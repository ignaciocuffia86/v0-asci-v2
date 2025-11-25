-- Script 054: Add job_posted_at column to signals table
-- Purpose: Store the actual job posting publication date in signals for accurate filtering
-- This allows filtering job posting signals by their real publication date, not detection date

-- Step 1: Add the new column
ALTER TABLE public.signals
ADD COLUMN IF NOT EXISTS job_posted_at TIMESTAMPTZ;

-- Create index for performance when filtering by job posting date
CREATE INDEX IF NOT EXISTS idx_signals_job_posted_at 
ON public.signals(job_posted_at) 
WHERE job_posting_id IS NOT NULL;

-- Step 2: Populate existing job posting signals with the posted_at date from job_postings table
UPDATE public.signals s
SET job_posted_at = jp.posted_at
FROM public.job_postings jp
WHERE s.job_posting_id = jp.id
  AND s.job_posted_at IS NULL;

-- Step 3: Update process_job_signals to automatically set job_posted_at
CREATE OR REPLACE FUNCTION public.process_job_signals(
  p_job_posting_id UUID,
  p_signal_type TEXT,
  p_company_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_posting RECORD;
  v_text_to_analyze TEXT;
  v_signal_count INTEGER := 0;
  v_dict_record RECORD;
  v_snippet TEXT;
  v_dict_table TEXT;
BEGIN
  -- Get job posting details including posted_at
  SELECT 
    id, 
    title, 
    description, 
    apply_url,
    posted_at  -- Added posted_at to retrieve publication date
  INTO v_job_posting
  FROM public.job_postings
  WHERE id = p_job_posting_id;

  IF NOT FOUND THEN
    RAISE NOTICE 'Job posting % not found', p_job_posting_id;
    RETURN 0;
  END IF;

  -- Combine title and description for analysis
  v_text_to_analyze := COALESCE(v_job_posting.title, '') || ' ' || COALESCE(v_job_posting.description, '');
  
  IF LENGTH(v_text_to_analyze) < 10 THEN
    RAISE NOTICE 'Job posting % has insufficient text for analysis', p_job_posting_id;
    RETURN 0;
  END IF;

  -- Determine which dictionary table to use
  v_dict_table := CASE 
    WHEN p_signal_type = 'product' THEN 'dictionary_products'
    WHEN p_signal_type = 'process' THEN 'dictionary_processes'
    ELSE NULL
  END;

  IF v_dict_table IS NULL THEN
    RAISE NOTICE 'Invalid signal type: %', p_signal_type;
    RETURN 0;
  END IF;

  -- Search for keywords in the text
  FOR v_dict_record IN EXECUTE format(
    'SELECT id, name, keywords FROM public.%I WHERE keywords IS NOT NULL',
    v_dict_table
  )
  LOOP
    -- Check if any keyword matches (case-insensitive, word boundaries)
    IF v_text_to_analyze ~* ('\y(' || array_to_string(v_dict_record.keywords, '|') || ')\y') THEN
      
      -- Extract snippet using the helper function
      v_snippet := extract_snippet(v_text_to_analyze, v_dict_record.keywords);
      
      -- Insert signal with conflict handling
      INSERT INTO public.signals (
        company_id,
        signal_type,
        signal_id,
        job_posting_id,
        snippet,
        source_field,
        source_url,
        job_posted_at  -- Added job_posted_at column
      )
      VALUES (
        p_company_id,
        p_signal_type,
        v_dict_record.id,
        p_job_posting_id,
        v_snippet,
        'job_description',
        v_job_posting.apply_url,
        v_job_posting.posted_at  -- Set the actual job posting date
      )
      ON CONFLICT (job_posting_id, signal_type, signal_id) 
      DO UPDATE SET
        snippet = EXCLUDED.snippet,
        source_url = EXCLUDED.source_url,
        job_posted_at = EXCLUDED.job_posted_at;  -- Update job_posted_at on conflict
      
      v_signal_count := v_signal_count + 1;
    END IF;
  END LOOP;

  RETURN v_signal_count;
END;
$$;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '✓ Added job_posted_at column to signals table';
  RAISE NOTICE '✓ Populated existing job posting signals with publication dates';
  RAISE NOTICE '✓ Updated process_job_signals to set job_posted_at automatically';
END $$;
