-- Drawer: mostrar TODAS las señales detectadas en cada búsqueda laboral.
--
-- Problema: get_company_drawer_data armaba las vacantes con `SELECT DISTINCT ON (jp.id)`
-- SIN ORDER BY. Postgres devuelve en ese caso una fila arbitraria por vacante, con lo cual
-- `detected_keywords` de cada posting quedaba con UNA sola keyword aunque la vacante hubiera
-- matcheado varias, y los chips de "Ahora Buscando" subestimaban.
--
-- Fix: desduplicar por (vacante, señal) con un ORDER BY determinístico. El contador de la
-- solapa no cambia (el cliente agrupa por jp.id); cambia sólo el detalle de keywords.
-- get_company_job_postings (workspace) ya resolvía esto con jsonb_agg(DISTINCT ...).
--
-- NO toca la ventana de 6 meses: es intencional que el drawer muestre sólo lo reciente y el
-- listado el histórico completo; esa diferencia se explica en la UI.

CREATE OR REPLACE FUNCTION public.get_company_drawer_data(p_company_id uuid, p_filter_signal_ids uuid[] DEFAULT NULL::uuid[], p_filter_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

  -- 5. Job postings (FIX 160: jp.job_url en el fallback de apply_url)
  --    FIX: el DISTINCT ON (jp.id) sin ORDER BY dejaba UNA fila arbitraria por vacante,
  --    así que detected_keywords mostraba una sola keyword aunque la vacante matcheara varias.
  --    Ahora se desduplica por (vacante, señal) y se ordena, como ya hace get_company_job_postings.
  SELECT COALESCE(jsonb_agg(jp_data ORDER BY jp_data->>'posted_at' DESC), '[]'::jsonb) INTO v_job_postings
  FROM (
    SELECT DISTINCT ON (jp.id, COALESCE(dp.name, dpr.name, s.keyword_matched)) jsonb_build_object(
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
    ORDER BY jp.id, COALESCE(dp.name, dpr.name, s.keyword_matched), jp.posted_at DESC
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
$function$
;
