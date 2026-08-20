-- ═══════════════════════════════════════════════════════════
-- Fase 7 (radiografía self-service): fechas de puesto en contactos.
--
-- El export crudo de perfiles (SalesQL) trae la fecha de ingreso al puesto
-- actual y las fechas de cada posición previa, y la ruta de upload YA las
-- guarda en import_rows.row_data (current_position_started_at,
-- previous_position_N_started_at/_ended_at) — pero process_contact_batch_internal
-- nunca las leía, así que se perdían al materializar public.contacts.
--
-- Esta migración:
--  1. Agrega contacts.current_position_started_on (date) + índice por empresa.
--  2. parse_position_date(): las fechas vienen como 'YYYY-MM' (a veces
--     'YYYY-MM-DD' o 'YYYY'); se normalizan a date o NULL, nunca error.
--  3. Redefine process_contact_batch_internal para capturar la fecha del
--     puesto actual y sumar started_on/ended_on a cada objeto de
--     previous_positions.
--
-- El backfill del histórico se hace aparte, desde las import_rows retenidas
-- (la limpieza purga las procesadas viejas; lo que falte se recupera
-- re-subiendo los exports crudos: el upsert por linkedin_url pisa y completa).
-- ═══════════════════════════════════════════════════════════

alter table public.contacts
  add column if not exists current_position_started_on date;

-- Para "movimientos de la cuenta en la ventana": filtra por empresa + fecha.
create index if not exists idx_contacts_company_position_started
  on public.contacts (current_company_id, current_position_started_on desc)
  where current_position_started_on is not null;

create or replace function public.parse_position_date(p_raw text)
returns date
language plpgsql
immutable
as $$
declare
  v text := nullif(trim(p_raw), '');
begin
  if v is null then
    return null;
  end if;
  if v ~ '^\d{4}-\d{2}-\d{2}' then
    return substring(v, 1, 10)::date;
  end if;
  if v ~ '^\d{4}-\d{2}$' then
    return (v || '-01')::date;
  end if;
  if v ~ '^\d{4}$' then
    return (v || '-01-01')::date;
  end if;
  return null;
exception when others then
  -- Meses fuera de rango u otra basura: mejor NULL que frenar el batch.
  return null;
end;
$$;

-- Redefinición completa (baseline:5106) — cambios marcados con [fase-7].
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
        -- Process current company
        v_current_company_id := public.upsert_company(
          (v_row.row_data->>'company_name')::TEXT,
          (v_row.row_data->>'company_linkedin_url')::TEXT,
          (v_row.row_data->>'company_website')::TEXT,
          (v_row.row_data->>'company_industry')::TEXT,
          (v_row.row_data->>'company_country')::TEXT,
          (v_row.row_data->>'company_logo_url')::TEXT,
          (v_row.row_data->>'company_description')::TEXT
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

            -- [fase-7] started_on/ended_on normalizadas; jsonb_strip_nulls
            -- evita claves basura cuando el export no trae la fecha.
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

        -- Upsert contact
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
          COALESCE((v_row.row_data->>'linkedin_url')::TEXT, 'placeholder:' || gen_random_uuid()::TEXT),
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
          -- [fase-7] COALESCE: un re-export sin fecha no borra la que ya aprendimos.
          current_position_started_on = COALESCE(EXCLUDED.current_position_started_on, public.contacts.current_position_started_on),
          previous_positions = EXCLUDED.previous_positions, country = EXCLUDED.country, profile_picture_url = EXCLUDED.profile_picture_url,
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
