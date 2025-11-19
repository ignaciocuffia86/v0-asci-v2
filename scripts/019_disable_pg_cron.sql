-- Script to disable pg_cron job and rely solely on Vercel Cron
-- This prevents race conditions and double processing

DO $$
BEGIN
    -- Check if pg_cron extension exists
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Unschedule the job named 'process_pending_imports'
        PERFORM cron.unschedule('process_pending_imports');
        
        RAISE NOTICE 'Successfully unscheduled pg_cron job: process_pending_imports';
    ELSE
        RAISE NOTICE 'pg_cron extension not found, nothing to unschedule.';
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error while attempting to unschedule pg_cron: %', SQLERRM;
END $$;
