-- ============================================================================
-- 168 - Fix silent failure in the ingest ETL (jobpostings marked "completed"
--       with 0 processed rows)
-- ============================================================================
--
-- ROOT CAUSE
-- ----------
-- /api/ingest/upload created the import_batch with status='processing' BEFORE
-- inserting the import_rows (chunks of 2000, which is slow for jobpostings
-- because of the huge description/html columns).
--
-- The process-queue cron runs every minute, picks up batches in
-- ('pending','processing'), counts pending rows and treats "0 pending rows"
-- as "the batch is done":
--
--     if (!pendingBefore || pendingBefore === 0) -> status = 'completed'
--
-- If the cron happened to run inside that window, it saw 0 rows (they were
-- still being inserted), marked the batch 'completed', and never looked at it
-- again. The rows landed afterwards and stayed 'pending' forever.
-- This was introduced by commit 65a679a ("three-phase import batch
-- processing"), which turned "0 pending" into an authoritative terminal state.
--
-- THE FIX (3 layers of defense)
-- -----------------------------
-- 1. New 'uploading' status: the batch is invisible to the cron until every
--    row has been inserted. Removes the race at the source.
-- 2. total_rows guard: nothing may mark a batch 'completed' unless
--    processed + failed + skipped >= total_rows. Protects against regressions.
-- 3. Distributed lease lock: guarantees a single queue processor even when
--    several deployments hit the endpoint (we observed 2 concurrent versions).
--
-- Idempotent: safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Allow the new 'uploading' batch status and 'skipped' row status
-- ---------------------------------------------------------------------------
ALTER TABLE public.import_batches DROP CONSTRAINT IF EXISTS import_batches_status_check;
ALTER TABLE public.import_batches ADD CONSTRAINT import_batches_status_check
  CHECK (status = ANY (ARRAY['uploading','pending','processing','completed','failed']));

ALTER TABLE public.import_rows DROP CONSTRAINT IF EXISTS import_rows_status_check;
ALTER TABLE public.import_rows ADD CONSTRAINT import_rows_status_check
  CHECK (status = ANY (ARRAY['pending','processed','failed','skipped']));

-- Rows intentionally left unprocessed (historical reconciliation) are counted
-- here so progress math stays honest without inflating failed_rows.
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS skipped_rows INTEGER NOT NULL DEFAULT 0;

-- The cron filters on status; keep that lookup cheap.
CREATE INDEX IF NOT EXISTS idx_import_batches_status_created
  ON public.import_batches (status, created_at)
  WHERE status IN ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- 2. Distributed lease lock (works across sessions AND deployments)
-- ---------------------------------------------------------------------------
-- NOTE: pg_try_advisory_lock is session-scoped. Supabase/PostgREST uses a
-- connection pool, so each HTTP request gets a different session and a
-- session-level lock would be released between RPC calls. A lease row updated
-- atomically is the correct primitive here: a single conditional UPDATE takes
-- a row lock, so exactly one caller can win.
CREATE TABLE IF NOT EXISTS public.cron_locks (
  lock_name    TEXT PRIMARY KEY,
  holder       TEXT,
  locked_at    TIMESTAMPTZ,
  locked_until TIMESTAMPTZ
);

ALTER TABLE public.cron_locks ENABLE ROW LEVEL SECURITY;

INSERT INTO public.cron_locks (lock_name) VALUES ('process-queue')
ON CONFLICT (lock_name) DO NOTHING;

-- Acquire the lease. Returns TRUE only if it was free or expired.
CREATE OR REPLACE FUNCTION public.acquire_cron_lock(
  p_lock_name TEXT,
  p_holder    TEXT,
  p_ttl_secs  INTEGER DEFAULT 120
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_acquired BOOLEAN := FALSE;
BEGIN
  INSERT INTO public.cron_locks (lock_name) VALUES (p_lock_name)
  ON CONFLICT (lock_name) DO NOTHING;

  -- Atomic: only one concurrent caller can satisfy the WHERE clause.
  UPDATE public.cron_locks
  SET holder = p_holder,
      locked_at = now(),
      locked_until = now() + make_interval(secs => p_ttl_secs)
  WHERE lock_name = p_lock_name
    AND (locked_until IS NULL OR locked_until < now())
  RETURNING TRUE INTO v_acquired;

  RETURN COALESCE(v_acquired, FALSE);
END;
$$;

-- Extend the lease while still working (long batches).
CREATE OR REPLACE FUNCTION public.renew_cron_lock(
  p_lock_name TEXT,
  p_holder    TEXT,
  p_ttl_secs  INTEGER DEFAULT 120
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ok BOOLEAN := FALSE;
BEGIN
  UPDATE public.cron_locks
  SET locked_until = now() + make_interval(secs => p_ttl_secs)
  WHERE lock_name = p_lock_name
    AND holder = p_holder
  RETURNING TRUE INTO v_ok;

  RETURN COALESCE(v_ok, FALSE);
END;
$$;

-- Release only if we still own it (avoids releasing someone else's lease).
CREATE OR REPLACE FUNCTION public.release_cron_lock(
  p_lock_name TEXT,
  p_holder    TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ok BOOLEAN := FALSE;
BEGIN
  UPDATE public.cron_locks
  SET holder = NULL, locked_until = NULL
  WHERE lock_name = p_lock_name
    AND holder = p_holder
  RETURNING TRUE INTO v_ok;

  RETURN COALESCE(v_ok, FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.acquire_cron_lock(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_cron_lock(TEXT, TEXT, INTEGER)   TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cron_lock(TEXT, TEXT)          TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Atomically flip a batch from 'uploading' to 'pending'
-- ---------------------------------------------------------------------------
-- Called by the upload route only after every row has been inserted, so the
-- cron can never observe a partially loaded batch.
CREATE OR REPLACE FUNCTION public.finalize_batch_upload(
  p_batch_id UUID,
  p_total_rows INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actual_rows INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_actual_rows
  FROM public.import_rows
  WHERE batch_id = p_batch_id;

  -- Sanity check: the rows we think we inserted must actually be there.
  IF v_actual_rows <> p_total_rows THEN
    UPDATE public.import_batches
    SET status = 'failed',
        error_message = format(
          'Row count mismatch on upload: expected %s, found %s', p_total_rows, v_actual_rows),
        total_rows = v_actual_rows,
        updated_at = timezone('utc', now())
    WHERE id = p_batch_id;

    RETURN jsonb_build_object(
      'status', 'failed', 'expected', p_total_rows, 'found', v_actual_rows);
  END IF;

  UPDATE public.import_batches
  SET status = 'pending',
      total_rows = v_actual_rows,
      updated_at = timezone('utc', now())
  WHERE id = p_batch_id;

  INSERT INTO public.debug_events (batch_id, event_type, message, details)
  VALUES (p_batch_id, 'upload_finalized', 'All rows inserted, batch queued',
          jsonb_build_object('total_rows', v_actual_rows));

  RETURN jsonb_build_object('status', 'pending', 'total_rows', v_actual_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_batch_upload(UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Harden process_import_batch: refuse to touch 'uploading' batches and
--    never report 'completed' while rows are missing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_import_batch(
  p_batch_id UUID,
  p_chunk_size INTEGER DEFAULT 5,
  p_max_iterations INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_batch_type TEXT;
  v_batch_status TEXT;
  v_total_rows INTEGER;
  v_processed INTEGER := 0;
  v_pending INTEGER;
  v_done INTEGER;
  v_total_processed INTEGER := 0;
  v_iteration INTEGER := 0;
  v_is_complete BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT batch_type, status, total_rows
    INTO v_batch_type, v_batch_status, v_total_rows
  FROM public.import_batches
  WHERE id = p_batch_id;

  IF v_batch_type IS NULL THEN
    INSERT INTO public.debug_events (batch_id, event_type, message)
    VALUES (p_batch_id, 'error', 'Batch not found');
    RETURN jsonb_build_object(
      'status', 'error', 'message', 'Batch not found',
      'total_processed', 0, 'pending_remaining', 0, 'iterations', 0
    );
  END IF;

  -- GUARD 1: rows are still being inserted. Do nothing, do not judge progress.
  IF v_batch_status = 'uploading' THEN
    RETURN jsonb_build_object(
      'status', 'uploading', 'message', 'Batch is still being uploaded',
      'processed_this_call', 0, 'pending_remaining', -1, 'iterations', 0
    );
  END IF;

  WHILE v_iteration < p_max_iterations LOOP
    v_iteration := v_iteration + 1;

    SELECT COUNT(*) INTO v_pending
    FROM public.import_rows
    WHERE batch_id = p_batch_id AND status = 'pending';

    IF v_pending = 0 THEN EXIT; END IF;

    BEGIN
      IF v_batch_type = 'contacts' THEN
        v_processed := public.process_contact_batch_internal(p_batch_id, p_chunk_size);
      ELSIF v_batch_type = 'job_postings' THEN
        v_processed := public.process_job_batch_internal(p_batch_id, p_chunk_size);
      ELSE
        INSERT INTO public.debug_events (batch_id, event_type, message, details)
        VALUES (p_batch_id, 'error', 'Unknown batch type',
                json_build_object('batch_type', v_batch_type));
        EXIT;
      END IF;

      v_total_processed := v_total_processed + v_processed;

      IF v_processed < p_chunk_size THEN EXIT; END IF;

    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.debug_events (batch_id, event_type, message, details)
      VALUES (p_batch_id, 'chunk_error', 'Error processing chunk',
        json_build_object('error', SQLERRM, 'iteration', v_iteration));
      EXIT;
    END;
  END LOOP;

  SELECT COUNT(*) INTO v_pending
  FROM public.import_rows
  WHERE batch_id = p_batch_id AND status = 'pending';

  SELECT COUNT(*) INTO v_done
  FROM public.import_rows
  WHERE batch_id = p_batch_id AND status IN ('processed','failed','skipped');

  -- GUARD 2: 'completed' requires zero pending rows AND all expected rows
  -- accounted for. Prevents the "completed with 0 processed" silent failure.
  v_is_complete := (v_pending = 0)
                   AND (COALESCE(v_total_rows, 0) = 0 OR v_done >= v_total_rows);

  UPDATE public.import_batches
  SET
    processed_rows = (SELECT COUNT(*) FROM public.import_rows
                      WHERE batch_id = p_batch_id AND status = 'processed'),
    failed_rows    = (SELECT COUNT(*) FROM public.import_rows
                      WHERE batch_id = p_batch_id AND status = 'failed'),
    skipped_rows   = (SELECT COUNT(*) FROM public.import_rows
                      WHERE batch_id = p_batch_id AND status = 'skipped'),
    status = CASE WHEN v_is_complete THEN 'completed' ELSE 'processing' END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_batch_id;

  IF v_is_complete THEN
    INSERT INTO public.debug_events (batch_id, event_type, message, details)
    VALUES (p_batch_id, 'batch_completed', 'Batch processing completed',
      json_build_object('total_processed', v_total_processed, 'iterations', v_iteration));

    v_result := jsonb_build_object(
      'status', 'completed', 'total_processed', v_total_processed,
      'pending_remaining', 0, 'iterations', v_iteration
    );
  ELSE
    v_result := jsonb_build_object(
      'status', 'partial', 'processed_this_call', v_total_processed,
      'pending_remaining', v_pending, 'iterations', v_iteration
    );
  END IF;

  RETURN v_result;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Detect inconsistent batches (feeds the /admin/processing alert)
-- ---------------------------------------------------------------------------
-- NOTE: we compare against the rows that ACTUALLY exist, not total_rows.
-- Some historical batches (Nov 2025 - Feb 2026) had their import_rows purged
-- after processing, so total_rows > actual rows with nothing pending. Those are
-- not this bug and must not raise a permanent alert.
DROP VIEW IF EXISTS public.import_batches_inconsistent;
CREATE VIEW public.import_batches_inconsistent AS
SELECT
  b.id,
  b.filename,
  b.batch_type,
  b.status,
  b.total_rows,
  b.processed_rows,
  b.failed_rows,
  b.skipped_rows,
  COUNT(r.id) FILTER (WHERE r.status = 'pending') AS pending_rows,
  COUNT(r.id) AS actual_rows,
  b.created_at,
  b.updated_at
FROM public.import_batches b
LEFT JOIN public.import_rows r ON r.batch_id = b.id
GROUP BY b.id
HAVING
  -- The real bug signature: batch says "done" but rows are still queued.
  (b.status = 'completed' AND COUNT(r.id) FILTER (WHERE r.status = 'pending') > 0)
  -- Counters drifted from the rows that actually exist.
  OR (b.status = 'completed' AND COUNT(r.id) > 0
      AND (COALESCE(b.processed_rows,0) + COALESCE(b.failed_rows,0)
           + COALESCE(b.skipped_rows,0)) < COUNT(r.id))
  -- Upload never finalized (crashed mid-insert) and is now orphaned.
  OR (b.status = 'uploading' AND b.created_at < now() - interval '30 minutes');

GRANT SELECT ON public.import_batches_inconsistent TO authenticated, service_role;

-- Requeue a batch that was wrongly marked completed.
CREATE OR REPLACE FUNCTION public.requeue_import_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pending INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_pending
  FROM public.import_rows
  WHERE batch_id = p_batch_id AND status = 'pending';

  IF v_pending = 0 THEN
    RETURN jsonb_build_object('status', 'noop', 'reason', 'no pending rows');
  END IF;

  UPDATE public.import_batches
  SET status = 'pending',
      consecutive_failures = 0,
      last_error = NULL,
      updated_at = timezone('utc', now())
  WHERE id = p_batch_id;

  RETURN jsonb_build_object('status', 'pending', 'pending_rows', v_pending);
END;
$$;

GRANT EXECUTE ON FUNCTION public.requeue_import_batch(UUID) TO service_role, authenticated;

COMMIT;

-- ---------------------------------------------------------------------------
-- 6. Reconcile historical batches
-- ---------------------------------------------------------------------------
-- These were already processed through other means; per product decision they
-- stay 'completed'. We mark their leftover 'pending' rows as 'skipped' so the
-- new inconsistency alert does not flag them forever, and so the progress bar
-- reflects reality. Only touches batches that are ALREADY 'completed' - it can
-- never affect a batch that is actively processing.
BEGIN;

UPDATE public.import_rows r
SET status = 'skipped',
    error_message = 'Skipped: historical batch reconciled by migration 168'
WHERE r.status = 'pending'
  AND r.batch_id IN (
    SELECT b.id FROM public.import_batches b WHERE b.status = 'completed'
  );

UPDATE public.import_batches b
SET processed_rows = s.processed,
    failed_rows    = s.failed,
    skipped_rows   = s.skipped,
    updated_at     = timezone('utc', now())
FROM (
  SELECT batch_id,
         COUNT(*) FILTER (WHERE status = 'processed') AS processed,
         COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
         COUNT(*) FILTER (WHERE status = 'skipped')   AS skipped
  FROM public.import_rows
  GROUP BY batch_id
) s
WHERE b.id = s.batch_id
  AND b.status = 'completed';

COMMIT;
