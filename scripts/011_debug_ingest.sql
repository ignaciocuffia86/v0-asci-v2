-- Drop existing function to recreate with updated logic
DROP FUNCTION IF EXISTS public.process_import_batch(UUID, INTEGER);

-- Create debug events table if not exists
CREATE TABLE IF NOT EXISTS public.debug_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID,
  event_type TEXT,
  message TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on debug_events
ALTER TABLE public.debug_events ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Allow read access to authenticated users" ON public.debug_events;

-- Create policy for debug_events
CREATE POLICY "Allow read access to authenticated users" 
ON public.debug_events FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "Allow insert for authenticated users" 
ON public.debug_events FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- Main ingestion function with debugging and alumni detection
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
        profile_picture_url
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
        (v_row.row_data->>'profile_picture_url')::TEXT
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
