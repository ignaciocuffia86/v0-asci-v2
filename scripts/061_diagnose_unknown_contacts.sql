-- Diagnostic script: Find signals with Unknown contacts for Banco Hipotecario
-- This will help us understand why we have contacts without names

-- Step 1: Find the company ID for Banco Hipotecario
SELECT id, name FROM companies WHERE name ILIKE '%banco hipotecario%' LIMIT 5;

-- Fixed column names to match actual schema
-- Step 2: Get all signals for this company with contact details
SELECT 
    s.id as signal_id,
    s.signal_type,
    s.keyword_matched,
    s.snippet,
    s.contact_id,
    c.id as contact_table_id,
    c.full_name as contact_name,
    c.first_name,
    c.last_name,
    c.headline as contact_title,
    c.linkedin_url
FROM signals s
LEFT JOIN contacts c ON s.contact_id = c.id
WHERE s.company_id IN (SELECT id FROM companies WHERE name ILIKE '%banco hipotecario%')
AND s.contact_id IS NOT NULL
ORDER BY c.full_name NULLS FIRST
LIMIT 20;

-- Fixed to use correct columns and join through signals
-- Step 3: Check if there are contacts with NULL or empty names
SELECT 
    c.id,
    c.full_name,
    c.first_name,
    c.last_name,
    c.headline,
    c.about
FROM contacts c
WHERE c.id IN (
    SELECT DISTINCT contact_id FROM signals 
    WHERE company_id IN (SELECT id FROM companies WHERE name ILIKE '%banco hipotecario%')
    AND contact_id IS NOT NULL
)
AND (c.full_name IS NULL OR c.full_name = '' OR c.full_name = 'Unknown')
LIMIT 10;

-- Fixed column name from c.name to c.full_name
-- Step 4: Count signals by contact name status
SELECT 
    CASE 
        WHEN c.full_name IS NULL THEN 'NULL name'
        WHEN c.full_name = '' THEN 'Empty name'
        WHEN c.full_name = 'Unknown' THEN 'Unknown name'
        ELSE 'Has name'
    END as name_status,
    COUNT(*) as signal_count
FROM signals s
LEFT JOIN contacts c ON s.contact_id = c.id
WHERE s.company_id IN (SELECT id FROM companies WHERE name ILIKE '%banco hipotecario%')
AND s.contact_id IS NOT NULL
GROUP BY name_status;
