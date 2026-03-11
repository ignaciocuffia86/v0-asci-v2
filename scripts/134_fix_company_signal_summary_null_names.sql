-- Fix: Mostrar keyword_matched cuando product_name o process_name es NULL
-- Esto soluciona señales con signal_id que ya no existen en los diccionarios

CREATE OR REPLACE FUNCTION get_company_signal_summary(
  p_company_id UUID
)
RETURNS TABLE (
  total_signals BIGINT,
  current_employees_with_signals BIGINT,
  alumni_with_tech_signals BIGINT,
  job_postings_count BIGINT,
  top_processes JSONB,
  top_technologies JSONB
) AS $$
BEGIN
RETURN QUERY
WITH company_signals AS (
  SELECT
    s.*,
    COALESCE(dp.name, s.keyword_matched) as process_name,
    COALESCE(dprod.name, s.keyword_matched) as product_name
  FROM signals s
  LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id AND s.signal_type = 'process'
  LEFT JOIN dictionary_products dprod ON s.signal_id = dprod.id AND s.signal_type = 'technology'
  WHERE s.company_id = p_company_id
),
job_postings_data AS (
  SELECT COUNT(DISTINCT jp.id) as jp_count
  FROM job_postings jp
  WHERE jp.company_id = p_company_id
)
SELECT
  COUNT(*) as total_signals,
  COUNT(DISTINCT CASE WHEN is_current_employee = true THEN contact_id END) as current_employees_with_signals,
  COUNT(DISTINCT CASE WHEN is_current_employee = false AND signal_type = 'technology' THEN contact_id END) as alumni_with_tech_signals,
  (SELECT jp_count FROM job_postings_data) as job_postings_count,
  -- Top 5 Processes (solo de empleados actuales)
  (
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
      SELECT process_name, COUNT(*) as count
      FROM company_signals
      WHERE signal_type = 'process' 
        AND is_current_employee = true
        AND process_name IS NOT NULL
        AND process_name != ''
      GROUP BY process_name
      ORDER BY count DESC
      LIMIT 5
    ) t
  ) as top_processes,
  -- Top 5 Technologies (current + alumni + job postings)
  (
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
      SELECT product_name, COUNT(*) as count
      FROM company_signals
      WHERE signal_type = 'technology'
        AND product_name IS NOT NULL
        AND product_name != ''
      GROUP BY product_name
      ORDER BY count DESC
      LIMIT 5
    ) t
  ) as top_technologies
FROM company_signals;
END;
$$ LANGUAGE plpgsql;
