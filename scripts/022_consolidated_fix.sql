-- Script 022: Consolidated Fix for Schema and Functions
-- This script ensures the database is in the correct state for ingestion,
-- fixing any missing columns, constraints, or outdated functions.

-- 1. Ensure Columns Exist
DO $$
BEGIN
    -- signals.snippet
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'signals' AND column_name = 'snippet') THEN
        ALTER TABLE public.signals ADD COLUMN snippet TEXT;
    END IF;

    -- signals.is_current_employee
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'signals' AND column_name = 'is_current_employee') THEN
        ALTER TABLE public.signals ADD COLUMN is_current_employee BOOLEAN DEFAULT TRUE;
    END IF;

    -- import_rows.processed_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_rows' AND column_name = 'processed_at') THEN
        ALTER TABLE public.import_rows ADD COLUMN processed_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- import_batches.failed_rows
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'import_batches' AND column_name = 'failed_rows') THEN
        ALTER TABLE public.import_batches ADD COLUMN failed_rows INTEGER DEFAULT 0;
    END IF;
END $$;

-- 2. Fix Signals Constraint (Idempotent)
-- First, clean up any duplicates that might violate the constraint
DELETE FROM public.signals a USING (
  SELECT min(ctid) as ctid, contact_id, company_id, signal_type, signal_id
  FROM public.signals 
  GROUP BY contact_id, company_id, signal_type, signal_id
  HAVING count(*) > 1
) b
WHERE a.contact_id = b.contact_id 
  AND a.company_id = b.company_id 
  AND a.signal_type = b.signal_type 
  AND a.signal_id = b.signal_id 
  AND a.ctid <> b.ctid;

-- Then, ensure the constraint exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_signal_per_contact_company_dict') THEN
        ALTER TABLE public.signals 
        ADD CONSTRAINT unique_signal_per_contact_company_dict 
        UNIQUE (contact_id, company_id, signal_type, signal_id);
    END IF;
END $$;

-- 3. Update Functions to Latest Logic

-- Function: Process Contact Signals (Optimized & Prioritized)
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
  -- Get contact data
  SELECT * INTO v_contact FROM public.contacts WHERE id = contact_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- ===================================================================
  -- CURRENT POSITION ANALYSIS (with prioritization)
  -- Priority order: current_position_title > headline > about
  -- ===================================================================
  IF v_contact.current_company_id IS NOT NULL THEN
    
    -- PROCESSES: Try current_position_title first, then headline, then about
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT DISTINCT ON (dp.id)
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
          substring(v_contact.current_position_title from greatest(1, position(kw in v_contact.current_position_title) - 100) for 200 + length(kw))
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 
          substring(v_contact.headline from greatest(1, position(kw in v_contact.headline) - 100) for 200 + length(kw))
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 
          substring(v_contact.about from greatest(1, position(kw in v_contact.about) - 100) for 200 + length(kw))
      END
    FROM public.dictionary_processes dp,
         unnest(dp.keywords) kw
    WHERE 
      COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y')
    ORDER BY dp.id, 
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 1
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 2
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 3
      END
    ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;

    -- PRODUCTS: Try current_position_title first, then headline, then about
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT DISTINCT ON (dp.id)
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
          substring(v_contact.current_position_title from greatest(1, position(kw in v_contact.current_position_title) - 100) for 200 + length(kw))
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 
          substring(v_contact.headline from greatest(1, position(kw in v_contact.headline) - 100) for 200 + length(kw))
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 
          substring(v_contact.about from greatest(1, position(kw in v_contact.about) - 100) for 200 + length(kw))
      END
    FROM public.dictionary_products dp,
         unnest(dp.keywords) kw
    WHERE 
      COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y')
    ORDER BY dp.id,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 1
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 2
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 3
      END
    ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;
  END IF;

  -- ===================================================================
  -- PREVIOUS POSITIONS ANALYSIS
  -- ===================================================================
  IF v_contact.previous_positions IS NOT NULL AND jsonb_array_length(v_contact.previous_positions) > 0 THEN
    FOR v_position IN SELECT * FROM jsonb_array_elements(v_contact.previous_positions) LOOP
      v_company_id := (v_position->>'company_id')::UUID;
      
      IF v_company_id IS NOT NULL THEN
        -- PROCESSES
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (dp.id)
          contact_id,
          v_company_id,
          'process',
          dp.id,
          kw,
          'previous_position',
          FALSE,
          substring(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '') 
                   from greatest(1, position(kw in COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) - 100) 
                   for 200 + length(kw))
        FROM public.dictionary_processes dp,
             unnest(dp.keywords) kw
        WHERE (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* ('\y' || kw || '\y')
        ORDER BY dp.id
        ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;

        -- PRODUCTS
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (dp.id)
          contact_id,
          v_company_id,
          'technology',
          dp.id,
          kw,
          'previous_position',
          FALSE,
          substring(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '') 
                   from greatest(1, position(kw in COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) - 100) 
                   for 200 + length(kw))
        FROM public.dictionary_products dp,
             unnest(dp.keywords) kw
        WHERE (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* ('\y' || kw || '\y')
        ORDER BY dp.id
        ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- Function: Process Import Batch (Ensuring latest version)
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
  v_failed_count INTEGER := 0;
  v_current_company_id UUID;
  v_contact_id UUID;
  v_prev_company_id UUID;
  v_prev_positions JSONB := '[]'::JSONB;
  v_position_obj JSONB;
  v_pending_count INTEGER;
BEGIN
  SET LOCAL row_security = off;
  
  INSERT INTO public.debug_events (batch_id, event_type, message, details)
  VALUES (p_batch_id, 'function_start', 'Starting process_import_batch', jsonb_build_object('limit', p_limit));
  
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
      
      -- Process previous positions
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
      
      PERFORM public.process_contact_signals(v_contact_id);
      
      UPDATE public.import_rows
      SET status = 'processed', processed_at = timezone('utc'::text, now())
      WHERE id = v_row.id;
      
      v_processed_count := v_processed_count + 1;
      
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.debug_events (batch_id, event_type, message, details)
      VALUES (p_batch_id, 'row_error', 'Error processing row', jsonb_build_object('row_id', v_row.id, 'error', SQLERRM));
      
      UPDATE public.import_rows
      SET status = 'failed', error_message = SQLERRM
      WHERE id = v_row.id;
      
      v_failed_count := v_failed_count + 1;
    END;
  END LOOP;
  
  UPDATE public.import_batches
  SET 
    processed_rows = COALESCE(processed_rows, 0) + v_processed_count,
    failed_rows = COALESCE(failed_rows, 0) + v_failed_count,
    status = CASE 
      WHEN (SELECT COUNT(*) FROM public.import_rows WHERE batch_id = p_batch_id AND status = 'pending') = 0 
      THEN 'completed'
      ELSE 'processing'
    END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_batch_id;
  
  RETURN v_processed_count;
END;
$$;
