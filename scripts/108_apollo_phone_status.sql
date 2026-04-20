-- 108_apollo_phone_status.sql
-- Agrega phone_status a user_company_contacts para tracking explícito del estado
-- del teléfono revelado por Apollo. Resuelve el caso donde el contacto se
-- inserta sin teléfono y la UI no sabe si debe esperarlo o no.
--
-- Estados:
--   'not_requested'  : el usuario no pidió reveal (revealPhone=false)
--   'pending'        : esperando webhook de Apollo
--   'received'       : el teléfono llegó (inline o via webhook)
--   'not_available'  : Apollo no lo encontró
--
-- Idempotente.

alter table user_company_contacts
  add column if not exists phone_status text default 'not_requested';

-- Backfill: registros con mobile_phone poblado => received; resto => not_requested
update user_company_contacts
   set phone_status = 'received'
 where source = 'apollo'
   and phone_status = 'not_requested'
   and mobile_phone is not null
   and mobile_phone <> '';

-- Constraint lógico para documentar valores válidos (check constraint amigable)
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
     where constraint_name = 'user_company_contacts_phone_status_check'
  ) then
    alter table user_company_contacts
      add constraint user_company_contacts_phone_status_check
      check (phone_status in ('not_requested', 'pending', 'received', 'not_available'));
  end if;
end $$;

-- Índice para que el polling de pendientes sea barato
create index if not exists idx_ucc_phone_status_pending
  on user_company_contacts (bookmark_id)
  where phone_status = 'pending';

comment on column user_company_contacts.phone_status is
  'Estado del reveal de teléfono en Apollo: not_requested | pending | received | not_available';
