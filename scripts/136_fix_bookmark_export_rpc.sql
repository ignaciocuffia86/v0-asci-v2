-- FIX: RPC para exportar datos consolidados de un bookmark
-- Corrige columnas que no existen: employee_count, position, email en contacts

CREATE OR REPLACE FUNCTION public.get_bookmark_export_data(
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
BEGIN
  -- Verify bookmark belongs to user and get company_id
  SELECT company_id INTO v_company_id
  FROM bookmarks
  WHERE id = p_bookmark_id AND user_id = p_user_id;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Build consolidated JSON
  SELECT jsonb_build_object(
    'company', (
      SELECT jsonb_build_object(
        'name', c.name,
        'country', c.country_normalized,
        'industry', c.industry,
        'website', c.website,
        'linkedin_url', c.linkedin_url,
        'employee_count', NULL
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
      SELECT jsonb_agg(emp_row ORDER BY (emp_row->>'signal_count')::int DESC NULLS LAST)
      FROM (
        SELECT DISTINCT ON (ct.id) jsonb_build_object(
          'first_name', ct.first_name,
          'last_name', ct.last_name,
          'position', ct.current_position_title,
          'email', COALESCE(ct.email1, ct.email2),
          'linkedin_url', ct.linkedin_url,
          'signal_count', (
            SELECT COUNT(*) FROM signals s 
            WHERE s.contact_id = ct.id AND s.is_current_employee = true
          ),
          'signals', (
            SELECT jsonb_agg(jsonb_build_object(
              'signal_type', s.signal_type,
              'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
              'source', s.source_field,
              'snippet', LEFT(s.snippet, 200)
            ))
            FROM signals s
            LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
            LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
            WHERE s.contact_id = ct.id AND s.is_current_employee = true
          )
        ) as emp_row
        FROM contacts ct
        INNER JOIN signals sig ON sig.contact_id = ct.id AND sig.is_current_employee = true
        WHERE ct.current_company_id = v_company_id
      ) sub
    ), '[]'::jsonb),
    'job_postings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', jp.title,
        'url', jp.job_url,
        'location', jp.location,
        'posted_at', jp.posted_at,
        'is_active', jp.is_active,
        'signals', (
          SELECT jsonb_agg(jsonb_build_object(
            'signal_type', s.signal_type,
            'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched)
          ))
          FROM signals s
          LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
          LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
          WHERE s.job_posting_id = jp.id
        )
      ) ORDER BY jp.posted_at DESC NULLS LAST)
      FROM job_postings jp
      WHERE jp.company_id = v_company_id AND jp.is_active = true
    ), '[]'::jsonb),
    'prospects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'first_name', ucc.first_name,
        'last_name', ucc.last_name,
        'headline', ucc.headline,
        'email', ucc.email,
        'email_status', ucc.email_status,
        'linkedin_url', ucc.linkedin_url,
        'phone', ucc.phone,
        'seniority', ucc.seniority,
        'is_decision_maker', ucc.is_decision_maker,
        'departments', ucc.departments
      ) ORDER BY ucc.is_decision_maker DESC NULLS LAST, ucc.seniority)
      FROM user_company_contacts ucc
      WHERE ucc.company_id = v_company_id AND ucc.user_id = p_user_id
    ), '[]'::jsonb),
    'news', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'title', cn.title,
        'url', cn.source_url,
        'published_at', cn.published_at,
        'source', cn.source_name
      ) ORDER BY cn.published_at DESC NULLS LAST)
      FROM company_news cn
      WHERE cn.company_id = v_company_id
      LIMIT 10
    ), '[]'::jsonb),
    'implementations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_name', ci.technology,
        'vendor_name', ci.provider_name,
        'category', ci.area,
        'source_url', ci.source_url
      ))
      FROM company_implementations ci
      WHERE ci.company_id = v_company_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_bookmark_export_data(UUID, UUID) TO authenticated;
