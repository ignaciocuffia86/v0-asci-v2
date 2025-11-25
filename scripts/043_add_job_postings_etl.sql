-- 1. Add batch_type to import_batches
ALTER TABLE public.import_batches ADD COLUMN IF NOT EXISTS batch_type TEXT DEFAULT 'contacts';

-- 2. Create job_postings table
CREATE TABLE IF NOT EXISTS public.job_postings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    posting_url TEXT UNIQUE,
    location TEXT,
    salary_range TEXT,
    posted_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    source_data JSONB, -- Store raw row data for reference
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Update signals table
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS job_posting_id UUID REFERENCES public.job_postings(id) ON DELETE CASCADE;

-- 4. Function: Process Job Signals
CREATE OR REPLACE FUNCTION public.process_job_signals(job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job RECORD;
  v_text_to_analyze TEXT;
BEGIN
  SELECT * INTO v_job FROM public.job_postings WHERE id = job_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_text_to_analyze := COALESCE(v_job.title, '') || ' ' || COALESCE(v_job.description, '');

  -- Check Processes
  INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet)
  SELECT 
    v_job.company_id, 
    'process', 
    dp.id, 
    kw, 
    'job_description', 
    job_id,
    substring(v_text_to_analyze from greatest(0, position(kw in v_text_to_analyze) - 100) for 200 + length(kw))
  FROM public.dictionary_processes dp,
       unnest(dp.keywords) kw
  WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
  ON CONFLICT DO NOTHING;

  -- Check Products
  INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet)
  SELECT 
    v_job.company_id, 
    'technology', 
    dp.id, 
    kw, 
    'job_description', 
    job_id,
    substring(v_text_to_analyze from greatest(0, position(kw in v_text_to_analyze) - 100) for 200 + length(kw))
  FROM public.dictionary_products dp,
       unnest(dp.keywords) kw
  WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
  ON CONFLICT DO NOTHING;
END;
$$;

-- 5. Extract Contact Processing Logic to Internal Function
CREATE OR REPLACE FUNCTION public.process_contact_batch_internal(p_batch_id UUID, p_limit INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_row RECORD;
  v_processed_count INTEGER := 0;
  v_failed_count INTEGER := 0;
  v_current_company_id UUID;
  v_contact_id UUID;
  v_prev_company_id UUID;
  v_prev_positions JSONB := '[]'::JSONB;
  v_position_obj JSONB;
BEGIN
  FOR v_row IN 
    SELECT * FROM public.import_rows 
    WHERE batch_id = p_batch_id AND status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- Process current company
      v_current_company_id := public.upsert_company(
        (v_row.row_data->>'company_name')::TEXT,
        (v_row.row_data->>'company_linkedin_url')::TEXT,
        (v_row.row_data->>'company_website')::TEXT,
        (v_row.row_data->>'company_industry')::TEXT,
        (v_row.row_data->>'company_country')::TEXT,
        (v_row.row_data->>'company_logo_url')::TEXT
      );
      
      -- Process previous positions (1-6)
      v_prev_positions := '[]'::JSONB;
      FOR i IN 1..6 LOOP
        IF v_row.row_data ? ('previous_company_' || i) AND 
           (v_row.row_data->>('previous_company_' || i)) IS NOT NULL AND
           (v_row.row_data->>('previous_company_' || i)) != '' THEN
          
          v_prev_company_id := public.upsert_company(
            (v_row.row_data->>('previous_company_' || i))::TEXT,
            NULL, NULL, NULL, NULL, NULL
          );
          
          v_position_obj := jsonb_build_object(
            'company_id', v_prev_company_id,
            'company_name', v_row.row_data->>('previous_company_' || i),
            'title', v_row.row_data->>('previous_position_' || i),
            'description', v_row.row_data->>('previous_position_' || i || '_description')
          );
          
          v_prev_positions := v_prev_positions || v_position_obj;
        END IF;
      END LOOP;

      -- Upsert contact
      INSERT INTO public.contacts (
        linkedin_url, first_name, last_name, full_name, headline, about,
        current_company_id, current_position_title, current_position_description,
        previous_positions, country, profile_picture_url,
        email1, email1_type, email1_status,
        email2, email2_type, email2_status,
        email3, email3_type, email3_status,
        email4, email4_type, email4_status,
        phone1, phone1_type, phone1_status,
        phone2, phone2_type, phone2_status
      ) VALUES (
        COALESCE((v_row.row_data->>'linkedin_url')::TEXT, 'placeholder:' || gen_random_uuid()::TEXT),
        (v_row.row_data->>'first_name')::TEXT, (v_row.row_data->>'last_name')::TEXT,
        (v_row.row_data->>'full_name')::TEXT, (v_row.row_data->>'headline')::TEXT,
        (v_row.row_data->>'about')::TEXT, v_current_company_id,
        (v_row.row_data->>'current_position')::TEXT, (v_row.row_data->>'current_position_description')::TEXT,
        v_prev_positions, (v_row.row_data->>'country')::TEXT, (v_row.row_data->>'profile_picture_url')::TEXT,
        (v_row.row_data->>'email1')::TEXT, (v_row.row_data->>'email1_type')::TEXT, (v_row.row_data->>'email1_status')::TEXT,
        (v_row.row_data->>'email2')::TEXT, (v_row.row_data->>'email2_type')::TEXT, (v_row.row_data->>'email2_status')::TEXT,
        (v_row.row_data->>'email3')::TEXT, (v_row.row_data->>'email3_type')::TEXT, (v_row.row_data->>'email3_status')::TEXT,
        (v_row.row_data->>'email4')::TEXT, (v_row.row_data->>'email4_type')::TEXT, (v_row.row_data->>'email4_status')::TEXT,
        (v_row.row_data->>'phone1')::TEXT, (v_row.row_data->>'phone1_type')::TEXT, (v_row.row_data->>'phone1_status')::TEXT,
        (v_row.row_data->>'phone2')::TEXT, (v_row.row_data->>'phone2_type')::TEXT, (v_row.row_data->>'phone2_status')::TEXT
      )
      ON CONFLICT (linkedin_url) DO UPDATE SET
        first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, full_name = EXCLUDED.full_name,
        headline = EXCLUDED.headline, about = EXCLUDED.about, current_company_id = EXCLUDED.current_company_id,
        current_position_title = EXCLUDED.current_position_title, current_position_description = EXCLUDED.current_position_description,
        previous_positions = EXCLUDED.previous_positions, country = EXCLUDED.country, profile_picture_url = EXCLUDED.profile_picture_url,
        updated_at = timezone('utc'::text, now())
      RETURNING id INTO v_contact_id;
      
      PERFORM public.process_contact_signals(v_contact_id);
      
      UPDATE public.import_rows SET status = 'processed', processed_at = timezone('utc'::text, now()) WHERE id = v_row.id;
      v_processed_count := v_processed_count + 1;
      
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.debug_events (batch_id, event_type, message, details)
      VALUES (p_batch_id, 'row_error', 'Error processing contact row', jsonb_build_object('row_id', v_row.id, 'error', SQLERRM));
      UPDATE public.import_rows SET status = 'failed', error_message = SQLERRM WHERE id = v_row.id;
      v_failed_count := v_failed_count + 1;
    END;
  END LOOP;
  RETURN v_processed_count;
END;
$$;

-- 6. Logic for Job Batch Import (Internal)
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
BEGIN
  FOR v_row IN 
    SELECT * FROM public.import_rows 
    WHERE batch_id = p_batch_id AND status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- Upsert Company
      -- Priority: company_linkedin_url -> companyUrl -> company_website
      v_company_id := public.upsert_company(
        COALESCE((v_row.row_data->>'company_name')::TEXT, (v_row.row_data->>'companyName')::TEXT, 'Unknown Company'),
        COALESCE((v_row.row_data->>'company_linkedin_url')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
        COALESCE((v_row.row_data->>'website')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
        (v_row.row_data->>'sector')::TEXT,
        COALESCE((v_row.row_data->>'country')::TEXT, (v_row.row_data->>'location')::TEXT),
        (v_row.row_data->>'logo_url')::TEXT
      );

      -- Upsert Job Posting
      INSERT INTO public.job_postings (
        company_id,
        title,
        description,
        posting_url,
        location,
        salary_range,
        posted_at,
        source_data
      ) VALUES (
        v_company_id,
        COALESCE((v_row.row_data->>'title')::TEXT, (v_row.row_data->>'job_title')::TEXT, 'Sin título'),
        COALESCE((v_row.row_data->>'description')::TEXT, (v_row.row_data->>'job_description')::TEXT, (v_row.row_data->>'html_job_description')::TEXT, ''),
        COALESCE((v_row.row_data->>'jobUrl')::TEXT, (v_row.row_data->>'url')::TEXT, (v_row.row_data->>'applyUrl')::TEXT, (v_row.row_data->>'uniq_id')::TEXT),
        COALESCE((v_row.row_data->>'location')::TEXT, (v_row.row_data->>'city')::TEXT || ', ' || (v_row.row_data->>'country')::TEXT),
        COALESCE((v_row.row_data->>'salary')::TEXT, (v_row.row_data->>'salary_offered')::TEXT),
        COALESCE((v_row.row_data->>'postedTime')::TIMESTAMPTZ, (v_row.row_data->>'publishedAt')::TIMESTAMPTZ, (v_row.row_data->>'post_date')::TIMESTAMPTZ, now()),
        v_row.row_data
      )
      ON CONFLICT (posting_url) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
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

-- 7. Main Dispatcher Function
CREATE OR REPLACE FUNCTION public.process_import_batch(p_batch_id UUID, p_limit INTEGER DEFAULT 50)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_type TEXT;
  v_processed INTEGER;
BEGIN
  SELECT batch_type INTO v_batch_type FROM public.import_batches WHERE id = p_batch_id;
  
  -- Log Start
  INSERT INTO public.debug_events (batch_id, event_type, message, details)
  VALUES (p_batch_id, 'function_start', 'Starting process_import_batch', jsonb_build_object('type', v_batch_type));

  IF v_batch_type = 'job_postings' THEN
     v_processed := public.process_job_batch_internal(p_batch_id, p_limit);
  ELSE
     v_processed := public.process_contact_batch_internal(p_batch_id, p_limit);
  END IF;
  
  -- Update Batch Status
  UPDATE public.import_batches
  SET 
    processed_rows = (SELECT COUNT(*) FROM public.import_rows WHERE batch_id = p_batch_id AND status = 'processed'),
    failed_rows = (SELECT COUNT(*) FROM public.import_rows WHERE batch_id = p_batch_id AND status = 'failed'),
    status = CASE 
      WHEN (SELECT COUNT(*) FROM public.import_rows WHERE batch_id = p_batch_id AND status = 'pending') = 0 
      THEN 'completed'
      ELSE 'processing'
    END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_batch_id;

  RETURN v_processed;
END;
$$;
