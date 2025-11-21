-- Function to search companies by process signals
-- Returns companies ordered by number of CURRENT employees with the signal
CREATE OR REPLACE FUNCTION search_companies_by_process(
  p_process_ids UUID[],
  p_countries TEXT[]
)
RETURNS TABLE (
  company_id UUID,
  company_name TEXT,
  company_logo_url TEXT,
  company_website TEXT,
  company_linkedin_url TEXT,
  company_country TEXT,
  signal_count BIGINT,
  sample_signals JSONB -- Returns a few sample signals for context
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as company_id,
    c.name as company_name,
    c.logo_url as company_logo_url,
    c.website as company_website,
    c.linkedin_url as company_linkedin_url,
    c.country as company_country,
    COUNT(DISTINCT s.contact_id) as signal_count,
    jsonb_agg(
      jsonb_build_object(
        'snippet', s.snippet,
        'source', s.source_field,
        'created_at', s.created_at
      ) ORDER BY s.created_at DESC
    ) FILTER (WHERE s.snippet IS NOT NULL) as sample_signals
  FROM signals s
  JOIN companies c ON s.company_id = c.id
  WHERE 
    s.signal_id = ANY(p_process_ids)
    AND s.is_current_employee = true -- Only CURRENT employees for processes
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
  GROUP BY c.id
  ORDER BY signal_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to search companies by technology/product signals
-- Returns companies ordered by total signals, separating Current vs Alumni
CREATE OR REPLACE FUNCTION search_companies_by_technology(
  p_product_id UUID,
  p_countries TEXT[]
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
  alumni_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as company_id,
    c.name as company_name,
    c.logo_url as company_logo_url,
    c.website as company_website,
    c.linkedin_url as company_linkedin_url,
    c.country as company_country,
    COUNT(DISTINCT s.contact_id) as total_count,
    COUNT(DISTINCT CASE WHEN s.is_current_employee = true THEN s.contact_id END) as current_count,
    COUNT(DISTINCT CASE WHEN s.is_current_employee = false THEN s.contact_id END) as alumni_count
  FROM signals s
  JOIN companies c ON s.company_id = c.id
  WHERE 
    s.signal_id = p_product_id
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
  GROUP BY c.id
  ORDER BY total_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to get signal summary for a specific company
CREATE OR REPLACE FUNCTION get_company_signal_summary(
  p_company_id UUID
)
RETURNS TABLE (
  total_signals BIGINT,
  current_employees_with_signals BIGINT,
  alumni_with_tech_signals BIGINT,
  top_processes JSONB,
  top_technologies JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH company_signals AS (
    SELECT 
      s.*,
      dp.name as process_name,
      dprod.name as product_name
    FROM signals s
    LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id AND s.signal_type = 'process'
    LEFT JOIN dictionary_products dprod ON s.signal_id = dprod.id AND s.signal_type = 'technology'
    WHERE s.company_id = p_company_id
  )
  SELECT 
    COUNT(*) as total_signals,
    COUNT(DISTINCT CASE WHEN is_current_employee = true THEN contact_id END) as current_employees_with_signals,
    COUNT(DISTINCT CASE WHEN is_current_employee = false AND signal_type = 'technology' THEN contact_id END) as alumni_with_tech_signals,
    -- Top 5 Processes
    (
      SELECT jsonb_agg(t) FROM (
        SELECT process_name, COUNT(*) as count
        FROM company_signals
        WHERE signal_type = 'process' AND is_current_employee = true
        GROUP BY process_name
        ORDER BY count DESC
        LIMIT 5
      ) t
    ) as top_processes,
    -- Top 5 Technologies
    (
      SELECT jsonb_agg(t) FROM (
        SELECT product_name, COUNT(*) as count
        FROM company_signals
        WHERE signal_type = 'technology'
        GROUP BY product_name
        ORDER BY count DESC
        LIMIT 5
      ) t
    ) as top_technologies
  FROM company_signals;
END;
$$ LANGUAGE plpgsql;
