-- Fase 4: dedup preciso por apollo_person_id en user_company_contacts
--
-- Nota: existen duplicados históricos con el mismo (user_id, company_id) pero
-- distinto apollo_person_id (personas que cambiaron de empresa o que fueron
-- cargadas por distintas búsquedas). Por eso creamos índices NO únicos.
-- El dedup estricto se aplica en código via upsert defensivo y en un job de
-- consolidación futuro (ver plan Fase 4).
-- ---------------------------------------------------------------------------

alter table user_company_contacts
  add column if not exists apollo_person_id text;

alter table user_company_contacts
  add column if not exists last_verified_at timestamptz;

-- Backfill desde apollo_contacts_cache si hay match por linkedin_url
update user_company_contacts ucc
set apollo_person_id = acc.apollo_id
from apollo_contacts_cache acc
where ucc.apollo_person_id is null
  and acc.linkedin_url is not null
  and ucc.linkedin_url = acc.linkedin_url;

-- Índice para lookups rápidos por (user, company, apollo_person_id)
create index if not exists idx_user_company_contacts_apollo
  on user_company_contacts (user_id, company_id, apollo_person_id)
  where apollo_person_id is not null;

-- Índice global por apollo_person_id (útil para "en qué empresas está esta persona")
create index if not exists idx_user_company_contacts_apollo_global
  on user_company_contacts (apollo_person_id)
  where apollo_person_id is not null;

comment on column user_company_contacts.apollo_person_id is
  'Apollo person ID para dedup preciso. Fase 4. Puede tener duplicados históricos; la consolidación ocurre en código.';

comment on column user_company_contacts.last_verified_at is
  'Última vez que la data fue verificada contra Apollo. Usado por el cron de re-verify (Fase 4).';
