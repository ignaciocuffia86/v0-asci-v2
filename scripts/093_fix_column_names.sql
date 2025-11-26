-- Corregir los nombres de columna en search_companies_by_technology
-- para que coincidan con lo que espera el frontend (current_count en lugar de current_employees_count)

DROP FUNCTION IF EXISTS search_companies_by_technology(uuid, text[]);

CREATE OR REPLACE FUNCTION search_companies_by_technology(
  p_product_id UUID,
  p_countries TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  company_id UUID,
  company_name TEXT,
  company_logo_url TEXT,
  company_website TEXT,
  company_linkedin_url TEXT,
  company_country TEXT,
  total_count BIGINT,
  current_count BIGINT,  -- Renombrado de current_employees_count a current_count
  alumni_count BIGINT,
  job_postings_count BIGINT
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
    -- Renombrado a current_count para coincidir con frontend
    COUNT(DISTINCT s.id) FILTER (WHERE s.is_current_employee = TRUE) AS current_count,
    -- Alumni: contactos que tienen esta empresa en previous_positions y señales de tecnología
    (
      SELECT COUNT(DISTINCT alumni_s.id)
      FROM contacts alumni_c
      CROSS JOIN LATERAL jsonb_array_elements(alumni_c.previous_positions) AS pp
      JOIN signals alumni_s ON alumni_s.contact_id = alumni_c.id
      WHERE (pp->>'company_id')::UUID = c.id
        AND alumni_c.current_company_id IS DISTINCT FROM c.id
        AND alumni_s.company_id = c.id
        AND alumni_s.signal_type = 'technology'
        AND alumni_s.signal_id = p_product_id
    ) AS alumni_count,
    COALESCE(
      (SELECT COUNT(*) FROM job_postings jp WHERE jp.company_id = c.id AND jp.signal_id = p_product_id),
      0
    ) AS job_postings_count
  FROM companies c
  INNER JOIN signals s ON s.company_id = c.id
  WHERE s.signal_id = p_product_id
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
  GROUP BY c.id, c.name, c.logo_url, c.website, c.linkedin_url, c.country
  ORDER BY total_count DESC;
END;
$$;
