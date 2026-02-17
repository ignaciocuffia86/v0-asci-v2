-- =====================================================
-- FASE 3+4: Eliminate pg_cron duplicates + Reactivate pending batches
-- =====================================================

-- ===================
-- FASE 3: Remove pg_cron jobs that conflict with Vercel cron
-- The Vercel cron (/api/cron/process-queue) already handles everything.
-- pg_cron jobs cause deadlocks by running in parallel.
-- ===================

-- Unschedule pg_cron job #3: process_pending_queue(100)
SELECT cron.unschedule(3);

-- Unschedule pg_cron job #6: process_pending_signals_batch(20)
SELECT cron.unschedule(6);

-- ===================
-- FASE 4: Reactivate all batches with pending rows
-- Change "completed" batches that still have pending rows to "processing"
-- so the Vercel cron picks them up one by one.
-- ===================

-- Step 1: Reactivate batches that have pending import_rows
UPDATE import_batches
SET status = 'processing', updated_at = NOW()
WHERE id IN (
  SELECT DISTINCT ib.id
  FROM import_batches ib
  JOIN import_rows ir ON ir.batch_id = ib.id
  WHERE ib.status IN ('completed', 'pending')
    AND ir.status = 'pending'
);

-- Step 2: Reset the 5,143 failed rows caused by the "upsert_company does not exist" bug
-- (now fixed with script 125). These are retryable.
UPDATE import_rows
SET status = 'pending', error_message = NULL, processed_at = NULL
WHERE status = 'failed'
  AND error_message = 'function public.upsert_company(text, text, text, text, text, text, text) does not exist';

-- Step 3: Reset the 14 rows that failed from deadlocks (now have retry logic from script 123)
UPDATE import_rows
SET status = 'pending', error_message = NULL, processed_at = NULL
WHERE status = 'failed'
  AND error_message = 'deadlock detected';

-- Step 4: Sync the processed_rows/failed_rows counters on all batches
-- to match actual import_rows status counts
UPDATE import_batches ib
SET 
  processed_rows = sub.actual_processed,
  failed_rows = sub.actual_failed,
  updated_at = NOW()
FROM (
  SELECT 
    batch_id,
    COUNT(*) FILTER (WHERE status = 'processed') as actual_processed,
    COUNT(*) FILTER (WHERE status = 'failed') as actual_failed
  FROM import_rows
  GROUP BY batch_id
) sub
WHERE ib.id = sub.batch_id;
