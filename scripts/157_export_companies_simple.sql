-- Reemplazar export_companies_with_signals con versión simplificada
-- Sin STRING_AGG complejo que causa errores

DROP FUNCTION IF EXISTS export_companies_with_signals;

CREATE OR REPLACE FUNCTION export_companies_with_signals(
  p_signal_type TEXT DEFAULT NULL,
  p_signal_names TEXT[] DEFAULT NULL,
  p_countries TEXT[] DEFAULT NULL,
  p_industries TEXT[] DEFAULT NULL,
  p_limit INT DEFAULT 1000
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
  technology_signals BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as company_id,
    c.name as company_name,
    c.website,
    c.linkedin_url,
    c.country_normalized as country,
    c.industry,
    COUNT(s.id) as total_signals,
    COUNT(CASE WHEN s.signal_type = 'process' THEN 1 END) as process_signals,
    COUNT(CASE WHEN s.signal_type = 'technology' THEN 1 END) as technology_signals
  FROM signals s
  INNER JOIN companies c ON s.company_id = c.id
  LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id AND s.signal_type = 'process'
  LEFT JOIN dictionary_products dprod ON s.signal_id = dprod.id AND s.signal_type = 'technology'
  WHERE 
    -- Filtro por tipo de señal
    (p_signal_type IS NULL OR s.signal_type = p_signal_type)
    -- Filtro por nombres de señales específicas
    AND (
      p_signal_names IS NULL 
      OR (s.signal_type = 'process' AND dp.name = ANY(p_signal_names))
      OR (s.signal_type = 'technology' AND dprod.name = ANY(p_signal_names))
    )
    -- Filtro por países
    AND (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
    -- Filtro por industrias
    AND (p_industries IS NULL OR c.industry = ANY(p_industries))
  GROUP BY c.id, c.name, c.website, c.linkedin_url, c.country_normalized, c.industry
  HAVING COUNT(s.id) > 0
  ORDER BY COUNT(s.id) DESC
  LIMIT p_limit;
END;
$$;
