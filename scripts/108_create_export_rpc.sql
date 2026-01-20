-- =============================================================================
-- SCRIPT 108: RPC para Export de Compañías
-- =============================================================================

-- Función principal para obtener compañías con contadores
CREATE OR REPLACE FUNCTION get_companies_for_export(
  p_country TEXT DEFAULT NULL,
  p_sort_by TEXT DEFAULT 'signals',
  p_limit INT DEFAULT 100,
  p_only_without_linkedin BOOLEAN DEFAULT FALSE,
  p_only_without_industry BOOLEAN DEFAULT FALSE,
  p_min_signals INT DEFAULT 0
)
RETURNS TABLE (
  name TEXT,
  country TEXT,
  linkedin_url TEXT,
  website TEXT,
  signal_count_process BIGINT,
  signal_count_technology BIGINT,
  job_posting_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH company_signals AS (
    SELECT 
      s.company_id,
      COUNT(*) FILTER (WHERE s.signal_type = 'process') as process_count,
      COUNT(*) FILTER (WHERE s.signal_type = 'technology') as tech_count,
      COUNT(DISTINCT s.job_posting_id) FILTER (WHERE s.job_posting_id IS NOT NULL) as jp_count
    FROM signals s
    GROUP BY s.company_id
  )
  SELECT 
    c.name,
    c.country_normalized as country,
    c.linkedin_url,
    c.website,
    COALESCE(cs.process_count, 0) as signal_count_process,
    COALESCE(cs.tech_count, 0) as signal_count_technology,
    COALESCE(cs.jp_count, 0) as job_posting_count
  FROM companies c
  LEFT JOIN company_signals cs ON cs.company_id = c.id
  WHERE 
    -- Filtro por país
    (p_country IS NULL OR c.country_normalized = p_country)
    -- Filtro por LinkedIn
    AND (NOT p_only_without_linkedin OR c.linkedin_url IS NULL OR c.linkedin_url = '')
    -- Filtro por industria
    AND (NOT p_only_without_industry OR c.industry IS NULL OR c.industry = '')
    -- Filtro por mínimo de señales
    AND (p_min_signals = 0 OR COALESCE(cs.process_count, 0) + COALESCE(cs.tech_count, 0) >= p_min_signals)
  ORDER BY 
    CASE 
      WHEN p_sort_by = 'signals' THEN COALESCE(cs.process_count, 0) + COALESCE(cs.tech_count, 0)
      WHEN p_sort_by = 'contacts' THEN COALESCE(cs.process_count, 0) + COALESCE(cs.tech_count, 0) -- Fallback
      WHEN p_sort_by = 'job_postings' THEN COALESCE(cs.jp_count, 0)
      ELSE COALESCE(cs.process_count, 0) + COALESCE(cs.tech_count, 0)
    END DESC,
    CASE 
      WHEN p_sort_by = 'signals_asc' THEN COALESCE(cs.process_count, 0) + COALESCE(cs.tech_count, 0)
      ELSE 0
    END ASC,
    CASE 
      WHEN p_sort_by = 'no_linkedin' THEN 
        CASE WHEN c.linkedin_url IS NULL OR c.linkedin_url = '' THEN 0 ELSE 1 END
      ELSE 0
    END ASC,
    c.name
  LIMIT p_limit;
END;
$$;

-- Función para estadísticas del export
CREATE OR REPLACE FUNCTION get_export_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'total_companies', (SELECT COUNT(*) FROM companies),
    'with_linkedin', (SELECT COUNT(*) FROM companies WHERE linkedin_url IS NOT NULL AND linkedin_url != ''),
    'with_website', (SELECT COUNT(*) FROM companies WHERE website IS NOT NULL AND website != ''),
    'with_industry', (SELECT COUNT(*) FROM companies WHERE industry IS NOT NULL AND industry != ''),
    'with_country', (SELECT COUNT(*) FROM companies WHERE country_normalized IS NOT NULL),
    'with_signals', (SELECT COUNT(DISTINCT company_id) FROM signals),
    'with_job_postings', (SELECT COUNT(DISTINCT s.company_id) FROM signals s WHERE s.job_posting_id IS NOT NULL)
  ) INTO v_result;
  
  RETURN v_result;
END;
$$;

-- Test
SELECT * FROM get_companies_for_export('Argentina', 'signals', 5, false, false, 0);
