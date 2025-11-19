-- Update the background processing function to default to a smaller batch size
CREATE OR REPLACE FUNCTION public.process_pending_queue(p_limit INTEGER DEFAULT 10)
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
    v_processed_count := public.process_import_batch(v_batch_id, p_limit);

    RETURN v_processed_count;
END;
$$;

-- Update the cron job to use the smaller batch size (10)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Unschedule existing job
        PERFORM cron.unschedule('process_pending_imports');
        
        -- Schedule to run every minute with limit 10
        PERFORM cron.schedule(
            'process_pending_imports',
            '* * * * *', -- Every minute
            'SELECT public.process_pending_queue(10)'
        );
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not schedule cron job: %', SQLERRM;
END $$;
