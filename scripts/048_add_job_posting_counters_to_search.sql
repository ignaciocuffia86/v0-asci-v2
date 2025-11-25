-- Add job_postings_count to search RPCs
-- This script enhances the existing search functions to include job posting counts from the last 6 months

-- Drop and recreate functions to change return types
DROP FUNCTION IF EXISTS search_companies_by_process(UUID[], TEXT[]);
DROP FUNCTION IF EXISTS search_companies_by_technology(UUID, TEXT[]);

-- Update Process Search RPC to include job postings count
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
  job_postings_count BIGINT,  -- Added job postings counter
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
    -- Count job postings from last 6 months
    (
      SELECT COUNT(DISTINCT jp.id)
      FROM job_postings jp
      INNER JOIN signals js ON js.job_posting_id = jp.id
      WHERE js.company_id = c.id
        AND js.signal_id = ANY(p_process_ids)
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

-- Update Technology Search RPC to include job postings count
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
  job_postings_count BIGINT  -- Added job postings counter
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
    -- Count job postings from last 6 months
    (
      SELECT COUNT(DISTINCT jp.id)
      FROM job_postings jp
      INNER JOIN signals js ON js.job_posting_id = jp.id
      WHERE js.company_id = c.id
        AND js.signal_id = p_product_id
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

-- Create helper function to get job postings for drawer/bookmarks
CREATE OR REPLACE FUNCTION get_company_job_postings(
  p_company_id UUID,
  p_signal_ids UUID[] DEFAULT NULL,
  p_limit INT DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  posted_at TIMESTAMPTZ,
  apply_url TEXT,
  detected_keywords JSONB,
  is_recent BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    jp.id,
    jp.title,
    jp.posted_at,
    jp.apply_url,
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'keyword', s.keyword_matched,
        'signal_type', s.signal_type,
        'signal_name', COALESCE(dp.name, dt.name)
      )
    ) FILTER (WHERE s.id IS NOT NULL) AS detected_keywords,
    (jp.posted_at >= NOW() - INTERVAL '1 month') AS is_recent
  FROM job_postings jp
  LEFT JOIN signals s ON s.job_posting_id = jp.id
  LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id AND s.signal_type = 'process'
  LEFT JOIN dictionary_products dt ON s.signal_id = dt.id AND s.signal_type = 'technology'
  WHERE jp.company_id = p_company_id
    AND (p_signal_ids IS NULL OR s.signal_id = ANY(p_signal_ids))
    AND jp.posted_at >= NOW() - INTERVAL '6 months'
  GROUP BY jp.id
  ORDER BY jp.posted_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
