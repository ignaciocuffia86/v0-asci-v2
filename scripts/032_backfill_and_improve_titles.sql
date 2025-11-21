-- Script 032: Backfill Missing Job Titles and Improve Import Logic
-- This script fills missing current_position_title with headline data
-- and updates the import function to do this automatically in the future.

-- 1. Backfill missing titles using headline
-- We only update if current_position_title is NULL or empty, and headline is present
UPDATE public.contacts
SET 
  current_position_title = headline,
  updated_at = timezone('utc'::text, now())
WHERE 
  (current_position_title IS NULL OR current_position_title = '') 
  AND headline IS NOT NULL 
  AND headline != '';

-- 2. Update process_import_batch to use headline as fallback
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
  v_current_position TEXT;
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

      -- Determine current position (fallback to headline if empty)
      v_current_position := (v_row.row_data->>'current_position')::TEXT;
      IF (v_current_position IS NULL OR v_current_position = '') AND (v_row.row_data->>'headline') IS NOT NULL THEN
        v_current_position := (v_row.row_data->>'headline')::TEXT;
      END IF;

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
        v_current_position, -- Use the computed position
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
