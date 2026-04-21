-- Migration 110: add apollo_request_id to user_company_contacts
-- Proposito: correlacionar el request_id de Apollo cuando hacemos reveal de
-- telefono con el payload del webhook que llega despues. Sin esto, cuando
-- Apollo postea el webhook, no sabemos a que prospecto corresponde (el payload
-- solo trae person.id de Apollo, que puede matchear a varios prospectos
-- distintos en caso de dedup).
-- Idempotente: ADD COLUMN IF NOT EXISTS.

alter table public.user_company_contacts
  add column if not exists apollo_request_id text;

create index if not exists idx_ucc_apollo_request_id
  on public.user_company_contacts (apollo_request_id)
  where apollo_request_id is not null;

comment on column public.user_company_contacts.apollo_request_id is
  'Request ID que devuelve Apollo al hacer people/match con reveal_phone_number=true. Permite correlacionar el webhook async con el prospecto que disparo el reveal.';
