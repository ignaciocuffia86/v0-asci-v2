-- Script 021: Diagnose Ingestion Issues
-- Run this to check the health of the schema and view recent errors

-- 1. Check if the unique constraint exists
SELECT 
    conname as constraint_name, 
    contype as constraint_type,
    pg_get_constraintdef(oid) as definition
FROM pg_constraint 
WHERE conrelid = 'public.signals'::regclass;

-- 2. Check the last 5 errors in debug_events
SELECT 
    created_at, 
    event_type, 
    message, 
    details 
FROM public.debug_events 
WHERE event_type IN ('row_error', 'function_error') 
ORDER BY created_at DESC 
LIMIT 5;

-- 3. Check failed rows count in recent batches
SELECT 
    id, 
    created_at, 
    total_rows, 
    processed_rows, 
    failed_rows, 
    status 
FROM public.import_batches 
ORDER BY created_at DESC 
LIMIT 3;
