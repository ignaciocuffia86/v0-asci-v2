-- Script to refine signal detection and contact info storage
-- 1. Add specific columns for emails and phones to contacts table
-- 2. Update signal detection to include current_position_title
-- 3. Update ingestion logic to populate new columns

-- Step 1: Add specific columns for emails and phones
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS email1 TEXT,
ADD COLUMN IF NOT EXISTS email1_type TEXT,
ADD COLUMN IF NOT EXISTS email1_status TEXT,
ADD COLUMN IF NOT EXISTS email2 TEXT,
ADD COLUMN IF NOT EXISTS email2_type TEXT,
ADD COLUMN IF NOT EXISTS email2_status TEXT,
ADD COLUMN IF NOT EXISTS email3 TEXT,
ADD COLUMN IF NOT EXISTS email3_type TEXT,
ADD COLUMN IF NOT EXISTS email3_status TEXT,
ADD COLUMN IF NOT EXISTS email4 TEXT,
ADD COLUMN IF NOT EXISTS email4_type TEXT,
ADD COLUMN IF NOT EXISTS email4_status TEXT,
ADD COLUMN IF NOT EXISTS phone1 TEXT,
ADD COLUMN IF NOT EXISTS phone1_type TEXT,
ADD COLUMN IF NOT EXISTS phone1_status TEXT,
ADD COLUMN IF NOT EXISTS phone2 TEXT,
ADD COLUMN IF NOT EXISTS phone2_type TEXT,
ADD COLUMN IF NOT EXISTS phone2_status TEXT;

-- Step 2: Update signal detection function
-- Added DROP FUNCTION to avoid parameter name conflict error
DROP FUNCTION IF EXISTS public.process_contact_signals(UUID);

CREATE OR REPLACE FUNCTION public.process_contact_signals(p_contact_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact RECORD;
  v_process RECORD;
  v_vendor RECORD;
  v_keyword TEXT;
  v_text_to_analyze TEXT;
  v_signal_found BOOLEAN;
  v_signal_source TEXT;
  v_company_id UUID;
  v_is_current BOOLEAN;
  v_pos JSONB;
BEGIN
  -- Get contact data
  SELECT * INTO v_contact FROM public.contacts WHERE id = p_contact_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 1. Analyze CURRENT position (Headline + About + Current Title + Current Description)
  -- This assigns signals to the CURRENT company
  IF v_contact.current_company_id IS NOT NULL THEN
    v_text_to_analyze := COALESCE(v_contact.headline, '') || ' ' || 
                         COALESCE(v_contact.about, '') || ' ' || 
                         COALESCE(v_contact.current_position_title, '') || ' ' || 
                         COALESCE(v_contact.current_position_description, '');
    
    v_company_id := v_contact.current_company_id;
    v_is_current := TRUE;
    
    -- Check for Processes
    FOR v_process IN SELECT * FROM public.dictionary_processes LOOP
      FOREACH v_keyword IN ARRAY v_process.keywords LOOP
        IF v_text_to_analyze ILIKE '%' || v_keyword || '%' THEN
          -- Insert signal
          INSERT INTO public.signals (contact_id, company_id, signal_type, signal_value, source, is_current_employee)
          VALUES (p_contact_id, v_company_id, 'process', v_process.process_name, 'current_role', v_is_current)
          ON CONFLICT (contact_id, company_id, signal_type, signal_value) DO NOTHING;
        END IF;
      END LOOP;
    END LOOP;

    -- Check for Vendors/Products
    FOR v_vendor IN SELECT * FROM public.dictionary_vendors LOOP
      -- Check vendor name
      IF v_text_to_analyze ILIKE '%' || v_vendor.vendor_name || '%' THEN
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_value, source, is_current_employee)
        VALUES (p_contact_id, v_company_id, 'technology', v_vendor.vendor_name, 'current_role', v_is_current)
        ON CONFLICT (contact_id, company_id, signal_type, signal_value) DO NOTHING;
      END IF;
      
      -- Check products
      -- (Assuming a join with products table if needed, but for now checking vendor keywords if any)
    END LOOP;
  END IF;

  -- 2. Analyze PREVIOUS positions
  -- This assigns signals to the SPECIFIC PREVIOUS company
  IF v_contact.previous_positions IS NOT NULL AND jsonb_array_length(v_contact.previous_positions) > 0 THEN
    FOR v_pos IN SELECT * FROM jsonb_array_elements(v_contact.previous_positions) LOOP
      
      -- Only process if we have a valid company_id for this position
      IF (v_pos->>'company_id') IS NOT NULL THEN
        v_company_id := (v_pos->>'company_id')::UUID;
        v_text_to_analyze := COALESCE(v_pos->>'title', '') || ' ' || COALESCE(v_pos->>'description', '');
        v_is_current := FALSE;
        
        -- Check for Processes
        FOR v_process IN SELECT * FROM public.dictionary_processes LOOP
          FOREACH v_keyword IN ARRAY v_process.keywords LOOP
            IF v_text_to_analyze ILIKE '%' || v_keyword || '%' THEN
              INSERT INTO public.signals (contact_id, company_id, signal_type, signal_value, source, is_current_employee)
              VALUES (p_contact_id, v_company_id, 'process', v_process.process_name, 'previous_role', v_is_current)
              ON CONFLICT (contact_id, company_id, signal_type, signal_value) DO NOTHING;
            END IF;
          END LOOP;
        END LOOP;

        -- Check for Vendors
        FOR v_vendor IN SELECT * FROM public.dictionary_vendors LOOP
          IF v_text_to_analyze ILIKE '%' || v_vendor.vendor_name || '%' THEN
            INSERT INTO public.signals (contact_id, company_id, signal_type, signal_value, source, is_current_employee)
            VALUES (p_contact_id, v_company_id, 'technology', v_vendor.vendor_name, 'previous_role', v_is_current)
            ON CONFLICT (contact_id, company_id, signal_type, signal_value) DO NOTHING;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- Step 3: Update ingestion function to populate new columns
-- Added DROP FUNCTION to ensure clean replacement
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
  v_current_company_id UUID;
  v_contact_id UUID;
  v_prev_company_id UUID;
  v_prev_positions JSONB := '[]'::JSONB;
  v_position_obj JSONB;
  v_pending_count INTEGER;
BEGIN
  -- Disable RLS for this function
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
    END;
  END LOOP;
  
  -- Update batch status
  UPDATE public.import_batches
  SET 
    processed_rows = COALESCE(processed_rows, 0) + v_processed_count,
    status = CASE 
      WHEN (SELECT COUNT(*) FROM public.import_rows WHERE batch_id = p_batch_id AND status = 'pending') = 0 
      THEN 'completed'
      ELSE 'processing'
    END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_batch_id;
  
  INSERT INTO public.debug_events (batch_id, event_type, message, details)
  VALUES (p_batch_id, 'function_end', 'Completed process_import_batch', jsonb_build_object('processed', v_processed_count));
  
  RETURN v_processed_count;
END;
$$;
