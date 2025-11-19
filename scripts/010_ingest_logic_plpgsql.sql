-- Function to process a batch of imported rows with a limit (Chunking)
-- Added SECURITY DEFINER to bypass RLS restrictions during processing
CREATE OR REPLACE FUNCTION public.process_import_batch(p_batch_id UUID, p_limit INTEGER DEFAULT 50)
RETURNS INTEGER 
SECURITY DEFINER -- This allows the function to bypass RLS policies
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_row_data JSONB;
  v_company_id UUID;
  v_contact_id UUID;
  v_prev_company_id UUID;
  v_prev_positions JSONB;
  v_linkedin_url TEXT;
  v_full_name TEXT;
  i INTEGER;
  v_prev_company_name TEXT;
  v_prev_pos_title TEXT;
  v_prev_pos_desc TEXT;
  v_prev_pos_start TEXT;
  v_prev_pos_end TEXT;
  v_processed_count INTEGER := 0;
BEGIN
  -- Disable RLS for this session to allow function to access all rows
  SET LOCAL row_security = off;
  
  -- Update batch status to processing if it's pending
  UPDATE public.import_batches 
  SET status = 'processing', updated_at = now() 
  WHERE id = p_batch_id AND status = 'pending';

  -- Iterate over pending rows in the batch with LIMIT
  FOR v_row IN 
    SELECT * FROM public.import_rows 
    WHERE batch_id = p_batch_id AND status = 'pending' 
    LIMIT p_limit
  LOOP
    v_row_data := v_row.row_data;
    
    BEGIN
      -- 1. Process Current Company
      v_company_id := public.upsert_company(
        (v_row_data->>'company_name')::TEXT,
        (v_row_data->>'company_linkedin_url')::TEXT,
        (v_row_data->>'company_website')::TEXT,
        (v_row_data->>'company_industry')::TEXT,
        (v_row_data->>'company_country')::TEXT,
        (v_row_data->>'company_logo_url')::TEXT
      );

      -- 2. Process Previous Companies and Build Previous Positions JSON
      v_prev_positions := '[]'::JSONB;
      
      FOR i IN 1..6 LOOP
        v_prev_company_name := v_row_data->>('previous_company_' || i);
        
        IF v_prev_company_name IS NOT NULL AND v_prev_company_name != '' THEN
          v_prev_company_id := public.upsert_company(v_prev_company_name);
          
          v_prev_pos_title := v_row_data->>('previous_position_' || i);
          v_prev_pos_desc := v_row_data->>('previous_position_' || i || '_description');
          v_prev_pos_start := v_row_data->>('previous_position_' || i || '_started_at');
          v_prev_pos_end := v_row_data->>('previous_position_' || i || '_ended_at');
          
          v_prev_positions := v_prev_positions || jsonb_build_object(
            'company_id', v_prev_company_id,
            'company_name', v_prev_company_name,
            'title', v_prev_pos_title,
            'description', v_prev_pos_desc,
            'started_at', v_prev_pos_start,
            'ended_at', v_prev_pos_end
          );
        END IF;
      END LOOP;

      -- 3. Process Contact
      v_linkedin_url := v_row_data->>'linkedin_url';
      v_full_name := v_row_data->>'full_name';
      
      IF v_linkedin_url IS NULL OR v_linkedin_url = '' THEN
        IF v_full_name IS NOT NULL AND v_full_name != '' THEN
           v_linkedin_url := 'placeholder:' || gen_random_uuid();
        ELSE
           RAISE EXCEPTION 'Missing linkedin_url and full_name';
        END IF;
      END IF;

      -- Upsert Contact (OVERWRITE logic)
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
        current_position_started,
        previous_positions,
        country,
        profile_picture_url,
        processed
      ) VALUES (
        v_linkedin_url,
        (v_row_data->>'first_name')::TEXT,
        (v_row_data->>'last_name')::TEXT,
        v_full_name,
        (v_row_data->>'headline')::TEXT,
        (v_row_data->>'about')::TEXT,
        v_company_id,
        (v_row_data->>'current_position')::TEXT,
        (v_row_data->>'current_position_description')::TEXT,
        (v_row_data->>'current_position_started_at')::TIMESTAMP,
        v_prev_positions,
        (v_row_data->>'country')::TEXT,
        (v_row_data->>'profile_picture_url')::TEXT,
        FALSE 
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
        current_position_started = EXCLUDED.current_position_started,
        previous_positions = EXCLUDED.previous_positions,
        country = EXCLUDED.country,
        profile_picture_url = EXCLUDED.profile_picture_url,
        processed = FALSE,
        updated_at = now()
      RETURNING id INTO v_contact_id;

      -- 4. Trigger Signal Detection
      PERFORM public.process_contact_signals(v_contact_id);

      -- Mark row as processed
      UPDATE public.import_rows 
      SET status = 'processed' 
      WHERE id = v_row.id;
      
      -- Increment processed count in batch
      UPDATE public.import_batches
      SET processed_rows = processed_rows + 1
      WHERE id = p_batch_id;
      
      v_processed_count := v_processed_count + 1;

    EXCEPTION WHEN OTHERS THEN
      UPDATE public.import_rows 
      SET status = 'failed', error_message = SQLERRM 
      WHERE id = v_row.id;
    END;
  END LOOP;

  -- Check if batch is fully completed
  IF NOT EXISTS (SELECT 1 FROM public.import_rows WHERE batch_id = p_batch_id AND status = 'pending') THEN
     UPDATE public.import_batches 
     SET status = 'completed', updated_at = now() 
     WHERE id = p_batch_id;
  END IF;

  RETURN v_processed_count;
END;
$$ LANGUAGE plpgsql;
