-- Script 090: Recrear search_companies_by_technology con lógica correcta de alumni
-- Fecha: 2025-01-26
-- Descripción: La función anterior contaba alumni incorrectamente.
-- La nueva lógica cuenta contactos que tienen la empresa en previous_positions
-- y tienen señales de technology para esa empresa.

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
  WITH product_signals AS (
    -- Primero obtenemos todas las señales del producto seleccionado
    SELECT 
      s.id as signal_id,
      s.company_id,
      s.contact_id,
      s.is_current_employee,
      s.signal_type
    FROM signals s
    WHERE s.product_id = p_product_id
  ),
  -- Contar alumni correctamente: contactos que tienen la empresa en previous_positions
  -- y tienen señales de technology para esa empresa
  alumni_by_company AS (
    SELECT 
      c.id as company_id,
      COUNT(DISTINCT ps.signal_id) as alumni_signal_count
    FROM companies c
    JOIN product_signals ps ON ps.company_id = c.id
    JOIN contacts ct ON ct.id = ps.contact_id
    WHERE ps.signal_type = 'technology'
    AND ps.is_current_employee = FALSE
    -- Verificar que el contacto tiene esta empresa en previous_positions
    AND EXISTS (
      SELECT 1 
      FROM jsonb_array_elements(ct.previous_positions) as pp
      WHERE (pp->>'company_id')::uuid = c.id
    )
    -- Y que actualmente NO trabaja en esta empresa
    AND ct.current_company_id IS DISTINCT FROM c.id
    GROUP BY c.id
  ),
  company_stats AS (
    SELECT
      c.id,
      c.name,
      c.logo_url,
      c.website,
      c.linkedin_url,
      c.country,
      -- Total de señales para este producto
      COUNT(DISTINCT ps.signal_id) AS total_count,
      -- Empleados actuales
      COUNT(DISTINCT ps.signal_id) FILTER (WHERE ps.is_current_employee = TRUE) AS current_count,
      -- Job postings (señales de current_employee pero de tipo process/technology de job postings)
      COUNT(DISTINCT jp.id) AS job_postings_count
    FROM companies c
    JOIN product_signals ps ON ps.company_id = c.id
    LEFT JOIN job_postings jp ON jp.company_id = c.id 
      AND jp.product_id = p_product_id
      AND jp.status = 'active'
    WHERE (p_countries IS NULL OR c.country = ANY(p_countries))
    GROUP BY c.id, c.name, c.logo_url, c.website, c.linkedin_url, c.country
    HAVING COUNT(DISTINCT ps.signal_id) > 0
  )
  SELECT 
    cs.id AS company_id,
    cs.name AS company_name,
    cs.logo_url AS company_logo_url,
    cs.website AS company_website,
    cs.linkedin_url AS company_linkedin_url,
    cs.country AS company_country,
    cs.total_count,
    cs.current_count,
    COALESCE(ac.alumni_signal_count, 0) AS alumni_count,
    cs.job_postings_count
  FROM company_stats cs
  LEFT JOIN alumni_by_company ac ON ac.company_id = cs.id
  ORDER BY cs.total_count DESC;
END;
$$;

-- Verificar que la función se creó correctamente
SELECT proname, pg_get_function_identity_arguments(oid) as args
FROM pg_proc 
WHERE proname = 'search_companies_by_technology';
