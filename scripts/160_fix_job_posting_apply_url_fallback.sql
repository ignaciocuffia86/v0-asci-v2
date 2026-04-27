-- Script 160: Fix botón "Ver Oferta Completa" no aparece en job postings
--
-- PROBLEMA
-- Los RPCs get_company_job_postings y get_company_drawer_data solo devuelven
-- jp.apply_url. Pero el ETL actual carga la URL del job en jp.job_url
-- (la columna apply_url quedó casi siempre NULL en producción). Como
-- consecuencia, en el UI:
--   {jp.apply_url && (<a ...>Ver Oferta Completa</a>)}
-- el botón nunca se renderiza.
--
-- SOLUCIÓN
-- 1. Garantizar que la columna apply_url exista (idempotente).
-- 2. Reescribir ambos RPCs para devolver:
--      COALESCE(jp.apply_url, jp.job_url, <source_url de la signal>)
--    como `apply_url`. Así, si apply_url es NULL pero existe job_url
--    o source_url, igual se devuelve un link válido.
-- 3. La UI ya comprueba `jp.apply_url`, no necesita cambios para que
--    aparezca el botón.

-- 1) Columna apply_url - asegurar existencia
ALTER TABLE public.job_postings
  ADD COLUMN IF NOT EXISTS apply_url TEXT;

-- 2) Reescribir get_company_job_postings (usado en bookmark > Búsquedas Laborales)
DROP FUNCTION IF EXISTS public.get_company_job_postings(UUID, UUID[], INT);
DROP FUNCTION IF EXISTS public.get_company_job_postings(UUID, UUID[], INT, TEXT);

CREATE OR REPLACE FUNCTION public.get_company_job_postings(
  p_company_id UUID,
  p_signal_ids UUID[] DEFAULT NULL,
  p_limit INT DEFAULT 100,
  p_location_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  location TEXT,
  posted_at TIMESTAMPTZ,
  apply_url TEXT,
  detected_keywords JSONB,
  is_recent BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    jp.id,
    jp.title,
    jp.location,
    jp.posted_at,
    -- Fallback chain: apply_url -> job_url -> primer source_url de las signals
    COALESCE(jp.apply_url, jp.job_url, max_source_url.url) AS apply_url,
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'keyword', s.keyword_matched,
        'signal_type', s.signal_type,
        'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched)
      )
    ) FILTER (WHERE s.id IS NOT NULL) AS detected_keywords,
    (jp.posted_at >= NOW() - INTERVAL '1 month') AS is_recent
  FROM signals s
  JOIN job_postings jp ON jp.id = s.job_posting_id
  LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id AND s.signal_type = 'process'
  LEFT JOIN dictionary_products dpr ON s.signal_id = dpr.id AND s.signal_type = 'technology'
  LEFT JOIN LATERAL (
    SELECT s2.source_url AS url
    FROM signals s2
    WHERE s2.job_posting_id = jp.id AND s2.source_url IS NOT NULL
    LIMIT 1
  ) max_source_url ON true
  WHERE s.company_id = p_company_id
    AND s.job_posting_id IS NOT NULL
    AND (p_signal_ids IS NULL OR s.signal_id = ANY(p_signal_ids))
    AND jp.posted_at >= NOW() - INTERVAL '6 months'
    AND (
      p_location_filter IS NULL
      OR jp.location ILIKE '%' || p_location_filter || '%'
    )
  GROUP BY jp.id, jp.title, jp.location, jp.posted_at, jp.apply_url, jp.job_url, max_source_url.url
  ORDER BY jp.posted_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_job_postings(UUID, UUID[], INT, TEXT)
  TO authenticated, anon;

-- 3) Parchar la sección job_postings de get_company_drawer_data
--    (sólo cambiamos el COALESCE para incluir job_url como segundo fallback).
--    Mantenemos el resto del cuerpo idéntico al script 104.
CREATE OR REPLACE FUNCTION public.get_company_drawer_data(
  p_company_id UUID,
  p_filter_signal_ids UUID[] DEFAULT NULL,
  p_filter_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_company JSONB;
  v_dictionary_names TEXT[];
  v_signals JSONB;
  v_contacts JSONB;
  v_job_postings JSONB;
  v_alumni_signals JSONB;
  v_six_months_ago TIMESTAMPTZ;
BEGIN
  v_six_months_ago := NOW() - INTERVAL '6 months';

  -- 1. Company
  SELECT to_jsonb(c.*) INTO v_company
  FROM companies c
  WHERE c.id = p_company_id;

  -- 2. Dictionary names
  IF p_filter_signal_ids IS NOT NULL AND array_length(p_filter_signal_ids, 1) > 0 AND p_filter_type IS NOT NULL THEN
    IF p_filter_type = 'process' THEN
      SELECT array_agg(name) INTO v_dictionary_names
      FROM dictionary_processes
      WHERE id = ANY(p_filter_signal_ids);
    ELSE
      SELECT array_agg(name) INTO v_dictionary_names
      FROM dictionary_products
      WHERE id = ANY(p_filter_signal_ids);
    END IF;
  END IF;

  -- 3. Current employee signals
  SELECT COALESCE(jsonb_agg(signal_data ORDER BY signal_data->>'contact_name'), '[]'::jsonb) INTO v_signals
  FROM (
    SELECT jsonb_build_object(
      'id', s.id,
      'contact_id', s.contact_id,
      'company_id', s.company_id,
      'signal_id', s.signal_id,
      'signal_type', s.signal_type,
      'keyword_matched', s.keyword_matched,
      'source_field', s.source_field,
      'snippet', s.snippet,
      'source_url', s.source_url,
      'is_current_employee', s.is_current_employee,
      'created_at', s.created_at,
      'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
      'contact', jsonb_build_object(
        'id', ct.id,
        'full_name', ct.full_name,
        'headline', ct.headline,
        'linkedin_url', ct.linkedin_url,
        'profile_picture_url', ct.profile_picture_url,
        'current_position_title', ct.current_position_title,
        'current_company_id', ct.current_company_id,
        'email1', ct.email1,
        'email1_type', ct.email1_type,
        'email1_status', ct.email1_status,
        'email2', ct.email2,
        'email2_type', ct.email2_type,
        'email2_status', ct.email2_status,
        'phone1', ct.phone1,
        'phone1_type', ct.phone1_type,
        'phone2', ct.phone2,
        'phone2_type', ct.phone2_type,
        'previous_positions', ct.previous_positions
      ),
      'contact_name', ct.full_name
    ) AS signal_data
    FROM signals s
    LEFT JOIN contacts ct ON ct.id = s.contact_id
    LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
    LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
    WHERE s.company_id = p_company_id
      AND s.is_current_employee = TRUE
      AND (
        s.contact_id IS NOT NULL
        OR s.job_posted_at >= v_six_months_ago
      )
      AND (
        p_filter_signal_ids IS NULL
        OR array_length(p_filter_signal_ids, 1) = 0
        OR s.signal_id = ANY(p_filter_signal_ids)
      )
    LIMIT 200
  ) subq;

  -- 4. Contacts with signal counts
  SELECT COALESCE(jsonb_agg(contact_data ORDER BY contact_data->>'full_name'), '[]'::jsonb) INTO v_contacts
  FROM (
    SELECT jsonb_build_object(
      'id', ct.id,
      'full_name', ct.full_name,
      'headline', ct.headline,
      'linkedin_url', ct.linkedin_url,
      'profile_picture_url', ct.profile_picture_url,
      'current_position_title', ct.current_position_title,
      'email1', ct.email1,
      'email1_type', ct.email1_type,
      'email1_status', ct.email1_status,
      'email2', ct.email2,
      'email2_type', ct.email2_type,
      'email2_status', ct.email2_status,
      'phone1', ct.phone1,
      'phone1_type', ct.phone1_type,
      'phone2', ct.phone2,
      'phone2_type', ct.phone2_type,
      'signal_count', (
        SELECT COUNT(*)::int
        FROM signals s2
        WHERE s2.contact_id = ct.id
          AND (
            p_filter_signal_ids IS NULL
            OR array_length(p_filter_signal_ids, 1) = 0
            OR s2.signal_id = ANY(p_filter_signal_ids)
          )
      )
    ) AS contact_data
    FROM contacts ct
    WHERE ct.current_company_id = p_company_id
      AND (
        p_filter_signal_ids IS NULL
        OR array_length(p_filter_signal_ids, 1) = 0
        OR EXISTS (
          SELECT 1 FROM signals s3
          WHERE s3.contact_id = ct.id
            AND s3.signal_id = ANY(p_filter_signal_ids)
        )
      )
  ) subq
  WHERE (contact_data->>'signal_count')::int > 0
     OR p_filter_signal_ids IS NULL
     OR array_length(p_filter_signal_ids, 1) = 0;

  -- 5. Job postings (FIX 160: agregar jp.job_url al fallback de apply_url)
  SELECT COALESCE(jsonb_agg(jp_data ORDER BY jp_data->>'posted_at' DESC), '[]'::jsonb) INTO v_job_postings
  FROM (
    SELECT DISTINCT ON (jp.id) jsonb_build_object(
      'id', jp.id,
      'title', jp.title,
      'posted_at', jp.posted_at,
      'apply_url', COALESCE(jp.apply_url, jp.job_url, s.source_url),
      'keyword_matched', s.keyword_matched,
      'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
      'snippet', s.snippet
    ) AS jp_data
    FROM signals s
    JOIN job_postings jp ON jp.id = s.job_posting_id
    LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
    LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
    WHERE s.company_id = p_company_id
      AND s.job_posting_id IS NOT NULL
      AND jp.posted_at >= v_six_months_ago
      AND (
        p_filter_signal_ids IS NULL
        OR array_length(p_filter_signal_ids, 1) = 0
        OR s.signal_id = ANY(p_filter_signal_ids)
      )
  ) subq;

  -- 6. Alumni signals (sin cambios respecto a 104)
  SELECT COALESCE(jsonb_agg(alumni_signal_data ORDER BY alumni_signal_data->>'contact_name'), '[]'::jsonb) INTO v_alumni_signals
  FROM (
    SELECT jsonb_build_object(
      'id', s.id,
      'contact_id', s.contact_id,
      'company_id', s.company_id,
      'signal_id', s.signal_id,
      'signal_type', s.signal_type,
      'keyword_matched', s.keyword_matched,
      'source_field', s.source_field,
      'snippet', s.snippet,
      'source_url', s.source_url,
      'is_current_employee', s.is_current_employee,
      'created_at', s.created_at,
      'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
      'contact', jsonb_build_object(
        'id', ct.id,
        'full_name', ct.full_name,
        'headline', ct.headline,
        'linkedin_url', ct.linkedin_url,
        'profile_picture_url', ct.profile_picture_url,
        'current_position_title', ct.current_position_title,
        'current_company_id', ct.current_company_id,
        'email1', ct.email1,
        'email1_type', ct.email1_type,
        'email1_status', ct.email1_status,
        'email2', ct.email2,
        'email2_type', ct.email2_type,
        'email2_status', ct.email2_status,
        'phone1', ct.phone1,
        'phone1_type', ct.phone1_type,
        'phone2', ct.phone2,
        'phone2_type', ct.phone2_type,
        'previous_positions', ct.previous_positions
      ),
      'contact_name', ct.full_name
    ) AS alumni_signal_data
    FROM contacts ct
    CROSS JOIN LATERAL jsonb_array_elements(ct.previous_positions) AS pp
    JOIN signals s ON s.contact_id = ct.id
    LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
    LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
    WHERE (pp->>'company_id')::uuid = p_company_id
      AND ct.current_company_id IS DISTINCT FROM p_company_id
      AND s.company_id = p_company_id
      AND (
        p_filter_type IS NULL
        OR s.signal_type = p_filter_type
      )
      AND (
        p_filter_signal_ids IS NULL
        OR array_length(p_filter_signal_ids, 1) = 0
        OR s.signal_id = ANY(p_filter_signal_ids)
      )
    LIMIT 100
  ) subq;

  v_result := jsonb_build_object(
    'company', v_company,
    'dictionary_names', COALESCE(to_jsonb(v_dictionary_names), '[]'::jsonb),
    'signals', v_signals,
    'contacts', v_contacts,
    'job_postings', v_job_postings,
    'alumni_signals', v_alumni_signals
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_drawer_data(UUID, UUID[], TEXT)
  TO authenticated, anon;
