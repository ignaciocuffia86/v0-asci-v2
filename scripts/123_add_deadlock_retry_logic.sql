-- Fix: Add retry logic for deadlock handling during batch processing
--
-- Root cause: Multiple parallel transactions trying to UPSERT the same companies
-- causes PostgreSQL deadlocks. When processing large batches with common companies
-- (e.g., multiple contacts from Rappi), the upsert_company() calls conflict.
--
-- Solution: Wrap contact batch processing with exponential backoff retry logic.
-- This allows deadlocks to resolve naturally when transactions retry with delays.

-- 1. Drop old function that doesn't have retry logic
DROP FUNCTION IF EXISTS public.process_contact_batch_internal(UUID, INTEGER);

-- 2. Create new version with retry logic and deadlock handling
CREATE OR REPLACE FUNCTION public.process_contact_batch_internal(p_batch_id UUID, p_limit INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_row RECORD;
  v_processed_count INTEGER := 0;
  v_retry_count INTEGER := 0;
  v_max_retries INTEGER := 3;
  v_retry_delay INTEGER;
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
    v_retry_count := 0;
    
    <<retry_loop>>
    LOOP
      BEGIN
        -- Process current company
        v_current_company_id := public.upsert_company(
          (v_row.row_data->>'company_name')::TEXT,
          (v_row.row_data->>'company_linkedin_url')::TEXT,
          (v_row.row_data->>'company_website')::TEXT,
          (v_row.row_data->>'company_industry')::TEXT,
          (v_row.row_data->>'company_country')::TEXT,
          (v_row.row_data->>'company_logo_url')::TEXT,
          (v_row.row_data->>'company_description')::TEXT
        );
        
        -- Process previous positions (1-6)
        v_prev_positions := '[]'::JSONB;
        FOR i IN 1..6 LOOP
          IF v_row.row_data ? ('previous_company_' || i) AND 
             (v_row.row_data->>('previous_company_' || i)) IS NOT NULL AND
             (v_row.row_data->>('previous_company_' || i)) != '' THEN
            
            v_prev_company_id := public.upsert_company(
              (v_row.row_data->>('previous_company_' || i))::TEXT,
              NULL, NULL, NULL, NULL, NULL, NULL
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
        
        -- Success - exit retry loop
        EXIT retry_loop;
        
      EXCEPTION 
        WHEN serialization_failure OR deadlock_detected THEN
          -- Handle deadlock with exponential backoff
          v_retry_count := v_retry_count + 1;
          
          IF v_retry_count >= v_max_retries THEN
            -- Max retries exceeded - mark as failed
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_error', 'Error processing contact row', 
              jsonb_build_object('row_id', v_row.id, 'error', SQLERRM, 'retries_exhausted', v_retry_count));
            
            UPDATE public.import_rows 
            SET status = 'failed', error_message = 'Deadlock after ' || v_retry_count || ' retries: ' || SQLERRM 
            WHERE id = v_row.id;
            
            -- Exit retry loop and move to next row
            EXIT retry_loop;
          ELSE
            -- Sleep with exponential backoff: 10ms, 50ms, 250ms
            v_retry_delay := 10 * (5 ^ (v_retry_count - 1));
            
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_retry', 'Retrying contact row after deadlock', 
              jsonb_build_object('row_id', v_row.id, 'retry_count', v_retry_count, 'delay_ms', v_retry_delay));
            
            -- Sleep using a helper (PostgreSQL doesn't have built-in sleep in PL/pgSQL)
            -- Use a dummy SELECT that takes time
            PERFORM pg_sleep(v_retry_delay::FLOAT / 1000.0);
            
            -- Retry the loop
            CONTINUE retry_loop;
          END IF;
          
        WHEN OTHERS THEN
          -- Non-deadlock error - fail immediately
          INSERT INTO public.debug_events (batch_id, event_type, message, details)
          VALUES (p_batch_id, 'row_error', 'Error processing contact row', 
            jsonb_build_object('row_id', v_row.id, 'error', SQLERRM));
          
          UPDATE public.import_rows 
          SET status = 'failed', error_message = SQLERRM 
          WHERE id = v_row.id;
          
          -- Exit retry loop and move to next row
          EXIT retry_loop;
      END;
    END LOOP; -- end retry_loop
  END LOOP;
  
  RETURN v_processed_count;
END;
$$;
