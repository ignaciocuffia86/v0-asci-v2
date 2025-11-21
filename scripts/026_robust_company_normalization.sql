-- 1. Create normalization function
DROP FUNCTION IF EXISTS public.normalize_company_name(text);

CREATE OR REPLACE FUNCTION public.normalize_company_name(p_name TEXT) RETURNS TEXT AS $$
BEGIN
  -- 1. Trim and lowercase
  p_name := LOWER(TRIM(p_name));
  
  -- 2. Replace garbage values with NULL
  IF p_name IN ('', '-', 'empty', 'n/a', 'null', 'none', 'unknown', 'sin nombre', 'no name') THEN
    RETURN NULL;
  END IF;
  
  -- 3. Normalize multiple spaces to single space
  p_name := regexp_replace(p_name, '\s+', ' ', 'g');
  
  -- 4. Remove trailing punctuation (.,;)
  p_name := regexp_replace(p_name, '[.,;]+$', '');
  
  -- 5. Remove common corporate suffixes (case insensitive due to step 1)
  -- We use \y to match word boundaries to avoid removing parts of real words
  p_name := regexp_replace(p_name, '\s+(s\.?a\.?|s\.?r\.?l\.?|ltd\.?|inc\.?|llc\.?|corp\.?|co\.?|plc\.?|gmbh\.?|b\.?v\.?)$', '', 'g');
  
  -- 6. Final trim just in case
  RETURN TRIM(p_name);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Add normalized_name column if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'normalized_name') THEN 
        ALTER TABLE public.companies ADD COLUMN normalized_name TEXT;
        CREATE INDEX idx_companies_normalized_name ON public.companies(normalized_name);
    END IF;
END $$;

-- 3. Backfill normalized_name for existing companies
UPDATE public.companies 
SET normalized_name = normalize_company_name(name)
WHERE normalized_name IS NULL;

-- 4. Update upsert_company function to use robust logic
CREATE OR REPLACE FUNCTION public.upsert_company(
  p_name TEXT,
  p_linkedin_url TEXT,
  p_website TEXT DEFAULT NULL,
  p_industry TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_company_id UUID;
  v_normalized_name TEXT;
  v_clean_linkedin_url TEXT;
BEGIN
  -- Clean inputs
  v_normalized_name := normalize_company_name(p_name);
  
  -- Clean LinkedIn URL (treat empty strings as NULL)
  IF p_linkedin_url = '' THEN
    v_clean_linkedin_url := NULL;
  ELSE
    v_clean_linkedin_url := p_linkedin_url;
  END IF;

  -- 1. Try to find by LinkedIn URL (Strongest Match)
  IF v_clean_linkedin_url IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE linkedin_url = v_clean_linkedin_url;
    
    IF v_company_id IS NOT NULL THEN
      -- Found by URL. Update metadata if missing and return.
      -- We could update the name here if the current name is "garbage" and the new name is good.
      UPDATE public.companies 
      SET 
        updated_at = NOW(),
        -- Update name if current is garbage and new is valid
        name = CASE 
          WHEN normalize_company_name(name) IS NULL AND v_normalized_name IS NOT NULL THEN p_name 
          ELSE name 
        END,
        normalized_name = CASE 
          WHEN normalize_company_name(name) IS NULL AND v_normalized_name IS NOT NULL THEN v_normalized_name 
          ELSE normalized_name 
        END,
        website = COALESCE(website, p_website),
        industry = COALESCE(industry, p_industry),
        country = COALESCE(country, p_country)
      WHERE id = v_company_id;
      
      RETURN v_company_id;
    END IF;
  END IF;

  -- 2. Try to find by Normalized Name (Secondary Match)
  IF v_normalized_name IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE normalized_name = v_normalized_name LIMIT 1;
    
    IF v_company_id IS NOT NULL THEN
      -- Found by Name. Update LinkedIn URL if we have one and the record doesn't.
      UPDATE public.companies 
      SET 
        updated_at = NOW(),
        linkedin_url = COALESCE(linkedin_url, v_clean_linkedin_url),
        website = COALESCE(website, p_website),
        industry = COALESCE(industry, p_industry),
        country = COALESCE(country, p_country)
      WHERE id = v_company_id;
      
      RETURN v_company_id;
    END IF;
  END IF;

  -- 3. If not found, Insert New
  -- Handle case where name is NULL/Garbage but we have a LinkedIn URL
  -- We'll use the LinkedIn URL slug or a placeholder as the name if needed, 
  -- but ideally we want a real name.
  
  IF p_name IS NULL OR p_name = '' OR v_normalized_name IS NULL THEN
    -- If we have a LinkedIn URL, try to extract name from it
    IF v_clean_linkedin_url IS NOT NULL THEN
       -- Extract last part of URL: linkedin.com/company/ibm -> ibm
       p_name := INITCAP(SPLIT_PART(v_clean_linkedin_url, '/', 5)); 
       -- If split fails or URL format is weird, fallback to "Unknown - [URL]"
       IF p_name IS NULL OR p_name = '' THEN
         p_name := 'Unknown - ' || v_clean_linkedin_url;
       END IF;
       v_normalized_name := normalize_company_name(p_name);
    ELSE
       -- No name and no LinkedIn URL. We can't create a company.
       -- Return NULL or raise error? 
       -- For ETL robustness, let's return NULL and let the caller handle it (or create a dummy).
       -- But the caller expects a UUID.
       -- Let's create a "Unknown Company [UUID]" to avoid breaking the flow.
       p_name := 'Unknown Company ' || gen_random_uuid();
       v_normalized_name := 'unknown company';
    END IF;
  END IF;

  INSERT INTO public.companies (
    name, 
    normalized_name, 
    linkedin_url, 
    website, 
    industry, 
    country
  ) VALUES (
    p_name, 
    v_normalized_name, 
    v_clean_linkedin_url, 
    p_website, 
    p_industry, 
    p_country
  )
  ON CONFLICT (linkedin_url) DO UPDATE 
  SET updated_at = NOW() 
  RETURNING id INTO v_company_id;
  
  -- Handle rare race condition where name conflict happens but linkedin_url didn't catch it
  -- (e.g. another process inserted "IBM" just now)
  IF v_company_id IS NULL THEN
     SELECT id INTO v_company_id FROM public.companies WHERE normalized_name = v_normalized_name LIMIT 1;
  END IF;

  RETURN v_company_id;
  
EXCEPTION WHEN unique_violation THEN
  -- Fallback for name collision race conditions
  SELECT id INTO v_company_id FROM public.companies WHERE normalized_name = v_normalized_name LIMIT 1;
  IF v_company_id IS NOT NULL THEN
    RETURN v_company_id;
  END IF;
  
  -- If still failing, return NULL (shouldn't happen often)
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
