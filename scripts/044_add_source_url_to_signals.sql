-- Add source_url column to signals table to store job posting URLs as proof
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Update process_job_signals to include posting_url in each signal
CREATE OR REPLACE FUNCTION public.process_job_signals(job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job RECORD;
  v_text_to_analyze TEXT;
BEGIN
  -- Fetch job posting including the posting_url for evidence
  SELECT * INTO v_job FROM public.job_postings WHERE id = job_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_text_to_analyze := COALESCE(v_job.title, '') || ' ' || COALESCE(v_job.description, '');

  -- Check Processes and include source_url (posting_url) as proof
  INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet, source_url)
  SELECT 
    v_job.company_id, 
    'process', 
    dp.id, 
    kw, 
    'job_description', 
    job_id,
    substring(v_text_to_analyze from greatest(0, position(kw in v_text_to_analyze) - 100) for 200 + length(kw)),
    v_job.posting_url  -- Store the job posting URL as proof
  FROM public.dictionary_processes dp,
       unnest(dp.keywords) kw
  WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
  ON CONFLICT DO NOTHING;

  -- Check Products and include source_url (posting_url) as proof
  INSERT INTO public.signals (company_id, signal_type, signal_id, keyword_matched, source_field, job_posting_id, snippet, source_url)
  SELECT 
    v_job.company_id, 
    'technology', 
    dp.id, 
    kw, 
    'job_description', 
    job_id,
    substring(v_text_to_analyze from greatest(0, position(kw in v_text_to_analyze) - 100) for 200 + length(kw)),
    v_job.posting_url  -- Store the job posting URL as proof
  FROM public.dictionary_products dp,
       unnest(dp.keywords) kw
  WHERE v_text_to_analyze ~* ('\y' || kw || '\y')
  ON CONFLICT DO NOTHING;
END;
$$;
