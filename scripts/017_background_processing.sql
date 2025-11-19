-- Enable pg_cron extension if available
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Function to process the next chunk of pending rows from any active batch
CREATE OR REPLACE FUNCTION public.process_pending_queue(p_limit INTEGER DEFAULT 50)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_batch_id UUID;
    v_processed_count INTEGER;
BEGIN
    -- Find the oldest batch that has pending rows
    SELECT batch_id INTO v_batch_id
    FROM public.import_rows
    WHERE status = 'pending'
    GROUP BY batch_id
    ORDER BY min(created_at) ASC
    LIMIT 1;

    -- If no pending batch found, return 0
    IF v_batch_id IS NULL THEN
        RETURN 0;
    END IF;

    -- Process a chunk of this batch
    -- We reuse the existing logic function
    v_processed_count := public.process_import_batch(v_batch_id, p_limit);

    RETURN v_processed_count;
END;
$$;

-- Schedule the job to run every minute
-- We wrap it in a DO block to avoid errors if pg_cron is not available or job already exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Unschedule if exists to avoid duplicates
        PERFORM cron.unschedule('process_pending_imports');
        
        -- Schedule to run every minute
        -- We process 50 rows per minute. 
        -- 10,000 rows would take 200 minutes (3 hours). 
        -- This is safe and "slow" as requested.
        PERFORM cron.schedule(
            'process_pending_imports',
            '* * * * *', -- Every minute
            'SELECT public.process_pending_queue(50)'
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not schedule cron job: %', SQLERRM;
END $$;
