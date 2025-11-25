-- 1. Add apply_url to job_postings if not exists
ALTER TABLE public.job_postings ADD COLUMN IF NOT EXISTS apply_url TEXT;

-- 2. Helper function to normalize LinkedIn URLs for matching
-- Removes 'sv.', 'mx.', etc., ensures 'www.', and strips query params
CREATE OR REPLACE FUNCTION public.normalize_linkedin_url(url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF url IS NULL OR url = '' THEN RETURN NULL; END IF;
  -- Basic cleanup: lower case, remove query params
  url := lower(regexp_replace(url, '\?.*$', '', 'g'));
  -- Normalize domain: replace 'sv.linkedin.com', 'mx.linkedin.com' etc with 'www.linkedin.com'
  url := regexp_replace(url, 'https?://([a-z]{2,3}\.)?linkedin\.com/', 'https://www.linkedin.com/', 'g');
  -- Ensure protocol is https
  IF url NOT LIKE 'https://%' THEN
     url := replace(url, 'http://', 'https://');
  END IF;
  -- Remove trailing slash
  url := regexp_replace(url, '/$', '', 'g');
  RETURN url;
END;
$$;

-- 3. Update internal job batch processor to use improved matching and store apply_url
CREATE OR REPLACE FUNCTION public.process_job_batch_internal(p_batch_id UUID, p_limit INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_row RECORD;
  v_processed_count INTEGER := 0;
  v_failed_count INTEGER := 0;
  v_company_id UUID;
  v_job_id UUID;
  v_normalized_linkedin TEXT;
  v_normalized_alt_url TEXT;
  v_apply_url TEXT;
BEGIN
  FOR v_row IN 
    SELECT * FROM public.import_rows 
    WHERE batch_id = p_batch_id AND status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- Extract and normalize URLs for matching
      v_normalized_linkedin := public.normalize_linkedin_url(COALESCE((v_row.row_data->>'company_linkedin_url')::TEXT, (v_row.row_data->>'companyUrl')::TEXT));
      v_normalized_alt_url := public.normalize_linkedin_url((v_row.row_data->>'companyUrl')::TEXT);
      
      -- Extract apply_url
      v_apply_url := COALESCE((v_row.row_data->>'applyUrl')::TEXT, (v_row.row_data->>'apply_url')::TEXT);

      -- Upsert Company
      -- Improved Matching: 
      -- 1. Try to find by normalized LinkedIn URL
      -- 2. If not found, create new one using the best available URL
      
      -- Try to find existing company first to avoid creating duplicates with slightly different URLs
      SELECT id INTO v_company_id FROM public.companies 
      WHERE linkedin_url = v_normalized_linkedin 
         OR (linkedin_url IS NOT NULL AND public.normalize_linkedin_url(linkedin_url) = v_normalized_linkedin)
      LIMIT 1;

      IF v_company_id IS NULL THEN
        -- Fallback to secondary URL check
        SELECT id INTO v_company_id FROM public.companies 
        WHERE linkedin_url = v_normalized_alt_url 
           OR (linkedin_url IS NOT NULL AND public.normalize_linkedin_url(linkedin_url) = v_normalized_alt_url)
        LIMIT 1;
      END IF;

      IF v_company_id IS NULL THEN
        -- Create new company
        INSERT INTO public.companies (name, linkedin_url, website, industry, country, logo_url)
        VALUES (
            COALESCE((v_row.row_data->>'company_name')::TEXT, (v_row.row_data->>'companyName')::TEXT, 'Unknown Company'),
            COALESCE(v_normalized_linkedin, v_normalized_alt_url), -- Use normalized version
            COALESCE((v_row.row_data->>'website')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
            (v_row.row_data->>'sector')::TEXT,
            COALESCE((v_row.row_data->>'country')::TEXT, (v_row.row_data->>'location')::TEXT),
            (v_row.row_data->>'logo_url')::TEXT
        )
        RETURNING id INTO v_company_id;
      ELSE
          -- Update existing company info if missing? Optional, keeping it simple for now.
      END IF;

      -- Upsert Job Posting
      INSERT INTO public.job_postings (
        company_id,
        title,
        description,
        posting_url,
        apply_url, -- New column
        location,
        salary_range,
        posted_at,
        source_data
      ) VALUES (
        v_company_id,
        COALESCE((v_row.row_data->>'title')::TEXT, (v_row.row_data->>'job_title')::TEXT, 'Sin título'),
        COALESCE((v_row.row_data->>'description')::TEXT, (v_row.row_data->>'job_description')::TEXT, (v_row.row_data->>'html_job_description')::TEXT, ''),
        COALESCE((v_row.row_data->>'jobUrl')::TEXT, (v_row.row_data->>'url')::TEXT, (v_row.row_data->>'uniq_id')::TEXT),
        v_apply_url,
        COALESCE((v_row.row_data->>'location')::TEXT, (v_row.row_data->>'city')::TEXT || ', ' || (v_row.row_data->>'country')::TEXT),
        COALESCE((v_row.row_data->>'salary')::TEXT, (v_row.row_data->>'salary_offered')::TEXT),
        COALESCE((v_row.row_data->>'postedTime')::TIMESTAMPTZ, (v_row.row_data->>'publishedAt')::TIMESTAMPTZ, (v_row.row_data->>'post_date')::TIMESTAMPTZ, now()),
        v_row.row_data
      )
      ON CONFLICT (posting_url) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        apply_url = EXCLUDED.apply_url, -- Update apply_url on conflict
        updated_at = now()
      RETURNING id INTO v_job_id;

      -- Process Signals
      PERFORM public.process_job_signals(v_job_id);

      -- Update Row Status
      UPDATE public.import_rows
      SET status = 'processed', processed_at = timezone('utc'::text, now())
      WHERE id = v_row.id;
      
      v_processed_count := v_processed_count + 1;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.debug_events (batch_id, event_type, message, details)
      VALUES (p_batch_id, 'row_error', 'Error processing job row', jsonb_build_object('row_id', v_row.id, 'error', SQLERRM));
      
      UPDATE public.import_rows
      SET status = 'failed', error_message = SQLERRM
      WHERE id = v_row.id;
      
      v_failed_count := v_failed_count + 1;
    END;
  END LOOP;
  
  RETURN v_processed_count;
END;
$$;

-- 4. Update process_job_signals to prefer apply_url as source_url proof
CREATE OR REPLACE FUNCTION public.process_job_signals(job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job RECORD;
  v_text_to_analyze TEXT;
  v_proof_url TEXT;
BEGIN
  -- Fetch job posting including the posting_url and apply_url
  SELECT * INTO v_job FROM public.job_postings WHERE id = job_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_text_to_analyze := COALESCE(v_job.title, '') || ' ' || COALESCE(v_job.description, '');
  
  -- Use apply_url as primary proof, fallback to posting_url
  v_proof_url := COALESCE(v_job.apply_url, v_job.posting_url);

  -- Check Processes
  INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet, source_url)
  SELECT 
    v_job.company_id, 
    'process', 
    dp.id, 
    kw, 
    'job_description', 
    job_id,
    substring(v_text_to_analyze from greatest(0, position(kw in v_text_to_analyze) - 100) for 200 + length(kw)),
    v_proof_url  -- Use the preferred proof URL
  FROM public.dictionary_processes dp,
       unnest(dp.keywords) kw
  WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
  ON CONFLICT DO NOTHING;

  -- Check Products
  INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet, source_url)
  SELECT 
    v_job.company_id, 
    'technology', 
    dp.id, 
    kw, 
    'job_description', 
    job_id,
    substring(v_text_to_analyze from greatest(0, position(kw in v_text_to_analyze) - 100) for 200 + length(kw)),
    v_proof_url  -- Use the preferred proof URL
  FROM public.dictionary_products dp,
       unnest(dp.keywords) kw
  WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
  ON CONFLICT DO NOTHING;
END;
$$;
