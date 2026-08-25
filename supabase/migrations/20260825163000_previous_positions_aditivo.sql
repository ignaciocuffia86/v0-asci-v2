-- ============================================================================
-- Fase 0.3 — previous_positions deja de pisarse entero en cada re-import
--
-- Problema (docs/analisis-inputs-companias-contactos-senales.md §4.2): el
-- upsert de contacto hacía `previous_positions = EXCLUDED.previous_positions`
-- mientras emails y teléfonos usan COALESCE. Un export que trae menos
-- posiciones que el anterior (los proveedores suelen recortar a las últimas
-- N) borraba historial laboral — y con él las señales futuras de esos
-- puestos y la base del análisis de movimientos.
--
-- Solución: merge aditivo. Las posiciones del import nuevo mandan (traen la
-- versión más fresca de título/fechas/descripción) y se conservan las
-- posiciones viejas cuya (company_id, title) no aparece en el import nuevo.
-- ============================================================================

-- Une dos arrays de previous_positions. Las entradas de p_new van primero y
-- ganan; de p_old sobreviven las que no están en p_new por (company_id,
-- title). Un mismo company_id con títulos distintos son posiciones distintas
-- (promociones), así que ambas se conservan.
CREATE OR REPLACE FUNCTION public.merge_previous_positions(p_old jsonb, p_new jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT coalesce(p_new, '[]'::jsonb) || coalesce(
    (SELECT jsonb_agg(o.e)
     FROM jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) o(e)
     WHERE NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) n(e)
       WHERE coalesce(n.e->>'company_id','') = coalesce(o.e->>'company_id','')
         AND lower(coalesce(n.e->>'title','')) = lower(coalesce(o.e->>'title',''))
     )),
    '[]'::jsonb);
$function$;

COMMENT ON FUNCTION public.merge_previous_positions(jsonb, jsonb) IS
  'Merge aditivo de contacts.previous_positions: lo nuevo gana, lo viejo que no reaparece se conserva. Evita que un export recortado borre historial laboral.';

-- ── process_contact_batch_internal ──────────────────────────────────────────
-- Copia literal de producción (2026-08-25, la versión de la migración
-- 20260825000000) con un solo cambio: la línea de previous_positions en el
-- ON CONFLICT usa merge_previous_positions en vez de pisar con EXCLUDED.
CREATE OR REPLACE FUNCTION public.process_contact_batch_internal(p_batch_id uuid, p_limit integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_row RECORD;
  v_processed_count INTEGER := 0;
  v_retry_count INTEGER := 0;
  v_max_retries INTEGER := 3;
  v_retry_delay INTEGER;
  v_current_company_id UUID;
  v_contact_id UUID;
  v_prev_company_id UUID;
  v_prev_positions JSONB := '[]'::JSONB;
  v_position_obj JSONB;
  v_resolved_id UUID;
  v_linkedin_url TEXT;
BEGIN
  FOR v_row IN
    SELECT * FROM public.import_rows
    WHERE batch_id = p_batch_id AND status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_retry_count := 0;

    <<retry_loop>>
    LOOP
      BEGIN
        v_current_company_id := public.upsert_company(
          (v_row.row_data->>'company_name')::TEXT,
          (v_row.row_data->>'company_linkedin_url')::TEXT,
          (v_row.row_data->>'company_website')::TEXT,
          (v_row.row_data->>'company_industry')::TEXT,
          (v_row.row_data->>'company_country')::TEXT,
          (v_row.row_data->>'company_logo_url')::TEXT,
          (v_row.row_data->>'company_description')::TEXT
        );

        v_prev_positions := '[]'::JSONB;
        FOR i IN 1..6 LOOP
          IF v_row.row_data ? ('previous_company_' || i) AND
             (v_row.row_data->>('previous_company_' || i)) IS NOT NULL AND
             (v_row.row_data->>('previous_company_' || i)) != '' THEN

            v_prev_company_id := public.upsert_company(
              (v_row.row_data->>('previous_company_' || i))::TEXT,
              NULL, NULL, NULL, NULL, NULL, NULL
            );

            v_position_obj := jsonb_strip_nulls(jsonb_build_object(
              'company_id', v_prev_company_id,
              'company_name', v_row.row_data->>('previous_company_' || i),
              'title', v_row.row_data->>('previous_position_' || i),
              'description', v_row.row_data->>('previous_position_' || i || '_description'),
              'started_on', public.parse_position_date(v_row.row_data->>('previous_position_' || i || '_started_at')),
              'ended_on', public.parse_position_date(v_row.row_data->>('previous_position_' || i || '_ended_at'))
            ));

            v_prev_positions := v_prev_positions || v_position_obj;
          END IF;
        END LOOP;

        -- ── Resolución de identidad ──
        v_linkedin_url := nullif(trim(v_row.row_data->>'linkedin_url'), '');

        v_resolved_id := public.resolve_contact_id(
          v_linkedin_url,
          v_row.row_data->>'full_name',
          ARRAY[v_row.row_data->>'email1', v_row.row_data->>'email2',
                v_row.row_data->>'email3', v_row.row_data->>'email4'],
          ARRAY[v_row.row_data->>'phone1', v_row.row_data->>'phone2']
        );

        IF v_resolved_id IS NOT NULL THEN
          IF v_linkedin_url IS NULL THEN
            SELECT c.linkedin_url INTO v_linkedin_url FROM public.contacts c WHERE c.id = v_resolved_id;
          ELSE
            UPDATE public.contacts c
               SET linkedin_url = v_linkedin_url
             WHERE c.id = v_resolved_id
               AND c.linkedin_url IS DISTINCT FROM v_linkedin_url
               AND NOT EXISTS (
                 SELECT 1 FROM public.contacts o
                 WHERE o.linkedin_url = v_linkedin_url AND o.id <> v_resolved_id
               );
          END IF;
        END IF;

        IF v_linkedin_url IS NULL THEN
          v_linkedin_url := 'placeholder:' || gen_random_uuid()::TEXT;
        END IF;

        INSERT INTO public.contacts (
          linkedin_url, first_name, last_name, full_name, headline, about,
          current_company_id, current_position_title, current_position_description,
          current_position_started_on,
          previous_positions, country, profile_picture_url,
          email1, email1_type, email1_status,
          email2, email2_type, email2_status,
          email3, email3_type, email3_status,
          email4, email4_type, email4_status,
          phone1, phone1_type, phone1_status,
          phone2, phone2_type, phone2_status
        ) VALUES (
          v_linkedin_url,
          (v_row.row_data->>'first_name')::TEXT, (v_row.row_data->>'last_name')::TEXT,
          (v_row.row_data->>'full_name')::TEXT, (v_row.row_data->>'headline')::TEXT,
          (v_row.row_data->>'about')::TEXT, v_current_company_id,
          (v_row.row_data->>'current_position')::TEXT, (v_row.row_data->>'current_position_description')::TEXT,
          public.parse_position_date(v_row.row_data->>'current_position_started_at'),
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
          current_position_started_on = COALESCE(EXCLUDED.current_position_started_on, public.contacts.current_position_started_on),
          -- [Fase 0] merge aditivo en vez de pisar: un export recortado ya no
          -- borra historial laboral.
          previous_positions = public.merge_previous_positions(public.contacts.previous_positions, EXCLUDED.previous_positions),
          country = EXCLUDED.country, profile_picture_url = EXCLUDED.profile_picture_url,
          email1 = COALESCE(public.contacts.email1, EXCLUDED.email1),
          email1_type = COALESCE(public.contacts.email1_type, EXCLUDED.email1_type),
          email1_status = COALESCE(public.contacts.email1_status, EXCLUDED.email1_status),
          email2 = COALESCE(public.contacts.email2, EXCLUDED.email2),
          email2_type = COALESCE(public.contacts.email2_type, EXCLUDED.email2_type),
          email2_status = COALESCE(public.contacts.email2_status, EXCLUDED.email2_status),
          email3 = COALESCE(public.contacts.email3, EXCLUDED.email3),
          email3_type = COALESCE(public.contacts.email3_type, EXCLUDED.email3_type),
          email3_status = COALESCE(public.contacts.email3_status, EXCLUDED.email3_status),
          email4 = COALESCE(public.contacts.email4, EXCLUDED.email4),
          email4_type = COALESCE(public.contacts.email4_type, EXCLUDED.email4_type),
          email4_status = COALESCE(public.contacts.email4_status, EXCLUDED.email4_status),
          phone1 = COALESCE(public.contacts.phone1, EXCLUDED.phone1),
          phone1_type = COALESCE(public.contacts.phone1_type, EXCLUDED.phone1_type),
          phone1_status = COALESCE(public.contacts.phone1_status, EXCLUDED.phone1_status),
          phone2 = COALESCE(public.contacts.phone2, EXCLUDED.phone2),
          phone2_type = COALESCE(public.contacts.phone2_type, EXCLUDED.phone2_type),
          phone2_status = COALESCE(public.contacts.phone2_status, EXCLUDED.phone2_status),
          updated_at = timezone('utc'::text, now())
        RETURNING id INTO v_contact_id;

        PERFORM public.process_contact_signals(v_contact_id);

        UPDATE public.import_rows SET status = 'processed', processed_at = timezone('utc'::text, now()) WHERE id = v_row.id;
        v_processed_count := v_processed_count + 1;

        EXIT retry_loop;

      EXCEPTION
        WHEN serialization_failure OR deadlock_detected THEN
          v_retry_count := v_retry_count + 1;

          IF v_retry_count >= v_max_retries THEN
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_error', 'Error processing contact row',
              jsonb_build_object('row_id', v_row.id, 'error', SQLERRM, 'retries_exhausted', v_retry_count));

            UPDATE public.import_rows
            SET status = 'failed', error_message = 'Deadlock after ' || v_retry_count || ' retries: ' || SQLERRM
            WHERE id = v_row.id;

            EXIT retry_loop;
          ELSE
            v_retry_delay := 10 * (5 ^ (v_retry_count - 1));

            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_retry', 'Retrying contact row after deadlock',
              jsonb_build_object('row_id', v_row.id, 'retry_count', v_retry_count, 'delay_ms', v_retry_delay));

            PERFORM pg_sleep(v_retry_delay::FLOAT / 1000.0);

            CONTINUE retry_loop;
          END IF;

        WHEN OTHERS THEN
          INSERT INTO public.debug_events (batch_id, event_type, message, details)
          VALUES (p_batch_id, 'row_error', 'Error processing contact row',
            jsonb_build_object('row_id', v_row.id, 'error', SQLERRM));

          UPDATE public.import_rows
          SET status = 'failed', error_message = SQLERRM
          WHERE id = v_row.id;

          EXIT retry_loop;
      END;
    END LOOP;
  END LOOP;

  RETURN v_processed_count;
END;
$function$;
