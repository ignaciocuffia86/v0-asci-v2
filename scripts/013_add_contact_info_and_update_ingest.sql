-- Add contact_info column to contacts table
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS contact_info JSONB DEFAULT '{}'::JSONB;

-- Update the ingestion function to handle contact info
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
  v_contact_info JSONB;
  v_emails JSONB := '[]'::JSONB;
  v_phones JSONB := '[]'::JSONB;
  i INTEGER;
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

      -- Build Contact Info (Emails)
      v_emails := '[]'::JSONB;
      FOR i IN 1..4 LOOP
        IF v_row.row_data ? ('email' || i) AND (v_row.row_data->>('email' || i)) IS NOT NULL AND (v_row.row_data->>('email' || i)) != '' THEN
           v_emails := v_emails || jsonb_build_object(
             'address', v_row.row_data->>('email' || i),
             'type', v_row.row_data->>('email' || i || '_type'),
             'status', v_row.row_data->>('email' || i || '_status')
           );
        END IF;
      END LOOP;

      -- Build Contact Info (Phones)
      v_phones := '[]'::JSONB;
      FOR i IN 1..2 LOOP
        IF v_row.row_data ? ('phone' || i) AND (v_row.row_data->>('phone' || i)) IS NOT NULL AND (v_row.row_data->>('phone' || i)) != '' THEN
           v_phones := v_phones || jsonb_build_object(
             'number', v_row.row_data->>('phone' || i),
             'type', v_row.row_data->>('phone' || i || '_type'),
             'status', v_row.row_data->>('phone' || i || '_status')
           );
        END IF;
      END LOOP;

      v_contact_info := jsonb_build_object(
        'emails', v_emails,
        'phones', v_phones
      );
      
      -- Upsert contact
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
        contact_info
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
        v_contact_info
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
        contact_info = EXCLUDED.contact_info,
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
