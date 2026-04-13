-- export_contacts v3
-- Fixes: uses country_normalized for clean country names, supports multiple signal names,
-- uses correct column names from actual schema.

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
DECLARE
  personal_domains TEXT[] := ARRAY[
    'gmail.com','googlemail.com',
    'hotmail.com','hotmail.es','hotmail.co.uk','hotmail.fr','hotmail.com.ar',
    'outlook.com','outlook.es','live.com','live.com.ar','msn.com',
    'yahoo.com','yahoo.es','yahoo.com.ar','yahoo.com.mx','yahoo.co.uk',
    'icloud.com','me.com','mac.com',
    'aol.com','protonmail.com','proton.me','zoho.com',
    'mail.com','gmx.com','gmx.net','yandex.com','yandex.ru',
    'tutanota.com','fastmail.com','hey.com'
  ];
  v_email TEXT;
  v_domain TEXT;
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (c.id, s.id)
    c.id                                                      AS contact_id,
    c.first_name::TEXT,
    c.last_name::TEXT,
    COALESCE(c.full_name, TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')))::TEXT AS full_name,
    c.current_position_title::TEXT                            AS job_title,
    comp.name::TEXT                                           AS company_name,
    -- Use country_normalized when available, fall back to country
    COALESCE(NULLIF(TRIM(comp.country_normalized),''), NULLIF(TRIM(comp.country),''))::TEXT AS company_country,
    c.linkedin_url::TEXT,
    COALESCE(NULLIF(TRIM(c.email1),''), NULLIF(TRIM(c.email2),''), NULLIF(TRIM(c.email3),''))::TEXT AS email,
    s.signal_type::TEXT,
    CASE
      WHEN s.signal_type = 'process'    THEN dp.name
      WHEN s.signal_type = 'technology' THEN dprod.name
    END::TEXT                                                 AS signal_name
  FROM contacts c
  JOIN companies comp ON comp.id = c.current_company_id
  JOIN signals   s    ON s.contact_id = c.id
  LEFT JOIN dictionary_processes dp    ON s.signal_type = 'process'    AND s.signal_id = dp.id
  LEFT JOIN dictionary_products  dprod ON s.signal_type = 'technology' AND s.signal_id = dprod.id
  WHERE
    -- signal type
    (p_signal_type IS NULL OR s.signal_type = p_signal_type)
    -- signal names (multi)
    AND (
      p_signal_names IS NULL
      OR (s.signal_type = 'process'    AND LOWER(dp.name)    = ANY(SELECT LOWER(x) FROM unnest(p_signal_names) x))
      OR (s.signal_type = 'technology' AND LOWER(dprod.name) = ANY(SELECT LOWER(x) FROM unnest(p_signal_names) x))
    )
    -- countries via country_normalized (with fallback to country)
    AND (
      p_countries IS NULL
      OR COALESCE(NULLIF(TRIM(comp.country_normalized),''), NULLIF(TRIM(comp.country),'')) = ANY(p_countries)
    )
    -- must have an email
    AND COALESCE(NULLIF(TRIM(c.email1),''), NULLIF(TRIM(c.email2),''), NULLIF(TRIM(c.email3),'')) IS NOT NULL
    -- corporate email filter
    AND (
      NOT p_only_corporate_email
      OR NOT (
        SPLIT_PART(LOWER(COALESCE(NULLIF(TRIM(c.email1),''), NULLIF(TRIM(c.email2),''), NULLIF(TRIM(c.email3),''))), '@', 2)
        = ANY(personal_domains)
      )
    )
  ORDER BY c.id, s.id, comp.country_normalized, comp.name, c.last_name
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.export_contacts(TEXT, TEXT[], TEXT[], BOOLEAN, INT) TO authenticated;
