-- ============================================================
-- 133: Optimize ETL Pipeline
-- Fixes: timeout on process_import_batch, pattern caching,
--        and adds p_max_iterations parameter for granular control
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- PHASE 2: Dictionary patterns cache table
-- Pre-compute regex patterns so process_contact_signals and
-- process_job_signals don't rebuild them on every call
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dictionary_patterns_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dict_type TEXT NOT NULL,         -- 'process' or 'technology'
  dict_id UUID NOT NULL,
  pattern TEXT NOT NULL,
  keywords TEXT[] NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(dict_type, dict_id)
);

-- Populate cache from current dictionary
INSERT INTO public.dictionary_patterns_cache (dict_type, dict_id, pattern, keywords)
SELECT 'process', dp.id, public.build_combined_pattern(dp.keywords), dp.keywords
FROM public.dictionary_processes dp
ON CONFLICT (dict_type, dict_id) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  keywords = EXCLUDED.keywords,
  updated_at = NOW();

INSERT INTO public.dictionary_patterns_cache (dict_type, dict_id, pattern, keywords)
SELECT 'technology', dp.id, public.build_combined_pattern(dp.keywords), dp.keywords
FROM public.dictionary_products dp
ON CONFLICT (dict_type, dict_id) DO UPDATE SET
  pattern = EXCLUDED.pattern,
  keywords = EXCLUDED.keywords,
  updated_at = NOW();

-- Function to refresh the entire cache (called after dictionary changes)
CREATE OR REPLACE FUNCTION public.refresh_dictionary_patterns_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Clear and rebuild
  DELETE FROM public.dictionary_patterns_cache;

  INSERT INTO public.dictionary_patterns_cache (dict_type, dict_id, pattern, keywords)
  SELECT 'process', dp.id, public.build_combined_pattern(dp.keywords), dp.keywords
  FROM public.dictionary_processes dp;

  INSERT INTO public.dictionary_patterns_cache (dict_type, dict_id, pattern, keywords)
  SELECT 'technology', dp.id, public.build_combined_pattern(dp.keywords), dp.keywords
  FROM public.dictionary_products dp;
END;
$$;

-- Triggers to auto-refresh cache when dictionary changes
CREATE OR REPLACE FUNCTION public.trigger_refresh_patterns_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_dictionary_patterns_cache();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_cache_processes ON public.dictionary_processes;
CREATE TRIGGER trg_refresh_cache_processes
  AFTER INSERT OR UPDATE OR DELETE ON public.dictionary_processes
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_refresh_patterns_cache();

DROP TRIGGER IF EXISTS trg_refresh_cache_products ON public.dictionary_products;
CREATE TRIGGER trg_refresh_cache_products
  AFTER INSERT OR UPDATE OR DELETE ON public.dictionary_products
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trigger_refresh_patterns_cache();


-- ─────────────────────────────────────────────────────────────
-- PHASE 2: Optimized process_contact_signals using cache
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_contact_signals(contact_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact RECORD;
  v_position JSONB;
  v_company_id UUID;
  v_dict RECORD;
  v_matched_kw TEXT;
  v_fields TEXT[];
  v_field_names TEXT[];
  v_field_text TEXT;
  i INT;
BEGIN
  SELECT * INTO v_contact FROM public.contacts WHERE id = contact_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_contact.current_company_id IS NOT NULL THEN
    v_fields := ARRAY[
      COALESCE(v_contact.current_position_title, ''),
      COALESCE(v_contact.headline, ''),
      COALESCE(v_contact.about, '')
    ];
    v_field_names := ARRAY['current_position', 'headline', 'about'];

    -- Use cached patterns instead of rebuilding per call
    FOR v_dict IN SELECT dict_type, dict_id, pattern, keywords FROM public.dictionary_patterns_cache
    LOOP
      FOR i IN 1..3 LOOP
        IF v_fields[i] != '' AND v_fields[i] ~* v_dict.pattern THEN
          SELECT kw INTO v_matched_kw
          FROM unnest(v_dict.keywords) kw
          WHERE v_fields[i] ~* ('\y' || public.escape_regex(kw) || '\y')
          LIMIT 1;

          IF v_matched_kw IS NOT NULL THEN
            INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
            VALUES (
              contact_id,
              v_contact.current_company_id,
              v_dict.dict_type,
              v_dict.dict_id,
              v_matched_kw,
              v_field_names[i],
              TRUE,
              public.extract_snippet(v_fields[i], v_matched_kw, 100)
            )
            ON CONFLICT DO NOTHING;
            EXIT; -- Only first matching field per dict entry
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  -- Process past positions
  IF v_contact.previous_positions IS NOT NULL THEN
    FOR v_position IN SELECT * FROM jsonb_array_elements(v_contact.previous_positions)
    LOOP
      v_company_id := (v_position->>'company_id')::UUID;
      
      IF v_company_id IS NOT NULL AND v_company_id != v_contact.current_company_id THEN
        v_field_text := COALESCE(v_position->>'title', '');

        IF v_field_text != '' THEN
          FOR v_dict IN SELECT dict_type, dict_id, pattern, keywords FROM public.dictionary_patterns_cache
          LOOP
            IF v_field_text ~* v_dict.pattern THEN
              SELECT kw INTO v_matched_kw
              FROM unnest(v_dict.keywords) kw
              WHERE v_field_text ~* ('\y' || public.escape_regex(kw) || '\y')
              LIMIT 1;

              IF v_matched_kw IS NOT NULL THEN
                INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
                VALUES (contact_id, v_company_id, v_dict.dict_type, v_dict.dict_id, v_matched_kw, 'past_position', FALSE, public.extract_snippet(v_field_text, v_matched_kw, 100))
                ON CONFLICT DO NOTHING;
              END IF;
            END IF;
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END IF;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- PHASE 2: Optimized process_job_signals using cache
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_job_signals(job_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
  v_text_to_analyze TEXT;
  v_apply_url TEXT;
  v_dict RECORD;
  v_matched_kw TEXT;
BEGIN
  SELECT * INTO v_job FROM public.job_postings WHERE id = job_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_text_to_analyze := COALESCE(v_job.title, '') || ' ' || COALESCE(v_job.description, '');
  
  v_apply_url := COALESCE(
    v_job.source_data->>'applyUrl',
    v_job.source_data->>'apply_url',
    v_job.source_data->>'jobUrl',
    v_job.posting_url
  );

  -- Use cached patterns
  FOR v_dict IN SELECT dict_type, dict_id, pattern, keywords FROM public.dictionary_patterns_cache
  LOOP
    IF v_text_to_analyze ~* v_dict.pattern THEN
      SELECT kw INTO v_matched_kw
      FROM unnest(v_dict.keywords) kw
      WHERE v_text_to_analyze ~* ('\y' || public.escape_regex(kw) || '\y')
      LIMIT 1;

      IF v_matched_kw IS NOT NULL THEN
        INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet, source_url)
        VALUES (v_job.company_id, v_dict.dict_type, v_dict.dict_id, v_matched_kw, 'job_description', job_id, public.extract_snippet(v_text_to_analyze, v_matched_kw, 100), v_apply_url)
        ON CONFLICT (job_posting_id, signal_type, signal_id) DO NOTHING;
      END IF;
    END IF;
  END LOOP;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- PHASE 1: Add p_max_iterations parameter to process_import_batch
-- Allows the cron to control iterations externally so each 
-- RPC call = small committed transaction
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_import_batch(
  p_batch_id UUID,
  p_chunk_size INTEGER DEFAULT 5,
  p_max_iterations INTEGER DEFAULT 10
)
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

  -- Process in chunks (use p_max_iterations instead of hardcoded 10)
  WHILE v_iteration < p_max_iterations LOOP
    v_iteration := v_iteration + 1;
    
    SELECT COUNT(*) INTO v_pending
    FROM public.import_rows
    WHERE batch_id = p_batch_id AND status = 'pending';
    
    IF v_pending = 0 THEN
      EXIT;
    END IF;

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
      
      IF v_processed < p_chunk_size THEN
        EXIT;
      END IF;
      
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


-- ─────────────────────────────────────────────────────────────
-- PHASE 3: Add consecutive_failures column to import_batches
-- Used by the cron to skip batches that keep failing
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.import_batches 
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT;


-- ─────────────────────────────────────────────────────────────
-- Index on dictionary_patterns_cache for fast lookups
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_patterns_cache_type ON public.dictionary_patterns_cache(dict_type);
