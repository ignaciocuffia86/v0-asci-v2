-- Limpieza del diccionario de tecnologias — ejecutada el 24/08/2026
-- Aprobada por el usuario a partir de docs/auditoria-diccionario-tecnologia.md
--
-- Se corrio en este orden contra produccion (proyecto asciv2-database).
-- Se deja como registro reproducible; el respaldo previo quedo en dictionary_backup_20260824.

-- ---------------------------------------------------------------------------
-- Paso 0 — respaldo del diccionario completo antes de tocar nada
-- ---------------------------------------------------------------------------
create table if not exists dictionary_backup_20260824 as
select p.id as product_id, p.vendor_id, v.name as vendor_name, p.name as product_name,
       p.keywords, now() as snapshot_at
from dictionary_products p
left join dictionary_vendors v on v.id = p.vendor_id;

-- ---------------------------------------------------------------------------
-- Paso 1 — señales huerfanas: la keyword ya no esta en el array del producto
-- Resultado: -18.607 señales, 0 huerfanas restantes.
-- Ojo: hacerlo en lotes. La version con subconsulta re-evaluada por iteracion
-- es cuadratica y se cuelga; conviene acotar por signal_id, que si tiene indice.
-- ---------------------------------------------------------------------------
delete from signals s
using dictionary_products p
where s.signal_id = p.id
  and s.signal_type = 'technology'
  and not exists (
    select 1 from unnest(p.keywords) k where lower(k) = lower(s.keyword_matched)
  );

-- ---------------------------------------------------------------------------
-- Paso 2 — keywords que nunca pueden matchear (empiezan o terminan en simbolo)
-- mas las cinco php_*, que son nombres de categoria internos.
-- Resultado: -41 keywords en 12 productos.
-- ---------------------------------------------------------------------------
update dictionary_products p
set keywords = (
      select coalesce(array_agg(k.kw order by ord), '{}')
      from unnest(p.keywords) with ordinality as k(kw, ord)
      where k.kw ~ '^\w' and k.kw ~ '\w$'
        and lower(k.kw) not in ('php_core','php_ecosystem','php_frameworks','php_cms','php_testing')
    ),
    updated_at = now()
where exists (
  select 1 from unnest(p.keywords) kw
  where kw !~ '^\w' or kw !~ '\w$'
     or lower(kw) in ('php_core','php_ecosystem','php_frameworks','php_cms','php_testing')
);

-- ---------------------------------------------------------------------------
-- Paso 3 — las 10 keywords de alto falso positivo marcadas "eliminar" en H2.
-- Cada una verificada contra snippets reales. Resultado: -9.389 señales.
--   Storage (Ionic)          "Data Base Storage. Application Server Storage"
--   PAN (Palo Alto)          1.435 de 1.695 dicen "Pan American Energy"
--   CMS (IBM Z)              "Backend en CMS basado", "Web site/CMS/Portal"
--   morgan (NodeJS)          apellido Morgan, J.P. Morgan
--   SAT (SAP ECC)            autoridad fiscal de Mexico
--   CP (IBM Z)               sigla de dos letras
--   Reactive (Vue.js)        adjetivo generico
--   Buffer (NodeJS)          termino generico
--   S1 (SentinelOne)         "S1 Seguridad Privada", "Norma S1 de Seguridad e Higiene"
--   SNOW (ServiceNow)        "Ski Corral... snow"
-- ---------------------------------------------------------------------------
with objetivo(product_name, kw) as (values
  ('Ionic','storage'), ('Palo Alto Networks','pan'),
  ('IBM Z','cms'), ('IBM Z','cp'),
  ('NodeJS / Express.Js','morgan'), ('NodeJS / Express.Js','buffer'),
  ('SAP ECC 6 / Business Suite 7','sat'), ('Vue.js','reactive'),
  ('Sentinel One','s1'), ('ServiceNow ITSM','snow')
)
update dictionary_products p
set keywords = (
      select coalesce(array_agg(k.kw order by ord), '{}')
      from unnest(p.keywords) with ordinality as k(kw, ord)
      where lower(k.kw) not in (select o.kw from objetivo o where o.product_name = p.name)
    ),
    updated_at = now()
where p.name in (select product_name from objetivo);

-- y despues, borrar las señales que quedaron sin keyword (mismo delete del paso 1)

-- ---------------------------------------------------------------------------
-- Paso 4a — fusionar Oracle PL/SQL dentro de Oracle Database
-- PL/SQL es el lenguaje de la base, no un producto aparte.
-- Resultado: 88 keywords, 13.372 señales en el producto unificado.
-- ---------------------------------------------------------------------------
-- 1) sumar las keywords que el destino no tenga
-- 2) borrar del origen las señales que colisionarian con los unique de signals:
--      unique (contact_id, company_id, signal_type, signal_id)
--      unique (job_posting_id, signal_type, signal_id)
--      unique (signal_id, contact_id, company_id) where contact_id is not null
-- 3) mover el resto con un update de signal_id
-- 4) borrar el producto vacio
-- Ver el patron completo en el paso 4b, que es identico.

-- ---------------------------------------------------------------------------
-- Paso 4b — unificar SAP ERP dentro de SAP ECC 6, renombrado a
-- "SAP ECC / Business Suite". Compartian 24 keywords identicas.
-- Resultado: 169 keywords, 13.538 señales, 5.123 cuentas.
-- Se deduplicaron 8.730 señales que eran la misma persona contada dos veces.
-- ---------------------------------------------------------------------------
-- (dst = SAP ECC 6, src = SAP ERP)
--
--   update dictionary_products dst
--   set keywords = (select array_agg(distinct kw) from (
--                     select unnest(dst.keywords) as kw
--                     union select unnest(src.keywords) from dictionary_products src where src.id = :src
--                   ) t where kw is not null),
--       name = 'SAP ECC / Business Suite', updated_at = now()
--   where dst.id = :dst;
--
--   delete from signals s
--   where s.signal_id = :src
--     and ( (s.contact_id is not null and exists (
--              select 1 from signals d where d.signal_id = :dst
--                and d.signal_type = s.signal_type and d.contact_id = s.contact_id
--                and d.company_id is not distinct from s.company_id))
--        or (s.job_posting_id is not null and exists (
--              select 1 from signals d where d.signal_id = :dst
--                and d.signal_type = s.signal_type and d.job_posting_id = s.job_posting_id)) );
--
--   update signals set signal_id = :dst where signal_id = :src;
--   update document_tags set tag_reference_id = :dst, tag_value = 'SAP ECC / Business Suite'
--     where tag_reference_id = :src;                 -- 10 filas
--   delete from dictionary_products where id = :src;

-- ---------------------------------------------------------------------------
-- Paso 4c — separar "Sentinel defender" en dos productos.
-- Microsoft Sentinel (SIEM) y Microsoft Defender (endpoint) se venden aparte;
-- mezclados no se puede distinguir una cuenta con SIEM de una con EDR.
-- Regla de corte: la keyword nombra a Defender y no menciona a Sentinel.
-- Resultado: Sentinel 97 kw / 96 señales · Defender 16 kw / 362 señales.
-- ---------------------------------------------------------------------------
-- insert into dictionary_products (vendor_id, name, keywords)
-- select src.vendor_id, 'Microsoft Defender',
--        (select array_agg(kw) from unnest(src.keywords) kw
--         where kw ~* 'defender' and kw !~* 'sentinel')
-- from dictionary_products src where src.id = :sentinel_defender;
--
-- update signals s set signal_id = :nuevo
-- where s.signal_id = :sentinel_defender
--   and exists (select 1 from dictionary_products d where d.id = :nuevo
--                 and lower(s.keyword_matched) = any (select lower(k) from unnest(d.keywords) k));
--
-- update dictionary_products p
-- set keywords = (select array_agg(kw) from unnest(p.keywords) kw
--                 where kw !~* 'defender' or kw ~* 'sentinel'),
--     name = 'Microsoft Sentinel', updated_at = now()
-- where p.id = :sentinel_defender;

-- ---------------------------------------------------------------------------
-- Verificacion final
-- ---------------------------------------------------------------------------
select
  (select count(*) from dictionary_products) as productos,
  (select sum(coalesce(array_length(keywords,1),0)) from dictionary_products) as keywords,
  (select count(*) from signals where signal_type = 'technology') as senales_tech,
  (select count(*) from signals s join dictionary_products p on p.id = s.signal_id
     where s.signal_type = 'technology'
       and not exists (select 1 from unnest(p.keywords) k where lower(k) = lower(s.keyword_matched))
  ) as huerfanas,
  (select count(*) from signals s where s.signal_type = 'technology'
     and not exists (select 1 from dictionary_products p where p.id = s.signal_id)
  ) as sin_producto;
-- 24/08/2026: 81 productos · 3.226 keywords · 288.644 señales · 0 huerfanas · 4.162 sin producto

-- ---------------------------------------------------------------------------
-- Paso 5 — senales de productos borrados (aprobado y ejecutado despues)
-- 4.162 senales cuyo signal_id apuntaba a ocho productos borrados entre
-- nov-2025 y mar-2026 (Node.js 2.970, Angular 601, Laravel 418, Wordpress 81,
-- Python 50, Django 28, Flask 12, Copilot 2). La UI no podia mostrarlas.
-- ---------------------------------------------------------------------------
delete from signals s
where s.signal_type = 'technology'
  and not exists (select 1 from dictionary_products p where p.id = s.signal_id);
-- 4.162 filas. Restantes: 0.
