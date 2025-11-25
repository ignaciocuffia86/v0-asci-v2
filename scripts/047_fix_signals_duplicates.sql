-- Script 047: Fix duplicate job signals and apply constraints

-- 1. Remove duplicate signals for job postings
-- Keeps the one with the most recent created_at (or arbitrary one if same time)
DELETE FROM public.signals a USING (
  SELECT min(ctid) as ctid, job_posting_id, signal_type, signal_id
  FROM public.signals
  WHERE job_posting_id IS NOT NULL
  GROUP BY job_posting_id, signal_type, signal_id
  HAVING count(*) > 1
) b
WHERE a.job_posting_id = b.job_posting_id 
  AND a.signal_type = b.signal_type 
  AND a.signal_id = b.signal_id 
  AND a.ctid <> b.ctid;

-- 2. Now we can safely create the unique index
DROP INDEX IF EXISTS idx_signals_job_posting_unique;

CREATE UNIQUE INDEX idx_signals_job_posting_unique 
ON public.signals (job_posting_id, signal_type, signal_id) 
WHERE job_posting_id IS NOT NULL;

-- 3. Ensure the function is updated to handle conflicts properly
CREATE OR REPLACE FUNCTION public.process_job_signals(job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job RECORD;
  v_text_to_analyze TEXT;
  v_proof_url TEXT;
  v_inserted_count INTEGER;
BEGIN
  -- Fetch job posting
  SELECT * INTO v_job FROM public.job_postings WHERE id = job_id;
  
  IF NOT FOUND THEN 
    INSERT INTO public.debug_events (event_type, message, details)
    VALUES ('signal_detection', 'Job Posting Not Found', jsonb_build_object('job_id', job_id));
    RETURN; 
  END IF;

  v_text_to_analyze := COALESCE(v_job.title, '') || ' ' || COALESCE(v_job.description, '');
  v_proof_url := COALESCE(v_job.apply_url, v_job.posting_url);

  -- Log analysis attempt
  INSERT INTO public.debug_events (batch_id, event_type, message, details)
  VALUES (
    NULL, 
    'signal_detection_start', 
    'Analyzing Job Posting', 
    jsonb_build_object(
      'job_id', job_id, 
      'title_length', length(v_job.title),
      'desc_length', length(v_job.description),
      'text_preview', substring(v_text_to_analyze from 1 for 50)
    )
  );

  -- Check Processes
  WITH inserted AS (
    INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet, source_url)
    SELECT 
      v_job.company_id, 
      'process', 
      dp.id, 
      kw, 
      'job_description', 
      job_id,
      substring(v_text_to_analyze from greatest(0, position(kw in v_text_to_analyze) - 100) for 200 + length(kw)),
      v_proof_url
    FROM public.dictionary_processes dp,
         unnest(dp.keywords) kw
    WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
    ON CONFLICT (job_posting_id, signal_type, signal_id) WHERE job_posting_id IS NOT NULL DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO v_inserted_count FROM inserted;
  
  IF v_inserted_count > 0 THEN
      INSERT INTO public.debug_events (event_type, message, details)
      VALUES ('signal_detection_match', 'Found Process Signals', jsonb_build_object('count', v_inserted_count, 'job_id', job_id));
  END IF;

  -- Check Products
  WITH inserted AS (
    INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet, source_url)
    SELECT 
      v_job.company_id, 
      'technology', 
      dp.id, 
      kw, 
      'job_description', 
      job_id,
      substring(v_text_to_analyze from greatest(0, position(kw in v_text_to_analyze) - 100) for 200 + length(kw)),
      v_proof_url
    FROM public.dictionary_products dp,
         unnest(dp.keywords) kw
    WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
    ON CONFLICT (job_posting_id, signal_type, signal_id) WHERE job_posting_id IS NOT NULL DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO v_inserted_count FROM inserted;

  IF v_inserted_count > 0 THEN
      INSERT INTO public.debug_events (event_type, message, details)
      VALUES ('signal_detection_match', 'Found Tech Signals', jsonb_build_object('count', v_inserted_count, 'job_id', job_id));
  END IF;

END;
$$;
