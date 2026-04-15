-- export_contacts v5 - Fixed signal filtering logic
DROP FUNCTION IF EXISTS public.export_contacts CASCADE;

CREATE FUNCTION public.export_contacts(
  p_signal_type   TEXT    DEFAULT NULL,   -- 'process' | 'technology' | NULL (both)
  p_signal_names  TEXT[]  DEFAULT NULL,   -- array of exact names; NULL = all
  p_countries     TEXT[]  DEFAULT NULL,   -- matches companies.country_normalized; NULL = all
  p_only_corporate_email BOOLEAN DEFAULT TRUE,
  p_limit         INT     DEFAULT 10000
)
RETURNS TABLE (
  contact_id      UUID,
  first_name      TEXT,
  last_name       TEXT,
  full_name       TEXT,
  job_title       TEXT,
  company_name    TEXT,
  company_country TEXT,
  linkedin_url    TEXT,
  email           TEXT,
  signal_type     TEXT,
  signal_name     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH filtered_signals AS (
    -- First, get all signals that match our criteria
    SELECT
      s.contact_id,
      s.signal_type,
      s.signal_id,
      CASE 
        WHEN s.signal_type = 'process' THEN dp.name
        WHEN s.signal_type = 'technology' THEN dprod.name
        ELSE NULL 
      END as signal_name
    FROM signals s
    LEFT JOIN dictionary_processes dp ON s.signal_type = 'process' AND s.signal_id = dp.id
    LEFT JOIN dictionary_products dprod ON s.signal_type = 'technology' AND s.signal_id = dprod.id
    WHERE
      -- Signal type filter: if p_signal_type specified, only those; else all
      (p_signal_type IS NULL OR s.signal_type = p_signal_type)
      -- Signal names filter: if p_signal_names specified, only those; else all
      AND (
        p_signal_names IS NULL
        OR (s.signal_type = 'process' AND LOWER(dp.name) = ANY(SELECT LOWER(unnest) FROM unnest(p_signal_names)))
        OR (s.signal_type = 'technology' AND LOWER(dprod.name) = ANY(SELECT LOWER(unnest) FROM unnest(p_signal_names)))
      )
  )
  SELECT DISTINCT
    c.id                                    AS contact_id,
    c.first_name::TEXT,
    c.last_name::TEXT,
    COALESCE(c.full_name, CONCAT_WS(' ', c.first_name, c.last_name))::TEXT AS full_name,
    c.current_position_title::TEXT          AS job_title,
    comp.name::TEXT                         AS company_name,
    COALESCE(comp.country_normalized, comp.country)::TEXT AS company_country,
    c.linkedin_url::TEXT,
    COALESCE(c.email1, c.email2, c.email3)::TEXT AS email,
    fs.signal_type::TEXT,
    fs.signal_name::TEXT
  FROM filtered_signals fs
  JOIN contacts c ON c.id = fs.contact_id
  JOIN companies comp ON comp.id = c.current_company_id
  WHERE
    -- Must have email
    COALESCE(c.email1, c.email2, c.email3) IS NOT NULL
    AND COALESCE(c.email1, c.email2, c.email3) != ''
    -- Country filter
    AND (
      p_countries IS NULL
      OR COALESCE(comp.country_normalized, comp.country) = ANY(p_countries)
    )
    -- Corporate email filter
    AND (
      NOT p_only_corporate_email
      OR NOT (
        LOWER(COALESCE(c.email1, c.email2, c.email3)) LIKE '%@gmail.%'
        OR LOWER(COALESCE(c.email1, c.email2, c.email3)) LIKE '%@hotmail.%'
        OR LOWER(COALESCE(c.email1, c.email2, c.email3)) LIKE '%@outlook.%'
        OR LOWER(COALESCE(c.email1, c.email2, c.email3)) LIKE '%@yahoo.%'
        OR LOWER(COALESCE(c.email1, c.email2, c.email3)) LIKE '%@live.%'
        OR LOWER(COALESCE(c.email1, c.email2, c.email3)) LIKE '%@icloud.%'
        OR LOWER(COALESCE(c.email1, c.email2, c.email3)) LIKE '%@aol.%'
        OR LOWER(COALESCE(c.email1, c.email2, c.email3)) LIKE '%@protonmail.%'
        OR LOWER(COALESCE(c.email1, c.email2, c.email3)) LIKE '%@zoho.%'
        OR LOWER(COALESCE(c.email1, c.email2, c.email3)) LIKE '%@mail.com'
      )
    )
  LIMIT p_limit;
END;
$$;

-- Create indexes to speed up the query
CREATE INDEX IF NOT EXISTS idx_signals_contact_id ON signals(contact_id);
CREATE INDEX IF NOT EXISTS idx_signals_signal_type ON signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_signals_signal_id ON signals(signal_id);
CREATE INDEX IF NOT EXISTS idx_contacts_current_company_id ON contacts(current_company_id);
CREATE INDEX IF NOT EXISTS idx_companies_country_normalized ON companies(country_normalized);

GRANT EXECUTE ON FUNCTION public.export_contacts(TEXT, TEXT[], TEXT[], BOOLEAN, INT) TO authenticated;
