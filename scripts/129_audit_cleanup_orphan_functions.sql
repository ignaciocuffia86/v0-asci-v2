-- Audit cleanup: remove orphan/duplicate functions
-- 
-- Audit findings:
--
-- CONTACT PIPELINE (OK):
--   pg_cron → process_pending_queue(100) [SEC_DEF]
--     → process_import_batch(batch_id, chunk) [SEC_DEF, returns JSONB]
--       → process_contact_batch_internal(batch_id, limit) [SEC_DEF]
--         → upsert_company(7 params) [SEC_DEF]
--         → INSERT contacts
--         → process_contact_signals(contact_id) [SEC_DEF]
--           → extract_snippet(text, text, int) [IMMUTABLE] OK
--           → escape_regex(text) [IMMUTABLE-like] OK
--
-- JOB PIPELINE (OK):
--   pg_cron → process_pending_queue(100) [SEC_DEF]
--     → process_import_batch(batch_id, chunk) [SEC_DEF, returns JSONB]
--       → process_job_batch_internal(batch_id, limit) [SEC_DEF]
--         → upsert_company(7 params) [SEC_DEF]
--         → INSERT job_postings
--         → process_job_signals(job_id) [SEC_DEF, 1 arg]
--           → extract_snippet(text, text, int) [IMMUTABLE] OK
--           → escape_regex(text) via public.escape_regex() OK
--
-- SIGNALS REPROCESSING (OK):
--   pg_cron → process_pending_signals_batch(20) [SEC_DEF, 1 arg]
--     → process_contact_signals(contact_id) [SEC_DEF]
--     → process_job_signals(job_id) [SEC_DEF, 1 arg]
--
-- ORPHAN FUNCTIONS TO DROP:
-- 1. process_job_signals(uuid, text, uuid) - 3 arg version, NOT SEC_DEF, has bug with extract_snippet call, nobody calls it
-- 2. process_pending_signals_batch() - 0 arg version, NOT SEC_DEF, only marks signals.processed=true, nobody calls it

-- Drop orphan: process_job_signals with 3 args
DROP FUNCTION IF EXISTS public.process_job_signals(uuid, text, uuid);

-- Drop orphan: process_pending_signals_batch with 0 args  
DROP FUNCTION IF EXISTS public.process_pending_signals_batch();
