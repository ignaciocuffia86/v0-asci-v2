-- ═══════════════════════════════════════════════════════════════════
-- Capa 3: un keyword, una entrada de diccionario
--
-- El problema
-- -----------
-- 37 de los 3.694 keywords del diccionario están en DOS entradas a la vez.
-- El matcher (process_job_signals / process_contact_signals) recorre entrada
-- por entrada, así que una sola mención en un aviso genera una señal por cada
-- entrada que reclame ese keyword. Medido: 222.291 señales llevan un keyword
-- ambiguo y 151.906 están infladas — 75.953 evidencias contadas dos veces.
--
-- Choca de frente con la unidad canónica de la capa 1 (empresa, entrada de
-- diccionario, persona): dos entradas son dos señales canónicas, así que esto
-- no se puede plegar aguas abajo. Hay que arreglarlo en el diccionario.
--
-- Ejemplo real: un "Gerente de marca" de Quala cuya descripción dice
-- "innovación" produce una señal de Innovación Tecnológica y otra de
-- Transformación Digital, del mismo campo y la misma palabra.
--
-- La regla
-- --------
-- Cada keyword pertenece a exactamente una entrada. Las relaciones reales
-- entre entradas (WooCommerce implica comercio electrónico, AS/400 implica
-- on-premise) se modelan como derivación entre entradas, no duplicando el
-- keyword; eso queda pendiente.
--
-- Cómo se resolvió cada caso
-- --------------------------
--   · Gana la entrada más específica: help desk → Soporte y Atención (no
--     Experiencia del Cliente); as/400 → AS/400 (no On-Premise).
--   · "Control administrativo financiero" es el brief de un cliente puntual
--     (regalías, giras) cargado al diccionario global. Con 7 keywords genéricas
--     se volvió la entrada #1 de la base: 189.700 señales en 65.118 empresas.
--     Se queda solo con su vocabulario propio.
--   · Los keywords que no identifican nada se eliminan de todas: "innovación"
--     es relleno en cualquier aviso corporativo, y "cors middleware" /
--     "jwt authentication" / "lifecycle hooks" no distinguen un framework de
--     otro. Se van también 'versionado_test_final', que quedó de una prueba.
--   · "gestion de riesgos" NO se elimina aunque sea polisémico (compliance,
--     seguridad informática, riesgo laboral, riesgo de proyecto). A diferencia
--     de "innovación" son 174 señales, no 45.000, y sacarlo dejaría sin señal a
--     gente de compliance real. Queda en Legal y Cumplimiento, la lectura
--     dominante, al lado de "risk management" que ya estaba ahí.
--
-- Acentos
-- -------
-- El matcher usa ~* : ignora mayúsculas pero NO acentos. Por eso hay pares que
-- no se veían como ambiguos y lo son ("Gestión de proveedores" en Compras vs
-- "gestion de proveedores" en Logística): el concepto caía en una entrada u
-- otra según cómo lo escribieran en el aviso. Son 3 y se unifican, CONSERVANDO
-- las dos grafías en la entrada ganadora para no perder cobertura.
--
-- Reversible: v3.dictionary_snapshot y v3.signal_keyword_repairs guardan el
-- estado previo. v3.revert_keyword_ownership() lo restaura.
-- ═══════════════════════════════════════════════════════════════════

-- Normalización de keyword: sin acentos y en minúscula. Es MÁS agresiva que el
-- matcher a propósito — sirve para detectar colisiones que el matcher no ve.
create or replace function public.normalize_keyword(p_kw text)
returns text language sql immutable as $function$
  SELECT lower(translate(btrim(coalesce(p_kw,'')),
    'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
    'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'))
$function$;

comment on function public.normalize_keyword(text) is
  'Keyword sin acentos ni mayúsculas, para detectar dos entradas que reclaman el mismo término.';

-- ───────────────────────────────────────────────────────────────────
-- El plan: quién es dueño de cada keyword disputado
-- owner_name NULL = el keyword no identifica nada y se elimina de todas.
-- ───────────────────────────────────────────────────────────────────
create table if not exists v3.keyword_ownership_plan (
  keyword_norm text primary key,
  owner_name   text,
  owner_kind   text check (owner_kind in ('process','technology')),
  motivo       text not null
);
alter table v3.keyword_ownership_plan enable row level security;

insert into v3.keyword_ownership_plan (keyword_norm, owner_name, owner_kind, motivo) values
  -- No identifican nada
  ('innovacion',              null, null, 'relleno corporativo: 49.458 señales sin valor discriminante'),
  ('cors middleware',         null, null, 'concepto web genérico, no distingue framework'),
  ('jwt authentication',      null, null, 'concepto web genérico, no distingue framework'),
  ('lifecycle hooks',         null, null, 'concepto genérico, no distingue framework'),
  ('versionado_test_final',   null, null, 'basura de una prueba en Liderazgo IT'),
  -- Vuelven a la taxonomía general (salen de Control administrativo financiero)
  ('finanzas',                'Finanzas y Contabilidad', 'process', 'término genérico de finanzas'),
  ('cuentas por cobrar',      'Finanzas y Contabilidad', 'process', 'término genérico de finanzas'),
  ('cuentas por pagar',       'Finanzas y Contabilidad', 'process', 'término genérico de finanzas'),
  ('planificacion financiera','Finanzas y Contabilidad', 'process', 'término genérico de finanzas'),
  ('tesoreria',               'Finanzas y Contabilidad', 'process', 'más específico que Inversiones y cartera'),
  ('contratos',               'Legal y Cumplimiento',    'process', 'la gestión contractual es legal'),
  ('due diligence',           'Legal y Cumplimiento',    'process', 'es legal, no sostenibilidad'),
  ('etica empresarial',       'Legal y Cumplimiento',    'process', 'es compliance, no sostenibilidad'),
  ('gestion de riesgos',      'Legal y Cumplimiento',    'process', 'lectura dominante; convive con risk management'),
  ('reporting',               'Business Intelligence y Análisis', 'process', 'reporting es BI'),
  ('analisis de costos',      'Compras',                 'process', 'análisis de costos es de abastecimiento'),
  ('gestion de proveedores',  'Compras',                 'process', 'la gestión de proveedores es procurement'),
  ('supply chain',            'Logística y Operaciones', 'process', 'Logística ya tiene "cadena de suministro"'),
  ('seguimiento pedidos',     'Logística y Operaciones', 'process', 'el seguimiento de entregas es logística'),
  ('transformacion digital',  'Transformación Digital',  'process', 'Liderazgo IT tenía el nombre de otra entrada'),
  ('help desk',               'Soporte y Atención al Cliente', 'process', 'más específico que Experiencia del Cliente'),
  ('service desk',            'Soporte y Atención al Cliente', 'process', 'más específico que Experiencia del Cliente'),
  ('customer support',        'Soporte y Atención al Cliente', 'process', 'más específico que Experiencia del Cliente'),
  ('soporte tecnico',         'Soporte y Atención al Cliente', 'process', 'más específico que Experiencia del Cliente'),
  ('gestion de reclamos',     'Compliance y Reclamos',   'process', 'más específico que Experiencia del Cliente'),
  -- On-Premise pasa a technology y se queda con lo que es despliegue/hardware
  ('vmware',                  'On-Premise', 'technology', 'producto de virtualización, no un proceso'),
  ('citrix',                  'On-Premise', 'technology', 'producto de virtualización, no un proceso'),
  ('hyper-v',                 'On-Premise', 'technology', 'producto de virtualización, no un proceso'),
  ('hybrid cloud',            'On-Premise', 'technology', 'decisión del usuario: implica que hay on-premise'),
  ('on-premise',              'On-Premise', 'technology', 'es el nombre de la entrada'),
  -- ...pero cede los que nombran un producto más específico del diccionario técnico
  ('as/400',                  'AS/400',             'technology', 'el producto concreto gana'),
  ('iseries',                 'AS/400',             'technology', 'el producto concreto gana'),
  ('ibm power',               'AS/400',             'technology', 'el producto concreto gana'),
  ('palo alto',               'Palo Alto Networks', 'technology', 'el producto concreto gana'),
  ('palo alto networks',      'Palo Alto Networks', 'technology', 'el producto concreto gana'),
  ('oracle exadata',          'Oracle Database',    'technology', 'el producto concreto gana'),
  -- Producto específico contra el paraguas
  ('oracle integration cloud','Oracle ERP Cloud',   'technology', 'es plataforma de integración, no la base de datos'),
  ('exchange admin center',   'Microsoft Exchange Server', 'technology', 'el producto concreto gana al paraguas M365'),
  ('sharepoint admin center', 'Microsoft Sharepoint',      'technology', 'el producto concreto gana al paraguas M365'),
  ('woocommerce',             'Wordpress', 'technology', 'es un plugin de WordPress; lo de e-commerce será derivación'),
  ('options api',             'Vue.js',    'technology', 'Options API es de Vue; en Wordpress era un error')
on conflict (keyword_norm) do nothing;

-- ───────────────────────────────────────────────────────────────────
-- Rastro para deshacer
-- ───────────────────────────────────────────────────────────────────
create table if not exists v3.dictionary_snapshot (
  entry_id     uuid not null,
  entry_kind   text not null,
  entry_name   text not null,
  keywords     text[],
  fila_completa jsonb,
  snapshot_at  timestamptz not null default now(),
  primary key (entry_id, snapshot_at)
);
alter table v3.dictionary_snapshot enable row level security;

create table if not exists v3.signal_keyword_repairs (
  id             bigserial primary key,
  signal_row_id  uuid not null,
  accion         text not null check (accion in ('reatribuida','borrada')),
  signal_id_previo   uuid,
  signal_type_previo text,
  signal_id_nuevo    uuid,
  signal_type_nuevo  text,
  fila_completa  jsonb,
  aplicado_at    timestamptz not null default now()
);
create index if not exists idx_signal_keyword_repairs_row on v3.signal_keyword_repairs (signal_row_id);
alter table v3.signal_keyword_repairs enable row level security;

-- Los movimientos concretos, derivados del snapshot + el plan.
create table if not exists v3.keyword_ownership_moves (
  from_id      uuid not null,
  from_kind    text not null,
  from_name    text not null,
  keyword_norm text not null,
  to_id        uuid,
  to_kind      text,
  primary key (from_id, keyword_norm)
);
alter table v3.keyword_ownership_moves enable row level security;

-- ───────────────────────────────────────────────────────────────────
-- 1. Foto del diccionario antes de tocarlo
-- ───────────────────────────────────────────────────────────────────
insert into v3.dictionary_snapshot (entry_id, entry_kind, entry_name, keywords, fila_completa)
select pr.id, 'process', pr.name, pr.keywords, to_jsonb(pr)
from public.dictionary_processes pr
where not exists (select 1 from v3.dictionary_snapshot s where s.entry_id = pr.id)
union all
select p.id, 'technology', p.name, p.keywords, to_jsonb(p)
from public.dictionary_products p
where not exists (select 1 from v3.dictionary_snapshot s where s.entry_id = p.id);

-- ───────────────────────────────────────────────────────────────────
-- 2. On-Premise deja de ser un proceso
--
-- Sus 123 keywords son nombres de hardware y fabricantes (APC, Dell PowerEdge,
-- HPE ProLiant, Lenovo ThinkSystem, NetApp, VMware). No es un proceso de
-- negocio, es un modelo de despliegue, y por eso competía con el diccionario
-- técnico. Se mueve CONSERVANDO EL UUID: signals.signal_id es polimórfico y no
-- tiene FK, así que las 27.291 señales existentes siguen apuntando bien; solo
-- hay que darles vuelta el signal_type.
-- ───────────────────────────────────────────────────────────────────
do $do$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.dictionary_processes WHERE name = 'On-Premise';
  IF v_id IS NULL THEN
    RAISE NOTICE 'On-Premise ya estaba reclasificada';
    RETURN;
  END IF;

  -- Sin `categoria`: esa columna existe en producción pero no en el baseline
  -- del repo, y la migración tiene que correr en las dos.
  INSERT INTO public.dictionary_products (id, name, keywords, created_at, updated_at)
  SELECT id, name, keywords, created_at, now()
  FROM public.dictionary_processes WHERE id = v_id;

  UPDATE public.signals SET signal_type = 'technology'
  WHERE signal_id = v_id AND signal_type = 'process';

  DELETE FROM public.dictionary_processes WHERE id = v_id;
END $do$;

-- ───────────────────────────────────────────────────────────────────
-- 3. Qué keyword se va de qué entrada, y adónde
-- ───────────────────────────────────────────────────────────────────
with vivas as (
  select pr.id, 'process' as kind, pr.name, k
  from public.dictionary_processes pr, lateral unnest(pr.keywords) k
  union all
  select p.id, 'technology', p.name, k
  from public.dictionary_products p, lateral unnest(p.keywords) k
),
duenio as (
  select pl.keyword_norm, pl.owner_kind,
         (select v.id from vivas v where v.name = pl.owner_name and v.kind = pl.owner_kind limit 1) as owner_id
  from v3.keyword_ownership_plan pl
)
insert into v3.keyword_ownership_moves (from_id, from_kind, from_name, keyword_norm, to_id, to_kind)
select distinct v.id, v.kind, v.name, d.keyword_norm, d.owner_id, d.owner_kind
from vivas v
join duenio d on d.keyword_norm = public.normalize_keyword(v.k)
where d.owner_id is distinct from v.id
on conflict (from_id, keyword_norm) do nothing;

-- ───────────────────────────────────────────────────────────────────
-- 4. Sacar cada keyword de las entradas que no son su dueña
--
-- Se conserva la grafía original de la ganadora; solo se filtra por la forma
-- normalizada, que es como se detectó la colisión.
-- ───────────────────────────────────────────────────────────────────
update public.dictionary_processes d
set keywords = array(
      -- WITH ORDINALITY para conservar el orden original del array y no
      -- ensuciar el diff de futuras ediciones del diccionario.
      select t.k from unnest(d.keywords) with ordinality t(k, ord)
      where not exists (
        select 1 from v3.keyword_ownership_plan p
        where p.keyword_norm = public.normalize_keyword(t.k)
          and (p.owner_name is distinct from d.name or p.owner_kind is distinct from 'process')
      )
      order by t.ord
    ),
    updated_at = now()
where exists (
  select 1 from unnest(d.keywords) k
  join v3.keyword_ownership_plan p on p.keyword_norm = public.normalize_keyword(k)
  where p.owner_name is distinct from d.name or p.owner_kind is distinct from 'process'
);

update public.dictionary_products d
set keywords = array(
      -- WITH ORDINALITY para conservar el orden original del array y no
      -- ensuciar el diff de futuras ediciones del diccionario.
      select t.k from unnest(d.keywords) with ordinality t(k, ord)
      where not exists (
        select 1 from v3.keyword_ownership_plan p
        where p.keyword_norm = public.normalize_keyword(t.k)
          and (p.owner_name is distinct from d.name or p.owner_kind is distinct from 'technology')
      )
      order by t.ord
    ),
    updated_at = now()
where exists (
  select 1 from unnest(d.keywords) k
  join v3.keyword_ownership_plan p on p.keyword_norm = public.normalize_keyword(k)
  where p.owner_name is distinct from d.name or p.owner_kind is distinct from 'technology'
);

-- ───────────────────────────────────────────────────────────────────
-- 5. Las tres grafías que se habrían perdido
--
-- El matcher no normaliza acentos, así que la entrada ganadora necesita
-- también la variante que tenía la perdedora. Sin esto, un aviso que escriba
-- "Ética Empresarial" con acento dejaría de matchear.
-- ───────────────────────────────────────────────────────────────────
update public.dictionary_processes set keywords = keywords || array['Ética Empresarial'], updated_at = now()
where name = 'Legal y Cumplimiento'
  and not exists (select 1 from unnest(keywords) k where k = 'Ética Empresarial');

update public.dictionary_processes set keywords = keywords || array['gestion de proveedores'], updated_at = now()
where name = 'Compras'
  and not exists (select 1 from unnest(keywords) k where k = 'gestion de proveedores');

update public.dictionary_processes set keywords = keywords || array['Soporte Técnico'], updated_at = now()
where name = 'Soporte y Atención al Cliente'
  and not exists (select 1 from unnest(keywords) k where k = 'Soporte Técnico');

-- ───────────────────────────────────────────────────────────────────
-- 6. Reparar las señales ya generadas
--
-- No alcanza con borrar la señal de la entrada perdedora: si un aviso disparó
-- "contratos" SOLO por Control administrativo financiero, borrarla dejaría al
-- aviso sin señal cuando en realidad corresponde a Legal. Entonces:
--   · si la evidencia ya tiene la entrada ganadora → se borra (era el duplicado)
--   · si no → se reatribuye a la ganadora
--   · si el keyword no tiene dueño → se borra
-- Así ninguna evidencia pierde su señal por este cambio.
--
-- Va por lotes: el mayor movimiento son 49.458 señales de "innovación".
-- ───────────────────────────────────────────────────────────────────
drop function if exists v3.repair_keyword_ownership(int);
create function v3.repair_keyword_ownership(p_limit int default 20000)
returns table(reatribuidas int, borradas int, restantes bigint)
language plpgsql as $function$
DECLARE
  v_mv RECORD; v_re int := 0; v_del int := 0; v_n int; v_budget int := p_limit;
BEGIN
  FOR v_mv IN SELECT * FROM v3.keyword_ownership_moves LOOP
    EXIT WHEN v_budget <= 0;

    -- Borrar: sin dueño, o la evidencia ya tiene a la ganadora.
    WITH cand AS (
      SELECT s.id FROM public.signals s
      WHERE s.signal_id = v_mv.from_id
        AND public.normalize_keyword(s.keyword_matched) = v_mv.keyword_norm
        AND (
          v_mv.to_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.signals o
            WHERE o.signal_id = v_mv.to_id AND o.id <> s.id
              AND ( (s.job_posting_id IS NOT NULL AND o.job_posting_id = s.job_posting_id)
                 OR (s.contact_id  IS NOT NULL AND o.contact_id = s.contact_id
                                               AND o.company_id IS NOT DISTINCT FROM s.company_id) )
          )
        )
      LIMIT greatest(v_budget, 0)
    ), aud AS (
      INSERT INTO v3.signal_keyword_repairs
        (signal_row_id, accion, signal_id_previo, signal_type_previo, fila_completa)
      SELECT s.id, 'borrada', s.signal_id, s.signal_type, to_jsonb(s)
      FROM public.signals s JOIN cand c ON c.id = s.id
      RETURNING signal_row_id
    )
    DELETE FROM public.signals s USING aud WHERE s.id = aud.signal_row_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_del := v_del + v_n; v_budget := v_budget - v_n;

    CONTINUE WHEN v_mv.to_id IS NULL;
    EXIT WHEN v_budget <= 0;

    -- Reatribuir el resto a la entrada ganadora.
    WITH cand AS (
      SELECT s.id FROM public.signals s
      WHERE s.signal_id = v_mv.from_id
        AND public.normalize_keyword(s.keyword_matched) = v_mv.keyword_norm
      LIMIT greatest(v_budget, 0)
    ), aud AS (
      INSERT INTO v3.signal_keyword_repairs
        (signal_row_id, accion, signal_id_previo, signal_type_previo, signal_id_nuevo, signal_type_nuevo)
      SELECT s.id, 'reatribuida', s.signal_id, s.signal_type, v_mv.to_id, v_mv.to_kind
      FROM public.signals s JOIN cand c ON c.id = s.id
      RETURNING signal_row_id
    )
    UPDATE public.signals s SET signal_id = v_mv.to_id, signal_type = v_mv.to_kind
    FROM aud WHERE s.id = aud.signal_row_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_re := v_re + v_n; v_budget := v_budget - v_n;
  END LOOP;

  RETURN QUERY
    SELECT v_re, v_del,
           (SELECT count(*) FROM public.signals s
             JOIN v3.keyword_ownership_moves m
               ON m.from_id = s.signal_id
              AND m.keyword_norm = public.normalize_keyword(s.keyword_matched));
END $function$;

comment on function v3.repair_keyword_ownership(int) is
  'Reatribuye o borra las señales que quedaron en una entrada que ya no es dueña del keyword.';

-- ───────────────────────────────────────────────────────────────────
-- 7. Deshacer
-- ───────────────────────────────────────────────────────────────────
drop function if exists v3.revert_keyword_ownership();
create function v3.revert_keyword_ownership()
returns table(senales_restauradas int, senales_devueltas int, entradas_restauradas int)
language plpgsql as $function$
DECLARE v_ins int; v_upd int; v_dic int; v_id uuid;
BEGIN
  -- Señales borradas: se reinsertan tal cual estaban.
  INSERT INTO public.signals
  SELECT (jsonb_populate_record(null::public.signals, r.fila_completa)).*
  FROM v3.signal_keyword_repairs r
  WHERE r.accion = 'borrada'
    AND NOT EXISTS (SELECT 1 FROM public.signals s WHERE s.id = r.signal_row_id);
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  -- Señales reatribuidas: vuelven a su entrada original.
  UPDATE public.signals s
  SET signal_id = r.signal_id_previo, signal_type = r.signal_type_previo
  FROM v3.signal_keyword_repairs r
  WHERE r.accion = 'reatribuida' AND s.id = r.signal_row_id
    AND s.signal_id IS NOT DISTINCT FROM r.signal_id_nuevo;
  GET DIAGNOSTICS v_upd = ROW_COUNT;

  -- On-Premise vuelve a ser proceso.
  SELECT entry_id INTO v_id FROM v3.dictionary_snapshot
  WHERE entry_name = 'On-Premise' AND entry_kind = 'process' LIMIT 1;
  IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.dictionary_products WHERE id = v_id) THEN
    INSERT INTO public.dictionary_processes (id, name, keywords)
    SELECT v_id, 'On-Premise', keywords FROM v3.dictionary_snapshot
    WHERE entry_id = v_id ORDER BY snapshot_at LIMIT 1;
    UPDATE public.signals SET signal_type = 'process' WHERE signal_id = v_id;
    DELETE FROM public.dictionary_products WHERE id = v_id;
  END IF;

  -- Keywords de cada entrada, como estaban.
  UPDATE public.dictionary_processes d SET keywords = s.keywords, updated_at = now()
  FROM v3.dictionary_snapshot s WHERE s.entry_id = d.id AND s.keywords IS DISTINCT FROM d.keywords;
  GET DIAGNOSTICS v_dic = ROW_COUNT;

  UPDATE public.dictionary_products d SET keywords = s.keywords, updated_at = now()
  FROM v3.dictionary_snapshot s WHERE s.entry_id = d.id AND s.keywords IS DISTINCT FROM d.keywords;

  DELETE FROM v3.signal_keyword_repairs;
  DELETE FROM v3.keyword_ownership_moves;

  RETURN QUERY SELECT v_ins, v_upd, v_dic;
END $function$;

comment on function v3.revert_keyword_ownership() is
  'Deshace la capa 3: restaura señales, keywords y la clasificación de On-Premise.';

-- ───────────────────────────────────────────────────────────────────
-- 8. Correr la reparación
-- ───────────────────────────────────────────────────────────────────
DO $do$
DECLARE v_re int; v_del int; v_rest bigint; v_tot_re int := 0; v_tot_del int := 0;
BEGIN
  LOOP
    SELECT r.reatribuidas, r.borradas, r.restantes INTO v_re, v_del, v_rest
    FROM v3.repair_keyword_ownership(20000) r;
    v_tot_re := v_tot_re + v_re; v_tot_del := v_tot_del + v_del;
    EXIT WHEN coalesce(v_re,0) = 0 AND coalesce(v_del,0) = 0;
  END LOOP;
  RAISE NOTICE 'capa 3: % reatribuidas, % borradas, % sin resolver', v_tot_re, v_tot_del, v_rest;
END $do$;

-- ───────────────────────────────────────────────────────────────────
-- 9. Que no vuelva a pasar
--
-- Valida que ningún keyword quede en dos entradas. Se corre a mano o desde
-- un test; no es un trigger para no encarecer cada edición del diccionario.
-- ───────────────────────────────────────────────────────────────────
create or replace function public.check_keyword_ownership()
returns table(keyword_norm text, entradas text)
language sql stable as $function$
  WITH todas AS (
    SELECT pr.id, pr.name, public.normalize_keyword(k) AS norm
    FROM public.dictionary_processes pr, LATERAL unnest(pr.keywords) k
    UNION ALL
    SELECT p.id, p.name, public.normalize_keyword(k)
    FROM public.dictionary_products p, LATERAL unnest(p.keywords) k
  )
  SELECT t.norm, string_agg(DISTINCT t.name, ' ⟷ ' ORDER BY t.name)
  FROM todas t
  GROUP BY t.norm
  HAVING count(DISTINCT t.id) > 1
$function$;

comment on function public.check_keyword_ownership() is
  'Devuelve los keywords que quedaron en más de una entrada. Vacío = diccionario sano.';
