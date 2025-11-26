-- =====================================================
-- Script 080: RPC get_icebreaker_context
-- =====================================================
-- Recopila TODO el contexto necesario para generar icebreakers
-- personalizados por bookmark

CREATE OR REPLACE FUNCTION public.get_icebreaker_context(
  p_bookmark_id UUID,
  p_contact_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_company_id UUID;
  v_result JSONB;
  v_company JSONB;
  v_contact JSONB;
  v_signals JSONB;
  v_job_postings JSONB;
  v_news JSONB;
  v_success_cases JSONB;
  v_strategy JSONB;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  -- Get company_id from bookmark (verify ownership)
  SELECT b.company_id INTO v_company_id
  FROM bookmarks b
  WHERE b.id = p_bookmark_id AND b.user_id = v_user_id;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Bookmark not found or not owned');
  END IF;

  -- =====================================================
  -- 1. COMPANY INFO
  -- =====================================================
  SELECT jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'industry', c.industry,
    'country', c.country,
    'website', c.website,
    'linkedin_url', c.linkedin_url
  ) INTO v_company
  FROM companies c
  WHERE c.id = v_company_id;

  -- =====================================================
  -- 2. CONTACT INFO (if provided)
  -- =====================================================
  IF p_contact_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', ct.id,
      'first_name', ct.first_name,
      'last_name', ct.last_name,
      'headline', ct.headline,
      'current_position_title', ct.current_position_title,
      'linkedin_url', ct.linkedin_url,
      'is_current_employee', EXISTS(
        SELECT 1 FROM signals s 
        WHERE s.contact_id = ct.id 
        AND s.company_id = v_company_id 
        AND s.is_current_employee = true
      )
    ) INTO v_contact
    FROM contacts ct
    WHERE ct.id = p_contact_id;
  ELSE
    v_contact := NULL;
  END IF;

  -- =====================================================
  -- 3. SIGNALS (technology/process signals for this company)
  -- =====================================================
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'keyword', s.keyword_matched,
      'signal_type', s.signal_type,
      'snippet', s.snippet,
      'source_field', s.source_field,
      'is_current_employee', s.is_current_employee,
      'vendor', dv.name,
      'product', dp.name,
      'process', dpr.name
    ) ORDER BY s.created_at DESC
  ), '[]'::jsonb) INTO v_signals
  FROM signals s
  LEFT JOIN dictionary_products dp ON LOWER(s.keyword_matched) = ANY(SELECT LOWER(k) FROM unnest(dp.keywords) k)
  LEFT JOIN dictionary_vendors dv ON dp.vendor_id = dv.id
  LEFT JOIN dictionary_processes dpr ON LOWER(s.keyword_matched) = ANY(SELECT LOWER(k) FROM unnest(dpr.keywords) k)
  WHERE s.company_id = v_company_id
  LIMIT 20;

  -- =====================================================
  -- 4. JOB POSTINGS (active positions)
  -- =====================================================
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'title', jp.title,
      'description_preview', LEFT(jp.description, 300),
      'location', jp.location,
      'seniority', jp.seniority,
      'posted_at', jp.posted_at
    ) ORDER BY jp.posted_at DESC NULLS LAST
  ), '[]'::jsonb) INTO v_job_postings
  FROM job_postings jp
  WHERE jp.company_id = v_company_id
  LIMIT 10;

  -- =====================================================
  -- 5. NEWS (user's collected news for this bookmark)
  -- =====================================================
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'title', cn.title,
      'summary', cn.summary,
      'source_name', cn.source_name,
      'published_at', cn.published_at,
      'relevance_tags', cn.relevance_tags
    ) ORDER BY cn.published_at DESC NULLS LAST
  ), '[]'::jsonb) INTO v_news
  FROM company_news cn
  WHERE cn.bookmark_id = p_bookmark_id
    AND cn.user_id = v_user_id
  LIMIT 10;

  -- =====================================================
  -- 6. SUCCESS CASES (user's cases, prioritizing relevant industry)
  -- =====================================================
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'title', sc.title,
      'client_industry', sc.client_industry,
      'client_size', sc.client_size,
      'challenge', sc.challenge,
      'solution', sc.solution,
      'results', sc.results,
      'technologies', sc.technologies,
      'is_relevant', sc.client_industry = (SELECT industry FROM companies WHERE id = v_company_id)
    ) ORDER BY 
      (sc.client_industry = (SELECT industry FROM companies WHERE id = v_company_id)) DESC,
      sc.created_at DESC
  ), '[]'::jsonb) INTO v_success_cases
  FROM success_cases sc
  WHERE sc.user_id = v_user_id
    AND sc.is_active = true
  LIMIT 10;

  -- =====================================================
  -- 7. STRATEGY (user's strategy for this bookmark)
  -- =====================================================
  SELECT jsonb_build_object(
    'target_summary', ucs.target_summary,
    'recommended_pitch', ucs.recommended_pitch,
    'sender_context', COALESCE(
      ucs.sender_context_override,
      (SELECT value_proposition FROM profiles WHERE id = v_user_id)
    )
  ) INTO v_strategy
  FROM user_company_strategies ucs
  WHERE ucs.bookmark_id = p_bookmark_id
    AND ucs.user_id = v_user_id;

  -- If no strategy exists, try to get default sender context from profile
  IF v_strategy IS NULL THEN
    SELECT jsonb_build_object(
      'target_summary', NULL,
      'recommended_pitch', NULL,
      'sender_context', p.value_proposition
    ) INTO v_strategy
    FROM profiles p
    WHERE p.id = v_user_id;
  END IF;

  -- =====================================================
  -- BUILD FINAL RESULT
  -- =====================================================
  v_result := jsonb_build_object(
    'company', v_company,
    'contact', v_contact,
    'signals', v_signals,
    'job_postings', v_job_postings,
    'news', v_news,
    'success_cases', v_success_cases,
    'strategy', v_strategy,
    'template_rules', jsonb_build_object(
      'always_start_with_name', true,
      'never_mention_job_title', true,
      'only_mention_process_if_explicit', true,
      'fallback_phrase', 'en sus operaciones'
    ),
    'generated_at', NOW()
  );

  RETURN v_result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_icebreaker_context(UUID, UUID) TO authenticated;

-- =====================================================
-- Verification
-- =====================================================
SELECT 'RPC get_icebreaker_context creado correctamente' as resultado;
