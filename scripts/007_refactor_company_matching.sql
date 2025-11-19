-- Improve company matching with normalization function
CREATE OR REPLACE FUNCTION public.normalize_company_name(name TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Remove common suffixes and normalize
  RETURN lower(
    regexp_replace(
      regexp_replace(name, '\s+(S\.?A\.?|S\.?R\.?L\.?|LTDA\.?|INC\.?|LLC\.?|CORP\.?|LTD\.?)$', '', 'i'),
      '\s+', ' ', 'g'
    )
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Add normalized name column for faster matching
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS normalized_name TEXT;

-- Create index on normalized name
CREATE INDEX IF NOT EXISTS idx_companies_normalized_name ON public.companies(normalized_name);

-- Update existing companies with normalized names
UPDATE public.companies SET normalized_name = normalize_company_name(name) WHERE normalized_name IS NULL;

-- Function to find or create company with smart matching
CREATE OR REPLACE FUNCTION public.upsert_company(
  p_name TEXT,
  p_linkedin_url TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_industry TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_company_id UUID;
  v_normalized_name TEXT;
BEGIN
  -- Normalize the input name
  v_normalized_name := normalize_company_name(p_name);
  
  -- Try to find by normalized name first
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE normalized_name = v_normalized_name
  LIMIT 1;
  
  IF v_company_id IS NOT NULL THEN
    -- Company exists, update if we have richer data
    UPDATE public.companies
    SET 
      linkedin_url = COALESCE(linkedin_url, p_linkedin_url),
      website = COALESCE(website, p_website),
      industry = COALESCE(industry, p_industry),
      country = COALESCE(country, p_country),
      logo_url = COALESCE(logo_url, p_logo_url),
      updated_at = now()
    WHERE id = v_company_id;
    
    RETURN v_company_id;
  END IF;
  
  -- Company doesn't exist, create it
  INSERT INTO public.companies (name, normalized_name, linkedin_url, website, industry, country, logo_url)
  VALUES (p_name, v_normalized_name, p_linkedin_url, p_website, p_industry, p_country, p_logo_url)
  ON CONFLICT (name) DO UPDATE SET
    linkedin_url = COALESCE(companies.linkedin_url, EXCLUDED.linkedin_url),
    website = COALESCE(companies.website, EXCLUDED.website),
    industry = COALESCE(companies.industry, EXCLUDED.industry),
    country = COALESCE(companies.country, EXCLUDED.country),
    logo_url = COALESCE(companies.logo_url, EXCLUDED.logo_url),
    updated_at = now()
  RETURNING id INTO v_company_id;
  
  RETURN v_company_id;
END;
$$ LANGUAGE plpgsql;
