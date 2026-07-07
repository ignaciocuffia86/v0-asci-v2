-- ============================================================================
-- 166_etl_keyword_staging.sql
-- Segunda iteración del ETL de keywords: resolver el timeout en keywords
-- MUY frecuentes/genéricas ("Excel", "Pagos", "Presupuesto", ...).
--
-- Problema (medido con EXPLAIN ANALYZE en PROD):
--   Para keywords frecuentes el índice trigram devuelve decenas de miles de
--   candidatos (+ falsos positivos como "excelente" para "Excel"). El
--   Bitmap Heap Scan debe traer ~40k bloques (~300 MB) y re-evaluar el regex
--   fila por fila (~27s). Además, el keyset por match (WHERE patrón ORDER BY id
--   LIMIT n) re-escanea TODO el conjunto de matches en CADA batch, así que el
--   costo pesado se paga en cada corrida, no solo la primera.
--
-- Solución: separar MATCH (1 sola pasada pesada por keyword -> tabla staging)
-- de INSERT (paginación keyset sobre staging, tocando solo filas ya matcheadas
-- por PK -> rápido). Semántica de match y output en signals: idénticos.
--
-- Fases add_keyword: match_contacts -> insert_contacts -> match_jobs
--                    -> insert_jobs -> done (+ limpieza de staging).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabla staging de matches por job. Solo IDs; se limpia al completar.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dictionary_job_matches (
  job_id      uuid NOT NULL,
  entity_type text NOT NULL,   -- 'contact' | 'job_posting'
  entity_id   uuid NOT NULL,
  PRIMARY KEY (job_id, entity_type, entity_id)
);

-- ----------------------------------------------------------------------------
-- 2. Driver reescrito: un PASO por llamada (acotado), staging-based.
--    statement_timeout amplio para permitir la pasada de match pesada;
--    los pasos de insert son rápidos igual.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_dictionary_job(
  p_job_id uuid,
  p_batch_size integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '40s'  -- permite el scan de match pesado; < abort del cron (50s) y del maxDuration (60s)
AS $function$
DECLARE
  v_job RECORD;
  v_result JSONB;
  v_pattern text;
  v_ids uuid[];
  v_new_cursor uuid;
  v_window_count integer;
  v_matched integer;
  v_signals_created integer := 0;
  v_inserted integer;
  v_has_more boolean := false;
  v_six_months_ago timestamptz := NOW() - INTERVAL '6 months';
BEGIN
  -- Guardia de concurrencia por job: si otro proceso ya lo trabaja, salir.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_job_id::text, 0)) THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'locked');
  END IF;

  SELECT * INTO v_job FROM public.dictionary_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job not found');
  END IF;

  IF v_job.status = 'pending' THEN
    UPDATE public.dictionary_jobs
    SET status = 'processing', started_at = NOW()
    WHERE id = p_job_id;
    SELECT * INTO v_job FROM public.dictionary_jobs WHERE id = p_job_id;
  END IF;

  -- ------------------------------------------------------------------------
  -- remove_keyword: borrado por signal_id (indexado), una pasada.
  -- ------------------------------------------------------------------------
  IF v_job.job_type = 'remove_keyword' THEN
    v_result := public.process_remove_keyword(v_job.signal_id, v_job.keyword);
    UPDATE public.dictionary_jobs
    SET status = 'completed', completed_at = NOW(), progress = 100,
        processed_records = (v_result->>'deleted_count')::INTEGER,
        total_records = (v_result->>'deleted_count')::INTEGER,
        phase = 'done'
    WHERE id = p_job_id;
    RETURN v_result;
  END IF;

  IF v_job.job_type <> 'add_keyword' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown job type');
  END IF;

  v_pattern := '\y' || public.escape_regex(v_job.keyword) || '\y';

  -- ========================================================================
  -- FASE match_contacts: UNA sola pasada pesada -> staging de contact_ids.
  -- ========================================================================
  IF v_job.phase IS NULL OR v_job.phase = 'contacts' OR v_job.phase = 'match_contacts' THEN
    -- Reinicio idempotente del staging de contactos para este job.
    DELETE FROM public.dictionary_job_matches
    WHERE job_id = p_job_id AND entity_type = 'contact';

    INSERT INTO public.dictionary_job_matches (job_id, entity_type, entity_id)
    SELECT p_job_id, 'contact', c.id
    FROM public.contacts c
    WHERE (
      c.current_position_title       ~* v_pattern OR
      c.headline                      ~* v_pattern OR
      c.about                         ~* v_pattern OR
      c.current_position_description   ~* v_pattern OR
      public.contacts_prevpos_text(c.previous_positions) ~* v_pattern
    )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_matched = ROW_COUNT;

    UPDATE public.dictionary_jobs
    SET phase = 'insert_contacts',
        contacts_cursor = NULL,
        total_records = v_matched,
        progress = LEAST(30, progress)
    WHERE id = p_job_id;

    RETURN jsonb_build_object(
      'success', true, 'phase', 'insert_contacts',
      'processed', 0, 'signals_created', 0, 'matched', v_matched, 'has_more', true
    );
  END IF;

  -- ========================================================================
  -- FASE insert_contacts: paginar staging por PK y generar señales.
  -- Solo toca contactos ya matcheados (acceso por PK -> rápido).
  -- ========================================================================
  IF v_job.phase = 'insert_contacts' THEN
    SELECT array_agg(entity_id ORDER BY entity_id)
    INTO v_ids
    FROM (
      SELECT m.entity_id
      FROM public.dictionary_job_matches m
      WHERE m.job_id = p_job_id AND m.entity_type = 'contact'
        AND (v_job.contacts_cursor IS NULL OR m.entity_id > v_job.contacts_cursor)
      ORDER BY m.entity_id
      LIMIT p_batch_size
    ) s;

    v_window_count := COALESCE(array_length(v_ids, 1), 0);

    IF v_window_count = 0 THEN
      UPDATE public.dictionary_jobs SET phase = 'match_jobs' WHERE id = p_job_id;
      RETURN jsonb_build_object(
        'success', true, 'phase', 'match_jobs',
        'processed', 0, 'signals_created', 0, 'has_more', true
      );
    END IF;

    v_new_cursor := v_ids[v_window_count];

    -- (a) POSICIÓN ACTUAL
    WITH ins AS (
      INSERT INTO public.signals (
        contact_id, company_id, signal_type, signal_id, keyword_matched,
        source_field, is_current_employee, snippet
      )
      SELECT
        c.id, c.current_company_id, v_job.signal_type, v_job.signal_id, v_job.keyword,
        CASE
          WHEN COALESCE(c.current_position_title, '')     ~* v_pattern THEN 'current_position'
          WHEN COALESCE(c.headline, '')                    ~* v_pattern THEN 'headline'
          WHEN COALESCE(c.about, '')                        ~* v_pattern THEN 'about'
          ELSE 'current_position_description'
        END,
        TRUE,
        public.extract_snippet(
          COALESCE(c.current_position_title, '') || ' ' ||
          COALESCE(c.headline, '') || ' ' ||
          COALESCE(c.about, '') || ' ' ||
          COALESCE(c.current_position_description, ''),
          v_job.keyword, 100
        )
      FROM public.contacts c
      WHERE c.id = ANY(v_ids)
        AND c.current_company_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.companies co WHERE co.id = c.current_company_id)
        AND (
          c.current_position_title     ~* v_pattern OR
          c.headline                    ~* v_pattern OR
          c.about                        ~* v_pattern OR
          c.current_position_description ~* v_pattern
        )
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;
    v_signals_created := v_signals_created + v_inserted;

    -- (b) POSICIONES PREVIAS
    WITH ins AS (
      INSERT INTO public.signals (
        contact_id, company_id, signal_type, signal_id, keyword_matched,
        source_field, is_current_employee, snippet
      )
      SELECT
        c.id, (pos->>'company_id')::uuid, v_job.signal_type, v_job.signal_id, v_job.keyword,
        'previous_position', FALSE,
        public.extract_snippet(
          COALESCE(pos->>'title', '') || ' ' || COALESCE(pos->>'description', ''),
          v_job.keyword, 100
        )
      FROM public.contacts c
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.previous_positions) = 'array'
             THEN c.previous_positions ELSE '[]'::jsonb END
      ) AS pos
      WHERE c.id = ANY(v_ids)
        AND (pos->>'company_id') IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.companies co WHERE co.id = (pos->>'company_id')::uuid)
        AND (COALESCE(pos->>'title', '') || ' ' || COALESCE(pos->>'description', '')) ~* v_pattern
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;
    v_signals_created := v_signals_created + v_inserted;

    v_has_more := (v_window_count = p_batch_size);

    UPDATE public.dictionary_jobs
    SET contacts_processed = COALESCE(contacts_processed, 0) + v_window_count,
        contacts_cursor = v_new_cursor,
        processed_records = COALESCE(contacts_processed, 0) + v_window_count,
        progress = CASE WHEN v_has_more THEN LEAST(59, GREATEST(progress, 40)) ELSE 60 END,
        phase = CASE WHEN v_has_more THEN 'insert_contacts' ELSE 'match_jobs' END
    WHERE id = p_job_id;

    RETURN jsonb_build_object(
      'success', true,
      'phase', CASE WHEN v_has_more THEN 'insert_contacts' ELSE 'match_jobs' END,
      'processed', v_window_count, 'signals_created', v_signals_created, 'has_more', true
    );
  END IF;

  -- ========================================================================
  -- FASE match_jobs: UNA sola pasada -> staging de job_posting_ids.
  -- ========================================================================
  IF v_job.phase = 'match_jobs' OR v_job.phase = 'job_postings' THEN
    DELETE FROM public.dictionary_job_matches
    WHERE job_id = p_job_id AND entity_type = 'job_posting';

    INSERT INTO public.dictionary_job_matches (job_id, entity_type, entity_id)
    SELECT p_job_id, 'job_posting', jp.id
    FROM public.job_postings jp
    WHERE jp.posted_at >= v_six_months_ago
      AND (jp.title ~* v_pattern OR jp.description ~* v_pattern)
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_matched = ROW_COUNT;

    UPDATE public.dictionary_jobs
    SET phase = 'insert_jobs', job_postings_cursor = NULL
    WHERE id = p_job_id;

    RETURN jsonb_build_object(
      'success', true, 'phase', 'insert_jobs',
      'processed', 0, 'signals_created', 0, 'matched', v_matched, 'has_more', true
    );
  END IF;

  -- ========================================================================
  -- FASE insert_jobs: paginar staging por PK y generar señales.
  -- ========================================================================
  IF v_job.phase = 'insert_jobs' THEN
    SELECT array_agg(entity_id ORDER BY entity_id)
    INTO v_ids
    FROM (
      SELECT m.entity_id
      FROM public.dictionary_job_matches m
      WHERE m.job_id = p_job_id AND m.entity_type = 'job_posting'
        AND (v_job.job_postings_cursor IS NULL OR m.entity_id > v_job.job_postings_cursor)
      ORDER BY m.entity_id
      LIMIT p_batch_size
    ) s;

    v_window_count := COALESCE(array_length(v_ids, 1), 0);

    IF v_window_count = 0 THEN
      -- Terminado: limpiar staging del job y marcar completado.
      DELETE FROM public.dictionary_job_matches WHERE job_id = p_job_id;
      UPDATE public.dictionary_jobs
      SET status = 'completed', completed_at = NOW(), progress = 100, phase = 'done',
          processed_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0),
          total_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0)
      WHERE id = p_job_id;
      RETURN jsonb_build_object(
        'success', true, 'phase', 'done',
        'processed', 0, 'signals_created', 0, 'has_more', false
      );
    END IF;

    v_new_cursor := v_ids[v_window_count];

    WITH ins AS (
      INSERT INTO public.signals (
        job_posting_id, company_id, signal_type, signal_id, keyword_matched,
        source_field, job_posted_at, snippet
      )
      SELECT
        jp.id, jp.company_id, v_job.signal_type, v_job.signal_id, v_job.keyword,
        CASE WHEN COALESCE(jp.title, '') ~* v_pattern THEN 'job_title' ELSE 'job_description' END,
        jp.posted_at,
        public.extract_snippet(COALESCE(jp.title, '') || ' ' || COALESCE(jp.description, ''), v_job.keyword, 100)
      FROM public.job_postings jp
      JOIN public.companies c ON c.id = jp.company_id
      WHERE jp.id = ANY(v_ids)
        AND (jp.title ~* v_pattern OR jp.description ~* v_pattern)
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_signals_created FROM ins;

    v_has_more := (v_window_count = p_batch_size);

    UPDATE public.dictionary_jobs
    SET job_postings_processed = COALESCE(job_postings_processed, 0) + v_window_count,
        job_postings_cursor = v_new_cursor,
        processed_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0) + v_window_count,
        progress = LEAST(99, GREATEST(progress, 70))
    WHERE id = p_job_id;

    IF NOT v_has_more THEN
      DELETE FROM public.dictionary_job_matches WHERE job_id = p_job_id;
      UPDATE public.dictionary_jobs
      SET status = 'completed', completed_at = NOW(), progress = 100, phase = 'done',
          processed_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0),
          total_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0)
      WHERE id = p_job_id;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'phase', CASE WHEN v_has_more THEN 'insert_jobs' ELSE 'done' END,
      'processed', v_window_count, 'signals_created', v_signals_created,
      'has_more', v_has_more
    );
  END IF;

  -- Fase desconocida: no hacer nada, marcar para re-inspección.
  RETURN jsonb_build_object('success', true, 'phase', v_job.phase, 'processed', 0, 'has_more', false);
END;
$function$;
