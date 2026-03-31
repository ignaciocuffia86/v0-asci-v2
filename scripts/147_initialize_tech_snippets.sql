-- Initialize tech_snippets for existing records (backward compatibility)
-- This ensures old records have the new column populated with empty arrays

UPDATE company_public_docs
SET tech_snippets = COALESCE(tech_snippets, '[]'::jsonb)
WHERE tech_snippets IS NULL;

-- Verify the update
SELECT COUNT(*) as total_records, 
       COUNT(CASE WHEN tech_snippets = '[]'::jsonb THEN 1 END) as empty_snippets,
       COUNT(CASE WHEN tech_snippets != '[]'::jsonb THEN 1 END) as with_snippets
FROM company_public_docs;
