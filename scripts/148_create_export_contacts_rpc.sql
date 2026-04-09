-- Create or replace the export_contacts RPC function
-- Supports: multi-country filter, process/technology filter, corporate email only filter

CREATE OR REPLACE FUNCTION export_contacts(
  p_signal_type TEXT DEFAULT NULL,           -- 'process' or 'technology'
  p_signal_name TEXT DEFAULT NULL,           -- name of process or technology
  p_countries TEXT[] DEFAULT NULL,           -- array of country codes/names
  p_exclude_service_providers BOOLEAN DEFAULT TRUE,
  p_only_corporate_email BOOLEAN DEFAULT TRUE,
  p_limit INT DEFAULT 10000
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
  signal_name TEXT,
  signal_context TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  personal_email_domains TEXT[] := ARRAY[
    'gmail.com', 'googlemail.com',
    'hotmail.com', 'hotmail.es', 'hotmail.co.uk', 'hotmail.fr',
    'outlook.com', 'outlook.es', 'live.com', 'msn.com',
    'yahoo.com', 'yahoo.es', 'yahoo.com.ar', 'yahoo.com.mx', 'yahoo.co.uk',
    'icloud.com', 'me.com', 'mac.com',
    'aol.com',
    'protonmail.com', 'proton.me',
    'zoho.com',
    'mail.com',
    'gmx.com', 'gmx.net',
    'yandex.com', 'yandex.ru',
    'tutanota.com',
    'fastmail.com',
    'hey.com'
  ];
BEGIN
  RETURN QUERY
  WITH contact_signals AS (
    -- Get contacts with process signals
    SELECT 
      c.id as contact_id,
      c.first_name,
      c.last_name,
      COALESCE(c.first_name || ' ' || c.last_name, c.first_name, c.last_name) as full_name,
      c.job_title,
      comp.name as company_name,
      comp.country as company_country,
      c.linkedin_url,
      c.email,
      'process'::TEXT as signal_type,
      dp.name as signal_name,
      cps.context as signal_context
    FROM contacts c
    JOIN companies comp ON c.company_id = comp.id
    JOIN contact_process_signals cps ON cps.contact_id = c.id
    JOIN dictionary_processes dp ON dp.id = cps.process_id
    WHERE 
      (p_signal_type IS NULL OR p_signal_type = 'process')
      AND (p_signal_name IS NULL OR LOWER(dp.name) = LOWER(p_signal_name))
      AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR comp.country = ANY(p_countries))
      AND (NOT p_exclude_service_providers OR comp.is_service_provider IS NOT TRUE)
      AND c.email IS NOT NULL
      AND (
        NOT p_only_corporate_email 
        OR NOT (
          SELECT bool_or(c.email ILIKE '%@' || domain)
          FROM unnest(personal_email_domains) AS domain
        )
      )
    
    UNION ALL
    
    -- Get contacts with technology signals
    SELECT 
      c.id as contact_id,
      c.first_name,
      c.last_name,
      COALESCE(c.first_name || ' ' || c.last_name, c.first_name, c.last_name) as full_name,
      c.job_title,
      comp.name as company_name,
      comp.country as company_country,
      c.linkedin_url,
      c.email,
      'technology'::TEXT as signal_type,
      dprod.name as signal_name,
      cts.context as signal_context
    FROM contacts c
    JOIN companies comp ON c.company_id = comp.id
    JOIN contact_technology_signals cts ON cts.contact_id = c.id
    JOIN dictionary_products dprod ON dprod.id = cts.product_id
    WHERE 
      (p_signal_type IS NULL OR p_signal_type = 'technology')
      AND (p_signal_name IS NULL OR LOWER(dprod.name) = LOWER(p_signal_name))
      AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR comp.country = ANY(p_countries))
      AND (NOT p_exclude_service_providers OR comp.is_service_provider IS NOT TRUE)
      AND c.email IS NOT NULL
      AND (
        NOT p_only_corporate_email 
        OR NOT (
          SELECT bool_or(c.email ILIKE '%@' || domain)
          FROM unnest(personal_email_domains) AS domain
        )
      )
  )
  SELECT DISTINCT ON (cs.contact_id, cs.signal_type, cs.signal_name)
    cs.contact_id,
    cs.first_name,
    cs.last_name,
    cs.full_name,
    cs.job_title,
    cs.company_name,
    cs.company_country,
    cs.linkedin_url,
    cs.email,
    cs.signal_type,
    cs.signal_name,
    cs.signal_context
  FROM contact_signals cs
  ORDER BY cs.contact_id, cs.signal_type, cs.signal_name, cs.company_name
  LIMIT p_limit;
END;
$$;

-- Grant execute permission to authenticated users (admin check done in app)
GRANT EXECUTE ON FUNCTION export_contacts TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION export_contacts IS 'Export contacts with signals. Supports multi-country, process/technology filter, and corporate email filter.';
