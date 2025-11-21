-- Script 031: Fix Duplicate Signals and Internal Promotion Logic
-- 1. Deduplicates signals that differ only by case (e.g. "Help Desk" vs "help desk")
-- 2. Improves internal promotion detection by comparing company names (normalized)
--    in addition to IDs, handling cases where companies haven't been merged yet.

-- ===================================================================
-- 1. CLEANUP DUPLICATE SIGNALS
-- ===================================================================
-- Delete signals that are duplicates based on case-insensitive keyword matching
-- for the same contact, company, and signal type.
DELETE FROM public.signals
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY contact_id, company_id, signal_type, lower(keyword_matched)
        ORDER BY 
          -- Prefer exact case match with dictionary if possible, otherwise arbitrary
          CASE WHEN keyword_matched ~ '^[A-Z]' THEN 0 ELSE 1 END, 
          id
      ) as rn
    FROM public.signals
  ) t
  WHERE rn > 1
);

-- ===================================================================
-- 2. IMPROVE INTERNAL PROMOTION DETECTION (RETROACTIVE FIX)
-- ===================================================================
-- Update existing signals to is_current_employee = TRUE if:
-- a) IDs match (existing logic)
-- b) Normalized names match (new logic for duplicate companies)
UPDATE public.signals s
SET is_current_employee = TRUE
FROM public.contacts c
LEFT JOIN public.companies cc ON c.current_company_id = cc.id,
public.companies sc
WHERE s.contact_id = c.id
  AND s.company_id = sc.id
  AND s.source_field = 'previous_position'
  AND s.is_current_employee = FALSE
  AND (
    -- Direct ID match
    s.company_id = c.current_company_id
    OR
    -- Normalized name match (handles duplicate companies like "YPF" vs "YPF S.A.")
    (cc.name IS NOT NULL AND sc.name IS NOT NULL AND 
     public.normalize_company_name(cc.name) = public.normalize_company_name(sc.name))
  );

-- ===================================================================
-- 3. UPDATE FUNCTION FOR FUTURE INGESTION
-- ===================================================================
DROP FUNCTION IF EXISTS public.process_contact_signals(UUID);
CREATE OR REPLACE FUNCTION public.process_contact_signals(p_contact_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contact RECORD;
  v_position JSONB;
  v_company_id UUID;
  v_current_company_name TEXT;
  v_prev_company_name TEXT;
  v_is_internal_promotion BOOLEAN;
BEGIN
  -- Get contact data
  SELECT * INTO v_contact FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Get current company name for comparison
  IF v_contact.current_company_id IS NOT NULL THEN
    SELECT name INTO v_current_company_name FROM public.companies WHERE id = v_contact.current_company_id;
  END IF;

  -- ===================================================================
  -- CURRENT POSITION ANALYSIS
  -- ===================================================================
  IF v_contact.current_company_id IS NOT NULL THEN
    
    -- PROCESSES
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT DISTINCT ON (LOWER(kw)) -- Deduplicate by case-insensitive keyword
      p_contact_id,
      v_contact.current_company_id,
      'process',
      dp.id,
      kw,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 'current_position'
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 'headline'
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 'about'
      END,
      TRUE,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 
          substring(v_contact.current_position_title from greatest(1, position(kw in v_contact.current_position_title) - 100) for 200 + length(kw))
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 
          substring(v_contact.headline from greatest(1, position(kw in v_contact.headline) - 100) for 200 + length(kw))
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 
          substring(v_contact.about from greatest(1, position(kw in v_contact.about) - 100) for 200 + length(kw))
      END
    FROM public.dictionary_processes dp,
         unnest(dp.keywords) kw
    WHERE 
      COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y')
    ORDER BY LOWER(kw), dp.id
    ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;

    -- PRODUCTS
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT DISTINCT ON (LOWER(kw)) -- Deduplicate by case-insensitive keyword
      p_contact_id,
      v_contact.current_company_id,
      'technology',
      dp.id,
      kw,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 'current_position'
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 'headline'
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 'about'
      END,
      TRUE,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 
          substring(v_contact.current_position_title from greatest(1, position(kw in v_contact.current_position_title) - 100) for 200 + length(kw))
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 
          substring(v_contact.headline from greatest(1, position(kw in v_contact.headline) - 100) for 200 + length(kw))
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 
          substring(v_contact.about from greatest(1, position(kw in v_contact.about) - 100) for 200 + length(kw))
      END
    FROM public.dictionary_products dp,
         unnest(dp.keywords) kw
    WHERE 
      COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y')
    ORDER BY LOWER(kw), dp.id
    ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;
  END IF;

  -- ===================================================================
  -- PREVIOUS POSITIONS ANALYSIS
  -- ===================================================================
  IF v_contact.previous_positions IS NOT NULL AND jsonb_array_length(v_contact.previous_positions) > 0 THEN
    FOR v_position IN SELECT * FROM jsonb_array_elements(v_contact.previous_positions) LOOP
      v_company_id := (v_position->>'company_id')::UUID;
      v_prev_company_name := v_position->>'company_name';
      
      IF v_company_id IS NOT NULL THEN
        -- Detect if this is an internal promotion
        -- Check ID match OR Name match (normalized)
        v_is_internal_promotion := (v_company_id = v_contact.current_company_id) OR 
                                   (v_current_company_name IS NOT NULL AND v_prev_company_name IS NOT NULL AND 
                                    public.normalize_company_name(v_current_company_name) = public.normalize_company_name(v_prev_company_name));
        
        -- PROCESSES
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (LOWER(kw)) -- Deduplicate by case-insensitive keyword
          p_contact_id,
          v_company_id,
          'process',
          dp.id,
          kw,
          'previous_position',
          v_is_internal_promotion,
          substring(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '') 
                   from greatest(1, position(kw in COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) - 100) 
                   for 200 + length(kw))
        FROM public.dictionary_processes dp,
             unnest(dp.keywords) kw
        WHERE (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* ('\y' || kw || '\y')
        ORDER BY LOWER(kw), dp.id
        ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;

        -- PRODUCTS
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (LOWER(kw)) -- Deduplicate by case-insensitive keyword
          p_contact_id,
          v_company_id,
          'technology',
          dp.id,
          kw,
          'previous_position',
          v_is_internal_promotion,
          substring(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '') 
                   from greatest(1, position(kw in COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) - 100) 
                   for 200 + length(kw))
        FROM public.dictionary_products dp,
             unnest(dp.keywords) kw
        WHERE (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* ('\y' || kw || '\y')
        ORDER BY LOWER(kw), dp.id
        ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END;
$$;
