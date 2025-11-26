-- Script 089: Fix alumni count to match drawer logic
-- The alumni count should only include contacts that have the company in their previous_positions
-- and have technology signals for that company

CREATE OR REPLACE FUNCTION search_companies_by_technology(
  p_product_id UUID,
  p_countries TEXT[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  company_id UUID,
  company_name TEXT,
  company_logo_url TEXT,
  company_website TEXT,
  company_linkedin_url TEXT,
  company_country TEXT,
  total_count BIGINT,
  current_count BIGINT,
  alumni_count BIGINT,
  job_postings_count BIGINT
)
LANGUAGE plpgsql
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
    COUNT(DISTINCT s.id) FILTER (WHERE s.is_current_employee = TRUE) AS current_count,
    -- Alumni count: only count technology signals from contacts that have this company in previous_positions
    (
      SELECT COUNT(DISTINCT s2.id)
      FROM contacts ct
      CROSS JOIN LATERAL jsonb_array_elements(ct.previous_positions) AS pp
      JOIN signals s2 ON s2.contact_id = ct.id
      WHERE (pp->>'company_id')::UUID = c.id
        AND ct.current_company_id IS DISTINCT FROM c.id  -- Not currently working there
        AND s2.company_id = c.id
        AND s2.signal_type = 'technology'
        AND s2.signal_id = p_product_id
    ) AS alumni_count,
    -- Job postings count
    (
      SELECT COUNT(DISTINCT jp.id)
      FROM job_postings jp
      INNER JOIN signals js ON js.job_posting_id = jp.id
      WHERE js.company_id = c.id
        AND js.signal_id = p_product_id
        AND js.signal_type = 'technology'
        AND jp.posted_at >= NOW() - INTERVAL '6 months'
    ) AS job_postings_count
  FROM companies c
  INNER JOIN signals s ON s.company_id = c.id
  WHERE s.signal_id = p_product_id
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
  GROUP BY c.id
  HAVING COUNT(DISTINCT s.id) > 0
  ORDER BY current_count DESC, total_count DESC;
END;
$$;
