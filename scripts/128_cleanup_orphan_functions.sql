-- Cleanup orphan functions that are no longer referenced by any code
-- 
-- upsert_company_from_contact: replaced by upsert_company (same signature, 7 params)
-- upsert_company_from_job: replaced by upsert_company (which handles 7 params with defaults)

DROP FUNCTION IF EXISTS public.upsert_company_from_contact(text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.upsert_company_from_job(text, text, text, text, text, text);
