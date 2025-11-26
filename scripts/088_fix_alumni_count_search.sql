-- Script 088: Fix alumni count in search functions
-- Only count technology signals for alumni (not process signals)

-- Update search_companies_by_technology function
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
  current_count BIGINT,
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
    COUNT(DISTINCT s.id) FILTER (WHERE s.is_current_employee = TRUE) AS current_count,
    -- Only count technology signals for alumni (excluding process signals)
    COUNT(DISTINCT s.id) FILTER (WHERE s.is_current_employee = FALSE AND s.signal_type = 'technology') AS alumni_count,
    -- Fixed: Only count job postings that mention the specific technology being searched
    (
      SELECT COUNT(DISTINCT jp.id)
      FROM job_postings jp
      INNER JOIN signals js ON js.job_posting_id = jp.id
      WHERE js.company_id = c.id
        AND js.signal_id = p_product_id  -- Filter by the specific product ID being searched
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION search_companies_by_technology(UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION search_companies_by_technology(UUID, TEXT[]) TO anon;
