-- Consolidated ETL Process Script
-- This script is the Single Source of Truth for the ingestion process.
-- It defines tables, RLS, and all necessary functions.

-- 1. TABLES
-- Import Batches
CREATE TABLE IF NOT EXISTS public.import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    filename TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
    total_rows INTEGER DEFAULT 0,
    processed_rows INTEGER DEFAULT 0,
    failed_rows INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Import Rows (Raw Data)
CREATE TABLE IF NOT EXISTS public.import_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID REFERENCES public.import_batches(id),
    row_data JSONB NOT NULL, -- Stores the raw CSV row as JSON
    status TEXT DEFAULT 'pending', -- pending, processed, failed
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Safely add processed_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_rows' AND column_name = 'processed_at') THEN
        ALTER TABLE public.import_rows ADD COLUMN processed_at TIMESTAMP WITH TIME ZONE;
    END IF;
    
    -- Safely add failed_rows to import_batches if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_batches' AND column_name = 'failed_rows') THEN
        ALTER TABLE public.import_batches ADD COLUMN failed_rows INTEGER DEFAULT 0;
    END IF;
END $$;

-- Debug Events
CREATE TABLE IF NOT EXISTS public.debug_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID,
  event_type TEXT,
  message TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add snippet column to signals if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'signals' AND column_name = 'snippet') THEN
        ALTER TABLE public.signals ADD COLUMN snippet TEXT;
    END IF;
END $$;

-- 2. RLS POLICIES
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debug_events ENABLE ROW LEVEL SECURITY;

-- Batches
DROP POLICY IF EXISTS "Users can view their own batches" ON public.import_batches;
CREATE POLICY "Users can view their own batches" ON public.import_batches
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own batches" ON public.import_batches;
CREATE POLICY "Users can insert their own batches" ON public.import_batches
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own batches" ON public.import_batches;
CREATE POLICY "Users can update their own batches" ON public.import_batches
    FOR UPDATE USING (auth.uid() = user_id);

-- Rows
DROP POLICY IF EXISTS "Users can view rows of their batches" ON public.import_rows;
CREATE POLICY "Users can view rows of their batches" ON public.import_rows
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.import_batches WHERE id = import_rows.batch_id AND user_id = auth.uid())
    );

DROP POLICY IF EXISTS "Users can insert rows to their batches" ON public.import_rows;
CREATE POLICY "Users can insert rows to their batches" ON public.import_rows
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.import_batches WHERE id = import_rows.batch_id AND user_id = auth.uid())
    );

-- Debug Events
DROP POLICY IF EXISTS "Allow read access to authenticated users" ON public.debug_events;
CREATE POLICY "Allow read access to authenticated users" 
ON public.debug_events FOR SELECT 
USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow insert for authenticated users" ON public.debug_events;
CREATE POLICY "Allow insert for authenticated users" 
ON public.debug_events FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');


-- 3. FUNCTIONS

-- Function: Upsert Company (Normalization)
CREATE OR REPLACE FUNCTION public.upsert_company(
  p_name TEXT,
  p_linkedin_url TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_industry TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_id UUID;
  v_normalized_name TEXT;
BEGIN
  -- Normalize name: trim, lowercase, remove common suffixes
  v_normalized_name := TRIM(p_name);
  
  -- Try to find existing company by LinkedIn URL (strongest match)
  IF p_linkedin_url IS NOT NULL AND p_linkedin_url != '' THEN
    SELECT id INTO v_company_id FROM public.companies WHERE linkedin_url = p_linkedin_url LIMIT 1;
  END IF;
  
  -- If not found, try by name (case insensitive)
  IF v_company_id IS NULL THEN
    SELECT id INTO v_company_id FROM public.companies 
    WHERE LOWER(name) = LOWER(v_normalized_name) 
    LIMIT 1;
  END IF;
  
  -- If found, update with new info if available (enrichment)
  IF v_company_id IS NOT NULL THEN
    UPDATE public.companies SET
      linkedin_url = COALESCE(linkedin_url, p_linkedin_url),
      website = COALESCE(website, p_website),
      industry = COALESCE(industry, p_industry),
      country = COALESCE(country, p_country),
      logo_url = COALESCE(logo_url, p_logo_url),
      updated_at = timezone('utc'::text, now())
    WHERE id = v_company_id;
  ELSE
    -- If not found, create new
    INSERT INTO public.companies (name, linkedin_url, website, industry, country, logo_url)
    VALUES (v_normalized_name, p_linkedin_url, p_website, p_industry, p_country, p_logo_url)
    RETURNING id INTO v_company_id;
  END IF;
  
  RETURN v_company_id;
END;
$$;

-- Function: Process Contact Signals (Optimized with Set-Based SQL and Snippets)
DROP FUNCTION IF EXISTS public.process_contact_signals(UUID);
CREATE OR REPLACE FUNCTION public.process_contact_signals(contact_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contact RECORD;
  v_text_to_analyze TEXT;
  v_position JSONB;
  v_company_id UUID;
BEGIN
  -- Get contact data
  SELECT * INTO v_contact FROM public.contacts WHERE id = contact_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- 1. Analyze Current Position (Headline, About, Current Title, Current Description)
  v_text_to_analyze := COALESCE(v_contact.headline, '') || ' ' || 
                       COALESCE(v_contact.about, '') || ' ' || 
                       COALESCE(v_contact.current_position_title, '') || ' ' ||
                       COALESCE(v_contact.current_position_description, '');
                       
  IF v_contact.current_company_id IS NOT NULL THEN
    -- Check Processes (Set-based)
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT 
      contact_id, 
      v_contact.current_company_id, 
      'process', 
      dp.id, 
      kw, 
      'current_position', 
      TRUE,
      substring(v_text_to_analyze from greatest(0, position(kw in v_text_to_analyze) - 100) for 200 + length(kw))
    FROM public.dictionary_processes dp,
         unnest(dp.keywords) kw
    WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
    ON CONFLICT DO NOTHING;

    -- Check Products (Set-based)
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT 
      contact_id, 
      v_contact.current_company_id, 
      'technology', 
      dp.id, 
      kw, 
      'current_position', 
      TRUE,
      substring(v_text_to_analyze from greatest(0, position(kw in v_text_to_analyze) - 100) for 200 + length(kw))
    FROM public.dictionary_products dp,
         unnest(dp.keywords) kw
    WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
    ON CONFLICT DO NOTHING;
  END IF;

  -- 2. Analyze Previous Positions
  IF v_contact.previous_positions IS NOT NULL AND jsonb_array_length(v_contact.previous_positions) > 0 THEN
    FOR v_position IN SELECT * FROM jsonb_array_elements(v_contact.previous_positions) LOOP
      v_company_id := (v_position->>'company_id')::UUID;
      
      IF v_company_id IS NOT NULL THEN
        v_text_to_analyze := COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '');
        
        -- Check Processes (Set-based)
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT 
          contact_id, 
          v_company_id, 
          'process', 
          dp.id, 
          kw, 
          'previous_position', 
          FALSE,
          substring(v_text_to_analyze from greatest(0, position(kw in v_text_to_analyze) - 100) for 200 + length(kw))
        FROM public.dictionary_processes dp,
             unnest(dp.keywords) kw
        WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
        ON CONFLICT DO NOTHING;

        -- Check Products (Set-based)
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT 
          contact_id, 
          v_company_id, 
          'technology', 
          dp.id, 
          kw, 
          'previous_position', 
          FALSE,
          substring(v_text_to_analyze from greatest(0, position(kw in v_text_to_analyze) - 100) for 200 + length(kw))
        FROM public.dictionary_products dp,
             unnest(dp.keywords) kw
        WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- Function: Process Import Batch (Main ETL Logic)
DROP FUNCTION IF EXISTS public.process_import_batch(UUID, INTEGER);
CREATE OR REPLACE FUNCTION public.process_import_batch(
  p_batch_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_processed_count INTEGER := 0;
  v_failed_count INTEGER := 0; -- Track failed rows in this batch
  v_current_company_id UUID;
  v_contact_id UUID;
  v_prev_company_id UUID;
  v_prev_positions JSONB := '[]'::JSONB;
  v_position_obj JSONB;
  v_pending_count INTEGER;
BEGIN
  -- Disable RLS for this function to ensure it can read/write all necessary data
  SET LOCAL row_security = off;
  
  -- Log function start
  INSERT INTO public.debug_events (batch_id, event_type, message, details)
  VALUES (p_batch_id, 'function_start', 'Starting process_import_batch', jsonb_build_object('limit', p_limit));
  
  -- Check pending rows
  SELECT COUNT(*) INTO v_pending_count
  FROM public.import_rows
  WHERE batch_id = p_batch_id AND status = 'pending';
  
  INSERT INTO public.debug_events (batch_id, event_type, message, details)
  VALUES (p_batch_id, 'pending_rows_check', 'Pending rows count', jsonb_build_object('count', v_pending_count));
  
  -- Process rows
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
          
          -- Create/get previous company
          v_prev_company_id := public.upsert_company(
            (v_row.row_data->>('previous_company_' || i))::TEXT,
            NULL, NULL, NULL, NULL, NULL
          );
          
          -- Build position object with company_id
          v_position_obj := jsonb_build_object(
            'company_id', v_prev_company_id,
            'company_name', v_row.row_data->>('previous_company_' || i),
            'title', v_row.row_data->>('previous_position_' || i),
            'description', v_row.row_data->>('previous_position_' || i || '_description')
          );
          
          v_prev_positions := v_prev_positions || v_position_obj;
        END IF;
      END LOOP;

      -- Upsert contact with new columns
      INSERT INTO public.contacts (
        linkedin_url,
        first_name,
        last_name,
        full_name,
        headline,
        about,
        current_company_id,
        current_position_title,
        current_position_description,
        previous_positions,
        country,
        profile_picture_url,
        email1, email1_type, email1_status,
        email2, email2_type, email2_status,
        email3, email3_type, email3_status,
        email4, email4_type, email4_status,
        phone1, phone1_type, phone1_status,
        phone2, phone2_type, phone2_status
      ) VALUES (
        COALESCE((v_row.row_data->>'linkedin_url')::TEXT, 'placeholder:' || gen_random_uuid()::TEXT),
        (v_row.row_data->>'first_name')::TEXT,
        (v_row.row_data->>'last_name')::TEXT,
        (v_row.row_data->>'full_name')::TEXT,
        (v_row.row_data->>'headline')::TEXT,
        (v_row.row_data->>'about')::TEXT,
        v_current_company_id,
        (v_row.row_data->>'current_position')::TEXT,
        (v_row.row_data->>'current_position_description')::TEXT,
        v_prev_positions,
        (v_row.row_data->>'country')::TEXT,
        (v_row.row_data->>'profile_picture_url')::TEXT,
        (v_row.row_data->>'email1')::TEXT, (v_row.row_data->>'email1_type')::TEXT, (v_row.row_data->>'email1_status')::TEXT,
        (v_row.row_data->>'email2')::TEXT, (v_row.row_data->>'email2_type')::TEXT, (v_row.row_data->>'email2_status')::TEXT,
        (v_row.row_data->>'email3')::TEXT, (v_row.row_data->>'email3_type')::TEXT, (v_row.row_data->>'email3_status')::TEXT,
        (v_row.row_data->>'email4')::TEXT, (v_row.row_data->>'email4_type')::TEXT, (v_row.row_data->>'email4_status')::TEXT,
        (v_row.row_data->>'phone1')::TEXT, (v_row.row_data->>'phone1_type')::TEXT, (v_row.row_data->>'phone1_status')::TEXT,
        (v_row.row_data->>'phone2')::TEXT, (v_row.row_data->>'phone2_type')::TEXT, (v_row.row_data->>'phone2_status')::TEXT
      )
      ON CONFLICT (linkedin_url) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        full_name = EXCLUDED.full_name,
        headline = EXCLUDED.headline,
        about = EXCLUDED.about,
        current_company_id = EXCLUDED.current_company_id,
        current_position_title = EXCLUDED.current_position_title,
        current_position_description = EXCLUDED.current_position_description,
        previous_positions = EXCLUDED.previous_positions,
        country = EXCLUDED.country,
        profile_picture_url = EXCLUDED.profile_picture_url,
        email1 = EXCLUDED.email1, email1_type = EXCLUDED.email1_type, email1_status = EXCLUDED.email1_status,
        email2 = EXCLUDED.email2, email2_type = EXCLUDED.email2_type, email2_status = EXCLUDED.email2_status,
        email3 = EXCLUDED.email3, email3_type = EXCLUDED.email3_type, email3_status = EXCLUDED.email3_status,
        email4 = EXCLUDED.email4, email4_type = EXCLUDED.email4_type, email4_status = EXCLUDED.email4_status,
        phone1 = EXCLUDED.phone1, phone1_type = EXCLUDED.phone1_type, phone1_status = EXCLUDED.phone1_status,
        phone2 = EXCLUDED.phone2, phone2_type = EXCLUDED.phone2_type, phone2_status = EXCLUDED.phone2_status,
        updated_at = timezone('utc'::text, now())
      RETURNING id INTO v_contact_id;
      
      -- Trigger signal detection for this contact
      PERFORM public.process_contact_signals(v_contact_id);
      
      -- Mark row as processed
      UPDATE public.import_rows
      SET status = 'processed', processed_at = timezone('utc'::text, now())
      WHERE id = v_row.id;
      
      v_processed_count := v_processed_count + 1;
      
    EXCEPTION WHEN OTHERS THEN
      -- Log error and mark row as failed
      INSERT INTO public.debug_events (batch_id, event_type, message, details)
      VALUES (p_batch_id, 'row_error', 'Error processing row', jsonb_build_object(
        'row_id', v_row.id,
        'error', SQLERRM
      ));
      
      UPDATE public.import_rows
      SET status = 'failed', error_message = SQLERRM
      WHERE id = v_row.id;
      
      v_failed_count := v_failed_count + 1; -- Increment failed count
    END;
  END LOOP;
  
  -- Update batch status
  UPDATE public.import_batches
  SET 
    processed_rows = COALESCE(processed_rows, 0) + v_processed_count,
    failed_rows = COALESCE(failed_rows, 0) + v_failed_count, -- Update failed_rows
    status = CASE 
      WHEN (SELECT COUNT(*) FROM public.import_rows WHERE batch_id = p_batch_id AND status = 'pending') = 0 
      THEN 'completed'
      ELSE 'processing'
    END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_batch_id;
  
  INSERT INTO public.debug_events (batch_id, event_type, message, details)
  VALUES (p_batch_id, 'function_end', 'Completed process_import_batch', jsonb_build_object('processed', v_processed_count, 'failed', v_failed_count));
  
  RETURN v_processed_count; -- Return processed count (successes only)
END;
$$;
