-- Script 020: Optimize Signal Detection
-- This script improves signal detection to avoid duplicates and prioritize sources correctly

-- 1. Clean up existing duplicates BEFORE adding the constraint
-- Keep only the most recently created signal for each combination
DELETE FROM public.signals a USING (
  SELECT min(ctid) as ctid, contact_id, company_id, signal_type, signal_id
  FROM public.signals 
  GROUP BY contact_id, company_id, signal_type, signal_id
  HAVING count(*) > 1
) b
WHERE a.contact_id = b.contact_id 
  AND a.company_id = b.company_id 
  AND a.signal_type = b.signal_type 
  AND a.signal_id = b.signal_id 
  AND a.ctid <> b.ctid;

-- 2. Add UNIQUE constraint to signals table to prevent duplicates
-- Drop existing constraint if it exists
ALTER TABLE public.signals DROP CONSTRAINT IF EXISTS unique_signal_per_contact_company_dict;

-- Add new constraint: one signal per contact, company, signal_type, and dictionary entry
ALTER TABLE public.signals 
ADD CONSTRAINT unique_signal_per_contact_company_dict 
UNIQUE (contact_id, company_id, signal_type, signal_id);

-- 3. Add is_current_employee column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'signals' AND column_name = 'is_current_employee') THEN
        ALTER TABLE public.signals ADD COLUMN is_current_employee BOOLEAN DEFAULT TRUE;
    END IF;
END $$;

-- 4. Redefine process_contact_signals with prioritization logic
DROP FUNCTION IF EXISTS public.process_contact_signals(UUID);
CREATE OR REPLACE FUNCTION public.process_contact_signals(contact_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contact RECORD;
  v_position JSONB;
  v_company_id UUID;
BEGIN
  -- Get contact data
  SELECT * INTO v_contact FROM public.contacts WHERE id = contact_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- ===================================================================
  -- CURRENT POSITION ANALYSIS (with prioritization)
  -- Priority order: current_position_title > headline > about
  -- ===================================================================
  IF v_contact.current_company_id IS NOT NULL THEN
    
    -- PROCESSES: Try current_position_title first, then headline, then about
    -- Using DISTINCT ON to get only the first match per (contact_id, company_id, signal_type, signal_id)
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT DISTINCT ON (contact_id, v_contact.current_company_id, 'process', dp.id)
      contact_id,
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
    ORDER BY contact_id, v_contact.current_company_id, 'process', dp.id, 
      -- Prioritize by source: current_position=1, headline=2, about=3
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 1
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 2
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 3
      END
    ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;

    -- PRODUCTS: Try current_position_title first, then headline, then about
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT DISTINCT ON (contact_id, v_contact.current_company_id, 'technology', dp.id)
      contact_id,
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
    ORDER BY contact_id, v_contact.current_company_id, 'technology', dp.id,
      -- Prioritize by source: current_position=1, headline=2, about=3
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 1
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 2
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 3
      END
    ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;
  END IF;

  -- ===================================================================
  -- PREVIOUS POSITIONS ANALYSIS
  -- One signal per (contact, company, dictionary entry)
  -- ===================================================================
  IF v_contact.previous_positions IS NOT NULL AND jsonb_array_length(v_contact.previous_positions) > 0 THEN
    FOR v_position IN SELECT * FROM jsonb_array_elements(v_contact.previous_positions) LOOP
      v_company_id := (v_position->>'company_id')::UUID;
      
      IF v_company_id IS NOT NULL THEN
        -- PROCESSES
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (contact_id, v_company_id, 'process', dp.id)
          contact_id,
          v_company_id,
          'process',
          dp.id,
          kw,
          'previous_position',
          FALSE,
          substring(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '') 
                   from greatest(1, position(kw in COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) - 100) 
                   for 200 + length(kw))
        FROM public.dictionary_processes dp,
             unnest(dp.keywords) kw
        WHERE (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* ('\y' || kw || '\y')
        ORDER BY contact_id, v_company_id, 'process', dp.id
        ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;

        -- PRODUCTS
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (contact_id, v_company_id, 'technology', dp.id)
          contact_id,
          v_company_id,
          'technology',
          dp.id,
          kw,
          'previous_position',
          FALSE,
          substring(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '') 
                   from greatest(1, position(kw in COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) - 100) 
                   for 200 + length(kw))
        FROM public.dictionary_products dp,
             unnest(dp.keywords) kw
        WHERE (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* ('\y' || kw || '\y')
        ORDER BY contact_id, v_company_id, 'technology', dp.id
        ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END;
$$;
