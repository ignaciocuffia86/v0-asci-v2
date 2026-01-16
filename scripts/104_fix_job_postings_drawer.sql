-- Fix job_postings in drawer to match search criteria
-- Problems:
-- 1. No 6-month filter (search uses posted_at >= NOW() - 6 months)
-- 2. Only JOIN dictionary_products, missing dictionary_processes for signal_name

CREATE OR REPLACE FUNCTION get_company_drawer_data(
  p_company_id UUID,
  p_filter_signal_ids UUID[] DEFAULT NULL,
  p_filter_type TEXT DEFAULT NULL -- 'technology' or 'process'
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
  
  -- 1. Get company details
  SELECT to_jsonb(c.*) INTO v_company
  FROM companies c
  WHERE c.id = p_company_id;
  
  -- 2. Get dictionary names if filtering
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
  
  -- 3. Get current employee signals with contact info and signal names (single query with JOIN)
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
    ) as signal_data
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
  
  -- 4. Get contacts with signal counts (single query)
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
    ) as contact_data
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
  WHERE (contact_data->>'signal_count')::int > 0 OR p_filter_signal_ids IS NULL OR array_length(p_filter_signal_ids, 1) = 0;
  
  -- 5. Get job postings with signals (FIXED: added 6-month filter + JOIN both dictionaries)
  SELECT COALESCE(jsonb_agg(jp_data ORDER BY jp_data->>'posted_at' DESC), '[]'::jsonb) INTO v_job_postings
  FROM (
    SELECT DISTINCT ON (jp.id) jsonb_build_object(
      'id', jp.id,
      'title', jp.title,
      'posted_at', jp.posted_at,
      'apply_url', COALESCE(s.source_url, jp.apply_url),
      'keyword_matched', s.keyword_matched,
      'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched),
      'snippet', s.snippet
    ) as jp_data
    FROM signals s
    JOIN job_postings jp ON jp.id = s.job_posting_id
    -- JOIN both dictionaries for signal_name
    LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
    LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
    WHERE s.company_id = p_company_id
    AND s.job_posting_id IS NOT NULL
    -- Add 6-month filter to match search criteria
    AND jp.posted_at >= v_six_months_ago
    AND (
      p_filter_signal_ids IS NULL 
      OR array_length(p_filter_signal_ids, 1) = 0 
      OR s.signal_id = ANY(p_filter_signal_ids)
    )
  ) subq;
  
  -- 6. Get alumni signals (FIXED in script 102: uses p_filter_type dynamically)
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
    ) as alumni_signal_data
    FROM contacts ct
    CROSS JOIN LATERAL jsonb_array_elements(ct.previous_positions) AS pp
    JOIN signals s ON s.contact_id = ct.id
    LEFT JOIN dictionary_products dp ON dp.id = s.signal_id AND s.signal_type = 'technology'
    LEFT JOIN dictionary_processes dpr ON dpr.id = s.signal_id AND s.signal_type = 'process'
    WHERE (pp->>'company_id')::uuid = p_company_id
    AND ct.current_company_id IS DISTINCT FROM p_company_id
    AND s.company_id = p_company_id
    -- Use p_filter_type dynamically instead of hardcoded 'technology'
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
  
  -- Build final result
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

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_company_drawer_data(UUID, UUID[], TEXT) TO authenticated, anon;
