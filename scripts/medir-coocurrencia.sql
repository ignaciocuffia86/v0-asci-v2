-- ═══════════════════════════════════════════════════════════════════
-- Medir una keyword candidata a co-ocurrencia ANTES de agregarla
--
-- El criterio de toda la auditoría no es el largo del acrónimo ni si la
-- palabra "suena" ambigua: es la razón entre señales identificablemente
-- reales y falsas sobre una muestra LEÍDA, con umbral de 80:20.
--
-- Este archivo es el procedimiento en cuatro pasos que se usó para las cinco
-- primeras keywords (Fabric, Exchange, Pub/Sub, Commerce Cloud, Web Forms).
-- Reemplazar :keyword, :producto_id y las dos listas.
--
-- Ver docs/auditoria-diccionario-tecnologia.md, sección "Co-ocurrencia".
-- ═══════════════════════════════════════════════════════════════════

-- ── Paso 0. El universo ────────────────────────────────────────────
-- El ILIKE es solo para acotar barato con el índice trgm; quien decide es el
-- regex con límites de palabra que viene después.
create temporary view cand as
select c.id,
  coalesce(c.current_position_title, '')       || ' ' ||
  coalesce(c.headline, '')                     || ' ' ||
  coalesce(c.about, '')                        || ' ' ||
  coalesce(c.current_position_description, '') || ' ' ||
  coalesce(public.contacts_prevpos_text(c.previous_positions), '') as t
from public.contacts c
where c.current_position_title ilike '%fabric%'
   or c.headline ilike '%fabric%'
   or c.about ilike '%fabric%'
   or c.current_position_description ilike '%fabric%'
   or public.contacts_prevpos_text(c.previous_positions) ilike '%fabric%';

-- Los patrones se arman con la MISMA función que usa el motor, para que la
-- medición no difiera del resultado real por un límite de palabra mal puesto.
-- (Medir con regex escrito a mano fue justamente lo que subestimó "Web Forms"
-- en un 25%: '\y\.NET\y' nunca matchea.)
create temporary view pat as
select
  public.dict_alt_pattern('{"Fabric": ["Power BI", "Synapse", "OneLake"]}'::jsonb, 'Fabric') as ctx,
  public.dict_alt_pattern('{"Fabric": ["Service Fabric", "Data Fabric"]}'::jsonb, 'Fabric') as excl;

-- ── Paso 1. El embudo ──────────────────────────────────────────────
-- Cuánto queda después de cada filtro. Si "final" es una fracción minúscula
-- del crudo, la keyword probablemente no valga la pena ni con reglas.
select
  count(*) filter (where t ~* '\yFabric\y')                                        as crudo,
  count(*) filter (where public.dict_mask(t, p.excl) ~* '\yFabric\y')              as tras_exclusion,
  count(*) filter (where public.dict_mask(t, p.excl) ~* '\yFabric\y' and t ~* p.ctx) as final
from cand, pat p;

-- ── Paso 2. Aporte marginal de cada término de contexto ────────────
-- "aporta" = cuántos trae. "unico_aporte" = cuántos trae que NINGÚN otro
-- término del núcleo ya traía. Un término con mucho aporte único es sospechoso:
-- suele estar ensanchando la red en vez de discriminar. Hay que leerlos.
--
-- Así se descartaron "Business Intelligence", "Data Engineer" y "Warehouse"
-- para Fabric: sumaban 26 perfiles y la mitad eran textiles y Fabric Care.
with m as (
  select c.t from cand c, pat p where public.dict_mask(c.t, p.excl) ~* '\yFabric\y'
), nucleo as (
  -- Los términos de los que ya no se duda. El aporte único se mide CONTRA
  -- esto, no contra la lista completa: si el candidato estuviera incluido en
  -- el patrón de comparación, su aporte único daría cero siempre.
  select public.dict_alt_pattern(
    '{"x": ["Power BI", "Synapse", "OneLake", "Lakehouse", "Data Factory", "Databricks"]}'::jsonb, 'x') as p
), term as (
  -- Los candidatos a evaluar.
  select unnest(array['DAX', 'Power Query', 'Warehouse', 'Business Intelligence', 'Data Engineer']) as k
)
select term.k,
  count(*) filter (where m.t ~* t_pat.p)                          as aporta,
  count(*) filter (where m.t ~* t_pat.p and not m.t ~* nucleo.p)  as unico_aporte
from term
cross join lateral (
  select public.dict_alt_pattern(jsonb_build_object('x', jsonb_build_array(term.k)), 'x') as p
) t_pat
cross join nucleo
cross join m
group by term.k, t_pat.p order by aporta desc;

-- ── Paso 3. Leer la muestra ────────────────────────────────────────
-- El paso que no se puede saltear. Los conteos dicen cuántos, no cuáles.
-- Leer 40 y contar cuántos son de verdad. Acá aparecieron las colocaciones que
-- nadie había pensado: "Fabric UI", "Fabric Manager", "urban fabric",
-- "K2View Fabric", "Fabric Controller", "e-commerce cloud".
select public.extract_snippet(public.dict_mask(t, p.excl), 'Fabric', 50) as snip
from cand, pat p
where public.dict_mask(t, p.excl) ~* '\yFabric\y'
  and t ~* p.ctx
order by md5(cand.id::text)
limit 40;

-- ── Paso 4. Aplicar ────────────────────────────────────────────────
-- Recién con la muestra por encima de 80:20. Desde el ABM del diccionario
-- (botón de mira en cada keyword) o, para un lote, como en
-- supabase/migrations/20260824153000_rescate_keywords_coocurrencia.sql
--
-- Al cambiar las reglas de una keyword que YA existe hay que encolar
-- remove_keyword y después add_keyword, en inserts separados: comparten
-- created_at si van juntas y el orden queda indefinido.
