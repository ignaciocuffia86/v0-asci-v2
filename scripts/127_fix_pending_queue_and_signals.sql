-- Fix process_pending_queue to work with the new JSONB return type from process_import_batch
-- Also make it handle the JSONB response properly instead of expecting an INTEGER.

-- ============================================================
-- Step 1: Fix process_pending_queue to handle JSONB return 
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_pending_queue(p_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
DECLARE
    v_batch_id UUID;
    v_result JSONB;
    v_total_processed INTEGER := 0;
    v_max_attempts INTEGER := 3;
    v_attempt INTEGER := 0;
BEGIN
    -- Find the oldest batch that has pending rows
    SELECT b.id INTO v_batch_id
    FROM public.import_batches b
    WHERE b.status IN ('pending', 'processing')
    AND EXISTS (
        SELECT 1 FROM public.import_rows r 
        WHERE r.batch_id = b.id 
        AND r.status = 'pending'
        LIMIT 1
    )
    ORDER BY b.created_at ASC
    LIMIT 1;

    IF v_batch_id IS NULL THEN
        RETURN 0;
    END IF;

    -- Process chunks of this batch
    WHILE v_attempt < v_max_attempts LOOP
        v_attempt := v_attempt + 1;
        
        BEGIN
            -- process_import_batch now returns JSONB
            v_result := public.process_import_batch(v_batch_id, p_limit);
            
            v_total_processed := v_total_processed + COALESCE(
              (v_result->>'processed_this_call')::INTEGER,
              (v_result->>'total_processed')::INTEGER,
              0
            );
            
            -- If batch completed or no more pending, stop
            IF v_result->>'status' = 'completed' OR 
               COALESCE((v_result->>'pending_remaining')::INTEGER, 0) = 0 THEN
                EXIT;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            INSERT INTO public.debug_events (event_type, message, details)
            VALUES ('process_queue_error', 'Error in process_pending_queue', 
              jsonb_build_object('batch_id', v_batch_id, 'error', SQLERRM, 'attempt', v_attempt));
            EXIT;
        END;
    END LOOP;

    RETURN v_total_processed;
END;
$function$;

-- ============================================================
-- Step 2: Verify the fix
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE 'process_pending_queue updated to handle JSONB return from process_import_batch';
END$$;
