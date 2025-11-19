-- Function to detect signals for a batch of contacts
-- This function will be called from the application layer (Next.js server action)
-- It takes a contact_id and processes it against the dictionary

CREATE OR REPLACE FUNCTION public.process_contact_signals(contact_id UUID)
RETURNS VOID AS $$
DECLARE
  contact_record RECORD;
  prod_record RECORD;
  proc_record RECORD;
  keyword TEXT;
  field_text TEXT;
  field_name TEXT;
  match_position INTEGER;
  snippet_start INTEGER;
  snippet_end INTEGER;
  snippet_text TEXT;
  fields_to_check TEXT[] := ARRAY['headline', 'about', 'current_position_description'];
  prev_pos JSONB;
  prev_pos_desc TEXT;
  i INTEGER;
BEGIN
  -- Get contact data
  SELECT * INTO contact_record FROM public.contacts WHERE id = contact_id;
  
  IF contact_record IS NULL THEN
    RETURN;
  END IF;

  -- 1. Check Dictionary Products (Technologies)
  FOR prod_record IN SELECT id, name, keywords FROM public.dictionary_products LOOP
    FOREACH keyword IN ARRAY prod_record.keywords || prod_record.name LOOP
      
      -- Check main fields
      FOREACH field_name IN ARRAY fields_to_check LOOP
        EXECUTE format('SELECT $1.%I', field_name) USING contact_record INTO field_text;
        
        IF field_text IS NOT NULL THEN
          -- Use regex for exact word matching (case insensitive)
          -- \m matches start of word, \M matches end of word
          IF field_text ~* ('\m' || keyword || '\M') THEN
            
            -- Extract snippet (approx 100 chars before and after)
            match_position := position(lower(keyword) in lower(field_text));
            snippet_start := GREATEST(1, match_position - 100);
            snippet_end := LEAST(length(field_text), match_position + length(keyword) + 100);
            snippet_text := substring(field_text from snippet_start for (snippet_end - snippet_start));
            
            -- Insert signal
            INSERT INTO public.signals (
              contact_id,
              signal_type,
              signal_id,
              keyword_matched,
              source_field,
              company_id,
              snippet
            ) VALUES (
              contact_id,
              'technology',
              prod_record.id,
              keyword,
              field_name,
              contact_record.current_company_id,
              snippet_text
            );
          END IF;
        END IF;
      END LOOP;

      -- Check previous positions (JSONB)
      IF contact_record.previous_positions IS NOT NULL THEN
        FOR i IN 0 .. jsonb_array_length(contact_record.previous_positions) - 1 LOOP
          prev_pos := contact_record.previous_positions->i;
          prev_pos_desc := prev_pos->>'description';
          
          IF prev_pos_desc IS NOT NULL AND prev_pos_desc ~* ('\m' || keyword || '\M') THEN
             -- Extract snippet logic (simplified for JSON)
             snippet_text := substring(prev_pos_desc from 1 for 200); -- Simplified snippet for JSON

             -- Try to find company for previous position (not implemented fully, using current for now or null)
             -- Ideally we would match the company name string to a company ID
             
             INSERT INTO public.signals (
              contact_id,
              signal_type,
              signal_id,
              keyword_matched,
              source_field,
              company_id, -- This should ideally be the previous company ID if we could resolve it
              snippet
            ) VALUES (
              contact_id,
              'technology',
              prod_record.id,
              keyword,
              'previous_position_' || (i+1) || '_description',
              NULL, -- We don't have the ID for previous companies easily resolved yet
              snippet_text
            );
          END IF;
        END LOOP;
      END IF;

    END LOOP;
  END LOOP;

  -- 2. Check Dictionary Processes (Same logic)
  FOR proc_record IN SELECT id, name, keywords FROM public.dictionary_processes LOOP
    FOREACH keyword IN ARRAY proc_record.keywords || proc_record.name LOOP
      
      -- Check main fields
      FOREACH field_name IN ARRAY fields_to_check LOOP
        EXECUTE format('SELECT $1.%I', field_name) USING contact_record INTO field_text;
        
        IF field_text IS NOT NULL AND field_text ~* ('\m' || keyword || '\M') THEN
            match_position := position(lower(keyword) in lower(field_text));
            snippet_start := GREATEST(1, match_position - 100);
            snippet_end := LEAST(length(field_text), match_position + length(keyword) + 100);
            snippet_text := substring(field_text from snippet_start for (snippet_end - snippet_start));
            
            INSERT INTO public.signals (
              contact_id,
              signal_type,
              signal_id,
              keyword_matched,
              source_field,
              company_id,
              snippet
            ) VALUES (
              contact_id,
              'process',
              proc_record.id,
              keyword,
              field_name,
              contact_record.current_company_id,
              snippet_text
            );
        END IF;
      END LOOP;

       -- Check previous positions
      IF contact_record.previous_positions IS NOT NULL THEN
        FOR i IN 0 .. jsonb_array_length(contact_record.previous_positions) - 1 LOOP
          prev_pos := contact_record.previous_positions->i;
          prev_pos_desc := prev_pos->>'description';
          
          IF prev_pos_desc IS NOT NULL AND prev_pos_desc ~* ('\m' || keyword || '\M') THEN
             snippet_text := substring(prev_pos_desc from 1 for 200);
             
             INSERT INTO public.signals (
              contact_id,
              signal_type,
              signal_id,
              keyword_matched,
              source_field,
              company_id,
              snippet
            ) VALUES (
              contact_id,
              'process',
              proc_record.id,
              keyword,
              'previous_position_' || (i+1) || '_description',
              NULL,
              snippet_text
            );
          END IF;
        END LOOP;
      END IF;

    END LOOP;
  END LOOP;

  -- Mark as processed
  UPDATE public.contacts SET processed = TRUE, processed_at = now() WHERE id = contact_id;
END;
$$ LANGUAGE plpgsql;
