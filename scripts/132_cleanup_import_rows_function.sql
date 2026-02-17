-- =====================================================
-- FASE 5: Auto-cleanup of processed import_rows
-- =====================================================
-- Deletes import_rows that are fully processed and older than 30 days.
-- Keeps failed rows for 90 days for debugging.
-- Only deletes from batches that are fully completed (no pending rows left).
-- Also cleans up debug_events older than 30 days.
-- =====================================================

CREATE OR REPLACE FUNCTION public.cleanup_old_import_data(
  p_processed_retention_days INT DEFAULT 30,
  p_failed_retention_days INT DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_deleted_processed INT := 0;
  v_deleted_failed INT := 0;
  v_deleted_debug INT := 0;
  v_deleted_batches INT := 0;
BEGIN
  -- 1. Delete PROCESSED import_rows older than retention period
  -- Only from batches that have zero pending rows (fully done)
  DELETE FROM public.import_rows ir
  WHERE ir.status = 'processed'
    AND ir.processed_at < NOW() - (p_processed_retention_days || ' days')::INTERVAL
    AND NOT EXISTS (
      SELECT 1 FROM public.import_rows ir2
      WHERE ir2.batch_id = ir.batch_id
        AND ir2.status = 'pending'
    );
  GET DIAGNOSTICS v_deleted_processed = ROW_COUNT;

  -- 2. Delete FAILED import_rows older than extended retention period
  DELETE FROM public.import_rows ir
  WHERE ir.status = 'failed'
    AND ir.processed_at < NOW() - (p_failed_retention_days || ' days')::INTERVAL
    AND NOT EXISTS (
      SELECT 1 FROM public.import_rows ir2
      WHERE ir2.batch_id = ir.batch_id
        AND ir2.status = 'pending'
    );
  GET DIAGNOSTICS v_deleted_failed = ROW_COUNT;

  -- 3. Delete import_batches that have no remaining import_rows
  DELETE FROM public.import_batches ib
  WHERE ib.status = 'completed'
    AND ib.created_at < NOW() - (p_processed_retention_days || ' days')::INTERVAL
    AND NOT EXISTS (
      SELECT 1 FROM public.import_rows ir WHERE ir.batch_id = ib.id
    );
  GET DIAGNOSTICS v_deleted_batches = ROW_COUNT;

  -- 4. Delete old debug_events
  DELETE FROM public.debug_events
  WHERE created_at < NOW() - (p_processed_retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_deleted_debug = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted_processed_rows', v_deleted_processed,
    'deleted_failed_rows', v_deleted_failed,
    'deleted_empty_batches', v_deleted_batches,
    'deleted_debug_events', v_deleted_debug
  );
END;
$function$;
