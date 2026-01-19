-- Fix: Stop inserting debug_events when there's nothing to process
-- Problem: pg_cron job runs every minute and inserts "No pending signals to process"
-- even when there's nothing to do, generating ~1,440 rows per day

-- Step 1: Update the function to NOT log when there's nothing to process
CREATE OR REPLACE FUNCTION public.process_pending_signals_batch()
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
    v_signals_to_process uuid[];
    v_signal record;
    v_processed_count integer := 0;
    v_batch_size integer := 100;
BEGIN
    -- Get batch of pending signals
    SELECT array_agg(id) INTO v_signals_to_process
    FROM (
        SELECT id FROM public.signals 
        WHERE processed = false
        ORDER BY created_at ASC
        LIMIT v_batch_size
    ) sub;

    -- If no signals to process, just return 0 (NO LOGGING)
    IF v_signals_to_process IS NULL OR array_length(v_signals_to_process, 1) IS NULL THEN
        -- Removed: INSERT INTO debug_events - no need to log "nothing to do"
        RETURN 0;
    END IF;

    -- Process each signal
    FOR v_signal IN 
        SELECT * FROM public.signals 
        WHERE id = ANY(v_signals_to_process)
    LOOP
        -- Mark as processed
        UPDATE public.signals 
        SET processed = true 
        WHERE id = v_signal.id;
        
        v_processed_count := v_processed_count + 1;
    END LOOP;

    -- Only log when we actually processed something
    IF v_processed_count > 0 THEN
        INSERT INTO public.debug_events (event_type, message, details) 
        VALUES (
            'signals_batch_processed', 
            format('Processed %s signals', v_processed_count),
            jsonb_build_object('count', v_processed_count)
        );
    END IF;

    RETURN v_processed_count;
END;
$function$;

-- Step 2: Clean up the spam records (keep last 100 for reference)
DELETE FROM public.debug_events 
WHERE event_type = 'signals_processing' 
AND message = 'No pending signals to process'
AND id NOT IN (
    SELECT id FROM public.debug_events 
    WHERE event_type = 'signals_processing'
    ORDER BY created_at DESC 
    LIMIT 100
);

-- Step 3: Add a retention policy - delete events older than 30 days (optional, run periodically)
-- This is a one-time cleanup; consider adding a scheduled job for ongoing maintenance
DELETE FROM public.debug_events 
WHERE created_at < NOW() - INTERVAL '30 days';

-- Step 4: Verify the cleanup
SELECT event_type, COUNT(*) as count 
FROM debug_events 
GROUP BY event_type 
ORDER BY count DESC;
