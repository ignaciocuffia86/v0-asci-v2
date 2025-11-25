-- Script 050: Fix Snippet Extraction to properly capture keyword context
-- Problem: position() is case-sensitive and returns 0 when not found, causing snippets to show start of text instead of keyword context

-- Helper function to extract snippet around keyword with case-insensitive search
CREATE OR REPLACE FUNCTION public.extract_snippet(text_content TEXT, keyword TEXT, context_chars INTEGER DEFAULT 100)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  keyword_position INTEGER;
  snippet_start INTEGER;
  snippet_length INTEGER;
  result_snippet TEXT;
BEGIN
  -- Find case-insensitive position of keyword using regexp_instr
  keyword_position := regexp_instr(text_content, '\y' || keyword || '\y', 1, 1, 0, 'i');
  
  -- If keyword not found, return first 200 chars as fallback
  IF keyword_position = 0 OR keyword_position IS NULL THEN
    RETURN substring(text_content from 1 for 200);
  END IF;
  
  -- Calculate snippet boundaries (context_chars before and after keyword)
  snippet_start := GREATEST(1, keyword_position - context_chars);
  snippet_length := (context_chars * 2) + length(keyword);
  
  -- Extract snippet
  result_snippet := substring(text_content from snippet_start for snippet_length);
  
  -- Clean up: trim whitespace
  result_snippet := TRIM(result_snippet);
  
  RETURN result_snippet;
END;
$$;

-- Update process_contact_signals to use new snippet extraction
DROP FUNCTION IF EXISTS public.process_contact_signals(UUID);
CREATE OR REPLACE FUNCTION public.process_contact_signals(contact_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contact RECORD;
  v_position JSONB;
  v_company_id UUID;
BEGIN
  SELECT * INTO v_contact FROM public.contacts WHERE id = contact_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Using extract_snippet function for better context extraction
  IF v_contact.current_company_id IS NOT NULL THEN
    
    -- PROCESSES: Current position
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT DISTINCT ON (contact_id, v_contact.current_company_id, 'process', dp.id)
      contact_id,
      v_contact.current_company_id,
      'process',
      dp.id,
      kw,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 'current_position'
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 'headline'
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 'about'
      END,
      TRUE,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 
          public.extract_snippet(v_contact.current_position_title, kw, 100)
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 
          public.extract_snippet(v_contact.headline, kw, 100)
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 
          public.extract_snippet(v_contact.about, kw, 100)
      END
    FROM public.dictionary_processes dp,
         unnest(dp.keywords) kw
    WHERE 
      COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y')
    ORDER BY contact_id, v_contact.current_company_id, 'process', dp.id, 
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 1
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 2
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 3
      END
    ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;

    -- PRODUCTS: Current position
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT DISTINCT ON (contact_id, v_contact.current_company_id, 'technology', dp.id)
      contact_id,
      v_contact.current_company_id,
      'technology',
      dp.id,
      kw,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 'current_position'
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 'headline'
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 'about'
      END,
      TRUE,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 
          public.extract_snippet(v_contact.current_position_title, kw, 100)
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 
          public.extract_snippet(v_contact.headline, kw, 100)
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 
          public.extract_snippet(v_contact.about, kw, 100)
      END
    FROM public.dictionary_products dp,
         unnest(dp.keywords) kw
    WHERE 
      COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y')
    ORDER BY contact_id, v_contact.current_company_id, 'technology', dp.id,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 1
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 2
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 3
      END
    ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;
  END IF;

  -- PREVIOUS POSITIONS
  IF v_contact.previous_positions IS NOT NULL AND jsonb_array_length(v_contact.previous_positions) > 0 THEN
    FOR v_position IN SELECT * FROM jsonb_array_elements(v_contact.previous_positions) LOOP
      v_company_id := (v_position->>'company_id')::UUID;
      
      IF v_company_id IS NOT NULL THEN
        -- PROCESSES
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (contact_id, v_company_id, 'process', dp.id)
          contact_id,
          v_company_id,
          'process',
          dp.id,
          kw,
          'previous_position',
          FALSE,
          public.extract_snippet(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', ''), kw, 100)
        FROM public.dictionary_processes dp,
             unnest(dp.keywords) kw
        WHERE (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* ('\y' || kw || '\y')
        ORDER BY contact_id, v_company_id, 'process', dp.id
        ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;

        -- PRODUCTS
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (contact_id, v_company_id, 'technology', dp.id)
          contact_id,
          v_company_id,
          'technology',
          dp.id,
          kw,
          'previous_position',
          FALSE,
          public.extract_snippet(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', ''), kw, 100)
        FROM public.dictionary_products dp,
             unnest(dp.keywords) kw
        WHERE (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* ('\y' || kw || '\y')
        ORDER BY contact_id, v_company_id, 'technology', dp.id
        ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- Update process_job_signals to use new snippet extraction
DROP FUNCTION IF EXISTS public.process_job_signals(UUID);
CREATE OR REPLACE FUNCTION public.process_job_signals(job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job RECORD;
  v_text_to_analyze TEXT;
  v_apply_url TEXT;
BEGIN
  SELECT * INTO v_job FROM public.job_postings WHERE id = job_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_text_to_analyze := COALESCE(v_job.title, '') || ' ' || COALESCE(v_job.description, '');
  
  -- Extract apply_url from source_data for use as proof
  v_apply_url := COALESCE(
    v_job.source_data->>'applyUrl',
    v_job.source_data->>'apply_url',
    v_job.source_data->>'jobUrl',
    v_job.posting_url
  );

  -- Using extract_snippet function and adding source_url
  -- Check Processes
  INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet, source_url)
  SELECT 
    v_job.company_id, 
    'process', 
    dp.id, 
    kw, 
    'job_description', 
    job_id,
    public.extract_snippet(v_text_to_analyze, kw, 100),
    v_apply_url
  FROM public.dictionary_processes dp,
       unnest(dp.keywords) kw
  WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
  ON CONFLICT (job_posting_id, signal_type, signal_id) DO NOTHING;

  -- Check Products
  INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet, source_url)
  SELECT 
    v_job.company_id, 
    'technology', 
    dp.id, 
    kw, 
    'job_description', 
    job_id,
    public.extract_snippet(v_text_to_analyze, kw, 100),
    v_apply_url
  FROM public.dictionary_products dp,
       unnest(dp.keywords) kw
  WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
  ON CONFLICT (job_posting_id, signal_type, signal_id) DO NOTHING;
  
  -- Log signal processing for debugging
  INSERT INTO public.debug_events (event_type, message, details)
  VALUES ('job_signals_processed', 'Processed signals for job posting', jsonb_build_object(
    'job_id', job_id,
    'title', v_job.title,
    'signals_found', (SELECT COUNT(*) FROM public.signals WHERE job_posting_id = job_id)
  ));
END;
$$;
