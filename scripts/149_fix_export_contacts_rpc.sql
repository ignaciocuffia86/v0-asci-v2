-- Fix export_contacts - drop all overloads and recreate with correct signature

-- Drop ALL existing export_contacts functions regardless of signature
DROP FUNCTION IF EXISTS public.export_contacts CASCADE;

-- Create the definitive export_contacts RPC function
-- Supports: multi-country filter, process/technology filter, corporate email only filter
CREATE FUNCTION public.export_contacts(
  p_signal_type TEXT DEFAULT NULL,
  p_signal_name TEXT DEFAULT NULL,
  p_countries TEXT[] DEFAULT NULL,
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
STABLE
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
  v_is_personal_email BOOLEAN;
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
      AND c.email != ''
    
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
      AND c.email != ''
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
  WHERE 
    -- Apply corporate email filter if requested
    (NOT p_only_corporate_email OR NOT (cs.email ILIKE ANY(ARRAY(SELECT '%@' || domain FROM unnest(personal_email_domains) AS domain))))
  ORDER BY cs.contact_id, cs.signal_type, cs.signal_name, cs.company_name
  LIMIT p_limit;
END;
$$;

-- Grant execute permission to authenticated users (admin check done in app)
GRANT EXECUTE ON FUNCTION public.export_contacts(TEXT, TEXT, TEXT[], BOOLEAN, BOOLEAN, INT) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.export_contacts IS 'Export contacts with signals. Supports multi-country, process/technology filter, and corporate email filter. p_countries: array of country names, p_only_corporate_email: excludes personal email domains when true.';
