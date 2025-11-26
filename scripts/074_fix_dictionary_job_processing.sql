-- Fix dictionary job processing to properly track contacts and job_postings progress
-- The issue is that job_postings always restart from offset 0

-- First, add columns to track progress separately
ALTER TABLE public.dictionary_jobs 
ADD COLUMN IF NOT EXISTS contacts_processed INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS contacts_total INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS job_postings_processed INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS job_postings_total INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS phase TEXT DEFAULT 'contacts'; -- 'contacts', 'job_postings', 'done'

-- Update existing stuck jobs to completed (they processed everything)
UPDATE public.dictionary_jobs 
SET status = 'completed', 
    completed_at = NOW(), 
    progress = 100
WHERE status = 'processing' 
  AND processed_records >= total_records 
  AND total_records > 0;

-- Recreate the main orchestrator function with proper phase tracking
CREATE OR REPLACE FUNCTION public.process_dictionary_job(
  p_job_id UUID,
  p_batch_size INTEGER DEFAULT 1000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job RECORD;
  v_result JSONB;
  v_contacts_result JSONB;
  v_jobs_result JSONB;
  v_total_signals INTEGER := 0;
  v_has_more BOOLEAN := false;
  v_total_records INTEGER;
  v_processed_records INTEGER;
BEGIN
  -- Get job details
  SELECT * INTO v_job FROM public.dictionary_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job not found');
  END IF;
  
  -- Update job status to processing
  IF v_job.status = 'pending' THEN
    UPDATE public.dictionary_jobs 
    SET status = 'processing', started_at = NOW()
    WHERE id = p_job_id;
    -- Refresh job data
    SELECT * INTO v_job FROM public.dictionary_jobs WHERE id = p_job_id;
  END IF;
  
  -- Handle different job types
  CASE v_job.job_type
    WHEN 'remove_keyword' THEN
      -- Immediate deletion
      v_result := public.process_remove_keyword(v_job.signal_id, v_job.keyword);
      
      UPDATE public.dictionary_jobs 
      SET status = 'completed', 
          completed_at = NOW(),
          progress = 100,
          processed_records = (v_result->>'deleted_count')::INTEGER,
          total_records = (v_result->>'deleted_count')::INTEGER,
          phase = 'done'
      WHERE id = p_job_id;
      
      RETURN v_result;
      
    WHEN 'add_keyword' THEN
      -- Phase 1: Process contacts
      IF v_job.phase = 'contacts' OR v_job.phase IS NULL THEN
        v_contacts_result := public.process_add_keyword_contacts(
          v_job.signal_id, v_job.signal_type, v_job.keyword, 
          p_batch_size, COALESCE(v_job.contacts_processed, 0)
        );
        
        v_total_signals := (v_contacts_result->>'signals_created')::INTEGER;
        
        -- Update contacts progress
        UPDATE public.dictionary_jobs 
        SET contacts_processed = COALESCE(contacts_processed, 0) + (v_contacts_result->>'processed')::INTEGER,
            contacts_total = (v_contacts_result->>'total_contacts')::INTEGER
        WHERE id = p_job_id;
        
        -- Check if contacts phase is complete
        IF NOT (v_contacts_result->>'has_more')::BOOLEAN THEN
          -- Move to job_postings phase
          UPDATE public.dictionary_jobs SET phase = 'job_postings' WHERE id = p_job_id;
          v_job.phase := 'job_postings';
        ELSE
          v_has_more := true;
        END IF;
      END IF;
      
      -- Phase 2: Process job postings
      IF v_job.phase = 'job_postings' AND NOT v_has_more THEN
        v_jobs_result := public.process_add_keyword_job_postings(
          v_job.signal_id, v_job.signal_type, v_job.keyword, 
          p_batch_size, COALESCE(v_job.job_postings_processed, 0)
        );
        
        v_total_signals := v_total_signals + (v_jobs_result->>'signals_created')::INTEGER;
        
        -- Update job_postings progress
        UPDATE public.dictionary_jobs 
        SET job_postings_processed = COALESCE(job_postings_processed, 0) + (v_jobs_result->>'processed')::INTEGER,
            job_postings_total = (v_jobs_result->>'total_jobs')::INTEGER
        WHERE id = p_job_id;
        
        v_has_more := (v_jobs_result->>'has_more')::BOOLEAN;
        
        IF NOT v_has_more THEN
          UPDATE public.dictionary_jobs SET phase = 'done' WHERE id = p_job_id;
        END IF;
      END IF;
      
      -- Refresh job data for final calculations
      SELECT * INTO v_job FROM public.dictionary_jobs WHERE id = p_job_id;
      
      -- Calculate totals
      v_total_records := COALESCE(v_job.contacts_total, 0) + COALESCE(v_job.job_postings_total, 0);
      v_processed_records := COALESCE(v_job.contacts_processed, 0) + COALESCE(v_job.job_postings_processed, 0);
      
      -- Update overall progress
      IF v_has_more THEN
        UPDATE public.dictionary_jobs 
        SET total_records = v_total_records,
            processed_records = v_processed_records,
            progress = CASE WHEN v_total_records > 0 
                       THEN LEAST(99, (v_processed_records * 100 / v_total_records))
                       ELSE 0 END
        WHERE id = p_job_id;
      ELSE
        UPDATE public.dictionary_jobs 
        SET status = 'completed', 
            completed_at = NOW(),
            progress = 100,
            total_records = v_total_records,
            processed_records = v_processed_records
        WHERE id = p_job_id;
      END IF;
      
      RETURN jsonb_build_object(
        'success', true,
        'phase', v_job.phase,
        'processed', v_processed_records,
        'total', v_total_records,
        'signals_created', v_total_signals,
        'has_more', v_has_more
      );
      
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'Unknown job type');
  END CASE;
END;
$$;

SELECT 'Dictionary job processing fixed' AS status;
