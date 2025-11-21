-- Script 030: Fix Internal Promotion Detection
-- This script updates the signal detection logic to correctly identify
-- when a signal from a previous_position is actually an internal promotion
-- (same company, different role) rather than a true alumni situation.

-- Drop and recreate the process_contact_signals function with improved logic
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
  v_is_internal_promotion BOOLEAN;
BEGIN
  -- Get contact data
  SELECT * INTO v_contact FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN RETURN; END IF;


  -- ===================================================================
  -- PREVIOUS POSITIONS ANALYSIS (with internal promotion detection)
  -- ===================================================================
  IF v_contact.previous_positions IS NOT NULL AND jsonb_array_length(v_contact.previous_positions) > 0 THEN
    FOR v_position IN SELECT * FROM jsonb_array_elements(v_contact.previous_positions) LOOP
      v_company_id := (v_position->>'company_id')::UUID;
      
      IF v_company_id IS NOT NULL THEN
        -- Detect if this is an internal promotion
        -- If the previous position company matches current company, it's internal
        v_is_internal_promotion := (v_company_id = v_contact.current_company_id);
        
        -- PROCESSES
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (dp.id)
          p_contact_id,
          v_company_id,
          'process',
          dp.id,
          kw,
          'previous_position',
          v_is_internal_promotion, -- Mark as current if internal promotion
          substring(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '') 
                   from greatest(1, position(kw in COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) - 100) 
                   for 200 + length(kw))
        FROM public.dictionary_processes dp,
             unnest(dp.keywords) kw
        WHERE (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* ('\y' || kw || '\y')
        ORDER BY dp.id
        ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;

        -- PRODUCTS
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (dp.id)
          p_contact_id,
          v_company_id,
          'technology',
          dp.id,
          kw,
          'previous_position',
          v_is_internal_promotion, -- Mark as current if internal promotion
          substring(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '') 
                   from greatest(1, position(kw in COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) - 100) 
                   for 200 + length(kw))
        FROM public.dictionary_products dp,
             unnest(dp.keywords) kw
        WHERE (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* ('\y' || kw || '\y')
        ORDER BY dp.id
        ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- Update existing signals to fix internal promotions retroactively
-- This will mark signals as is_current_employee=TRUE if they are from previous_position
-- but the contact still works at the same company
UPDATE public.signals s
SET is_current_employee = TRUE
FROM public.contacts c
WHERE s.contact_id = c.id
  AND s.source_field = 'previous_position'
  AND s.company_id = c.current_company_id
  AND s.is_current_employee = FALSE;
