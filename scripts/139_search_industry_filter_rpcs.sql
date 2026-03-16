-- ============================================================================
-- FASE 5: RPCs para Filtro de Industria en Búsqueda
-- ============================================================================

-- 1. RPC para obtener industrias disponibles con conteo para búsqueda por TECNOLOGÍA
-- ============================================================================
CREATE OR REPLACE FUNCTION get_industry_counts_for_technology(
  p_product_id UUID,
  p_countries TEXT[],
  p_exclude_providers BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  master_industry_id TEXT,
  name_es TEXT,
  icon TEXT,
  company_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mi.id as master_industry_id,
    mi.name_es,
    mi.icon,
    COUNT(DISTINCT c.id) as company_count
  FROM signals s
  JOIN companies c ON s.company_id = c.id
  JOIN master_industries mi ON c.master_industry_id = mi.id
  WHERE s.signal_id = p_product_id
    AND s.signal_type = 'technology'
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
    AND (NOT p_exclude_providers OR c.is_service_provider IS NOT TRUE)
    AND c.master_industry_id IS NOT NULL
  GROUP BY mi.id, mi.name_es, mi.icon, mi.display_order
  HAVING COUNT(DISTINCT c.id) > 0
  ORDER BY mi.display_order;
END;
$$;

-- 2. RPC para obtener industrias disponibles con conteo para búsqueda por PROCESO
-- ============================================================================
CREATE OR REPLACE FUNCTION get_industry_counts_for_process(
  p_process_ids UUID[],
  p_countries TEXT[],
  p_exclude_providers BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  master_industry_id TEXT,
  name_es TEXT,
  icon TEXT,
  company_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mi.id as master_industry_id,
    mi.name_es,
    mi.icon,
    COUNT(DISTINCT c.id) as company_count
  FROM signals s
  JOIN companies c ON s.company_id = c.id
  JOIN master_industries mi ON c.master_industry_id = mi.id
  WHERE s.signal_id = ANY(p_process_ids)
    AND s.signal_type = 'process'
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
    AND (NOT p_exclude_providers OR c.is_service_provider IS NOT TRUE)
    AND c.master_industry_id IS NOT NULL
  GROUP BY mi.id, mi.name_es, mi.icon, mi.display_order
  HAVING COUNT(DISTINCT c.id) > 0
  ORDER BY mi.display_order;
END;
$$;

-- 3. Actualizar RPC de búsqueda por TECNOLOGÍA para incluir filtro de industria
-- ============================================================================
CREATE OR REPLACE FUNCTION search_companies_by_technology_v2(
  p_product_id UUID,
  p_countries TEXT[] DEFAULT NULL,
  p_exclude_providers BOOLEAN DEFAULT FALSE,
  p_master_industry_ids TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  company_id UUID,
  company_name TEXT,
  company_logo_url TEXT,
  company_website TEXT,
  company_linkedin_url TEXT,
  company_country TEXT,
  company_industry TEXT,
  total_count BIGINT,
  current_count BIGINT,
  alumni_count BIGINT,
  job_postings_count BIGINT,
  relevance_score NUMERIC,
  current_score NUMERIC,
  alumni_score NUMERIC,
  job_postings_score NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH signal_data AS (
    SELECT 
      s.company_id,
      COUNT(*) FILTER (WHERE s.contact_id IS NOT NULL AND ct.is_current = TRUE) as current_count,
      COUNT(*) FILTER (WHERE s.contact_id IS NOT NULL AND ct.is_current = FALSE) as alumni_count,
      COUNT(*) FILTER (WHERE s.job_posting_id IS NOT NULL) as job_postings_count
    FROM signals s
    LEFT JOIN contacts ct ON s.contact_id = ct.id
    WHERE s.signal_id = p_product_id
      AND s.signal_type = 'technology'
    GROUP BY s.company_id
  )
  SELECT 
    c.id as company_id,
    c.name as company_name,
    c.logo_url as company_logo_url,
    c.website as company_website,
    c.linkedin_url as company_linkedin_url,
    c.country as company_country,
    c.industry as company_industry,
    (COALESCE(sd.current_count, 0) + COALESCE(sd.alumni_count, 0) + COALESCE(sd.job_postings_count, 0)) as total_count,
    COALESCE(sd.current_count, 0) as current_count,
    COALESCE(sd.alumni_count, 0) as alumni_count,
    COALESCE(sd.job_postings_count, 0) as job_postings_count,
    -- Score de relevancia ponderado
    (
      COALESCE(sd.current_count, 0) * 3.0 +
      COALESCE(sd.alumni_count, 0) * 1.0 +
      COALESCE(sd.job_postings_count, 0) * 2.0
    )::NUMERIC as relevance_score,
    (COALESCE(sd.current_count, 0) * 3.0)::NUMERIC as current_score,
    (COALESCE(sd.alumni_count, 0) * 1.0)::NUMERIC as alumni_score,
    (COALESCE(sd.job_postings_count, 0) * 2.0)::NUMERIC as job_postings_score
  FROM signal_data sd
  JOIN companies c ON sd.company_id = c.id
  WHERE (p_countries IS NULL OR c.country = ANY(p_countries))
    AND (NOT p_exclude_providers OR c.is_service_provider IS NOT TRUE)
    AND (p_master_industry_ids IS NULL OR c.master_industry_id = ANY(p_master_industry_ids))
  ORDER BY relevance_score DESC, current_count DESC
  LIMIT 500;
END;
$$;

-- 4. Actualizar RPC de búsqueda por PROCESO para incluir filtro de industria
-- ============================================================================
CREATE OR REPLACE FUNCTION search_companies_by_process_v2(
  p_process_ids UUID[],
  p_countries TEXT[] DEFAULT NULL,
  p_exclude_providers BOOLEAN DEFAULT FALSE,
  p_master_industry_ids TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  company_id UUID,
  company_name TEXT,
  company_logo_url TEXT,
  company_website TEXT,
  company_linkedin_url TEXT,
  company_country TEXT,
  company_industry TEXT,
  signal_count BIGINT,
  current_count BIGINT,
  alumni_count BIGINT,
  job_postings_count BIGINT,
  relevance_score NUMERIC,
  current_score NUMERIC,
  alumni_score NUMERIC,
  job_postings_score NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH signal_data AS (
    SELECT 
      s.company_id,
      COUNT(*) as total_signals,
      COUNT(*) FILTER (WHERE s.contact_id IS NOT NULL AND ct.is_current = TRUE) as current_count,
      COUNT(*) FILTER (WHERE s.contact_id IS NOT NULL AND ct.is_current = FALSE) as alumni_count,
      COUNT(*) FILTER (WHERE s.job_posting_id IS NOT NULL) as job_postings_count
    FROM signals s
    LEFT JOIN contacts ct ON s.contact_id = ct.id
    WHERE s.signal_id = ANY(p_process_ids)
      AND s.signal_type = 'process'
    GROUP BY s.company_id
  )
  SELECT 
    c.id as company_id,
    c.name as company_name,
    c.logo_url as company_logo_url,
    c.website as company_website,
    c.linkedin_url as company_linkedin_url,
    c.country as company_country,
    c.industry as company_industry,
    sd.total_signals as signal_count,
    COALESCE(sd.current_count, 0) as current_count,
    COALESCE(sd.alumni_count, 0) as alumni_count,
    COALESCE(sd.job_postings_count, 0) as job_postings_count,
    -- Score de relevancia ponderado
    (
      COALESCE(sd.current_count, 0) * 3.0 +
      COALESCE(sd.alumni_count, 0) * 1.0 +
      COALESCE(sd.job_postings_count, 0) * 2.0
    )::NUMERIC as relevance_score,
    (COALESCE(sd.current_count, 0) * 3.0)::NUMERIC as current_score,
    (COALESCE(sd.alumni_count, 0) * 1.0)::NUMERIC as alumni_score,
    (COALESCE(sd.job_postings_count, 0) * 2.0)::NUMERIC as job_postings_score
  FROM signal_data sd
  JOIN companies c ON sd.company_id = c.id
  WHERE (p_countries IS NULL OR c.country = ANY(p_countries))
    AND (NOT p_exclude_providers OR c.is_service_provider IS NOT TRUE)
    AND (p_master_industry_ids IS NULL OR c.master_industry_id = ANY(p_master_industry_ids))
  ORDER BY relevance_score DESC, current_count DESC
  LIMIT 500;
END;
$$;

-- 5. Permisos
GRANT EXECUTE ON FUNCTION get_industry_counts_for_technology TO authenticated;
GRANT EXECUTE ON FUNCTION get_industry_counts_for_process TO authenticated;
GRANT EXECUTE ON FUNCTION search_companies_by_technology_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION search_companies_by_process_v2 TO authenticated;
