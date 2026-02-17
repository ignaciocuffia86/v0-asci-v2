-- Fix: Process import batch RPC returns integer instead of structured result
-- 
-- Root cause: The RPC returns only an INTEGER, but the cron job expects a JSONB
-- object with status, total_processed, iterations, pending_remaining.
-- The frontend calls the RPC but doesn't process partial results properly.
--
-- Solution: Change the RPC to return JSONB with complete status information,
-- allowing both frontend and cron to handle partial processing correctly.

DROP FUNCTION IF EXISTS public.process_import_batch(UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.process_import_batch(p_batch_id UUID, p_chunk_size INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_type TEXT;
  v_batch_status TEXT;
  v_processed INTEGER := 0;
  v_pending INTEGER;
  v_total_processed INTEGER := 0;
  v_max_iterations INTEGER := 10;
  v_iteration INTEGER := 0;
  v_result JSONB;
BEGIN
  -- Validate batch exists
  SELECT batch_type, status INTO v_batch_type, v_batch_status
  FROM public.import_batches
  WHERE id = p_batch_id;
  
  IF v_batch_type IS NULL THEN
    INSERT INTO public.debug_events (batch_id, event_type, message) 
    VALUES (p_batch_id, 'error', 'Batch not found');
    RETURN jsonb_build_object(
      'status', 'error',
      'message', 'Batch not found',
      'total_processed', 0,
      'pending_remaining', 0,
      'iterations', 0
    );
  END IF;

  INSERT INTO public.debug_events (batch_id, event_type, message)
  VALUES (p_batch_id, 'batch_process_start', 'Starting batch processing in chunks');

  -- Process in chunks until complete
  WHILE v_iteration < v_max_iterations LOOP
    v_iteration := v_iteration + 1;
    
    -- Count current pending rows
    SELECT COUNT(*) INTO v_pending
    FROM public.import_rows
    WHERE batch_id = p_batch_id AND status = 'pending';
    
    IF v_pending = 0 THEN
      EXIT;
    END IF;

    -- Process based on batch type
    BEGIN
      IF v_batch_type = 'contacts' THEN
        v_processed := public.process_contact_batch_internal(p_batch_id, p_chunk_size);
      ELSIF v_batch_type = 'job_postings' THEN
        v_processed := public.process_job_batch_internal(p_batch_id, p_chunk_size);
      ELSE
        INSERT INTO public.debug_events (batch_id, event_type, message, details)
        VALUES (p_batch_id, 'error', 'Unknown batch type', json_build_object('batch_type', v_batch_type));
        EXIT;
      END IF;
      
      v_total_processed := v_total_processed + v_processed;
      
      -- If we processed fewer than chunk_size, we're done
      IF v_processed < p_chunk_size THEN
        EXIT;
      END IF;
      
      INSERT INTO public.debug_events (batch_id, event_type, message, details)
      VALUES (p_batch_id, 'chunk_processed', 'Processed chunk', 
        json_build_object('iteration', v_iteration, 'processed_in_chunk', v_processed, 'total_so_far', v_total_processed));
      
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.debug_events (batch_id, event_type, message, details)
      VALUES (p_batch_id, 'chunk_error', 'Error processing chunk', 
        json_build_object('error', SQLERRM, 'iteration', v_iteration));
      EXIT;
    END;
  END LOOP;

  -- Check if completed
  SELECT COUNT(*) INTO v_pending
  FROM public.import_rows
  WHERE batch_id = p_batch_id AND status = 'pending';
  
  -- Update batch status and counts
  UPDATE public.import_batches
  SET 
    processed_rows = (SELECT COUNT(*) FROM public.import_rows WHERE batch_id = p_batch_id AND status = 'processed'),
    failed_rows = (SELECT COUNT(*) FROM public.import_rows WHERE batch_id = p_batch_id AND status = 'failed'),
    status = CASE WHEN v_pending = 0 THEN 'completed' ELSE 'processing' END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_batch_id;
  
  IF v_pending = 0 THEN
    INSERT INTO public.debug_events (batch_id, event_type, message, details)
    VALUES (p_batch_id, 'batch_completed', 'Batch processing completed', 
      json_build_object('total_processed', v_total_processed, 'iterations', v_iteration));
    
    v_result := jsonb_build_object(
      'status', 'completed',
      'total_processed', v_total_processed,
      'pending_remaining', 0,
      'iterations', v_iteration
    );
  ELSE
    INSERT INTO public.debug_events (batch_id, event_type, message, details)
    VALUES (p_batch_id, 'batch_partial', 'Batch processing partial, needs retry', 
      json_build_object('processed_this_call', v_total_processed, 'pending_remaining', v_pending, 'iterations', v_iteration));
    
    v_result := jsonb_build_object(
      'status', 'partial',
      'processed_this_call', v_total_processed,
      'pending_remaining', v_pending,
      'iterations', v_iteration
    );
  END IF;

  RETURN v_result;
END;
$$;
