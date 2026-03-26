-- Migration 137: Update all RPCs to use job_url instead of posting_url / apply_url
-- Affects: get_bookmark_export_data, get_company_drawer_data, get_company_job_postings,
--          process_job_batch_internal, process_job_signals

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_bookmark_export_data — job_postings section: posting_url → job_url
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_bookmark_export_data(p_bookmark_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_id      UUID;
  v_result          JSONB;
  v_ucc_count       INT;
  v_filter_ids      UUID[];
  v_has_context     BOOLEAN;
BEGIN
  SELECT
    company_id,
    ARRAY(
      SELECT jsonb_array_elements_text(search_context->'filterSignalIds')::UUID
    )
  INTO v_company_id, v_filter_ids
  FROM bookmarks
  WHERE id = p_bookmark_id AND user_id = p_user_id;

  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_has_context := (array_length(v_filter_ids, 1) IS NOT NULL AND array_length(v_filter_ids, 1) > 0);

  SELECT COUNT(*) INTO v_ucc_count
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
      FROM companies c WHERE c.id = v_company_id
    ),
    'bookmark', (
      SELECT jsonb_build_object(
        'status', b.status,
        'priority', b.priority,
        'notes', b.notes,
        'search_context', b.search_context,
        'created_at', b.created_at
      )
      FROM bookmarks b WHERE b.id = p_bookmark_id
    ),
    'strategy', (
      SELECT jsonb_build_object(
        'recommended_pitch', ucs.recommended_pitch,
        'sender_context_override', ucs.sender_context_override
      )
      FROM user_company_strategies ucs
      WHERE ucs.bookmark_id = p_bookmark_id AND ucs.user_id = p_user_id
    ),
    'contacts_with_signals', CASE
      WHEN v_ucc_count > 0 THEN (
        WITH current_employees AS (
          SELECT
            ucc.first_name, ucc.last_name, ucc.role, ucc.email,
            ucc.linkedin_url, ucc.seniority, ucc.apollo_cache_id,
            (SELECT COUNT(*) FROM signals s WHERE s.contact_id = ucc.apollo_cache_id AND s.is_current_employee = true AND (NOT v_has_context OR s.signal_id = ANY(v_filter_ids))) AS signal_count,
            (SELECT jsonb_agg(jsonb_build_object('signal_type', s.signal_type, 'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched), 'snippet', LEFT(s.snippet, 200)))
             FROM signals s
             LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
             LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
             WHERE s.contact_id = ucc.apollo_cache_id AND s.is_current_employee = true AND (NOT v_has_context OR s.signal_id = ANY(v_filter_ids))) AS signals
          FROM user_company_contacts ucc
          WHERE ucc.company_id = v_company_id AND ucc.user_id = p_user_id
          ORDER BY (SELECT COUNT(*) FROM signals s WHERE s.contact_id = ucc.apollo_cache_id AND s.is_current_employee = true AND (NOT v_has_context OR s.signal_id = ANY(v_filter_ids))) DESC
          LIMIT 40
        ),
        total AS (SELECT COUNT(*) AS cnt FROM user_company_contacts WHERE company_id = v_company_id AND user_id = p_user_id)
        SELECT jsonb_build_object(
          'source', 'decision_makers', 'has_context_filter', v_has_context,
          'total_count', (SELECT cnt FROM total),
          'exported_count', (SELECT COUNT(*) FROM current_employees),
          'truncated', (SELECT cnt FROM total) > 40,
          'warning', CASE WHEN (SELECT cnt FROM total) > 40 THEN 'Se exportan solo los 40 primeros contactos.' ELSE NULL END,
          'data', COALESCE((SELECT jsonb_agg(jsonb_build_object('first_name', ce.first_name, 'last_name', ce.last_name, 'role', ce.role, 'email', ce.email, 'linkedin_url', ce.linkedin_url, 'seniority', ce.seniority, 'is_current_employee', true, 'signal_count', ce.signal_count, 'signals', ce.signals) ORDER BY ce.signal_count DESC) FROM current_employees ce), '[]'::jsonb)
        )
      )
      ELSE (
        WITH signal_contacts AS (
          SELECT con.id AS contact_id, con.first_name, con.last_name, con.current_position_title AS role, con.email1 AS email, con.linkedin_url,
            COUNT(s.id) AS signal_count,
            jsonb_agg(DISTINCT jsonb_build_object('signal_type', s.signal_type, 'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched), 'snippet', LEFT(s.snippet, 200))) AS signals
          FROM signals s
          JOIN contacts con ON con.id = s.contact_id
          LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
          LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
          WHERE s.company_id = v_company_id AND s.contact_id IS NOT NULL AND s.is_current_employee = true AND (NOT v_has_context OR s.signal_id = ANY(v_filter_ids))
          GROUP BY con.id, con.first_name, con.last_name, con.current_position_title, con.email1, con.linkedin_url
          ORDER BY COUNT(s.id) DESC LIMIT 40
        ),
        totals AS (SELECT COUNT(DISTINCT s.contact_id) AS total FROM signals s WHERE s.company_id = v_company_id AND s.contact_id IS NOT NULL AND s.is_current_employee = true AND (NOT v_has_context OR s.signal_id = ANY(v_filter_ids)))
        SELECT jsonb_build_object(
          'source', 'signals', 'has_context_filter', v_has_context,
          'total_count', (SELECT total FROM totals),
          'exported_count', (SELECT COUNT(*) FROM signal_contacts),
          'truncated', (SELECT total FROM totals) > 40,
          'warning', CASE WHEN (SELECT total FROM totals) > 40 THEN 'Se exportan los 40 contactos con más señales.' ELSE NULL END,
          'data', COALESCE((SELECT jsonb_agg(jsonb_build_object('first_name', sc.first_name, 'last_name', sc.last_name, 'role', sc.role, 'email', sc.email, 'linkedin_url', sc.linkedin_url, 'seniority', NULL, 'is_current_employee', true, 'signal_count', sc.signal_count, 'signals', sc.signals) ORDER BY sc.signal_count DESC) FROM signal_contacts sc), '[]'::jsonb)
        )
      )
    END,
    'job_postings', COALESCE((
      SELECT jsonb_agg(posting_row)
      FROM (
        SELECT jsonb_build_object(
          'title', jp.title,
          'job_url', jp.job_url,
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
      SELECT jsonb_agg(news_row) FROM (
        SELECT jsonb_build_object('title', cn.title, 'source_url', cn.source_url, 'published_at', cn.published_at, 'source_name', cn.source_name) as news_row
        FROM company_news cn WHERE cn.company_id = v_company_id ORDER BY cn.published_at DESC NULLS LAST LIMIT 10
      ) news_sub
    ), '[]'::jsonb),
    'implementations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('technology', ci.technology, 'provider_name', ci.provider_name, 'area', ci.area, 'source_url', ci.source_url))
      FROM company_implementations ci WHERE ci.company_id = v_company_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_company_drawer_data — apply_url → job_url
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_company_drawer_data(
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

  SELECT to_jsonb(c.*) INTO v_company FROM companies c WHERE c.id = p_company_id;

  IF p_filter_signal_ids IS NOT NULL AND array_length(p_filter_signal_ids, 1) > 0 AND p_filter_type IS NOT NULL THEN
    IF p_filter_type = 'process' THEN
      SELECT array_agg(name) INTO v_dictionary_names FROM dictionary_processes WHERE id = ANY(p_filter_signal_ids);
    ELSE
      SELECT array_agg(name) INTO v_dictionary_names FROM dictionary_products WHERE id = ANY(p_filter_signal_ids);
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(signal_data ORDER BY signal_data->>'contact_name'), '[]'::jsonb) INTO v_signals
  FROM (
    SELECT jsonb_build_object(
      'id', s.id, 'contact_id', s.contact_id, 'company_id', s.company_id,
      'signal_id', s.signal_id, 'signal_type', s.signal_type, 'keyword_matched', s.keyword_matched,
      'source_field', s.source_field, 'snippet', s.snippet, 'source_url', s.source_url,
      'is_current_employee', s.is_current_employee, 'created_at', s.created_at,
      'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
      'contact', jsonb_build_object(
        'id', ct.id, 'full_name', ct.full_name, 'headline', ct.headline,
        'linkedin_url', ct.linkedin_url, 'profile_picture_url', ct.profile_picture_url,
        'current_position_title', ct.current_position_title, 'current_company_id', ct.current_company_id,
        'email1', ct.email1, 'email1_type', ct.email1_type, 'email1_status', ct.email1_status,
        'email2', ct.email2, 'email2_type', ct.email2_type, 'email2_status', ct.email2_status,
        'phone1', ct.phone1, 'phone1_type', ct.phone1_type, 'phone2', ct.phone2,
        'phone2_type', ct.phone2_type, 'previous_positions', ct.previous_positions
      ),
      'contact_name', ct.full_name
    ) as signal_data
    FROM signals s
    LEFT JOIN contacts ct ON ct.id = s.contact_id
    LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
    LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
    WHERE s.company_id = p_company_id AND s.is_current_employee = TRUE
      AND (s.contact_id IS NOT NULL OR s.job_posted_at >= v_six_months_ago)
      AND (p_filter_signal_ids IS NULL OR array_length(p_filter_signal_ids, 1) = 0 OR s.signal_id = ANY(p_filter_signal_ids))
    LIMIT 200
  ) subq;

  SELECT COALESCE(jsonb_agg(contact_data ORDER BY contact_data->>'full_name'), '[]'::jsonb) INTO v_contacts
  FROM (
    SELECT jsonb_build_object(
      'id', ct.id, 'full_name', ct.full_name, 'headline', ct.headline,
      'linkedin_url', ct.linkedin_url, 'profile_picture_url', ct.profile_picture_url,
      'current_position_title', ct.current_position_title,
      'email1', ct.email1, 'email1_type', ct.email1_type, 'email1_status', ct.email1_status,
      'email2', ct.email2, 'email2_type', ct.email2_type, 'email2_status', ct.email2_status,
      'phone1', ct.phone1, 'phone1_type', ct.phone1_type, 'phone2', ct.phone2, 'phone2_type', ct.phone2_type,
      'signal_count', (SELECT COUNT(*)::int FROM signals s2 WHERE s2.contact_id = ct.id AND (p_filter_signal_ids IS NULL OR array_length(p_filter_signal_ids, 1) = 0 OR s2.signal_id = ANY(p_filter_signal_ids)))
    ) as contact_data
    FROM contacts ct
    WHERE ct.current_company_id = p_company_id
      AND (p_filter_signal_ids IS NULL OR array_length(p_filter_signal_ids, 1) = 0
        OR EXISTS (SELECT 1 FROM signals s3 WHERE s3.contact_id = ct.id AND s3.signal_id = ANY(p_filter_signal_ids)))
  ) subq
  WHERE (contact_data->>'signal_count')::int > 0 OR p_filter_signal_ids IS NULL OR array_length(p_filter_signal_ids, 1) = 0;

  -- job_postings: use job_url as the single URL source (COALESCE with source_url for signals that have it)
  SELECT COALESCE(jsonb_agg(jp_data ORDER BY jp_data->>'posted_at' DESC), '[]'::jsonb) INTO v_job_postings
  FROM (
    SELECT DISTINCT ON (jp.id) jsonb_build_object(
      'id', jp.id,
      'title', jp.title,
      'posted_at', jp.posted_at,
      'job_url', COALESCE(s.source_url, jp.job_url),
      'keyword_matched', s.keyword_matched,
      'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
      'snippet', s.snippet
    ) as jp_data
    FROM signals s
    JOIN job_postings jp ON jp.id = s.job_posting_id
    LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
    LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
    WHERE s.company_id = p_company_id AND s.job_posting_id IS NOT NULL AND jp.posted_at >= v_six_months_ago
      AND (p_filter_signal_ids IS NULL OR array_length(p_filter_signal_ids, 1) = 0 OR s.signal_id = ANY(p_filter_signal_ids))
  ) subq;

  SELECT COALESCE(jsonb_agg(alumni_signal_data ORDER BY alumni_signal_data->>'contact_name'), '[]'::jsonb) INTO v_alumni_signals
  FROM (
    SELECT DISTINCT ON (s.contact_id) jsonb_build_object(
      'id', s.id, 'contact_id', s.contact_id, 'company_id', s.company_id,
      'signal_id', s.signal_id, 'signal_type', s.signal_type, 'keyword_matched', s.keyword_matched,
      'source_field', s.source_field, 'snippet', s.snippet, 'source_url', s.source_url,
      'is_current_employee', s.is_current_employee, 'created_at', s.created_at,
      'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
      'contact', jsonb_build_object(
        'id', ct.id, 'full_name', ct.full_name, 'headline', ct.headline,
        'linkedin_url', ct.linkedin_url, 'profile_picture_url', ct.profile_picture_url,
        'current_position_title', ct.current_position_title, 'current_company_id', ct.current_company_id,
        'email1', ct.email1, 'email1_type', ct.email1_type, 'email1_status', ct.email1_status,
        'email2', ct.email2, 'email2_type', ct.email2_type, 'email2_status', ct.email2_status,
        'phone1', ct.phone1, 'phone1_type', ct.phone1_type, 'phone2', ct.phone2,
        'phone2_type', ct.phone2_type, 'previous_positions', ct.previous_positions
      ),
      'contact_name', ct.full_name
    ) as alumni_signal_data
    FROM signals s
    JOIN contacts ct ON ct.id = s.contact_id
    LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
    LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
    WHERE s.company_id = p_company_id AND s.is_current_employee = FALSE AND s.contact_id IS NOT NULL
      AND (p_filter_type IS NULL OR s.signal_type = p_filter_type)
      AND (p_filter_signal_ids IS NULL OR array_length(p_filter_signal_ids, 1) = 0 OR s.signal_id = ANY(p_filter_signal_ids))
    ORDER BY s.contact_id, s.created_at DESC
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_company_job_postings — apply_url → job_url
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_company_job_postings(
  p_company_id UUID,
  p_signal_ids UUID[] DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_location_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  location TEXT,
  posted_at TIMESTAMPTZ,
  job_url TEXT,
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
    COALESCE(s.source_url, jp.job_url) as job_url,
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
    SELECT s2.source_url as url
    FROM signals s2
    WHERE s2.job_posting_id = jp.id AND s2.source_url IS NOT NULL
    LIMIT 1
  ) max_source_url ON true
  WHERE s.company_id = p_company_id
    AND s.job_posting_id IS NOT NULL
    AND (p_signal_ids IS NULL OR s.signal_id = ANY(p_signal_ids))
    AND jp.posted_at >= NOW() - INTERVAL '6 months'
    AND (p_location_filter IS NULL OR jp.location ILIKE '%' || p_location_filter || '%')
  GROUP BY jp.id, jp.title, jp.location, jp.posted_at, jp.job_url, s.source_url
  ORDER BY jp.posted_at DESC
  LIMIT p_limit;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. process_job_batch_internal — posting_url → job_url en INSERT y ON CONFLICT
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION process_job_batch_internal(p_batch_id UUID, p_limit INT DEFAULT 50)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_row RECORD;
  v_processed_count INTEGER := 0;
  v_retry_count INTEGER := 0;
  v_max_retries INTEGER := 3;
  v_retry_delay INTEGER;
  v_company_id UUID;
  v_job_id UUID;
BEGIN
  FOR v_row IN
    SELECT * FROM public.import_rows
    WHERE batch_id = p_batch_id AND status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_retry_count := 0;

    <<retry_loop>>
    LOOP
      BEGIN
        v_company_id := public.upsert_company(
          COALESCE((v_row.row_data->>'company_name')::TEXT, (v_row.row_data->>'companyName')::TEXT, 'Unknown Company'),
          COALESCE((v_row.row_data->>'company_linkedin_url')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
          COALESCE((v_row.row_data->>'website')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
          (v_row.row_data->>'sector')::TEXT,
          COALESCE((v_row.row_data->>'country')::TEXT, (v_row.row_data->>'location')::TEXT),
          (v_row.row_data->>'logo_url')::TEXT,
          (v_row.row_data->>'company_description')::TEXT
        );

        -- job_url: unified single URL from any scraper field variant
        INSERT INTO public.job_postings (
          company_id, title, description, job_url, location,
          salary_range, posted_at, source_data
        ) VALUES (
          v_company_id,
          COALESCE((v_row.row_data->>'title')::TEXT, (v_row.row_data->>'job_title')::TEXT, 'Sin título'),
          COALESCE((v_row.row_data->>'description')::TEXT, (v_row.row_data->>'job_description')::TEXT, (v_row.row_data->>'html_job_description')::TEXT, ''),
          COALESCE(
            (v_row.row_data->>'job_url')::TEXT,
            (v_row.row_data->>'applyUrl')::TEXT,
            (v_row.row_data->>'apply_url')::TEXT,
            (v_row.row_data->>'apply_link')::TEXT,
            (v_row.row_data->>'jobUrl')::TEXT,
            (v_row.row_data->>'url')::TEXT,
            (v_row.row_data->>'uniq_id')::TEXT
          ),
          COALESCE((v_row.row_data->>'location')::TEXT, (v_row.row_data->>'city')::TEXT || ', ' || (v_row.row_data->>'country')::TEXT),
          COALESCE((v_row.row_data->>'salary')::TEXT, (v_row.row_data->>'salary_offered')::TEXT),
          COALESCE((v_row.row_data->>'postedTime')::TIMESTAMPTZ, (v_row.row_data->>'publishedAt')::TIMESTAMPTZ, (v_row.row_data->>'post_date')::TIMESTAMPTZ, now()),
          v_row.row_data
        )
        ON CONFLICT (job_url) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          updated_at = now()
        WHERE job_postings.job_url IS NOT NULL
        RETURNING id INTO v_job_id;

        PERFORM public.process_job_signals(v_job_id);

        UPDATE public.import_rows
        SET status = 'processed', processed_at = timezone('utc'::text, now())
        WHERE id = v_row.id;

        v_processed_count := v_processed_count + 1;
        EXIT retry_loop;

      EXCEPTION
        WHEN serialization_failure OR deadlock_detected THEN
          v_retry_count := v_retry_count + 1;
          IF v_retry_count >= v_max_retries THEN
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_error', 'Error processing job row',
              jsonb_build_object('row_id', v_row.id, 'error', SQLERRM, 'retries_exhausted', v_retry_count));
            UPDATE public.import_rows SET status = 'failed', error_message = 'Deadlock after ' || v_retry_count || ' retries: ' || SQLERRM WHERE id = v_row.id;
            EXIT retry_loop;
          ELSE
            v_retry_delay := 10 * (5 ^ (v_retry_count - 1));
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_retry', 'Retrying job row after deadlock',
              jsonb_build_object('row_id', v_row.id, 'retry_count', v_retry_count, 'delay_ms', v_retry_delay));
            PERFORM pg_sleep(v_retry_delay::FLOAT / 1000.0);
            CONTINUE retry_loop;
          END IF;

        WHEN OTHERS THEN
          INSERT INTO public.debug_events (batch_id, event_type, message, details)
          VALUES (p_batch_id, 'row_error', 'Error processing job row',
            jsonb_build_object('row_id', v_row.id, 'error', SQLERRM));
          UPDATE public.import_rows SET status = 'failed', error_message = SQLERRM WHERE id = v_row.id;
          EXIT retry_loop;
      END;
    END LOOP;
  END LOOP;

  RETURN v_processed_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. process_job_signals — posting_url → job_url como source_url fallback
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION process_job_signals(job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_job RECORD;
  v_text_to_analyze TEXT;
  v_job_url TEXT;
  v_dict RECORD;
  v_matched_kw TEXT;
BEGIN
  SELECT * INTO v_job FROM public.job_postings WHERE id = job_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_text_to_analyze := COALESCE(v_job.title, '') || ' ' || COALESCE(v_job.description, '');

  -- Use job_url as the single URL source for signals
  v_job_url := COALESCE(
    v_job.source_data->>'applyUrl',
    v_job.source_data->>'apply_url',
    v_job.source_data->>'jobUrl',
    v_job.job_url
  );

  FOR v_dict IN SELECT dict_type, dict_id, pattern, keywords FROM public.dictionary_patterns_cache
  LOOP
    IF v_text_to_analyze ~* v_dict.pattern THEN
      SELECT kw INTO v_matched_kw
      FROM unnest(v_dict.keywords) kw
      WHERE v_text_to_analyze ~* ('\y' || public.escape_regex(kw) || '\y')
      LIMIT 1;

      IF v_matched_kw IS NOT NULL THEN
        INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet, source_url)
        VALUES (v_job.company_id, v_dict.dict_type, v_dict.dict_id, v_matched_kw, 'job_description', job_id, public.extract_snippet(v_text_to_analyze, v_matched_kw, 100), v_job_url)
        ON CONFLICT (job_posting_id, signal_type, signal_id) DO NOTHING;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- Verify: confirm no RPCs still reference old columns
SELECT proname FROM pg_proc
WHERE (prosrc ILIKE '%posting_url%' OR prosrc ILIKE '%apply_url%')
  AND proname IN ('get_bookmark_export_data','get_company_drawer_data','get_company_job_postings','process_job_batch_internal','process_job_signals');
