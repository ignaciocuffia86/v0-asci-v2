-- ASCI v3 — trazabilidad de resolución canónica. Aditivo; no modifica public/v2.
ALTER TABLE v3.research_jobs
  ADD COLUMN IF NOT EXISTS resolution_matched_by text,
  ADD COLUMN IF NOT EXISTS resolution_confidence numeric,
  ADD COLUMN IF NOT EXISTS resolution_reason text,
  ADD COLUMN IF NOT EXISTS original_company_id uuid;

ALTER TABLE v3.research_jobs DROP CONSTRAINT IF EXISTS research_jobs_resolution_matched_by_check;
ALTER TABLE v3.research_jobs ADD CONSTRAINT research_jobs_resolution_matched_by_check
  CHECK (resolution_matched_by IS NULL OR resolution_matched_by IN ('domain','alias','exact_name','ranked'));
