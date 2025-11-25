-- Fix posted_at dates for job postings
-- This script updates posted_at to use the real publishedAt date from source_data

DO $$
DECLARE
  v_updated_count INTEGER := 0;
  v_job RECORD;
  v_published_date TIMESTAMPTZ;
BEGIN
  RAISE NOTICE 'Starting job posting date fix...';
  
  -- Loop through all job postings
  FOR v_job IN 
    SELECT id, source_data
    FROM public.job_postings
    WHERE source_data IS NOT NULL
  LOOP
    -- Try to extract publishedAt from source_data
    -- Try multiple possible field names from the CSV
    v_published_date := NULL;
    
    -- Try publishedAt
    IF v_job.source_data ? 'publishedAt' THEN
      BEGIN
        v_published_date := (v_job.source_data->>'publishedAt')::TIMESTAMPTZ;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
    
    -- Try postedTime if publishedAt failed
    IF v_published_date IS NULL AND v_job.source_data ? 'postedTime' THEN
      BEGIN
        v_published_date := (v_job.source_data->>'postedTime')::TIMESTAMPTZ;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
    
    -- Try post_date if both above failed
    IF v_published_date IS NULL AND v_job.source_data ? 'post_date' THEN
      BEGIN
        v_published_date := (v_job.source_data->>'post_date')::TIMESTAMPTZ;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
    
    -- Update if we found a valid date
    IF v_published_date IS NOT NULL THEN
      UPDATE public.job_postings
      SET posted_at = v_published_date
      WHERE id = v_job.id;
      
      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Job posting date fix completed. Updated % job postings.', v_updated_count;
END $$;
