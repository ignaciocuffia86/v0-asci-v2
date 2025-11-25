-- Fix ETL to properly use the pre-mapped posted_at field from row_data
-- This ensures future ingestions will use the correct date from publishedAt column

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
  v_posted_at TIMESTAMPTZ;
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
      v_company_id := public.upsert_company(
        COALESCE((v_row.row_data->>'company_name')::TEXT, (v_row.row_data->>'companyName')::TEXT, 'Unknown Company'),
        COALESCE((v_row.row_data->>'company_linkedin_url')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
        COALESCE((v_row.row_data->>'website')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
        (v_row.row_data->>'sector')::TEXT,
        COALESCE((v_row.row_data->>'country')::TEXT, (v_row.row_data->>'location')::TEXT),
        (v_row.row_data->>'logo_url')::TEXT
      );

      -- Parse posted_at with better handling of different date formats
      BEGIN
        v_posted_at := (v_row.row_data->>'posted_at')::TIMESTAMPTZ;
      EXCEPTION WHEN OTHERS THEN
        -- If direct casting fails, try parsing common formats
        BEGIN
          v_posted_at := to_timestamp((v_row.row_data->>'posted_at')::TEXT, 'YYYY-MM-DD HH24:MI:SS');
        EXCEPTION WHEN OTHERS THEN
          -- Last resort fallback to now()
          v_posted_at := now();
        END;
      END;

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
        v_posted_at, -- Use the parsed posted_at variable instead of inline COALESCE
        v_row.row_data
      )
      ON CONFLICT (posting_url) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        posted_at = EXCLUDED.posted_at, -- Also update posted_at on conflict
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
