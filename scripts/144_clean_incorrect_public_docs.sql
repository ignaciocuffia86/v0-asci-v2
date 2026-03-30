-- Clean up incorrectly fetched public docs
-- These were fetched from SEC for wrong companies (CIK mismatch)

-- First, reset the is_public and cik fields for companies that were incorrectly marked
-- This forces a re-check with the stricter matching logic
UPDATE companies
SET 
  is_public = NULL,
  cik = NULL,
  ticker = NULL,
  public_status_checked_at = NULL
WHERE 
  is_public = true 
  AND cik IS NOT NULL
  AND (
    -- Non-US companies should not have SEC filings
    LOWER(country) NOT IN ('us', 'usa', 'united states', 'estados unidos', '')
    OR country IS NULL
  );

-- Delete public docs that came from SEC for companies that shouldn't have SEC filings
DELETE FROM company_public_docs
WHERE source_name = 'SEC EDGAR'
AND company_id IN (
  SELECT id FROM companies 
  WHERE LOWER(country) NOT IN ('us', 'usa', 'united states', 'estados unidos')
  AND country IS NOT NULL
);

-- Log what we cleaned
SELECT 
  'Cleaned companies' as action,
  COUNT(*) as count
FROM companies
WHERE public_status_checked_at IS NULL
  AND cik IS NULL;
