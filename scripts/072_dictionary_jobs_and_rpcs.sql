-- Script 072: Dictionary Jobs System
-- Enables async processing for dictionary changes (add/remove keywords, new products/processes)

-- =====================================================
-- 1. CREATE DICTIONARY_JOBS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.dictionary_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL CHECK (job_type IN ('add_keyword', 'remove_keyword', 'add_product', 'add_process', 'update_product', 'update_process')),
  signal_id UUID NOT NULL,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('technology', 'process')),
  keyword TEXT, -- For add_keyword/remove_keyword
  keywords TEXT[], -- For add_product/add_process (multiple keywords)
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  progress INTEGER DEFAULT 0,
  total_records INTEGER DEFAULT 0,
  processed_records INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_by TEXT -- Optional: track who created the job
);

-- Index for quick lookup of pending jobs
CREATE INDEX IF NOT EXISTS idx_dictionary_jobs_status ON public.dictionary_jobs(status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_dictionary_jobs_created_at ON public.dictionary_jobs(created_at DESC);

-- =====================================================
-- 2. RPC: DELETE SIGNALS BY KEYWORD
-- =====================================================

CREATE OR REPLACE FUNCTION public.process_remove_keyword(
  p_signal_id UUID,
  p_keyword TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM public.signals 
  WHERE signal_id = p_signal_id 
    AND keyword_matched ILIKE p_keyword;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count
  );
END;
$$;

-- =====================================================
-- 3. RPC: ADD KEYWORD TO CONTACTS (batch processing)
-- =====================================================

CREATE OR REPLACE FUNCTION public.process_add_keyword_contacts(
  p_signal_id UUID,
  p_signal_type TEXT,
  p_keyword TEXT,
  p_batch_size INTEGER DEFAULT 1000,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contact RECORD;
  v_position JSONB;
  v_company_id UUID;
  v_processed INTEGER := 0;
  v_signals_created INTEGER := 0;
  v_total_contacts INTEGER;
  v_pattern TEXT;
BEGIN
  -- Build regex pattern with word boundaries
  v_pattern := '\y' || p_keyword || '\y';
  
  -- Get total count for progress tracking
  SELECT COUNT(*) INTO v_total_contacts FROM public.contacts;
  
  -- Process contacts in batch
  FOR v_contact IN 
    SELECT * FROM public.contacts
    ORDER BY id
    LIMIT p_batch_size OFFSET p_offset
  LOOP
    v_processed := v_processed + 1;
    
    -- Check current position
    IF v_contact.current_company_id IS NOT NULL THEN
      IF COALESCE(v_contact.current_position_title, '') ~* v_pattern OR
         COALESCE(v_contact.headline, '') ~* v_pattern OR
         COALESCE(v_contact.about, '') ~* v_pattern OR
         COALESCE(v_contact.current_position_description, '') ~* v_pattern THEN
        
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        VALUES (
          v_contact.id,
          v_contact.current_company_id,
          p_signal_type,
          p_signal_id,
          p_keyword,
          CASE 
            WHEN COALESCE(v_contact.current_position_title, '') ~* v_pattern THEN 'current_position'
            WHEN COALESCE(v_contact.headline, '') ~* v_pattern THEN 'headline'
            WHEN COALESCE(v_contact.about, '') ~* v_pattern THEN 'about'
            ELSE 'current_position_description'
          END,
          TRUE,
          public.extract_snippet(
            COALESCE(v_contact.current_position_title, '') || ' ' || 
            COALESCE(v_contact.headline, '') || ' ' || 
            COALESCE(v_contact.about, '') || ' ' ||
            COALESCE(v_contact.current_position_description, ''),
            p_keyword, 100
          )
        )
        ON CONFLICT DO NOTHING;
        
        IF FOUND THEN v_signals_created := v_signals_created + 1; END IF;
      END IF;
    END IF;
    
    -- Check previous positions
    IF v_contact.previous_positions IS NOT NULL AND jsonb_array_length(v_contact.previous_positions) > 0 THEN
      FOR v_position IN SELECT * FROM jsonb_array_elements(v_contact.previous_positions) LOOP
        v_company_id := (v_position->>'company_id')::UUID;
        
        IF v_company_id IS NOT NULL THEN
          IF (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* v_pattern THEN
            INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
            VALUES (
              v_contact.id,
              v_company_id,
              p_signal_type,
              p_signal_id,
              p_keyword,
              'previous_position',
              FALSE,
              public.extract_snippet(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', ''), p_keyword, 100)
            )
            ON CONFLICT DO NOTHING;
            
            IF FOUND THEN v_signals_created := v_signals_created + 1; END IF;
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'signals_created', v_signals_created,
    'total_contacts', v_total_contacts,
    'has_more', (p_offset + p_batch_size) < v_total_contacts
  );
END;
$$;

-- =====================================================
-- 4. RPC: ADD KEYWORD TO JOB POSTINGS (batch processing)
-- =====================================================

CREATE OR REPLACE FUNCTION public.process_add_keyword_job_postings(
  p_signal_id UUID,
  p_signal_type TEXT,
  p_keyword TEXT,
  p_batch_size INTEGER DEFAULT 1000,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job RECORD;
  v_processed INTEGER := 0;
  v_signals_created INTEGER := 0;
  v_total_jobs INTEGER;
  v_pattern TEXT;
  v_six_months_ago TIMESTAMPTZ;
BEGIN
  v_pattern := '\y' || p_keyword || '\y';
  v_six_months_ago := NOW() - INTERVAL '6 months';
  
  SELECT COUNT(*) INTO v_total_jobs 
  FROM public.job_postings 
  WHERE posted_at >= v_six_months_ago;
  
  FOR v_job IN 
    SELECT jp.*, c.id as company_id 
    FROM public.job_postings jp
    JOIN public.companies c ON jp.company_id = c.id
    WHERE jp.posted_at >= v_six_months_ago
    ORDER BY jp.id
    LIMIT p_batch_size OFFSET p_offset
  LOOP
    v_processed := v_processed + 1;
    
    IF (COALESCE(v_job.title, '') || ' ' || COALESCE(v_job.description, '')) ~* v_pattern THEN
      INSERT INTO public.signals (
        job_posting_id, company_id, signal_type, signal_id, keyword_matched, 
        source_field, job_posted_at, snippet
      )
      VALUES (
        v_job.id,
        v_job.company_id,
        p_signal_type,
        p_signal_id,
        p_keyword,
        CASE 
          WHEN COALESCE(v_job.title, '') ~* v_pattern THEN 'job_title'
          ELSE 'job_description'
        END,
        v_job.posted_at,
        public.extract_snippet(COALESCE(v_job.title, '') || ' ' || COALESCE(v_job.description, ''), p_keyword, 100)
      )
      ON CONFLICT DO NOTHING;
      
      IF FOUND THEN v_signals_created := v_signals_created + 1; END IF;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'signals_created', v_signals_created,
    'total_jobs', v_total_jobs,
    'has_more', (p_offset + p_batch_size) < v_total_jobs
  );
END;
$$;

-- =====================================================
-- 5. RPC: PROCESS DICTIONARY JOB (main orchestrator)
-- =====================================================

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
  v_total_processed INTEGER := 0;
  v_total_signals INTEGER := 0;
  v_has_more BOOLEAN := false;
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
          total_records = (v_result->>'deleted_count')::INTEGER
      WHERE id = p_job_id;
      
      RETURN v_result;
      
    WHEN 'add_keyword' THEN
      -- Process contacts
      v_contacts_result := public.process_add_keyword_contacts(
        v_job.signal_id, v_job.signal_type, v_job.keyword, 
        p_batch_size, v_job.processed_records
      );
      
      v_total_processed := v_job.processed_records + (v_contacts_result->>'processed')::INTEGER;
      v_total_signals := (v_contacts_result->>'signals_created')::INTEGER;
      
      -- If contacts done, process job postings
      IF NOT (v_contacts_result->>'has_more')::BOOLEAN THEN
        v_jobs_result := public.process_add_keyword_job_postings(
          v_job.signal_id, v_job.signal_type, v_job.keyword, 
          p_batch_size, 0
        );
        v_total_signals := v_total_signals + (v_jobs_result->>'signals_created')::INTEGER;
        v_has_more := (v_jobs_result->>'has_more')::BOOLEAN;
      ELSE
        v_has_more := true;
      END IF;
      
      -- Update progress
      IF v_job.total_records = 0 THEN
        UPDATE public.dictionary_jobs 
        SET total_records = (v_contacts_result->>'total_contacts')::INTEGER + 
                            COALESCE((v_jobs_result->>'total_jobs')::INTEGER, 0)
        WHERE id = p_job_id;
      END IF;
      
      IF v_has_more THEN
        UPDATE public.dictionary_jobs 
        SET processed_records = v_total_processed,
            progress = LEAST(99, (v_total_processed * 100 / NULLIF(total_records, 0)))
        WHERE id = p_job_id;
      ELSE
        UPDATE public.dictionary_jobs 
        SET status = 'completed', 
            completed_at = NOW(),
            progress = 100,
            processed_records = v_total_processed
        WHERE id = p_job_id;
      END IF;
      
      RETURN jsonb_build_object(
        'success', true,
        'processed', v_total_processed,
        'signals_created', v_total_signals,
        'has_more', v_has_more
      );
      
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'Unknown job type');
  END CASE;
END;
$$;

-- =====================================================
-- 6. RPC: GET PENDING DICTIONARY JOBS
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_pending_dictionary_jobs(p_limit INTEGER DEFAULT 10)
RETURNS SETOF public.dictionary_jobs
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT * FROM public.dictionary_jobs 
  WHERE status IN ('pending', 'processing')
  ORDER BY created_at ASC
  LIMIT p_limit;
$$;

-- =====================================================
-- 7. RPC: GET DICTIONARY JOBS STATUS (for admin UI)
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_dictionary_jobs_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pending INTEGER;
  v_processing INTEGER;
  v_recent JSONB;
BEGIN
  SELECT COUNT(*) INTO v_pending FROM public.dictionary_jobs WHERE status = 'pending';
  SELECT COUNT(*) INTO v_processing FROM public.dictionary_jobs WHERE status = 'processing';
  
  SELECT jsonb_agg(row_to_json(j))
  INTO v_recent
  FROM (
    SELECT id, job_type, signal_type, keyword, status, progress, 
           total_records, processed_records, created_at, completed_at, error_message
    FROM public.dictionary_jobs
    ORDER BY created_at DESC
    LIMIT 20
  ) j;
  
  RETURN jsonb_build_object(
    'pending_count', v_pending,
    'processing_count', v_processing,
    'recent_jobs', COALESCE(v_recent, '[]'::jsonb)
  );
END;
$$;

SELECT 'Dictionary jobs system created successfully' AS status;
