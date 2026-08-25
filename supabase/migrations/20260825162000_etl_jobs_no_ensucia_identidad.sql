-- ============================================================================
-- Fase 0.2 — El ETL de vacantes deja de ensuciar la identidad de la empresa
--
-- Problema (docs/analisis-inputs-companias-contactos-senales.md §4.3): al
-- armar la llamada a upsert_company, process_job_batch_internal usaba dos
-- fallbacks que escribían basura en columnas de identidad cuando estaban
-- vacías:
--
--   p_website ← row_data->>'companyUrl'   → la URL de LinkedIn de la empresa
--     terminaba en companies.website. Además de ser un dato falso, FABRICA
--     "identidad externa": el paso ③ de upsert_company (match por núcleo)
--     usa website para decidir cuál fila del núcleo es la empresa real, así
--     que una URL de LinkedIn en website puede legitimar merges hacia la
--     fila equivocada.
--
--   p_country ← row_data->>'location'     → la ubicación del AVISO ("Buenos
--     Aires, , Argentina") terminaba como país de la EMPRESA. En el camino
--     CSV, que no emite clave 'country', el país salía siempre del aviso.
--
-- En el camino Apify no se pierde nada: la ingesta ya inyecta la identidad
-- canónica de la cuenta destino ('website' y 'country' desde la propia fila
-- de companies, lib/v3/services/apify-job-ingest.ts) y esas claves se siguen
-- leyendo. Solo desaparecen los fallbacks hacia datos que no son de la
-- empresa. Si no hay dato confiable, la columna queda NULL y la completa el
-- enrichment (LinkedIn/Apollo), que es la fuente correcta.
--
-- El resto de la función es copia literal de producción (2026-08-25).
-- ============================================================================

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
  -- Cuándo se subió el lote: es la referencia de las fechas relativas.
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
          -- [Fase 0] website: solo el dato real de la empresa. Sin fallback a
          -- companyUrl (URL de LinkedIn ≠ website, y fabricaba identidad externa).
          (v_row.row_data->>'website')::TEXT,
          (v_row.row_data->>'sector')::TEXT,
          -- [Fase 0] country: solo el país de la empresa. Sin fallback a
          -- location (la ubicación del aviso no es el país de la empresa).
          (v_row.row_data->>'country')::TEXT,
          (v_row.row_data->>'logo_url')::TEXT,
          (v_row.row_data->>'company_description')::TEXT
        );

        INSERT INTO public.job_postings (
          company_id, title, description, job_url, location,
          salary_range, posted_at, source_data
        ) VALUES (
          v_company_id,
          COALESCE((v_row.row_data->>'title')::TEXT, (v_row.row_data->>'job_title')::TEXT, 'Sin título'),
          COALESCE((v_row.row_data->>'description')::TEXT, (v_row.row_data->>'job_description')::TEXT, (v_row.row_data->>'html_job_description')::TEXT, ''),
          -- `posting_url` es la clave que arma el upload de CSV; sin ella el
          -- job_url quedaba NULL y el ON CONFLICT no deduplicaba.
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
