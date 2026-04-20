-- Fase 4: dedup robusto por apollo_person_id en user_company_contacts

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

create index if not exists idx_user_company_contacts_apollo_person_id
  on user_company_contacts (apollo_person_id)
  where apollo_person_id is not null;

-- Constraint único parcial: mismo user + company + apollo_person_id sólo una vez
create unique index if not exists uq_user_company_contacts_apollo
  on user_company_contacts (user_id, company_id, apollo_person_id)
  where apollo_person_id is not null;
