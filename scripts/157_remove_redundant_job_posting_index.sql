-- Remove redundant job posting unique index
-- The index signals_job_posting_type_id_unique conflicts with idx_signals_unique_job_posting_v2
-- Both target (job_posting_id, signal_type, signal_id) but one has WHERE clause and one doesn't
-- This causes "no unique or exclusion constraint matching the ON CONFLICT specification" error

-- Keep idx_signals_unique_job_posting_v2 (with WHERE job_posting_id IS NOT NULL)
-- Drop the redundant signals_job_posting_type_id_unique

DROP INDEX IF EXISTS public.signals_job_posting_type_id_unique;

-- Verify the remaining correct indexes
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'signals'
AND indexdef LIKE '%UNIQUE%'
ORDER BY indexname;
