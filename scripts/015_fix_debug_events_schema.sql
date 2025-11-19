-- Script to fix debug_events table schema and ensure ingestion works
-- 1. Drop and recreate debug_events table with correct columns
-- 2. Re-apply RLS policies
-- 3. Re-define process_import_batch with latest logic

-- Step 1: Fix debug_events table
DROP TABLE IF EXISTS public.debug_events;

CREATE TABLE public.debug_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID,
  event_type TEXT,
  message TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Step 2: Re-apply RLS
ALTER TABLE public.debug_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to authenticated users" 
ON public.debug_events FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "Allow insert for authenticated users" 
ON public.debug_events FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- Step 3: Re-define process_import_batch (latest version from script 014)
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
