-- ═══════════════════════════════════════════════════════════
-- `v3.account_contacts.phone_status` pasa a hablar el vocabulario de v2.
--
-- EL PROBLEMA
-- -----------
-- Había tres vocabularios para el mismo eje y ninguno compatible con otro:
--
--   v2 (public.user_company_contacts, webhook)  not_requested · pending · received · not_available
--   v3 (CHECK de esta tabla)                    unknown · not_requested · processing · available · unavailable · failed
--   el código de v3                             escribía 'not_requested', leía 'processing'
--
-- Solo `not_requested` estaba en los dos CHECKs. Consecuencias medidas:
--
--   1. El webhook de Apollo escribe las palabras de v2. Si tocara esta tabla, el
--      CHECK lo rechazaría. O sea que el camino de vuelta del teléfono no podía
--      existir sin esta migración.
--   2. `mcp-contact-coverage` contaba pendientes buscando 'processing', que
--      nadie escribía nunca: `pendingPhone` daba 0 por construcción.
--
-- Es la misma forma exacta del bug que ya mató el enrichment una vez con
-- `role_origin: 'mcp_enrichment'`, rechazado por su propio CHECK. El CHECK tenía
-- razón las dos veces.
--
-- POR QUÉ GANA v2
-- ---------------
-- No por antigüedad. Es el vocabulario que está en producción con 5.148 filas
-- (not_requested 4.981, received 106, not_available 45, pending 16) y el que
-- habla el webhook de Apollo, que es la pieza que ninguna de las dos plataformas
-- controla. Alinear v3 a v2 es un CHECK y un default; alinear v2 a v3 sería
-- migrar datos vivos y reescribir el webhook.
--
-- SE PIERDE `failed`, a propósito. Era "se pidió y se rompió", que desde el lado
-- de quien lee un informe es indistinguible de que Apollo no lo entregara, y
-- tener las dos palabras obligaba a explicar la diferencia en cada informe.
--
-- SOBRE EL BACKFILL
-- -----------------
-- `v3.account_contacts` tiene 0 filas hoy: ningún enrichment por MCP llegó nunca
-- a completarse. El UPDATE va igual y no es ceremonia — esta migración puede
-- aplicarse en un entorno que sí tenga filas, y el orden importa: primero se
-- traducen los valores, después se aprieta el CHECK. Al revés, el CHECK nuevo
-- rechazaría las filas viejas y la migración fallaría a mitad de camino.
-- ═══════════════════════════════════════════════════════════

-- 1) Soltar el CHECK viejo ANTES de traducir: mientras esté puesto, ninguna de
--    las palabras nuevas entra.
alter table v3.account_contacts
  drop constraint if exists account_contacts_phone_status_check;

-- 2) Traducir lo que haya. El mapeo es el mismo que `normalizePhoneStatus` en
--    lib/shared/phone-status.ts, y tiene que seguir siéndolo.
update v3.account_contacts
   set phone_status = case phone_status
         when 'processing'  then 'pending'
         when 'available'   then 'received'
         when 'unavailable' then 'not_available'
         when 'failed'      then 'not_available'
         when 'unknown'     then 'not_requested'
         else phone_status
       end
 where phone_status not in ('not_requested', 'pending', 'received', 'not_available');

-- 3) El default se alinea con el de v2. Era 'unknown', que ni siquiera estaba en
--    el vocabulario que el código escribía.
alter table v3.account_contacts
  alter column phone_status set default 'not_requested';

-- 4) Y ahora sí, el CHECK nuevo: exactamente los cuatro de
--    public.user_company_contacts, ni uno más.
alter table v3.account_contacts
  add constraint account_contacts_phone_status_check
  check (phone_status in ('not_requested', 'pending', 'received', 'not_available'));

comment on column v3.account_contacts.phone_status is
  'Estado del pedido de teléfono a Apollo. Vocabulario COMPARTIDO con public.user_company_contacts: not_requested | pending | received | not_available. La fuente única en código es lib/shared/phone-status.ts — si cambia acá, cambia allá. El teléfono en sí NO vive en esta tabla: va a public.apollo_contacts_cache, que es donde v3 guarda la PII compartida.';
