-- Script 091: Fix search_companies_by_technology to use signal_id instead of product_id
-- Drop any existing versions first
DROP FUNCTION IF EXISTS search_companies_by_technology(uuid, text[]);
DROP FUNCTION IF EXISTS search_companies_by_technology(uuid, text[], integer, integer);

-- Recreate with correct column name (signal_id instead of product_id)
CREATE OR REPLACE FUNCTION search_companies_by_technology(
  p_product_id uuid,
  p_countries text[] DEFAULT NULL
)
RETURNS TABLE (
  company_id uuid,
  company_name text,
  company_logo_url text,
  company_website text,
  company_linkedin_url text,
  company_country text,
  total_count bigint,
  current_employees_count bigint,
  alumni_count bigint,
  job_postings_count bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id AS company_id,
    c.name AS company_name,
    c.logo_url AS company_logo_url,
    c.website AS company_website,
    c.linkedin_url AS company_linkedin_url,
    c.country AS company_country,
    COUNT(DISTINCT s.id) AS total_count,
    COUNT(DISTINCT s.id) FILTER (WHERE s.is_current_employee = TRUE) AS current_employees_count,
    -- Alumni count: contactos que tienen esta empresa en previous_positions con señales de tecnología
    (
      SELECT COUNT(DISTINCT s2.id)
      FROM contacts ct
      CROSS JOIN LATERAL jsonb_array_elements(ct.previous_positions) AS pp
      JOIN signals s2 ON s2.contact_id = ct.id
      WHERE (pp->>'company_id')::uuid = c.id
      AND ct.current_company_id IS DISTINCT FROM c.id
      AND s2.company_id = c.id
      AND s2.signal_type = 'technology'
      AND s2.signal_id = p_product_id
    ) AS alumni_count,
    COUNT(DISTINCT s.id) FILTER (WHERE s.job_posting_id IS NOT NULL) AS job_postings_count
  FROM companies c
  JOIN signals s ON s.company_id = c.id
  WHERE s.signal_id = p_product_id
  AND (p_countries IS NULL OR c.country = ANY(p_countries))
  GROUP BY c.id, c.name, c.logo_url, c.website, c.linkedin_url, c.country
  ORDER BY total_count DESC;
END;
$$;
