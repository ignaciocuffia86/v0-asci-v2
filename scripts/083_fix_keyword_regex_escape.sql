-- Script 083: Fix keyword regex escaping for special characters
-- Problem: Keywords like "*ngIf", "*ngFor" contain regex metacharacters that cause "invalid regular expression: quantifier operand invalid" errors

-- Helper function to escape regex special characters
CREATE OR REPLACE FUNCTION public.escape_regex(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(p_text, '([.*+?^${}()|[\]\\])', '\\\1', 'g');
$$;

-- =====================================================
-- UPDATE process_add_keyword_contacts with escaped regex
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
  v_escaped_keyword TEXT;
BEGIN
  -- Escape regex special characters in the keyword
  v_escaped_keyword := public.escape_regex(p_keyword);
  
  -- Build regex pattern with word boundaries
  v_pattern := '\y' || v_escaped_keyword || '\y';
  
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
-- UPDATE process_add_keyword_job_postings with escaped regex
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
  v_escaped_keyword TEXT;
  v_six_months_ago TIMESTAMPTZ;
BEGIN
  -- Escape regex special characters in the keyword
  v_escaped_keyword := public.escape_regex(p_keyword);
  
  v_pattern := '\y' || v_escaped_keyword || '\y';
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
-- Reset failed jobs so they can be re-processed
-- =====================================================

UPDATE public.dictionary_jobs 
SET status = 'pending',
    started_at = NULL,
    completed_at = NULL,
    error_message = NULL,
    progress = 0,
    processed_records = 0,
    contacts_processed = 0,
    job_postings_processed = 0,
    phase = 'contacts'
WHERE status = 'failed';

SELECT 'Regex escape fixed and failed jobs reset. Count: ' || COUNT(*) AS status
FROM public.dictionary_jobs 
WHERE status = 'pending';
