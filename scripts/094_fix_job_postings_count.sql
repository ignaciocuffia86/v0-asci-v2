-- Fix search_companies_by_technology function
-- The job_postings_count was using jp.signal_id which doesn't exist
-- job_postings table doesn't have signal_id, the relation is through signals.job_posting_id

DROP FUNCTION IF EXISTS search_companies_by_technology(uuid, text[]);

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
  current_count bigint,
  alumni_count bigint,
  job_postings_count bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH company_signals AS (
    SELECT 
      c.id,
      c.name,
      c.logo_url,
      c.website,
      c.linkedin_url,
      c.country,
      -- Total signals for this product in this company
      COUNT(DISTINCT s.id) AS total_signals,
      -- Current employees: signals where is_current_employee = true
      COUNT(DISTINCT s.id) FILTER (WHERE s.is_current_employee = TRUE) AS current_employees,
      -- Alumni: contacts with this company in previous_positions that have tech signals for this company
      (
        SELECT COUNT(DISTINCT als.id)
        FROM contacts alc
        CROSS JOIN LATERAL jsonb_array_elements(alc.previous_positions) AS pp
        JOIN signals als ON als.contact_id = alc.id
        WHERE (pp->>'company_id')::uuid = c.id
        AND alc.current_company_id IS DISTINCT FROM c.id
        AND als.company_id = c.id
        AND als.signal_id = p_product_id
        AND als.signal_type = 'technology'
      ) AS alumni_signals,
      -- Job postings count: join through signals.job_posting_id
      (
        SELECT COUNT(DISTINCT jp.id)
        FROM job_postings jp
        INNER JOIN signals js ON js.job_posting_id = jp.id
        WHERE js.company_id = c.id
        AND js.signal_id = p_product_id
        AND jp.posted_at >= NOW() - INTERVAL '6 months'
      ) AS job_postings
    FROM companies c
    INNER JOIN signals s ON s.company_id = c.id
    WHERE s.signal_id = p_product_id
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
    GROUP BY c.id, c.name, c.logo_url, c.website, c.linkedin_url, c.country
  )
  SELECT 
    cs.id AS company_id,
    cs.name AS company_name,
    cs.logo_url AS company_logo_url,
    cs.website AS company_website,
    cs.linkedin_url AS company_linkedin_url,
    cs.country AS company_country,
    cs.total_signals AS total_count,
    cs.current_employees AS current_count,
    cs.alumni_signals AS alumni_count,
    cs.job_postings AS job_postings_count
  FROM company_signals cs
  ORDER BY cs.total_signals DESC;
END;
$$;
