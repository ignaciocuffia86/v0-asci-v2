-- Fase 4: soporte para cron de re-verify
--
-- Agrega columnas y vista para detectar contactos "stale" que necesitan
-- re-verificación contra Apollo. El job de ejecución está en código
-- (/app/api/cron/apollo-reverify/route.ts) y se dispara desde Vercel Cron.
-- ---------------------------------------------------------------------------

alter table user_company_contacts
  add column if not exists needs_review boolean default false;

alter table user_company_contacts
  add column if not exists review_reason text;

-- Índice para queries rápidas del cron
create index if not exists idx_user_company_contacts_needs_review
  on user_company_contacts (needs_review)
  where needs_review = true;

create index if not exists idx_user_company_contacts_last_verified
  on user_company_contacts (last_verified_at)
  where apollo_person_id is not null;

-- Vista: contactos candidatos a re-verify (>90 días desde la última verificación)
create or replace view apollo_reverify_candidates as
select
  id,
  user_id,
  company_id,
  apollo_person_id,
  linkedin_url,
  full_name,
  last_verified_at,
  extract(epoch from (now() - last_verified_at)) / 86400 as days_since_verified
from user_company_contacts
where apollo_person_id is not null
  and source = 'apollo'
  and (
    last_verified_at is null
    or last_verified_at < now() - interval '90 days'
  )
  and (status is null or status != 'archived');

comment on view apollo_reverify_candidates is
  'Contactos de Apollo con más de 90 días sin re-verificar. Usado por el cron /api/cron/apollo-reverify.';
