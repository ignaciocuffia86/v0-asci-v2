-- Fix: Create proper upsert_company wrapper and fix batch processing functions
--
-- Root cause: The batch processing functions call upsert_company() which doesn't exist.
-- Only upsert_company_from_contact and upsert_company_from_job exist.
--
-- Solution: Create upsert_company() as a wrapper that routes to the correct function.

-- Create the generic upsert_company wrapper function (7 parameters for maximum compatibility)
CREATE OR REPLACE FUNCTION public.upsert_company(
  p_name TEXT,
  p_linkedin_url TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_industry TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_company_id UUID;
  v_normalized_name TEXT;
  v_clean_linkedin_url TEXT;
BEGIN
  -- Clean inputs
  v_normalized_name := CASE 
    WHEN p_name IS NULL OR p_name = '' THEN NULL
    ELSE LOWER(TRIM(p_name))
  END;
  
  -- Clean LinkedIn URL (treat empty strings as NULL)
  v_clean_linkedin_url := NULLIF(TRIM(COALESCE(p_linkedin_url, '')), '');

  -- 1. Try to find by LinkedIn URL (Strongest Match)
  IF v_clean_linkedin_url IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE linkedin_url = v_clean_linkedin_url;
    
    IF v_company_id IS NOT NULL THEN
      UPDATE public.companies 
      SET 
        updated_at = NOW(),
        name = COALESCE(NULLIF(TRIM(name), ''), p_name),
        website = COALESCE(website, p_website),
        industry = COALESCE(industry, p_industry),
        country = COALESCE(country, p_country),
        logo_url = COALESCE(logo_url, p_logo_url),
        description = CASE 
          WHEN (description IS NULL OR TRIM(description) = '') AND p_description IS NOT NULL AND TRIM(p_description) != '' 
          THEN TRIM(p_description)
          ELSE description 
        END
      WHERE id = v_company_id;
      
      RETURN v_company_id;
    END IF;
  END IF;

  -- 2. Try to find by Normalized Name (Secondary Match)
  IF v_normalized_name IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies 
    WHERE LOWER(COALESCE(name, '')) = v_normalized_name OR LOWER(COALESCE(normalized_name, '')) = v_normalized_name
    LIMIT 1;
    
    IF v_company_id IS NOT NULL THEN
      UPDATE public.companies 
      SET 
        updated_at = NOW(),
        linkedin_url = COALESCE(linkedin_url, v_clean_linkedin_url),
        website = COALESCE(website, p_website),
        industry = COALESCE(industry, p_industry),
        country = COALESCE(country, p_country),
        logo_url = COALESCE(logo_url, p_logo_url),
        description = CASE 
          WHEN (description IS NULL OR TRIM(description) = '') AND p_description IS NOT NULL AND TRIM(p_description) != '' 
          THEN TRIM(p_description)
          ELSE description 
        END
      WHERE id = v_company_id;
      
      RETURN v_company_id;
    END IF;
  END IF;

  -- 3. If not found, Insert New
  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    IF v_clean_linkedin_url IS NOT NULL THEN
       p_name := INITCAP(SPLIT_PART(v_clean_linkedin_url, '/', 5)); 
       IF p_name IS NULL OR p_name = '' THEN
         p_name := 'Unknown - ' || v_clean_linkedin_url;
       END IF;
    ELSE
       p_name := 'Unknown Company ' || gen_random_uuid();
    END IF;
  END IF;

  INSERT INTO public.companies (
    name, 
    linkedin_url, 
    website, 
    industry, 
    country,
    logo_url,
    description
  ) VALUES (
    TRIM(p_name), 
    v_clean_linkedin_url, 
    p_website, 
    p_industry, 
    p_country,
    p_logo_url,
    NULLIF(TRIM(COALESCE(p_description, '')), '')
  )
  ON CONFLICT (linkedin_url) DO UPDATE 
  SET 
    updated_at = NOW(),
    description = CASE 
      WHEN (companies.description IS NULL OR TRIM(companies.description) = '') 
           AND EXCLUDED.description IS NOT NULL 
      THEN EXCLUDED.description 
      ELSE companies.description 
    END
  RETURNING id INTO v_company_id;
  
  IF v_company_id IS NULL THEN
     SELECT id INTO v_company_id FROM public.companies WHERE LOWER(name) = v_normalized_name LIMIT 1;
  END IF;

  RETURN COALESCE(v_company_id, gen_random_uuid());
  
EXCEPTION WHEN OTHERS THEN
  -- Last resort: find or create by name
  SELECT id INTO v_company_id FROM public.companies 
  WHERE LOWER(TRIM(name)) = LOWER(TRIM(p_name)) 
  LIMIT 1;
  
  IF v_company_id IS NOT NULL THEN
    RETURN v_company_id;
  END IF;
  
  INSERT INTO public.companies (name, linkedin_url, description)
  VALUES (TRIM(p_name), v_clean_linkedin_url, NULLIF(TRIM(COALESCE(p_description, '')), ''))
  RETURNING id INTO v_company_id;
  
  RETURN v_company_id;
END;
$$ LANGUAGE plpgsql;
