-- Script 024: Fix Upsert Company Race Condition
-- This script redefines upsert_company to use ON CONFLICT for safe concurrency.

CREATE OR REPLACE FUNCTION public.upsert_company(
  p_name TEXT,
  p_linkedin_url TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_industry TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_id UUID;
  v_normalized_name TEXT;
BEGIN
  -- Normalize name: trim, lowercase
  v_normalized_name := TRIM(p_name);
  
  -- 1. Try to find existing company by LinkedIn URL (strongest match)
  IF p_linkedin_url IS NOT NULL AND p_linkedin_url != '' THEN
    SELECT id INTO v_company_id FROM public.companies WHERE linkedin_url = p_linkedin_url LIMIT 1;
    
    IF v_company_id IS NOT NULL THEN
      -- Update existing company with new info if available
      UPDATE public.companies SET
        website = COALESCE(website, p_website),
        industry = COALESCE(industry, p_industry),
        country = COALESCE(country, p_country),
        logo_url = COALESCE(logo_url, p_logo_url),
        updated_at = timezone('utc'::text, now())
      WHERE id = v_company_id;
      
      RETURN v_company_id;
    END IF;
  END IF;
  
  -- 2. If not found by URL, try by name (case insensitive)
  IF v_company_id IS NULL THEN
    SELECT id INTO v_company_id FROM public.companies 
    WHERE LOWER(name) = LOWER(v_normalized_name) 
    LIMIT 1;
    
    IF v_company_id IS NOT NULL THEN
      -- Update existing company
      UPDATE public.companies SET
        linkedin_url = COALESCE(linkedin_url, p_linkedin_url),
        website = COALESCE(website, p_website),
        industry = COALESCE(industry, p_industry),
        country = COALESCE(country, p_country),
        logo_url = COALESCE(logo_url, p_logo_url),
        updated_at = timezone('utc'::text, now())
      WHERE id = v_company_id;
      
      RETURN v_company_id;
    END IF;
  END IF;
  
  -- 3. If still not found, insert new company safely
  -- We use ON CONFLICT to handle race conditions where another process might have inserted it
  -- between our check and this insert.
  BEGIN
    INSERT INTO public.companies (name, linkedin_url, website, industry, country, logo_url)
    VALUES (v_normalized_name, p_linkedin_url, p_website, p_industry, p_country, p_logo_url)
    RETURNING id INTO v_company_id;
    
    RETURN v_company_id;
  EXCEPTION WHEN unique_violation THEN
    -- If we hit a unique constraint (likely linkedin_url), it means it was just inserted.
    -- We can now safely select it.
    IF p_linkedin_url IS NOT NULL AND p_linkedin_url != '' THEN
      SELECT id INTO v_company_id FROM public.companies WHERE linkedin_url = p_linkedin_url LIMIT 1;
    END IF;
    
    -- If still null (maybe name collision?), try name
    IF v_company_id IS NULL THEN
      SELECT id INTO v_company_id FROM public.companies WHERE LOWER(name) = LOWER(v_normalized_name) LIMIT 1;
    END IF;
    
    RETURN v_company_id;
  END;
END;
$$;
