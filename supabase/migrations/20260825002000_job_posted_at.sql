-- ═══════════════════════════════════════════════════════════════════
-- La fecha de publicación de las vacantes cargadas por CSV
--
-- El bug
-- ------
-- `process_job_batch_internal` fecha así:
--
--   COALESCE(row_data->>'postedTime', row_data->>'publishedAt',
--            row_data->>'post_date', now())
--
-- pero los dos caminos de upload de CSV (app/api/ingest/upload/route.ts y
-- app/actions/ingest.ts) arman el row_data con la clave `posted_at`:
--
--   posted_at: row.postedTime || row.post_date || row.publishedAt
--
-- Las tres claves que el RPC busca NUNCA existen en una fila de CSV, así que
-- siempre cae al `now()` del final. Medido antes de este arreglo: 25.056 de
-- 43.052 vacantes (58%) tienen `posted_at` igual a su fecha de carga.
--
-- El comentario de lib/v3/services/apify-posted-dates.ts da por sentado que
-- "la ingesta CSV histórica siempre trajo fechas absolutas". Ese supuesto es el
-- que falla: no importa qué traiga el CSV, la clave se renombra antes.
--
-- Qué rompe: el badge "Reciente" (< 1 mes), la sección "Ahora Buscando" y el
-- filtro de seis meses de get_company_drawer_data. Una vacante de hace medio
-- año se muestra como recién publicada.
--
-- El arreglo
-- ----------
--   1. Leer `posted_at`, que es la clave que de verdad llega.
--   2. Parsear las fechas relativas. El scraper de LinkedIn devuelve
--      "2 weeks ago", y si corrió con otro locale, "il y a 3 jours".
--   3. Resolverlas contra CUÁNDO SE SUBIÓ EL LOTE, no contra now(). "1 day
--      ago" en un CSV scrapeado en mayo significa mayo, aunque el lote se
--      procese en agosto.
--   4. Si no se puede saber la fecha, dejar NULL. Es la parte incómoda y es
--      deliberada: `now()` no era un default neutro, era afirmar que la vacante
--      se publicó hoy. Un NULL queda fuera del filtro de seis meses del drawer,
--      que es el comportamiento honesto para una vacante sin fecha.
--
-- Esta migración es solo hacia adelante. Las 25.056 filas ya mal fechadas no se
-- tocan: para muchas la fecha real se puede recuperar de `source_data`, pero es
-- un trabajo aparte y con su propio criterio.
-- ═══════════════════════════════════════════════════════════════════

-- Fecha de publicación a partir de lo que haya traído el scraper.
--
-- Devuelve NULL ante cualquier cosa que no sea una fecha reconocible. Eso
-- incluye la basura que aparece cuando el CSV viene con las columnas corridas:
-- en un lote real, `posted_at` traía "Région métropolitaine de Buenos Aires".
create or replace function public.parse_job_posted_at(
  p_raw text,
  p_reference timestamptz default now()
)
returns timestamptz
language plpgsql
stable
as $function$
DECLARE
  v_texto TEXT;
  v_num   INTEGER;
  v_ref   TIMESTAMPTZ := coalesce(p_reference, now());
  v_ts    TIMESTAMPTZ;
BEGIN
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN RETURN NULL; END IF;

  v_texto := lower(btrim(translate(p_raw,
    'áàâäãéèêëíìîïóòôöõúùûüñç', 'aaaaaeeeeiiiiooooouuuunc')));

  -- ── Relativas con número ──
  -- "3 days ago" | "il y a 3 jours" | "hace 3 dias" | "3 dias atras"
  IF v_texto ~ '(ago|il y a|hace|atras)' THEN
    v_num := nullif((regexp_match(v_texto, '(\d+)'))[1], '')::integer;

    IF v_num IS NOT NULL THEN
      -- El orden importa: se prueba de la unidad más chica a la más grande y
      -- con patrones que no se pisen entre idiomas.
      IF    v_texto ~ '(minut|\mmin\M)'                    THEN RETURN v_ref - make_interval(mins  => v_num);
      ELSIF v_texto ~ '(hour|hora|heure)'                  THEN RETURN v_ref - make_interval(hours => v_num);
      ELSIF v_texto ~ '(day|dia|jour)'                     THEN RETURN v_ref - make_interval(days  => v_num);
      ELSIF v_texto ~ '(week|semana|semaine)'              THEN RETURN v_ref - make_interval(weeks => v_num);
      ELSIF v_texto ~ '(month|mes|mois)'                   THEN RETURN v_ref - make_interval(months => v_num);
      ELSIF v_texto ~ '(year|annee|\mano\M|\manos\M|\man\M|\mans\M)'
                                                           THEN RETURN v_ref - make_interval(years => v_num);
      END IF;
    END IF;
  END IF;

  -- ── Relativas sin número ──
  -- Van ANTES del casteo: Postgres entiende 'yesterday'::timestamptz, pero lo
  -- resuelve contra hoy y no contra la fecha del scrapeo.
  IF v_texto ~ '^(yesterday|hier|ayer)$'                      THEN RETURN v_ref - make_interval(days => 1); END IF;
  IF v_texto ~ '^(today|hoy|aujourd''hui|just now|maintenant|ahora)$' THEN RETURN v_ref; END IF;

  -- ── Absolutas ──
  BEGIN
    v_ts := p_raw::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  -- Guarda de sanidad. Un CSV con las columnas corridas puede meter en esta
  -- columna un texto que Postgres castea igual; una vacante publicada en 1998 o
  -- dentro de dos meses es un error de parseo, no un dato.
  IF v_ts < timestamptz '2000-01-01' OR v_ts > v_ref + interval '30 days' THEN
    RETURN NULL;
  END IF;

  RETURN v_ts;
END;
$function$;

comment on function public.parse_job_posted_at(text, timestamptz) is
  'Fecha de publicación de una vacante. Entiende absolutas y relativas (en, es, fr) y las resuelve contra la fecha de referencia del scrapeo. NULL si no es una fecha.';

-- ───────────────────────────────────────────────────────────────────
-- El ETL de vacantes usa el parser
--
-- Base: la definición viva en producción, idéntica al baseline
-- (md5 del cuerpo 0f59d2f9d1de9d87f5b6426cbb6afd3e). Los únicos cambios son
-- la referencia temporal del lote, la expresión de `posted_at` y que el
-- ON CONFLICT ahora puede completar una fecha que faltaba.
-- ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_job_batch_internal(p_batch_id uuid, p_limit integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_row RECORD;
  v_processed_count INTEGER := 0;
  v_retry_count INTEGER := 0;
  v_max_retries INTEGER := 3;
  v_retry_delay INTEGER;
  v_company_id UUID;
  v_job_id UUID;
  v_scrape_ref TIMESTAMPTZ;
BEGIN
  -- Cuándo se subió el lote. Es la referencia para las fechas relativas: un
  -- "2 weeks ago" de un CSV de mayo son dos semanas antes de mayo, no de hoy.
  SELECT created_at INTO v_scrape_ref FROM public.import_batches WHERE id = p_batch_id;
  v_scrape_ref := coalesce(v_scrape_ref, now());

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
        v_company_id := public.upsert_company(
          COALESCE((v_row.row_data->>'company_name')::TEXT, (v_row.row_data->>'companyName')::TEXT, 'Unknown Company'),
          COALESCE((v_row.row_data->>'company_linkedin_url')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
          COALESCE((v_row.row_data->>'website')::TEXT, (v_row.row_data->>'companyUrl')::TEXT),
          (v_row.row_data->>'sector')::TEXT,
          COALESCE((v_row.row_data->>'country')::TEXT, (v_row.row_data->>'location')::TEXT),
          (v_row.row_data->>'logo_url')::TEXT,
          (v_row.row_data->>'company_description')::TEXT
        );

        -- job_url: unified single URL from any scraper field variant
        INSERT INTO public.job_postings (
          company_id, title, description, job_url, location,
          salary_range, posted_at, source_data
        ) VALUES (
          v_company_id,
          COALESCE((v_row.row_data->>'title')::TEXT, (v_row.row_data->>'job_title')::TEXT, 'Sin título'),
          COALESCE((v_row.row_data->>'description')::TEXT, (v_row.row_data->>'job_description')::TEXT, (v_row.row_data->>'html_job_description')::TEXT, ''),
          -- Mismo desajuste que `posted_at`, en la columna de al lado: el upload
          -- arma `posting_url` (de jobUrl/url/uniq_id) y el COALESCE original
          -- no la contemplaba. Sin job_url el ON CONFLICT no deduplica —NULL no
          -- colisiona con nada— así que la vacante se podía duplicar en cada
          -- carga. Impacto histórico chico (60 de 43.052 filas) porque la
          -- mayoría de los CSV traen además applyUrl.
          COALESCE(
            (v_row.row_data->>'job_url')::TEXT,
            (v_row.row_data->>'posting_url')::TEXT,
            (v_row.row_data->>'applyUrl')::TEXT,
            (v_row.row_data->>'apply_url')::TEXT,
            (v_row.row_data->>'apply_link')::TEXT,
            (v_row.row_data->>'jobUrl')::TEXT,
            (v_row.row_data->>'url')::TEXT,
            (v_row.row_data->>'uniq_id')::TEXT
          ),
          COALESCE((v_row.row_data->>'location')::TEXT, (v_row.row_data->>'city')::TEXT || ', ' || (v_row.row_data->>'country')::TEXT),
          COALESCE((v_row.row_data->>'salary')::TEXT, (v_row.row_data->>'salary_offered')::TEXT),
          -- `posted_at` primero: es la clave que arma el upload de CSV. Las
          -- otras tres las sigue mandando el adaptador de Apify.
          COALESCE(
            public.parse_job_posted_at(v_row.row_data->>'posted_at',   v_scrape_ref),
            public.parse_job_posted_at(v_row.row_data->>'postedTime',  v_scrape_ref),
            public.parse_job_posted_at(v_row.row_data->>'publishedAt', v_scrape_ref),
            public.parse_job_posted_at(v_row.row_data->>'post_date',   v_scrape_ref)
          ),
          v_row.row_data
        )
        ON CONFLICT (job_url) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          -- Completa la fecha si la fila vieja no tenía; nunca la borra con un
          -- NULL de un scrapeo peor.
          posted_at = COALESCE(EXCLUDED.posted_at, job_postings.posted_at),
          updated_at = now()
        WHERE job_postings.job_url IS NOT NULL
        RETURNING id INTO v_job_id;

        PERFORM public.process_job_signals(v_job_id);

        UPDATE public.import_rows
        SET status = 'processed', processed_at = timezone('utc'::text, now())
        WHERE id = v_row.id;

        v_processed_count := v_processed_count + 1;
        EXIT retry_loop;

      EXCEPTION
        WHEN serialization_failure OR deadlock_detected THEN
          v_retry_count := v_retry_count + 1;
          IF v_retry_count >= v_max_retries THEN
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_error', 'Error processing job row',
              jsonb_build_object('row_id', v_row.id, 'error', SQLERRM, 'retries_exhausted', v_retry_count));
            UPDATE public.import_rows SET status = 'failed', error_message = 'Deadlock after ' || v_retry_count || ' retries: ' || SQLERRM WHERE id = v_row.id;
            EXIT retry_loop;
          ELSE
            v_retry_delay := 10 * (5 ^ (v_retry_count - 1));
            INSERT INTO public.debug_events (batch_id, event_type, message, details)
            VALUES (p_batch_id, 'row_retry', 'Retrying job row after deadlock',
              jsonb_build_object('row_id', v_row.id, 'retry_count', v_retry_count, 'delay_ms', v_retry_delay));
            PERFORM pg_sleep(v_retry_delay::FLOAT / 1000.0);
            CONTINUE retry_loop;
          END IF;

        WHEN OTHERS THEN
          INSERT INTO public.debug_events (batch_id, event_type, message, details)
          VALUES (p_batch_id, 'row_error', 'Error processing job row',
            jsonb_build_object('row_id', v_row.id, 'error', SQLERRM));
          UPDATE public.import_rows SET status = 'failed', error_message = SQLERRM WHERE id = v_row.id;
          EXIT retry_loop;
      END;
    END LOOP;
  END LOOP;

  RETURN v_processed_count;
END;
$function$;
