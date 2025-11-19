-- Improved signal detection that correctly assigns company_id from previous positions
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
  prev_pos_title TEXT;
  prev_company_id UUID;
  i INTEGER;
BEGIN
  -- Get contact data
  SELECT * INTO contact_record FROM public.contacts WHERE id = contact_id;
  
  IF contact_record IS NULL THEN
    RETURN;
  END IF;

  -- Delete existing signals for this contact to avoid duplicates on reprocessing
  DELETE FROM public.signals WHERE contact_id = contact_id;

  -- 1. Check Dictionary Products (Technologies)
  FOR prod_record IN SELECT id, name, keywords FROM public.dictionary_products LOOP
    FOREACH keyword IN ARRAY prod_record.keywords || ARRAY[prod_record.name] LOOP
      
      -- Check main fields (current position)
      FOREACH field_name IN ARRAY fields_to_check LOOP
        EXECUTE format('SELECT $1.%I', field_name) USING contact_record INTO field_text;
        
        IF field_text IS NOT NULL AND field_text ~* ('\m' || keyword || '\M') THEN
          match_position := position(lower(keyword) in lower(field_text));
          snippet_start := GREATEST(1, match_position - 100);
          snippet_end := LEAST(length(field_text), match_position + length(keyword) + 100);
          snippet_text := substring(field_text from snippet_start for (snippet_end - snippet_start));
          
          -- Assign current company_id for current position signals
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
      END LOOP;

      -- Check previous positions with correct company_id assignment
      IF contact_record.previous_positions IS NOT NULL THEN
        FOR i IN 0 .. jsonb_array_length(contact_record.previous_positions) - 1 LOOP
          prev_pos := contact_record.previous_positions->i;
          prev_pos_desc := prev_pos->>'description';
          prev_pos_title := prev_pos->>'title';
          prev_company_id := (prev_pos->>'company_id')::UUID; -- Extract company_id from JSONB
          
          -- Check description field
          IF prev_pos_desc IS NOT NULL AND prev_pos_desc ~* ('\m' || keyword || '\M') THEN
             match_position := position(lower(keyword) in lower(prev_pos_desc));
             snippet_start := GREATEST(1, match_position - 100);
             snippet_end := LEAST(length(prev_pos_desc), match_position + length(keyword) + 100);
             snippet_text := substring(prev_pos_desc from snippet_start for (snippet_end - snippet_start));

             INSERT INTO public.signals (
              contact_id,
              signal_type,
              signal_id,
              keyword_matched,
              source_field,
              company_id, -- Use the company_id from the previous position
              snippet
            ) VALUES (
              contact_id,
              'technology',
              prod_record.id,
              keyword,
              'previous_position_' || (i+1) || '_description',
              prev_company_id,
              snippet_text
            );
          END IF;
          
          -- Also check title field
          IF prev_pos_title IS NOT NULL AND prev_pos_title ~* ('\m' || keyword || '\M') THEN
             snippet_text := prev_pos_title;

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
              'previous_position_' || (i+1),
              prev_company_id,
              snippet_text
            );
          END IF;
        END LOOP;
      END IF;

    END LOOP;
  END LOOP;

  -- 2. Check Dictionary Processes (Same logic)
  FOR proc_record IN SELECT id, name, keywords FROM public.dictionary_processes LOOP
    FOREACH keyword IN ARRAY proc_record.keywords || ARRAY[proc_record.name] LOOP
      
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
          prev_pos_title := prev_pos->>'title';
          prev_company_id := (prev_pos->>'company_id')::UUID;
          
          IF prev_pos_desc IS NOT NULL AND prev_pos_desc ~* ('\m' || keyword || '\M') THEN
             match_position := position(lower(keyword) in lower(prev_pos_desc));
             snippet_start := GREATEST(1, match_position - 100);
             snippet_end := LEAST(length(prev_pos_desc), match_position + length(keyword) + 100);
             snippet_text := substring(prev_pos_desc from snippet_start for (snippet_end - snippet_start));
             
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
              prev_company_id,
              snippet_text
            );
          END IF;
          
          IF prev_pos_title IS NOT NULL AND prev_pos_title ~* ('\m' || keyword || '\M') THEN
             snippet_text := prev_pos_title;
             
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
              'previous_position_' || (i+1),
              prev_company_id,
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
