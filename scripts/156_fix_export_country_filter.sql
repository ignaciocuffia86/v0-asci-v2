-- RPC v8: Fix country filter to use 'country' field instead of corrupted 'country_normalized'
-- The country_normalized field has bad data (job titles, etc.), so we use the raw country field

DROP FUNCTION IF EXISTS export_contacts(TEXT, TEXT[], TEXT[], BOOLEAN, INTEGER);
DROP FUNCTION IF EXISTS export_contacts(TEXT, TEXT[], TEXT[], TEXT[], BOOLEAN, INTEGER);

CREATE OR REPLACE FUNCTION export_contacts(
  p_signal_type TEXT DEFAULT NULL,           -- 'process' or 'technology' or NULL for both
  p_signal_names TEXT[] DEFAULT NULL,        -- Array of signal names to filter
  p_countries TEXT[] DEFAULT NULL,           -- Array of countries (from companies.country)
  p_industries TEXT[] DEFAULT NULL,          -- Array of industries to filter
  p_only_corporate_email BOOLEAN DEFAULT TRUE,
  p_limit INTEGER DEFAULT 10000
)
RETURNS TABLE (
  contact_id UUID,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  job_title TEXT,
  company_name TEXT,
  company_country TEXT,
  company_industry TEXT,
  linkedin_url TEXT,
  email TEXT,
  signal_type TEXT,
  signal_name TEXT,
  keyword_matched TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (c.id, 
    CASE 
      WHEN s.signal_type = 'process' THEN dp.name
      ELSE dprod.name
    END)
    c.id as contact_id,
    c.first_name::TEXT,
    c.last_name::TEXT,
    COALESCE(c.full_name, CONCAT(c.first_name, ' ', c.last_name))::TEXT as full_name,
    c.current_position_title::TEXT as job_title,
    comp.name::TEXT as company_name,
    -- Use country field (not country_normalized which has bad data)
    comp.country::TEXT as company_country,
    comp.industry::TEXT as company_industry,
    c.linkedin_url::TEXT,
    COALESCE(c.email1, c.email2, c.email3)::TEXT as email,
    s.signal_type::TEXT,
    CASE 
      WHEN s.signal_type = 'process' THEN dp.name
      ELSE dprod.name
    END::TEXT as signal_name,
    s.keyword_matched::TEXT
  FROM signals s
  -- Join to get signal name from dictionary
  LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id AND s.signal_type = 'process'
  LEFT JOIN dictionary_products dprod ON s.signal_id = dprod.id AND s.signal_type = 'technology'
  -- Join to get company info
  INNER JOIN companies comp ON s.company_id = comp.id
  -- Join to get contact info (INNER JOIN = only signals with contacts)
  INNER JOIN contacts c ON s.contact_id = c.id
  WHERE 
    -- Must have a contact
    s.contact_id IS NOT NULL
    -- Filter by signal type
    AND (p_signal_type IS NULL OR s.signal_type = p_signal_type)
    -- Filter by signal names (from dictionary)
    AND (
      p_signal_names IS NULL 
      OR (s.signal_type = 'process' AND dp.name = ANY(p_signal_names))
      OR (s.signal_type = 'technology' AND dprod.name = ANY(p_signal_names))
    )
    -- Filter by countries (using country field, not country_normalized)
    AND (p_countries IS NULL OR comp.country = ANY(p_countries))
    -- Filter by industries
    AND (p_industries IS NULL OR comp.industry = ANY(p_industries))
    -- Filter corporate emails
    AND (
      NOT p_only_corporate_email
      OR (
        COALESCE(c.email1, c.email2, c.email3) IS NOT NULL
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@gmail.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@hotmail.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@yahoo.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@outlook.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@live.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@icloud.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@protonmail.com'
        AND LOWER(COALESCE(c.email1, c.email2, c.email3)) NOT LIKE '%@aol.com'
      )
    )
  ORDER BY c.id, 
    CASE 
      WHEN s.signal_type = 'process' THEN dp.name
      ELSE dprod.name
    END,
    comp.name
  LIMIT p_limit;
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION export_contacts(TEXT, TEXT[], TEXT[], TEXT[], BOOLEAN, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION export_contacts(TEXT, TEXT[], TEXT[], TEXT[], BOOLEAN, INTEGER) TO anon;

-- Add index on country field for better performance
CREATE INDEX IF NOT EXISTS idx_companies_country ON companies(country);
