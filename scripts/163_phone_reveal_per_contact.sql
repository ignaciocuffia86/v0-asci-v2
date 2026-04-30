-- ============================================================================
-- Phone reveal per contact (on-demand)
--
-- Agrega la columna `phone_requested_at` para implementar:
--  - cooldown de 7 dias entre intentos de reveal por contacto
--  - timeout de pending (cron futuro: si pending > 30 min sin webhook -> not_available)
--
-- El resto de columnas ya existen:
--  - phone_status (script 108): not_requested | pending | received | not_available
--  - apollo_person_id, apollo_request_id, mobile_phone, phone (script 098 + 108)
-- ============================================================================

ALTER TABLE public.user_company_contacts
  ADD COLUMN IF NOT EXISTS phone_requested_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_company_contacts.phone_requested_at IS
  'Timestamp del ultimo intento de reveal de telefono via Apollo. Se usa para cooldown de 7 dias y timeout de pending.';

-- Indice parcial para acelerar la query del cron timeout (todavia no implementado, pero
-- la columna es barata de indexar y deja la infra lista).
CREATE INDEX IF NOT EXISTS idx_user_company_contacts_phone_pending
  ON public.user_company_contacts (phone_requested_at)
  WHERE phone_status = 'pending';

-- Indice para el match del webhook por apollo_person_id (path principal).
CREATE INDEX IF NOT EXISTS idx_user_company_contacts_apollo_person_id
  ON public.user_company_contacts (apollo_person_id)
  WHERE apollo_person_id IS NOT NULL;

-- Indice para el fallback del webhook por linkedin_url (cuando Apollo no manda apollo_id).
CREATE INDEX IF NOT EXISTS idx_user_company_contacts_linkedin_url
  ON public.user_company_contacts (linkedin_url)
  WHERE linkedin_url IS NOT NULL;
