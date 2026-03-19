-- RPC para exportar datos consolidados de un bookmark
-- Devuelve JSON con: company info, bookmark info, employees with signals (máx 40), job postings, prospects (máx 40), news, implementations
-- Soporta cuentas "generales" sin search_filter_id

DROP FUNCTION IF EXISTS public.get_bookmark_export_data(UUID, UUID) CASCADE;

CREATE FUNCTION public.get_bookmark_export_data(
  p_bookmark_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_id UUID;
  v_result JSONB;
  v_employees_count INT;
  v_contacts_count INT;
BEGIN
  -- Verify bookmark belongs to user and get company_id
  SELECT company_id INTO v_company_id
  FROM bookmarks
  WHERE id = p_bookmark_id AND user_id = p_user_id;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Count employees and contacts before limiting
  SELECT COUNT(*) INTO v_employees_count
  FROM contacts ct
  WHERE ct.company_id = v_company_id
    AND ct.is_current_employee = true
    AND ct.status = 'active';

  SELECT COUNT(*) INTO v_contacts_count
  FROM user_company_contacts ucc
  WHERE ucc.company_id = v_company_id AND ucc.user_id = p_user_id;

  -- Build consolidated JSON
  SELECT jsonb_build_object(
    'company', (
      SELECT jsonb_build_object(
        'name', c.name,
        'country', c.country_normalized,
        'industry', c.industry,
        'website', c.website,
        'linkedin_url', c.linkedin_url
      )
      FROM companies c
      WHERE c.id = v_company_id
    ),
    'bookmark', (
      SELECT jsonb_build_object(
        'status', b.status,
        'priority', b.priority,
        'notes', b.notes,
        'search_context', b.search_context,
        'created_at', b.created_at
      )
      FROM bookmarks b
      WHERE b.id = p_bookmark_id
    ),
    'strategy', (
      SELECT jsonb_build_object(
        'recommended_pitch', ucs.recommended_pitch,
        'sender_context_override', ucs.sender_context_override
      )
      FROM user_company_strategies ucs
      WHERE ucs.bookmark_id = p_bookmark_id AND ucs.user_id = p_user_id
    ),
    'employees_with_signals', COALESCE((
      SELECT jsonb_build_object(
        'total_count', v_employees_count,
        'exported_count', COALESCE((SELECT COUNT(*) FROM (SELECT 1 FROM contacts ct2 WHERE ct2.company_id = v_company_id AND ct2.is_current_employee = true AND ct2.status = 'active' LIMIT 40) x), 0),
        'truncated', v_employees_count > 40,
        'warning', CASE WHEN v_employees_count > 40 THEN 'Se exportan solo los 40 primeros empleados. Usa filtros de señales para refinar la búsqueda.' ELSE NULL END,
        'data', COALESCE((
          SELECT jsonb_agg(emp_row ORDER BY emp_row->>'signal_count' DESC NULLS LAST)
          FROM (
            SELECT jsonb_build_object(
              'first_name', ct.first_name,
              'last_name', ct.last_name,
              'position', ct.position,
              'email', ct.email,
              'linkedin_url', ct.linkedin_url,
              'signal_count', (SELECT COUNT(*) FROM signals s WHERE s.contact_id = ct.id),
              'signals', (
                SELECT jsonb_agg(jsonb_build_object(
                  'signal_type', s.signal_type,
                  'signal_name', COALESCE(dp.name, dpr.name, s.signal_type),
                  'source', s.source,
                  'snippet', LEFT(s.snippet, 200)
                ))
                FROM signals s
                LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
                LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
                WHERE s.contact_id = ct.id
              )
            ) as emp_row
            FROM contacts ct
            WHERE ct.company_id = v_company_id
              AND ct.is_current_employee = true
              AND ct.status = 'active'
            LIMIT 40
          ) sub
        ), '[]'::jsonb)
      )
    ), '{"total_count": 0, "exported_count": 0, "truncated": false, "data": []}'::jsonb),
    'job_postings', COALESCE((
      SELECT jsonb_agg(posting_row)
      FROM (
        SELECT jsonb_build_object(
          'title', jp.title,
          'url', jp.url,
          'location', jp.location,
          'posted_at', jp.posted_at,
          'is_active', jp.is_active,
          'signals', (
            SELECT jsonb_agg(jsonb_build_object(
              'signal_type', s.signal_type,
              'signal_name', COALESCE(dp.name, dpr.name, s.signal_type)
            ))
            FROM signals s
            LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
            LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
            WHERE s.job_posting_id = jp.id
          )
        ) as posting_row
        FROM job_postings jp
        WHERE jp.company_id = v_company_id AND jp.is_active = true
        ORDER BY jp.posted_at DESC NULLS LAST
      ) jp_sub
    ), '[]'::jsonb),
    'prospects', COALESCE((
      SELECT jsonb_build_object(
        'total_count', v_contacts_count,
        'exported_count', COALESCE((SELECT COUNT(*) FROM (SELECT 1 FROM user_company_contacts ucc2 WHERE ucc2.company_id = v_company_id AND ucc2.user_id = p_user_id LIMIT 40) x), 0),
        'truncated', v_contacts_count > 40,
        'warning', CASE WHEN v_contacts_count > 40 THEN 'Se exportan solo los 40 primeros prospectos. Usa filtros de señales para refinar la búsqueda.' ELSE NULL END,
        'data', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'first_name', ucc.first_name,
            'last_name', ucc.last_name,
            'headline', ucc.headline,
            'email', ucc.email,
            'email_status', ucc.email_status,
            'linkedin_url', ucc.linkedin_url,
            'phone', ucc.phone_number,
            'seniority', ucc.seniority,
            'is_decision_maker', ucc.is_likely_to_engage,
            'departments', ucc.departments
          ))
          FROM (
            SELECT *
            FROM user_company_contacts ucc
            WHERE ucc.company_id = v_company_id AND ucc.user_id = p_user_id
            ORDER BY ucc.is_likely_to_engage DESC NULLS LAST, ucc.seniority
            LIMIT 40
          ) ucc_sub
        ), '[]'::jsonb)
      )
    ), '{"total_count": 0, "exported_count": 0, "truncated": false, "data": []}'::jsonb),
    'news', COALESCE((
      SELECT jsonb_agg(news_row)
      FROM (
        SELECT jsonb_build_object(
          'title', cn.title,
          'url', cn.url,
          'published_at', cn.published_at,
          'source', cn.source
        ) as news_row
        FROM company_news cn
        WHERE cn.company_id = v_company_id
        ORDER BY cn.published_at DESC NULLS LAST
        LIMIT 10
      ) news_sub
    ), '[]'::jsonb),
    'implementations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_name', ci.product_name,
        'vendor_name', ci.vendor_name,
        'category', ci.category,
        'source_url', ci.source_url
      ))
      FROM company_implementations ci
      WHERE ci.company_id = v_company_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_bookmark_export_data(UUID, UUID) TO authenticated;
