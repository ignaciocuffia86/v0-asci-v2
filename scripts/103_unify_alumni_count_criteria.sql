-- Unificar criterio de conteo de alumni en búsqueda por proceso
-- Usar el mismo criterio complejo que tecnología:
-- - Contacto tiene la compañía en previous_positions
-- - current_company_id es DISTINTO de la compañía actual
-- - La señal pertenece a esa compañía

DROP FUNCTION IF EXISTS search_companies_by_process_v2(uuid[], text[], boolean);

CREATE OR REPLACE FUNCTION search_companies_by_process_v2(
  p_process_ids uuid[],
  p_countries text[] DEFAULT NULL,
  p_exclude_providers boolean DEFAULT FALSE
)
RETURNS TABLE (
  company_id uuid,
  company_name text,
  company_logo_url text,
  company_website text,
  company_linkedin_url text,
  company_country text,
  company_industry text,
  signal_count bigint,
  current_count bigint,
  alumni_count bigint,
  job_postings_count bigint,
  relevance_score numeric,
  current_score numeric,
  alumni_score numeric,
  job_postings_score numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  max_current bigint;
  max_alumni bigint;
  max_job_postings bigint;
  provider_industries text[] := ARRAY[
    'Information Technology & Services',
    'Information Technology and Services',
    'Management Consulting',
    'Accounting',
    'Staffing & Recruiting',
    'Staffing and Recruiting',
    'Computer Software'
  ];
BEGIN
  -- Calcular máximos para normalización
  SELECT 
    GREATEST(MAX(cnt.current_employees), 1),
    GREATEST(MAX(cnt.alumni_signals), 1),
    GREATEST(MAX(cnt.job_postings), 1)
  INTO max_current, max_alumni, max_job_postings
  FROM (
    SELECT 
      c.id,
      COUNT(DISTINCT s.id) FILTER (WHERE s.is_current_employee = TRUE) AS current_employees,
      -- Usar criterio complejo para alumni (igual que tecnología)
      (
        SELECT COUNT(DISTINCT als.id)
        FROM contacts alc
        CROSS JOIN LATERAL jsonb_array_elements(alc.previous_positions) AS pp
        JOIN signals als ON als.contact_id = alc.id
        WHERE (pp->>'company_id')::uuid = c.id
        AND alc.current_company_id IS DISTINCT FROM c.id
        AND als.company_id = c.id
        AND als.signal_id = ANY(p_process_ids)
        AND als.signal_type = 'process'
      ) AS alumni_signals,
      (
        SELECT COUNT(DISTINCT jp.id)
        FROM job_postings jp
        INNER JOIN signals js ON js.job_posting_id = jp.id
        WHERE js.company_id = c.id
        AND js.signal_id = ANY(p_process_ids)
        AND jp.posted_at >= NOW() - INTERVAL '6 months'
      ) AS job_postings
    FROM companies c
    INNER JOIN signals s ON s.company_id = c.id
    WHERE s.signal_id = ANY(p_process_ids)
    AND s.signal_type = 'process'
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
    AND (NOT p_exclude_providers OR c.industry IS NULL OR NOT c.industry = ANY(provider_industries))
    GROUP BY c.id
  ) cnt;

  RETURN QUERY
  WITH company_signals AS (
    SELECT 
      c.id,
      c.name,
      c.logo_url,
      c.website,
      c.linkedin_url,
      c.country,
      c.industry,
      COUNT(DISTINCT s.id) AS total_signals,
      COUNT(DISTINCT s.id) FILTER (WHERE s.is_current_employee = TRUE) AS current_employees,
      -- Usar criterio complejo para alumni (igual que tecnología)
      (
        SELECT COUNT(DISTINCT als.id)
        FROM contacts alc
        CROSS JOIN LATERAL jsonb_array_elements(alc.previous_positions) AS pp
        JOIN signals als ON als.contact_id = alc.id
        WHERE (pp->>'company_id')::uuid = c.id
        AND alc.current_company_id IS DISTINCT FROM c.id
        AND als.company_id = c.id
        AND als.signal_id = ANY(p_process_ids)
        AND als.signal_type = 'process'
      ) AS alumni_signals,
      (
        SELECT COUNT(DISTINCT jp.id)
        FROM job_postings jp
        INNER JOIN signals js ON js.job_posting_id = jp.id
        WHERE js.company_id = c.id
        AND js.signal_id = ANY(p_process_ids)
        AND jp.posted_at >= NOW() - INTERVAL '6 months'
      ) AS job_postings
    FROM companies c
    INNER JOIN signals s ON s.company_id = c.id
    WHERE s.signal_id = ANY(p_process_ids)
    AND s.signal_type = 'process'
    AND (p_countries IS NULL OR c.country = ANY(p_countries))
    AND (NOT p_exclude_providers OR c.industry IS NULL OR NOT c.industry = ANY(provider_industries))
    GROUP BY c.id, c.name, c.logo_url, c.website, c.linkedin_url, c.country, c.industry
  ),
  scored AS (
    SELECT 
      cs.*,
      ROUND((cs.current_employees::numeric / max_current) * 100, 1) AS curr_score,
      ROUND((cs.alumni_signals::numeric / max_alumni) * 100, 1) AS alum_score,
      ROUND((cs.job_postings::numeric / max_job_postings) * 100, 1) AS jp_score
    FROM company_signals cs
  )
  SELECT 
    sc.id AS company_id,
    sc.name AS company_name,
    sc.logo_url AS company_logo_url,
    sc.website AS company_website,
    sc.linkedin_url AS company_linkedin_url,
    sc.country AS company_country,
    sc.industry AS company_industry,
    sc.total_signals AS signal_count,
    sc.current_employees AS current_count,
    sc.alumni_signals AS alumni_count,
    sc.job_postings AS job_postings_count,
    ROUND((sc.curr_score * 0.4) + (sc.alum_score * 0.3) + (sc.jp_score * 0.3), 1) AS relevance_score,
    sc.curr_score AS current_score,
    sc.alum_score AS alumni_score,
    sc.jp_score AS job_postings_score
  FROM scored sc
  ORDER BY relevance_score DESC, sc.total_signals DESC;
END;
$$;
