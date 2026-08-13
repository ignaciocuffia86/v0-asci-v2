-- Bookmark export: expose ALL contact emails (email1..email4) and phones
-- (phone1/phone2) in get_bookmark_export_data.
--
-- Bug: the Excel export of a bookmark dropped the corporate email when it sat
-- in email3/email4 (the RPC only returned email1/email2). This CREATE OR
-- REPLACE adds email3/email4 (with type + status). Phones (phone1/phone2) are
-- included as well so the deployed function is correct regardless of whether
-- prod was still on a pre-phones version of this RPC.
--
-- Idempotent: same signature, SECURITY DEFINER, ownership and grants preserved.
-- Only the employees_with_signals object gains the email3/email4 slots.

CREATE OR REPLACE FUNCTION public.get_bookmark_export_data(p_bookmark_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_company_id UUID;
  v_search_context JSONB;
  v_filter_signal_ids UUID[];
  v_has_scope_filter BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT company_id, search_context
  INTO v_company_id, v_search_context
  FROM bookmarks
  WHERE id = p_bookmark_id AND user_id = p_user_id;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ARRAY(
    SELECT elem::UUID
    FROM jsonb_array_elements_text(
      COALESCE(v_search_context->'filterSignalIds', '[]'::jsonb)
    ) AS elem
    WHERE elem IS NOT NULL AND elem != ''
  ) INTO v_filter_signal_ids;

  v_has_scope_filter := (
    array_length(v_filter_signal_ids, 1) IS NOT NULL
    AND array_length(v_filter_signal_ids, 1) > 0
  );

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

    -- Empleados con senales: exponemos TODOS los slots de email (1..4) y phone
    -- (1..2) con tipo y status para que el usuario pueda priorizar en Excel.
    'employees_with_signals', COALESCE((
      SELECT jsonb_agg(emp_row ORDER BY (emp_row->>'signal_count')::int DESC NULLS LAST)
      FROM (
        SELECT DISTINCT ON (ct.id) jsonb_build_object(
          'first_name', ct.first_name,
          'last_name', ct.last_name,
          'position', ct.current_position_title,
          'linkedin_url', ct.linkedin_url,

          -- Slot 1 de email
          'email1', ct.email1,
          'email1_type', ct.email1_type,
          'email1_status', ct.email1_status,

          -- Slot 2 de email
          'email2', ct.email2,
          'email2_type', ct.email2_type,
          'email2_status', ct.email2_status,

          -- Slot 3 de email
          'email3', ct.email3,
          'email3_type', ct.email3_type,
          'email3_status', ct.email3_status,

          -- Slot 4 de email
          'email4', ct.email4,
          'email4_type', ct.email4_type,
          'email4_status', ct.email4_status,

          -- Slot 1 de telefono
          'phone1', ct.phone1,
          'phone1_type', ct.phone1_type,
          'phone1_status', ct.phone1_status,

          -- Slot 2 de telefono
          'phone2', ct.phone2,
          'phone2_type', ct.phone2_type,
          'phone2_status', ct.phone2_status,

          'signal_count', (
            SELECT COUNT(*)
            FROM signals s
            WHERE s.contact_id = ct.id
              AND s.is_current_employee = true
              AND (NOT v_has_scope_filter OR s.signal_id = ANY(v_filter_signal_ids))
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
            WHERE s.contact_id = ct.id
              AND s.is_current_employee = true
              AND (NOT v_has_scope_filter OR s.signal_id = ANY(v_filter_signal_ids))
          )
        ) AS emp_row
        FROM contacts ct
        WHERE ct.current_company_id = v_company_id
          AND EXISTS (
            SELECT 1 FROM signals sig
            WHERE sig.contact_id = ct.id
              AND sig.is_current_employee = true
              AND (NOT v_has_scope_filter OR sig.signal_id = ANY(v_filter_signal_ids))
          )
      ) sub
      WHERE (emp_row->>'signal_count')::int > 0
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
            AND (NOT v_has_scope_filter OR s.signal_id = ANY(v_filter_signal_ids))
        )
      ) ORDER BY jp.posted_at DESC NULLS LAST)
      FROM job_postings jp
      WHERE jp.company_id = v_company_id
        AND jp.is_active = true
        AND EXISTS (
          SELECT 1 FROM signals sig
          WHERE sig.job_posting_id = jp.id
            AND (NOT v_has_scope_filter OR sig.signal_id = ANY(v_filter_signal_ids))
        )
    ), '[]'::jsonb),

    'prospects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'first_name', ucc.first_name,
        'last_name', ucc.last_name,
        'headline', ucc.headline,
        'email', ucc.email,
        'email_status', ucc.email_status,
        'linkedin_url', ucc.linkedin_url,
        'mobile_phone', ucc.mobile_phone,
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
$function$;
