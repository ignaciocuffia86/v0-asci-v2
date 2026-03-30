-- Migration 145: Clean mismatched public documents
-- This removes documents where the company name doesn't match the document content

-- Delete public docs that are clearly for different companies
-- by checking if document title/source contains the company name

-- First, let's identify and delete docs where the company name is NOT in the title
-- This is a safer approach than trying to match complex patterns

-- Delete documents from company_public_docs where the document clearly belongs to another company
DELETE FROM company_public_docs
WHERE id IN (
  SELECT cpd.id
  FROM company_public_docs cpd
  JOIN companies c ON cpd.company_id = c.id
  WHERE 
    -- Document title does not contain company name (case insensitive)
    LOWER(cpd.document_title) NOT LIKE '%' || LOWER(SPLIT_PART(c.name, ' ', 1)) || '%'
    -- And source URL also doesn't contain company name
    AND LOWER(cpd.source_url) NOT LIKE '%' || LOWER(REPLACE(c.name, ' ', '')) || '%'
    AND LOWER(cpd.source_url) NOT LIKE '%' || LOWER(SPLIT_PART(c.name, ' ', 1)) || '%'
    -- Only for recently created docs (to catch the bad imports)
    AND cpd.created_at > NOW() - INTERVAL '7 days'
);

-- Reset is_public flag for non-US companies that were incorrectly marked
UPDATE companies
SET 
  is_public = NULL,
  cik = NULL,
  public_status_checked_at = NULL
WHERE 
  country IS NOT NULL 
  AND LOWER(country) NOT IN ('us', 'usa', 'united states', 'estados unidos', '')
  AND cik IS NOT NULL;

-- Log the cleanup
DO $$
BEGIN
  RAISE NOTICE 'Cleaned mismatched public documents and reset non-US company status';
END $$;
