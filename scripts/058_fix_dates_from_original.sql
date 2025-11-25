-- Fix job posting dates by reading from _original in source_data
-- The _original field contains the raw CSV row data

-- First, let's check what keys exist in _original for the first few records
DO $$
DECLARE
  v_sample JSONB;
  v_keys TEXT[];
BEGIN
  SELECT source_data->'_original' INTO v_sample
  FROM job_postings
  WHERE source_data->'_original' IS NOT NULL
  LIMIT 1;
  
  IF v_sample IS NOT NULL THEN
    RAISE NOTICE 'Sample _original keys: %', (SELECT array_agg(key) FROM jsonb_object_keys(v_sample) AS key);
  ELSE
    RAISE NOTICE '_original is null or not found';
  END IF;
END $$;

-- Update posted_at from _original.publishedAt (case-sensitive check for various formats)
UPDATE job_postings
SET posted_at = COALESCE(
  -- Try different case variations and field names
  (source_data->'_original'->>'publishedAt')::DATE,
  (source_data->'_original'->>'PublishedAt')::DATE,
  (source_data->'_original'->>'published_at')::DATE,
  (source_data->'_original'->>'PUBLISHEDAT')::DATE,
  (source_data->'_original'->>'post_date')::DATE,
  (source_data->'_original'->>'postDate')::DATE,
  -- Fallback to top-level source_data if _original doesn't have it
  (source_data->>'publishedAt')::DATE,
  (source_data->>'PublishedAt')::DATE,
  (source_data->>'published_at')::DATE,
  posted_at -- Keep existing if nothing found
)
WHERE source_data IS NOT NULL;

-- Also update the job_posted_at field in signals table
UPDATE signals s
SET job_posted_at = jp.posted_at
FROM job_postings jp
WHERE s.job_posting_id = jp.id
  AND s.job_posting_id IS NOT NULL;

-- Show results
SELECT 
  id,
  title,
  posted_at,
  source_data->'_original'->>'publishedAt' as original_publishedAt,
  jsonb_object_keys(COALESCE(source_data->'_original', '{}'::jsonb)) as available_keys
FROM job_postings
LIMIT 5;
