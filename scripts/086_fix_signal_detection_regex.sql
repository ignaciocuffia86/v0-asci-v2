-- Script 086: Fix regex escape in signal detection
-- Problem: Keywords like *ngIf, *ngFor cause "invalid regular expression: quantifier operand invalid"
-- Solution: Use escape_regex function to escape special regex characters in keywords

-- Update process_contact_signals to escape keywords
CREATE OR REPLACE FUNCTION process_contact_signals(contact_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_contact RECORD;
  v_position JSONB;
  v_company_id UUID;
  v_escaped_kw TEXT;
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
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 'current_position'
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 'headline'
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 'about'
      END,
      TRUE,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 
          public.extract_snippet(v_contact.current_position_title, kw, 100)
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 
          public.extract_snippet(v_contact.headline, kw, 100)
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 
          public.extract_snippet(v_contact.about, kw, 100)
      END
    FROM public.dictionary_processes dp,
         unnest(dp.keywords) kw
    WHERE 
      COALESCE(v_contact.current_position_title, '') ~* ('\y' || escape_regex(kw) || '\y') OR
      COALESCE(v_contact.headline, '') ~* ('\y' || escape_regex(kw) || '\y') OR
      COALESCE(v_contact.about, '') ~* ('\y' || escape_regex(kw) || '\y')
    ORDER BY contact_id, v_contact.current_company_id, dp.id, 
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 1
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 2
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 3
      END
    ON CONFLICT DO NOTHING;

    -- PRODUCTS/TECHNOLOGY: Current position
    INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
    SELECT DISTINCT ON (contact_id, v_contact.current_company_id, dp.id)
      contact_id,
      v_contact.current_company_id,
      'technology',
      dp.id,
      kw,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 'current_position'
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 'headline'
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 'about'
      END,
      TRUE,
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 
          public.extract_snippet(v_contact.current_position_title, kw, 100)
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 
          public.extract_snippet(v_contact.headline, kw, 100)
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 
          public.extract_snippet(v_contact.about, kw, 100)
      END
    FROM public.dictionary_products dp,
         unnest(dp.keywords) kw
    WHERE 
      COALESCE(v_contact.current_position_title, '') ~* ('\y' || escape_regex(kw) || '\y') OR
      COALESCE(v_contact.headline, '') ~* ('\y' || escape_regex(kw) || '\y') OR
      COALESCE(v_contact.about, '') ~* ('\y' || escape_regex(kw) || '\y')
    ORDER BY contact_id, v_contact.current_company_id, dp.id, 
      CASE 
        WHEN COALESCE(v_contact.current_position_title, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 1
        WHEN COALESCE(v_contact.headline, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 2
        WHEN COALESCE(v_contact.about, '') ~* ('\y' || escape_regex(kw) || '\y') THEN 3
      END
    ON CONFLICT DO NOTHING;

  END IF;

  -- Process past positions
  IF v_contact.positions IS NOT NULL THEN
    FOR v_position IN SELECT * FROM jsonb_array_elements(v_contact.positions)
    LOOP
      -- Get company_id for past position
      SELECT id INTO v_company_id 
      FROM public.companies 
      WHERE linkedin_url = v_position->>'company_linkedin_url'
      LIMIT 1;
      
      IF v_company_id IS NOT NULL AND v_company_id != v_contact.current_company_id THEN
        -- PROCESSES: Past positions
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (contact_id, v_company_id, dp.id)
          contact_id,
          v_company_id,
          'process',
          dp.id,
          kw,
          'past_position',
          FALSE,
          public.extract_snippet(v_position->>'title', kw, 100)
        FROM public.dictionary_processes dp,
             unnest(dp.keywords) kw
        WHERE COALESCE(v_position->>'title', '') ~* ('\y' || escape_regex(kw) || '\y')
        ORDER BY contact_id, v_company_id, dp.id
        ON CONFLICT DO NOTHING;

        -- PRODUCTS/TECHNOLOGY: Past positions
        INSERT INTO public.signals (contact_id, company_id, signal_type, signal_id, keyword_matched, source_field, is_current_employee, snippet)
        SELECT DISTINCT ON (contact_id, v_company_id, dp.id)
          contact_id,
          v_company_id,
          'technology',
          dp.id,
          kw,
          'past_position',
          FALSE,
          public.extract_snippet(v_position->>'title', kw, 100)
        FROM public.dictionary_products dp,
             unnest(dp.keywords) kw
        WHERE COALESCE(v_position->>'title', '') ~* ('\y' || escape_regex(kw) || '\y')
        ORDER BY contact_id, v_company_id, dp.id
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- Reset failed import_rows to pending so they can be reprocessed
UPDATE import_rows 
SET status = 'pending', error_message = NULL
WHERE status = 'failed' 
AND error_message LIKE '%invalid regular expression%';

-- Log the fix
DO $$
BEGIN
  RAISE NOTICE 'Script 086: Fixed regex escape in process_contact_signals. Reset % failed rows.', 
    (SELECT COUNT(*) FROM import_rows WHERE status = 'pending' AND error_message IS NULL);
END $$;
