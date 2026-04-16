-- RPC para exportar compañías con señales
-- Retorna compañías que tienen señales, con conteo y detalle para Apollo

DROP FUNCTION IF EXISTS export_companies_with_signals(TEXT, TEXT[], TEXT[], TEXT[], INTEGER);

CREATE OR REPLACE FUNCTION export_companies_with_signals(
  p_signal_type TEXT DEFAULT NULL,           -- 'process', 'technology', or NULL for both
  p_signal_names TEXT[] DEFAULT NULL,        -- Array of specific signal names to filter
  p_countries TEXT[] DEFAULT NULL,           -- Array of countries (country_normalized)
  p_industries TEXT[] DEFAULT NULL,          -- Array of industries
  p_limit INTEGER DEFAULT 10000
)
RETURNS TABLE (
  company_id UUID,
  company_name TEXT,
  website TEXT,
  linkedin_url TEXT,
  country TEXT,
  industry TEXT,
  total_signals BIGINT,
  process_signals BIGINT,
  technology_signals BIGINT,
  top_process_signals TEXT,
  top_technology_signals TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH filtered_signals AS (
    -- First, get all signals that match our filters
    SELECT 
      s.company_id,
      s.signal_type,
      s.signal_id,
      COALESCE(dp.name, dprod.name) as signal_name
    FROM signals s
    LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id AND s.signal_type = 'process'
    LEFT JOIN dictionary_products dprod ON s.signal_id = dprod.id AND s.signal_type = 'technology'
    WHERE 
      -- Filter by signal type if provided
      (p_signal_type IS NULL OR s.signal_type = p_signal_type)
      -- Filter by signal names if provided
      AND (
        p_signal_names IS NULL 
        OR COALESCE(dp.name, dprod.name) ILIKE ANY(
          SELECT '%' || unnest(p_signal_names) || '%'
        )
      )
  ),
  company_signals AS (
    -- Aggregate signals per company
    SELECT 
      c.id,
      c.name,
      c.website,
      c.linkedin_url,
      c.country_normalized,
      c.industry,
      COUNT(DISTINCT fs.signal_id) as total_sigs,
      COUNT(DISTINCT CASE WHEN fs.signal_type = 'process' THEN fs.signal_id END) as proc_sigs,
      COUNT(DISTINCT CASE WHEN fs.signal_type = 'technology' THEN fs.signal_id END) as tech_sigs
    FROM companies c
    INNER JOIN filtered_signals fs ON fs.company_id = c.id
    WHERE 
      -- Filter by country if provided
      (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
      -- Filter by industry if provided
      AND (p_industries IS NULL OR c.industry = ANY(p_industries))
    GROUP BY c.id, c.name, c.website, c.linkedin_url, c.country_normalized, c.industry
    HAVING COUNT(DISTINCT fs.signal_id) > 0
  ),
  top_signals AS (
    -- Get top 5 signals per company per type
    SELECT 
      cs.id as company_id,
      STRING_AGG(DISTINCT 
        CASE WHEN fs.signal_type = 'process' THEN fs.signal_name END, 
        ', ' ORDER BY fs.signal_name
      ) FILTER (WHERE fs.signal_type = 'process') as top_procs,
      STRING_AGG(DISTINCT 
        CASE WHEN fs.signal_type = 'technology' THEN fs.signal_name END, 
        ', ' ORDER BY fs.signal_name
      ) FILTER (WHERE fs.signal_type = 'technology') as top_techs
    FROM company_signals cs
    INNER JOIN filtered_signals fs ON fs.company_id = cs.id
    GROUP BY cs.id
  )
  SELECT 
    cs.id as company_id,
    cs.name::TEXT as company_name,
    cs.website::TEXT,
    cs.linkedin_url::TEXT,
    cs.country_normalized::TEXT as country,
    cs.industry::TEXT,
    cs.total_sigs as total_signals,
    cs.proc_sigs as process_signals,
    cs.tech_sigs as technology_signals,
    COALESCE(ts.top_procs, '')::TEXT as top_process_signals,
    COALESCE(ts.top_techs, '')::TEXT as top_technology_signals
  FROM company_signals cs
  LEFT JOIN top_signals ts ON ts.company_id = cs.id
  ORDER BY cs.total_sigs DESC
  LIMIT p_limit;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION export_companies_with_signals TO authenticated;
GRANT EXECUTE ON FUNCTION export_companies_with_signals TO anon;
