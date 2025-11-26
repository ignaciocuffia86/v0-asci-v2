-- ============================================================================
-- Script 085: Add Company Description Support
-- ============================================================================
-- This script:
-- 1. Adds 'description' column to companies table
-- 2. Updates upsert_company to accept and store description
-- 3. Updates process_contact_batch_internal to extract company_description from CSV
-- 4. Backfills existing companies with descriptions from import_rows
-- ============================================================================

-- 1. Add description column to companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. Update upsert_company function to accept description parameter
CREATE OR REPLACE FUNCTION public.upsert_company(
  p_name TEXT,
  p_linkedin_url TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_industry TEXT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL  -- New parameter for company description
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
      UPDATE public.companies 
      SET 
        updated_at = NOW(),
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
        country = COALESCE(country, p_country),
        logo_url = COALESCE(logo_url, p_logo_url),
        -- Update description if current is null/empty and new is valid
        description = CASE 
          WHEN (description IS NULL OR description = '') AND p_description IS NOT NULL AND p_description != '' 
          THEN p_description 
          ELSE description 
        END
      WHERE id = v_company_id;
      
      RETURN v_company_id;
    END IF;
  END IF;

  -- 2. Try to find by Normalized Name (Secondary Match)
  IF v_normalized_name IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE normalized_name = v_normalized_name LIMIT 1;
    
    IF v_company_id IS NOT NULL THEN
      UPDATE public.companies 
      SET 
        updated_at = NOW(),
        linkedin_url = COALESCE(linkedin_url, v_clean_linkedin_url),
        website = COALESCE(website, p_website),
        industry = COALESCE(industry, p_industry),
        country = COALESCE(country, p_country),
        logo_url = COALESCE(logo_url, p_logo_url),
        -- Update description if current is null/empty and new is valid
        description = CASE 
          WHEN (description IS NULL OR description = '') AND p_description IS NOT NULL AND p_description != '' 
          THEN p_description 
          ELSE description 
        END
      WHERE id = v_company_id;
      
      RETURN v_company_id;
    END IF;
  END IF;

  -- 3. If not found, Insert New
  IF p_name IS NULL OR p_name = '' OR v_normalized_name IS NULL THEN
    IF v_clean_linkedin_url IS NOT NULL THEN
       p_name := INITCAP(SPLIT_PART(v_clean_linkedin_url, '/', 5)); 
       IF p_name IS NULL OR p_name = '' THEN
         p_name := 'Unknown - ' || v_clean_linkedin_url;
       END IF;
       v_normalized_name := normalize_company_name(p_name);
    ELSE
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
    country,
    logo_url,
    description  -- Include description in insert
  ) VALUES (
    p_name, 
    v_normalized_name, 
    v_clean_linkedin_url, 
    p_website, 
    p_industry, 
    p_country,
    p_logo_url,
    NULLIF(p_description, '')  -- Store description, convert empty to NULL
  )
  ON CONFLICT (linkedin_url) DO UPDATE 
  SET 
    updated_at = NOW(),
    -- Update description on conflict if current is empty
    description = CASE 
      WHEN (companies.description IS NULL OR companies.description = '') 
           AND EXCLUDED.description IS NOT NULL 
      THEN EXCLUDED.description 
      ELSE companies.description 
    END
  RETURNING id INTO v_company_id;
  
  IF v_company_id IS NULL THEN
     SELECT id INTO v_company_id FROM public.companies WHERE normalized_name = v_normalized_name LIMIT 1;
  END IF;

  RETURN v_company_id;
  
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_company_id FROM public.companies WHERE normalized_name = v_normalized_name LIMIT 1;
  IF v_company_id IS NOT NULL THEN
    RETURN v_company_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;


-- 3. Update process_contact_batch_internal to extract company_description
CREATE OR REPLACE FUNCTION public.process_contact_batch_internal(p_batch_id UUID, p_limit INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_row RECORD;
  v_processed_count INTEGER := 0;
  v_failed_count INTEGER := 0;
  v_current_company_id UUID;
  v_contact_id UUID;
  v_prev_company_id UUID;
  v_prev_positions JSONB := '[]'::JSONB;
  v_position_obj JSONB;
BEGIN
  FOR v_row IN 
    SELECT * FROM public.import_rows 
    WHERE batch_id = p_batch_id AND status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      -- Process current company with description from CSV
      v_current_company_id := public.upsert_company(
        (v_row.row_data->>'company_name')::TEXT,
        (v_row.row_data->>'company_linkedin_url')::TEXT,
        (v_row.row_data->>'company_website')::TEXT,
        (v_row.row_data->>'company_industry')::TEXT,
        (v_row.row_data->>'company_country')::TEXT,
        (v_row.row_data->>'company_logo_url')::TEXT,
        (v_row.row_data->>'company_description')::TEXT  -- Extract company_description from CSV
      );
      
      -- Process previous positions (1-6)
      v_prev_positions := '[]'::JSONB;
      FOR i IN 1..6 LOOP
        IF v_row.row_data ? ('previous_company_' || i) AND 
           (v_row.row_data->>('previous_company_' || i)) IS NOT NULL AND
           (v_row.row_data->>('previous_company_' || i)) != '' THEN
          
          v_prev_company_id := public.upsert_company(
            (v_row.row_data->>('previous_company_' || i))::TEXT,
            NULL, NULL, NULL, NULL, NULL, NULL
          );
          
          v_position_obj := jsonb_build_object(
            'company_id', v_prev_company_id,
            'company_name', v_row.row_data->>('previous_company_' || i),
            'title', v_row.row_data->>('previous_position_' || i),
            'description', v_row.row_data->>('previous_position_' || i || '_description')
          );
          
          v_prev_positions := v_prev_positions || v_position_obj;
        END IF;
      END LOOP;

      -- Upsert contact (unchanged)
      INSERT INTO public.contacts (
        linkedin_url, first_name, last_name, full_name, headline, about,
        current_company_id, current_position_title, current_position_description,
        previous_positions, country, profile_picture_url,
        email1, email1_type, email1_status,
        email2, email2_type, email2_status,
        email3, email3_type, email3_status,
        email4, email4_type, email4_status,
        phone1, phone1_type, phone1_status,
        phone2, phone2_type, phone2_status
      ) VALUES (
        COALESCE((v_row.row_data->>'linkedin_url')::TEXT, 'placeholder:' || gen_random_uuid()::TEXT),
        (v_row.row_data->>'first_name')::TEXT, (v_row.row_data->>'last_name')::TEXT,
        (v_row.row_data->>'full_name')::TEXT, (v_row.row_data->>'headline')::TEXT,
        (v_row.row_data->>'about')::TEXT, v_current_company_id,
        (v_row.row_data->>'current_position')::TEXT, (v_row.row_data->>'current_position_description')::TEXT,
        v_prev_positions, (v_row.row_data->>'country')::TEXT, (v_row.row_data->>'profile_picture_url')::TEXT,
        (v_row.row_data->>'email1')::TEXT, (v_row.row_data->>'email1_type')::TEXT, (v_row.row_data->>'email1_status')::TEXT,
        (v_row.row_data->>'email2')::TEXT, (v_row.row_data->>'email2_type')::TEXT, (v_row.row_data->>'email2_status')::TEXT,
        (v_row.row_data->>'email3')::TEXT, (v_row.row_data->>'email3_type')::TEXT, (v_row.row_data->>'email3_status')::TEXT,
        (v_row.row_data->>'email4')::TEXT, (v_row.row_data->>'email4_type')::TEXT, (v_row.row_data->>'email4_status')::TEXT,
        (v_row.row_data->>'phone1')::TEXT, (v_row.row_data->>'phone1_type')::TEXT, (v_row.row_data->>'phone1_status')::TEXT,
        (v_row.row_data->>'phone2')::TEXT, (v_row.row_data->>'phone2_type')::TEXT, (v_row.row_data->>'phone2_status')::TEXT
      )
      ON CONFLICT (linkedin_url) DO UPDATE SET
        first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, full_name = EXCLUDED.full_name,
        headline = EXCLUDED.headline, about = EXCLUDED.about, current_company_id = EXCLUDED.current_company_id,
        current_position_title = EXCLUDED.current_position_title, current_position_description = EXCLUDED.current_position_description,
        previous_positions = EXCLUDED.previous_positions, country = EXCLUDED.country, profile_picture_url = EXCLUDED.profile_picture_url,
        updated_at = timezone('utc'::text, now())
      RETURNING id INTO v_contact_id;
      
      PERFORM public.process_contact_signals(v_contact_id);
      
      UPDATE public.import_rows SET status = 'processed', processed_at = timezone('utc'::text, now()) WHERE id = v_row.id;
      v_processed_count := v_processed_count + 1;
      
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.debug_events (batch_id, event_type, message, details)
      VALUES (p_batch_id, 'row_error', 'Error processing contact row', jsonb_build_object('row_id', v_row.id, 'error', SQLERRM));
      UPDATE public.import_rows SET status = 'failed', error_message = SQLERRM WHERE id = v_row.id;
      v_failed_count := v_failed_count + 1;
    END;
  END LOOP;
  RETURN v_processed_count;
END;
$$;


-- 4. Backfill existing companies with descriptions from import_rows
-- This finds the first company_description for each company from import_rows
WITH company_descriptions AS (
  SELECT DISTINCT ON (row_data->>'company_linkedin_url')
    row_data->>'company_linkedin_url' as linkedin_url,
    row_data->>'company_name' as company_name,
    row_data->>'company_description' as description
  FROM import_rows
  WHERE row_data->>'company_description' IS NOT NULL
    AND row_data->>'company_description' != ''
  ORDER BY row_data->>'company_linkedin_url', created_at DESC
)
UPDATE companies c
SET description = cd.description
FROM company_descriptions cd
WHERE (c.linkedin_url = cd.linkedin_url OR c.name = cd.company_name)
  AND (c.description IS NULL OR c.description = '');

-- Log completion
DO $$ 
BEGIN 
  RAISE NOTICE 'Script 085 completed: Added company description support';
END $$;
