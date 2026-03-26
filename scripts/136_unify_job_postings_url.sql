-- Migration 136: Unify job_postings URL columns into a single job_url column
--
-- Background:
-- - posting_url: populated from jobUrl/url/uniq_id (LinkedIn listing URL, some scrapers)
-- - apply_url:   populated from applyUrl/apply_url/apply_link (LinkedIn listing URL, other scrapers)
-- Both columns store the same type of data. No row has both populated simultaneously.
-- Some rows are duplicates: same URL loaded from two different scrapers, one in each column.
--
-- Strategy:
-- 1. Add job_url = COALESCE(apply_url, posting_url)
-- 2. Deduplicate rows with the same job_url (keep the one with more signals / newer)
-- 3. Add UNIQUE index on job_url
-- 4. Drop apply_url and posting_url

-- Step 1: Add new unified column
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS job_url TEXT;

-- Step 2: Consolidate existing data into job_url
UPDATE job_postings
SET job_url = COALESCE(apply_url, posting_url)
WHERE job_url IS NULL;

-- Step 3: Deduplicate — keep the row with the lowest id (oldest import) for each job_url
-- Delete the duplicates (higher id = later import of same job)
DELETE FROM job_postings
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY job_url ORDER BY created_at ASC NULLS LAST, id ASC) AS rn
    FROM job_postings
    WHERE job_url IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Step 4: Drop existing unique constraints on posting_url if any
DO $$
BEGIN
  ALTER TABLE job_postings DROP CONSTRAINT IF EXISTS job_postings_posting_url_key;
EXCEPTION WHEN others THEN NULL;
END $$;

DROP INDEX IF EXISTS job_postings_posting_url_key;
DROP INDEX IF EXISTS idx_job_postings_posting_url;
DROP INDEX IF EXISTS job_postings_posting_url_idx;

-- Step 5: Add unique index on job_url
CREATE UNIQUE INDEX idx_job_postings_job_url ON job_postings (job_url) WHERE job_url IS NOT NULL;

-- Step 6: Performance index
CREATE INDEX IF NOT EXISTS idx_job_postings_company_active ON job_postings (company_id, is_active) WHERE is_active = true;

-- Step 7: Drop redundant columns
ALTER TABLE job_postings DROP COLUMN IF EXISTS apply_url;
ALTER TABLE job_postings DROP COLUMN IF EXISTS posting_url;

-- Verify
SELECT
  COUNT(*)                                    AS total,
  COUNT(job_url)                              AS has_job_url,
  COUNT(CASE WHEN job_url IS NULL THEN 1 END) AS missing_job_url
FROM job_postings;
