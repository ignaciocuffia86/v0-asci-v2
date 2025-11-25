-- Fix job postings counter to only count postings that match the specific signal_id
-- Previously it was counting ALL job postings from the company

-- Drop and recreate functions with corrected filtering logic
DROP FUNCTION IF EXISTS search_companies_by_process(UUID[], TEXT[]);
DROP FUNCTION IF EXISTS search_companies_by_technology(UUID, TEXT[]);

-- Update Process Search RPC - Fix: Count only job postings with matching process signals
CREATE OR REPLACE FUNCTION search_companies_by_process(
  p_process_ids UUID[],
  p_countries TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  company_id UUID,
  company_name TEXT,
  company_logo_url TEXT,
  company_website TEXT,
  company_linkedin_url TEXT,
  company_country TEXT,
  signal_count BIGINT,
  job_postings_count BIGINT,
  sample_signals JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id AS company_id,
    c.name AS company_name,
    c.logo_url AS company_logo_url,
    c.website AS company_website,
    c.linkedin_url AS company_linkedin_url,
    c.country AS company_country,
    COUNT(DISTINCT s.id) AS signal_count,
    -- Fixed: Only count job postings that have signals matching the search criteria
    (
      SELECT COUNT(DISTINCT jp.id)
      FROM job_postings jp
      INNER JOIN signals js ON js.job_posting_id = jp.id
      WHERE js.company_id = c.id
        AND js.signal_id = ANY(p_process_ids)  -- Filter by the specific process IDs being searched
        AND js.signal_type = 'process'
        AND jp.posted_at >= NOW() - INTERVAL '6 months'
    ) AS job_postings_count,
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'keyword', s.keyword_matched,
        'contact_name', ct.full_name,
        'position', ct.current_position_title
      )
    ) FILTER (WHERE s.id IS NOT NULL) AS sample_signals
  FROM companies c
  INNER JOIN signals s ON s.company_id = c.id
  LEFT JOIN contacts ct ON s.contact_id = ct.id
  WHERE s.signal_id = ANY(p_process_ids)
    AND s.is_current_employee = TRUE
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
  GROUP BY c.id
  HAVING COUNT(DISTINCT s.id) > 0
  ORDER BY signal_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Update Technology Search RPC - Fix: Count only job postings with matching technology signals
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
) AS $$
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
    COUNT(DISTINCT s.id) FILTER (WHERE s.is_current_employee = FALSE) AS alumni_count,
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
$$ LANGUAGE plpgsql;
