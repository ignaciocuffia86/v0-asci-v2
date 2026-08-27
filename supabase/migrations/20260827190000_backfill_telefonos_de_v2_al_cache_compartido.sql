-- ═══════════════════════════════════════════════════════════
-- Los teléfonos que v2 ya pagó, al caché compartido.
--
-- POR QUÉ
-- -------
-- El reveal de teléfono de v2 escribe en `public.user_company_contacts`, que es
-- su propia tabla por usuario. El caché compartido —`public.apollo_contacts_cache`,
-- que es de donde lee v3— nunca los vio: tiene 4.416 personas y CERO teléfonos.
--
-- La migración anterior (20260827172000) y el camino nuevo del webhook hacen que
-- los teléfonos NUEVOS aterricen en el caché. Estos son los viejos, y sin este
-- backfill el MCP saldría a pagarle a Apollo por 80 números que ya compramos —
-- exactamente el error que se acaba de cerrar para los emails.
--
-- QUÉ MUEVE, MEDIDO
-- -----------------
--   106 filas con teléfono en user_company_contacts
--    80 PERSONAS distintas (la tabla duplica el contacto por bookmark, hasta 4
--       filas por persona; contar filas infla el número en un 32%)
--    80 de esas 80 ya tienen fila en apollo_contacts_cache — 0 huérfanas
--    65 con móvil, 15 solo con fijo
--     0 personas con dos números distintos entre sus filas duplicadas
--
-- Cero conflictos y cero filas nuevas: son 80 UPDATE sobre filas que ya existen.
-- Por eso NO se insertan personas nuevas acá. Importar al caché gente que nunca
-- pasó por el enrichment de v3 es otra decisión —traería su email, su cargo, su
-- empresa— y no es lo que este backfill viene a resolver.
--
-- LA REGLA DE ESCRITURA
-- ---------------------
-- Solo se llena la columna si está VACÍA. Es la misma que ya aplican v2 y el
-- webhook: un número cargado a mano vale más que uno que vuelve de Apollo, y
-- pisarlo es una pérdida que nadie ve. Hoy el caché tiene 0 teléfonos así que la
-- guarda no cambia nada, pero deja la migración segura de re-correr.
--
-- El móvil manda sobre el fijo cuando hay los dos, igual que `pickBestPhone`.
-- ═══════════════════════════════════════════════════════════

with por_persona as (
  select
    apollo_person_id,
    -- Sin conflicto medido (0 personas con dos números distintos), así que el
    -- max() elige el único que hay. Va explícito para que re-correrlo sea
    -- determinista aunque en el futuro sí haya duplicados divergentes.
    max(nullif(btrim(mobile_phone), '')) as movil,
    max(nullif(btrim(phone), ''))        as fijo
  from public.user_company_contacts
  where apollo_person_id is not null
    and (nullif(btrim(mobile_phone), '') is not null or nullif(btrim(phone), '') is not null)
  group by apollo_person_id
)
update public.apollo_contacts_cache c
   set mobile_phone = coalesce(nullif(btrim(c.mobile_phone), ''), p.movil),
       phone        = coalesce(nullif(btrim(c.phone), ''),        p.fijo),
       updated_at   = now()
  from por_persona p
 where c.apollo_id = p.apollo_person_id
   -- Solo las filas donde hay algo REAL para escribir. Sin esto, el UPDATE
   -- tocaría updated_at de filas que no cambian, y `splitByContactCache` usa
   -- esa fecha para decidir frescura: las estaríamos rejuveneciendo sin motivo.
   and (
     (nullif(btrim(c.mobile_phone), '') is null and p.movil is not null)
     or
     (nullif(btrim(c.phone), '') is null and p.fijo is not null)
   );
