DROP FUNCTION IF EXISTS export_contacts(TEXT, TEXT[], TEXT[], BOOLEAN, INTEGER);

CREATE OR REPLACE FUNCTION export_contacts(
  p_signal_type TEXT,
  p_signal_names TEXT[],
  p_countries TEXT[],
  p_only_corporate_email BOOLEAN,
  p_limit INTEGER
)
RETURNS TABLE (
  contact_id UUID,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  job_title TEXT,
  company_name TEXT,
  company_country TEXT,
  linkedin_url TEXT,
  email TEXT,
  signal_type TEXT,
  signal_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH filtered_signals AS (
    -- Step 1: Get all signals matching the criteria
    SELECT DISTINCT
      s.contact_id,
      s.company_id,
      s.signal_type,
      CASE 
        WHEN s.signal_type = 'process' THEN dp.name
        WHEN s.signal_type = 'technology' THEN dprod.name
        ELSE NULL
      END as signal_name
    FROM signals s
    LEFT JOIN dictionary_processes dp ON s.signal_type = 'process' AND s.signal_id = dp.id
    LEFT JOIN dictionary_products dprod ON s.signal_type = 'technology' AND s.signal_id = dprod.id
    WHERE 
      -- Filter by signal type
      (p_signal_type IS NULL OR s.signal_type = p_signal_type)
      -- Filter by signal names
      AND (p_signal_names IS NULL 
        OR (s.signal_type = 'process' AND dp.name ILIKE ANY(p_signal_names))
        OR (s.signal_type = 'technology' AND dprod.name ILIKE ANY(p_signal_names))
      )
  ),
  filtered_companies AS (
    -- Step 2: Get companies in selected countries
    SELECT id, name, country_normalized
    FROM companies
    WHERE p_countries IS NULL OR country_normalized = ANY(p_countries)
  ),
  contact_signals AS (
    -- Step 3: Join signals with companies and filter by country
    SELECT DISTINCT
      fs.contact_id,
      fs.signal_type,
      fs.signal_name,
      fc.country_normalized
    FROM filtered_signals fs
    INNER JOIN filtered_companies fc ON fs.company_id = fc.id
  )
  -- Step 4: Get contact details with signal info
  SELECT DISTINCT
    c.id as contact_id,
    c.first_name,
    c.last_name,
    COALESCE(c.full_name, c.first_name || ' ' || c.last_name) as full_name,
    c.current_position_title as job_title,
    comp.name as company_name,
    comp.country_normalized as company_country,
    c.linkedin_url,
    c.email1 as email,
    cs.signal_type,
    cs.signal_name
  FROM contact_signals cs
  INNER JOIN contacts c ON cs.contact_id = c.id
  INNER JOIN companies comp ON comp.id = c.current_company_id
  WHERE
    -- Filter by email if needed
    (NOT p_only_corporate_email OR (
      c.email1 IS NOT NULL
      AND c.email1 NOT ILIKE '%@gmail.com'
      AND c.email1 NOT ILIKE '%@hotmail.com'
      AND c.email1 NOT ILIKE '%@yahoo.com'
      AND c.email1 NOT ILIKE '%@outlook.com'
      AND c.email1 NOT ILIKE '%@aol.com'
      AND c.email1 NOT ILIKE '%@mail.com'
      AND c.email1 NOT ILIKE '%@protonmail.com'
      AND c.email1 NOT ILIKE '%@icloud.com'
      AND c.email1 NOT ILIKE '%@zoho.com'
    ))
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_signals_signal_type ON signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_signals_signal_id ON signals(signal_id);
CREATE INDEX IF NOT EXISTS idx_signals_contact_id ON signals(contact_id);
CREATE INDEX IF NOT EXISTS idx_signals_company_id ON signals(company_id);
CREATE INDEX IF NOT EXISTS idx_companies_country_normalized ON companies(country_normalized);
CREATE INDEX IF NOT EXISTS idx_contacts_current_company_id ON contacts(current_company_id);
