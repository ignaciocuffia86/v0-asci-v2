-- Add retry logic to job batch processing function
DROP FUNCTION IF EXISTS public.process_job_batch_internal(UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.process_job_batch_internal(p_batch_id UUID, p_limit INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_row RECORD;
  v_processed_count INTEGER := 0;
  v_retry_count INTEGER := 0;
  v_max_retries INTEGER := 3;
  v_retry_delay INTEGER;
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
    v_retry_count := 0;
    
    <<retry_loop>>
    LOOP
      BEGIN
        -- Upsert Company
        v_company_id := public.upsert_company(
          COALESCE((v_row.row_data->>'company_name')::TEXT, (v_row.row_data->>'companyName')::TEXT, 'Unknown Company'),
          COALESCE((v_row.row_data->>'company_linkedin_url')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
          COALESCE((v_row.row_data->>'website')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
          (v_row.row_data->>'sector')::TEXT,
          COALESCE((v_row.row_data->>'country')::TEXT, (v_row.row_data->>'location')::TEXT),
          (v_row.row_data->>'logo_url')::TEXT,
          (v_row.row_data->>'company_description')::TEXT
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
        
        -- Success - exit retry loop
        EXIT retry_loop;
        
      EXCEPTION 
        WHEN serialization_failure OR deadlock_detected THEN
          -- Handle deadlock with exponential backoff
          v_retry_count := v_retry_count + 1;
          
          IF v_retry_count >= v_max_retries THEN
            -- Max retries exceeded - mark as failed
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_error', 'Error processing job row', 
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
            VALUES (p_batch_id, 'row_retry', 'Retrying job row after deadlock', 
              jsonb_build_object('row_id', v_row.id, 'retry_count', v_retry_count, 'delay_ms', v_retry_delay));
            
            -- Sleep using pg_sleep
            PERFORM pg_sleep(v_retry_delay::FLOAT / 1000.0);
            
            -- Retry the loop
            CONTINUE retry_loop;
          END IF;
          
        WHEN OTHERS THEN
          -- Non-deadlock error - fail immediately
          INSERT INTO public.debug_events (batch_id, event_type, message, details)
          VALUES (p_batch_id, 'row_error', 'Error processing job row', 
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
