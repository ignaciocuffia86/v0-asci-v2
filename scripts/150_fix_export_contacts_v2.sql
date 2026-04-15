-- Fix export_contacts - using correct table structure
-- Based on actual schema: contacts.current_company_id, contacts.current_position_title, contacts.email1
-- Signals are in 'signals' table with signal_type and signal_id referencing dictionary tables

-- Drop ALL existing export_contacts functions
DROP FUNCTION IF EXISTS public.export_contacts CASCADE;

-- Create the definitive export_contacts RPC function
CREATE FUNCTION public.export_contacts(
  p_signal_type TEXT DEFAULT NULL,          -- 'process' or 'technology'
  p_signal_name TEXT DEFAULT NULL,          -- nombre del proceso o tecnología
  p_countries TEXT[] DEFAULT NULL,          -- array de países (de companies.country)
  p_only_corporate_email BOOLEAN DEFAULT TRUE,
  p_limit INT DEFAULT 10000
)
RETURNS TABLE (
  contact_id UUID,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  "position" TEXT,
  company_name TEXT,
  company_country TEXT,
  linkedin_url TEXT,
  email TEXT,
  signal_type TEXT,
  signal_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  personal_email_domains TEXT[] := ARRAY[
    '@gmail.com', '@googlemail.com',
    '@hotmail.com', '@hotmail.es', '@hotmail.co.uk', '@hotmail.fr',
    '@outlook.com', '@outlook.es', '@live.com', '@msn.com',
    '@yahoo.com', '@yahoo.es', '@yahoo.com.ar', '@yahoo.com.mx', '@yahoo.co.uk',
    '@icloud.com', '@me.com', '@mac.com',
    '@aol.com',
    '@protonmail.com', '@proton.me',
    '@zoho.com',
    '@mail.com',
    '@gmx.com', '@gmx.net',
    '@yandex.com', '@yandex.ru',
    '@tutanota.com',
    '@fastmail.com',
    '@hey.com'
  ];
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    c.id as contact_id,
    c.first_name::TEXT,
    c.last_name::TEXT,
    COALESCE(c.full_name, c.first_name || ' ' || c.last_name)::TEXT as full_name,
    c.current_position_title::TEXT as "position",
    comp.name::TEXT as company_name,
    comp.country::TEXT as company_country,
    c.linkedin_url::TEXT,
    COALESCE(c.email1, c.email2, c.email3)::TEXT as email,
    s.signal_type::TEXT,
    CASE 
      WHEN s.signal_type = 'process' THEN dp.name
      WHEN s.signal_type = 'technology' THEN dprod.name
      ELSE NULL
    END::TEXT as signal_name
  FROM contacts c
  INNER JOIN companies comp ON c.current_company_id = comp.id
  INNER JOIN signals s ON s.contact_id = c.id
  LEFT JOIN dictionary_processes dp ON s.signal_type = 'process' AND s.signal_id = dp.id
  LEFT JOIN dictionary_products dprod ON s.signal_type = 'technology' AND s.signal_id = dprod.id
  WHERE 
    -- Signal type filter
    (p_signal_type IS NULL OR s.signal_type = p_signal_type)
    -- Signal name filter
    AND (
      p_signal_name IS NULL 
      OR (s.signal_type = 'process' AND LOWER(dp.name) = LOWER(p_signal_name))
      OR (s.signal_type = 'technology' AND LOWER(dprod.name) = LOWER(p_signal_name))
    )
    -- Country filter (from companies table)
    AND (p_countries IS NULL OR array_length(p_countries, 1) IS NULL OR comp.country = ANY(p_countries))
    -- Email must exist
    AND COALESCE(c.email1, c.email2, c.email3) IS NOT NULL
    AND COALESCE(c.email1, c.email2, c.email3) != ''
    -- Corporate email filter
    AND (
      NOT p_only_corporate_email 
      OR NOT EXISTS (
        SELECT 1 FROM unnest(personal_email_domains) AS domain 
        WHERE LOWER(COALESCE(c.email1, c.email2, c.email3)) LIKE '%' || domain
      )
    )
  ORDER BY comp.country, comp.name, c.last_name, c.first_name
  LIMIT p_limit;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.export_contacts(TEXT, TEXT, TEXT[], BOOLEAN, INT) TO authenticated;

COMMENT ON FUNCTION public.export_contacts IS 'Export contacts with signals. p_signal_type: process or technology. p_signal_name: exact name. p_countries: array of country names from companies.country. p_only_corporate_email: excludes personal emails.';
