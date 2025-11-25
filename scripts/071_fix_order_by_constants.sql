-- Script 071: Fix ORDER BY non-integer constant error
-- Problem: ORDER BY clauses in process_contact_signals contain string literals ('process', 'technology')
-- which PostgreSQL doesn't allow as they are constant values that don't affect ordering

-- Update process_contact_signals to remove string constants from ORDER BY
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
  SELECT * INTO v_contact FROM public.contacts WHERE id = contact_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_contact.current_company_id IS NOT NULL THEN
    
    -- PROCESSES: Current position
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT DISTINCT ON (contact_id, v_contact.current_company_id, dp.id)
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
          public.extract_snippet(v_contact.current_position_title, kw, 100)
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 
          public.extract_snippet(v_contact.headline, kw, 100)
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 
          public.extract_snippet(v_contact.about, kw, 100)
      END
    FROM public.dictionary_processes dp,
         unnest(dp.keywords) kw
    WHERE 
      COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y')
    -- Removed 'process' string literal from ORDER BY - it's a constant that doesn't affect ordering
    ORDER BY contact_id, v_contact.current_company_id, dp.id, 
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 1
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 2
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 3
      END
    ON CONFLICT DO NOTHING;

    -- PRODUCTS: Current position
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT DISTINCT ON (contact_id, v_contact.current_company_id, dp.id)
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
          public.extract_snippet(v_contact.current_position_title, kw, 100)
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 
          public.extract_snippet(v_contact.headline, kw, 100)
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 
          public.extract_snippet(v_contact.about, kw, 100)
      END
    FROM public.dictionary_products dp,
         unnest(dp.keywords) kw
    WHERE 
      COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') OR
      COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y')
    -- Removed 'technology' string literal from ORDER BY - it's a constant that doesn't affect ordering
    ORDER BY contact_id, v_contact.current_company_id, dp.id,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || kw || '\y') THEN 1
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || kw || '\y') THEN 2
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || kw || '\y') THEN 3
      END
    ON CONFLICT DO NOTHING;
  END IF;

  -- PREVIOUS POSITIONS
  IF v_contact.previous_positions IS NOT NULL AND jsonb_array_length(v_contact.previous_positions) > 0 THEN
    FOR v_position IN SELECT * FROM jsonb_array_elements(v_contact.previous_positions) LOOP
      v_company_id := (v_position->>'company_id')::UUID;
      
      IF v_company_id IS NOT NULL THEN
        -- PROCESSES
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (contact_id, v_company_id, dp.id)
          contact_id,
          v_company_id,
          'process',
          dp.id,
          kw,
          'previous_position',
          FALSE,
          public.extract_snippet(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', ''), kw, 100)
        FROM public.dictionary_processes dp,
             unnest(dp.keywords) kw
        WHERE (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* ('\y' || kw || '\y')
        -- Removed 'process' string literal from ORDER BY
        ORDER BY contact_id, v_company_id, dp.id
        ON CONFLICT DO NOTHING;

        -- PRODUCTS
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (contact_id, v_company_id, dp.id)
          contact_id,
          v_company_id,
          'technology',
          dp.id,
          kw,
          'previous_position',
          FALSE,
          public.extract_snippet(COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', ''), kw, 100)
        FROM public.dictionary_products dp,
             unnest(dp.keywords) kw
        WHERE (COALESCE(v_position->>'title', '') || ' ' || COALESCE(v_position->>'description', '')) ~* ('\y' || kw || '\y')
        -- Removed 'technology' string literal from ORDER BY
        ORDER BY contact_id, v_company_id, dp.id
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END;
$$;

SELECT 'Function process_contact_signals updated - removed string literals from ORDER BY clauses' AS status;
