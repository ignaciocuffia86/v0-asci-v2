-- RPC para exportar datos consolidados de un bookmark
-- Mapeo de campos validado contra schema actual:
-- - companies: name, country_normalized, industry, website, linkedin_url (NO employee_count)
-- - bookmarks: status, priority, notes, search_context, created_at
-- - user_company_contacts: first_name, last_name, role (NOT position), email, linkedin_url, seniority
-- - job_postings: title, posting_url (NOT url), location, posted_at, is_active
-- - company_news: title, source_url (NOT url), published_at, source_name (NOT source)
-- - company_implementations: technology (NOT product_name), provider_name (NOT vendor_name), area (NOT category), source_url
-- - signals: signal_type, signal_id, contact_id, snippet (via apollo_cache_id junction)

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
  v_contacts_count INT;
BEGIN
  SELECT company_id INTO v_company_id
  FROM bookmarks
  WHERE id = p_bookmark_id AND user_id = p_user_id;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO v_contacts_count
  FROM user_company_contacts ucc
  WHERE ucc.company_id = v_company_id AND ucc.user_id = p_user_id;

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
    'contacts_with_signals', COALESCE((
      SELECT jsonb_build_object(
        'total_count', v_contacts_count,
        'exported_count', COALESCE((SELECT COUNT(*) FROM (SELECT 1 FROM user_company_contacts ucc2 WHERE ucc2.company_id = v_company_id AND ucc2.user_id = p_user_id LIMIT 40) x), 0),
        'truncated', v_contacts_count > 40,
        'warning', CASE WHEN v_contacts_count > 40 THEN 'Se exportan solo los 40 primeros contactos. Usa filtros de señales para refinar la búsqueda.' ELSE NULL END,
        'data', COALESCE((
          SELECT jsonb_agg(contact_row ORDER BY contact_row->>'signal_count' DESC NULLS LAST)
          FROM (
            SELECT jsonb_build_object(
              'first_name', ucc.first_name,
              'last_name', ucc.last_name,
              'role', ucc.role,
              'email', ucc.email,
              'linkedin_url', ucc.linkedin_url,
              'seniority', ucc.seniority,
              'signal_count', (
                SELECT COUNT(*) FROM signals s 
                WHERE s.contact_id = ucc.apollo_cache_id
              ),
              'signals', (
                SELECT jsonb_agg(jsonb_build_object(
                  'signal_type', s.signal_type,
                  'signal_name', COALESCE(dp.name, dpr.name, s.signal_type),
                  'snippet', LEFT(s.snippet, 200)
                ))
                FROM signals s
                LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
                LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
                WHERE s.contact_id = ucc.apollo_cache_id
              )
            ) as contact_row
            FROM user_company_contacts ucc
            WHERE ucc.company_id = v_company_id AND ucc.user_id = p_user_id
            ORDER BY (SELECT COUNT(*) FROM signals s WHERE s.contact_id = ucc.apollo_cache_id) DESC
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
          'posting_url', jp.posting_url,
          'location', jp.location,
          'posted_at', jp.posted_at,
          'is_active', jp.is_active
        ) as posting_row
        FROM job_postings jp
        WHERE jp.company_id = v_company_id AND jp.is_active = true
        ORDER BY jp.posted_at DESC NULLS LAST
      ) jp_sub
    ), '[]'::jsonb),
    'news', COALESCE((
      SELECT jsonb_agg(news_row)
      FROM (
        SELECT jsonb_build_object(
          'title', cn.title,
          'source_url', cn.source_url,
          'published_at', cn.published_at,
          'source_name', cn.source_name
        ) as news_row
        FROM company_news cn
        WHERE cn.company_id = v_company_id
        ORDER BY cn.published_at DESC NULLS LAST
        LIMIT 10
      ) news_sub
    ), '[]'::jsonb),
    'implementations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'technology', ci.technology,
        'provider_name', ci.provider_name,
        'area', ci.area,
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
