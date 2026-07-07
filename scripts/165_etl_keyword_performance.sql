-- ============================================================================
-- 165_etl_keyword_performance.sql
-- Optimización del ETL de keywords del diccionario (v2, schema public).
--
-- Objetivo: eliminar los TimeoutError y lock timeout al agregar/quitar keywords,
-- y frenar el crecimiento cuadrático de CPU/IO, SIN cambiar el output
-- (mismas filas en public.signals, misma semántica de match e idempotencia).
--
-- Cambios:
--   1. Índices trigram GIN (pg_trgm) para acelerar el match ~* de keywords.
--   2. Helper IMMUTABLE para indexar el texto de previous_positions (JSONB).
--   3. Columnas cursor en dictionary_jobs para paginación keyset.
--   4. Workers reescritos: set-based + filter-first + keyset (sin OFFSET, sin RBAR).
--   5. Driver con guardia de concurrencia (advisory lock) y tracking de cursor.
--
-- Semántica preservada:
--   - Patrón de match: '\y' || escape_regex(keyword) || '\y' con ~* (case-insensitive,
--     límites de palabra), idéntico al anterior.
--   - Columnas insertadas en signals y source_field: idénticos.
--   - Validación de company existente: idéntica.
--   - job_postings: solo posted_at >= NOW() - 6 months, idéntico.
--   - ON CONFLICT DO NOTHING sobre los índices únicos existentes: idéntico.
--
-- NOTA: los CREATE INDEX CONCURRENTLY NO pueden correr dentro de una transacción.
-- Ejecutar cada uno como statement independiente (o vía MCP, uno por uno).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ----------------------------------------------------------------------------
-- 2. Helper IMMUTABLE: aplana title+description de previous_positions a texto.
--    Separador ' | ' para que \y (límite de palabra) no cruce entre posiciones.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contacts_prevpos_text(prev jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    string_agg(
      COALESCE(e->>'title','') || ' ' || COALESCE(e->>'description',''),
      ' | ' ORDER BY ord
    ),
    ''
  )
  FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(prev) = 'array' THEN prev ELSE '[]'::jsonb END
       ) WITH ORDINALITY AS t(e, ord)
$$;

-- ----------------------------------------------------------------------------
-- 3. Índices trigram GIN. Aceleran el operador ~* (regex) via gin_trgm_ops.
--    Ejecutar CONCURRENTLY para no bloquear la tabla en producción.
-- ----------------------------------------------------------------------------
-- contacts (posición actual)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_curtitle_trgm
  ON public.contacts USING gin (current_position_title gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_headline_trgm
  ON public.contacts USING gin (headline gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_about_trgm
  ON public.contacts USING gin (about gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_curdesc_trgm
  ON public.contacts USING gin (current_position_description gin_trgm_ops);
-- contacts (posiciones previas, via helper inmutable)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_prevpos_trgm
  ON public.contacts USING gin (public.contacts_prevpos_text(previous_positions) gin_trgm_ops);
-- job_postings
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_postings_title_trgm
  ON public.job_postings USING gin (title gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_postings_desc_trgm
  ON public.job_postings USING gin (description gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 4. Cursores keyset en dictionary_jobs (paginación estable por id UUID).
-- ----------------------------------------------------------------------------
ALTER TABLE public.dictionary_jobs
  ADD COLUMN IF NOT EXISTS contacts_cursor uuid,
  ADD COLUMN IF NOT EXISTS job_postings_cursor uuid;

-- ----------------------------------------------------------------------------
-- 5. Worker contacts: set-based + filter-first + keyset.
--    Ventana de contactos que MATCHEAN (posición actual o previa), acotada por
--    LIMIT batch y avanzando por id. Solo toca filas que matchean (via índice).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.process_add_keyword_contacts(uuid, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.process_add_keyword_contacts(
  p_signal_id uuid,
  p_signal_type text,
  p_keyword text,
  p_batch_size integer,
  p_cursor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pattern text;
  v_ids uuid[];
  v_new_cursor uuid;
  v_window_count integer;
  v_signals_created integer := 0;
  v_inserted integer;
BEGIN
  v_pattern := '\y' || public.escape_regex(p_keyword) || '\y';

  -- Ventana keyset: contactos con match (actual o previo) más allá del cursor.
  SELECT array_agg(id ORDER BY id)
  INTO v_ids
  FROM (
    SELECT c.id
    FROM public.contacts c
    WHERE (p_cursor IS NULL OR c.id > p_cursor)
      AND (
        COALESCE(c.current_position_title, '')        ~* v_pattern OR
        COALESCE(c.headline, '')                       ~* v_pattern OR
        COALESCE(c.about, '')                          ~* v_pattern OR
        COALESCE(c.current_position_description, '')    ~* v_pattern OR
        public.contacts_prevpos_text(c.previous_positions) ~* v_pattern
      )
    ORDER BY c.id
    LIMIT p_batch_size
  ) s;

  v_window_count := COALESCE(array_length(v_ids, 1), 0);

  IF v_window_count = 0 THEN
    RETURN jsonb_build_object(
      'success', true, 'processed', 0, 'signals_created', 0,
      'cursor', p_cursor, 'has_more', false
    );
  END IF;

  v_new_cursor := v_ids[v_window_count];

  -- (a) Señales por POSICIÓN ACTUAL (company validada por FK EXISTS).
  WITH ins AS (
    INSERT INTO public.signals (
      contact_id, company_id, signal_type, signal_id, keyword_matched,
      source_field, is_current_employee, snippet
    )
    SELECT
      c.id,
      c.current_company_id,
      p_signal_type,
      p_signal_id,
      p_keyword,
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
        p_keyword, 100
      )
    FROM public.contacts c
    WHERE c.id = ANY(v_ids)
      AND c.current_company_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.companies co WHERE co.id = c.current_company_id)
      AND (
        COALESCE(c.current_position_title, '')     ~* v_pattern OR
        COALESCE(c.headline, '')                    ~* v_pattern OR
        COALESCE(c.about, '')                        ~* v_pattern OR
        COALESCE(c.current_position_description, '') ~* v_pattern
      )
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM ins;
  v_signals_created := v_signals_created + v_inserted;

  -- (b) Señales por POSICIONES PREVIAS (una por elemento que matchea, company validada).
  WITH ins AS (
    INSERT INTO public.signals (
      contact_id, company_id, signal_type, signal_id, keyword_matched,
      source_field, is_current_employee, snippet
    )
    SELECT
      c.id,
      (pos->>'company_id')::uuid,
      p_signal_type,
      p_signal_id,
      p_keyword,
      'previous_position',
      FALSE,
      public.extract_snippet(
        COALESCE(pos->>'title', '') || ' ' || COALESCE(pos->>'description', ''),
        p_keyword, 100
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

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_window_count,
    'signals_created', v_signals_created,
    'cursor', v_new_cursor,
    'has_more', (v_window_count = p_batch_size)
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6. Worker job_postings: set-based + filter-first + keyset.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.process_add_keyword_job_postings(uuid, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.process_add_keyword_job_postings(
  p_signal_id uuid,
  p_signal_type text,
  p_keyword text,
  p_batch_size integer,
  p_cursor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pattern text;
  v_six_months_ago timestamptz := NOW() - INTERVAL '6 months';
  v_ids uuid[];
  v_new_cursor uuid;
  v_window_count integer;
  v_signals_created integer := 0;
BEGIN
  v_pattern := '\y' || public.escape_regex(p_keyword) || '\y';

  -- Ventana keyset: job_postings con match dentro de los últimos 6 meses.
  SELECT array_agg(id ORDER BY id)
  INTO v_ids
  FROM (
    SELECT jp.id
    FROM public.job_postings jp
    WHERE (p_cursor IS NULL OR jp.id > p_cursor)
      AND jp.posted_at >= v_six_months_ago
      AND (
        COALESCE(jp.title, '')       ~* v_pattern OR
        COALESCE(jp.description, '')  ~* v_pattern
      )
    ORDER BY jp.id
    LIMIT p_batch_size
  ) s;

  v_window_count := COALESCE(array_length(v_ids, 1), 0);

  IF v_window_count = 0 THEN
    RETURN jsonb_build_object(
      'success', true, 'processed', 0, 'signals_created', 0,
      'cursor', p_cursor, 'has_more', false
    );
  END IF;

  v_new_cursor := v_ids[v_window_count];

  WITH ins AS (
    INSERT INTO public.signals (
      job_posting_id, company_id, signal_type, signal_id, keyword_matched,
      source_field, job_posted_at, snippet
    )
    SELECT
      jp.id,
      jp.company_id,
      p_signal_type,
      p_signal_id,
      p_keyword,
      CASE WHEN COALESCE(jp.title, '') ~* v_pattern THEN 'job_title' ELSE 'job_description' END,
      jp.posted_at,
      public.extract_snippet(COALESCE(jp.title, '') || ' ' || COALESCE(jp.description, ''), p_keyword, 100)
    FROM public.job_postings jp
    JOIN public.companies c ON c.id = jp.company_id
    WHERE jp.id = ANY(v_ids)
      AND (COALESCE(jp.title, '') ~* v_pattern OR COALESCE(jp.description, '') ~* v_pattern)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_signals_created FROM ins;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_window_count,
    'signals_created', v_signals_created,
    'cursor', v_new_cursor,
    'has_more', (v_window_count = p_batch_size)
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 7. Driver: guardia de concurrencia (advisory lock) + tracking de cursor.
--    Mantiene el contrato de fases (contacts -> job_postings -> done) y el
--    shape del JSONB de retorno. Evita que cron + server action procesen el
--    mismo job en paralelo (contención de locks).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_dictionary_job(
  p_job_id uuid,
  p_batch_size integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_job RECORD;
  v_result JSONB;
  v_contacts_result JSONB;
  v_jobs_result JSONB;
  v_total_signals INTEGER := 0;
  v_has_more BOOLEAN := false;
BEGIN
  -- Guardia de concurrencia: si otro proceso ya está trabajando este job, salir.
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

  CASE v_job.job_type
    WHEN 'remove_keyword' THEN
      v_result := public.process_remove_keyword(v_job.signal_id, v_job.keyword);
      UPDATE public.dictionary_jobs
      SET status = 'completed', completed_at = NOW(), progress = 100,
          processed_records = (v_result->>'deleted_count')::INTEGER,
          total_records = (v_result->>'deleted_count')::INTEGER,
          phase = 'done'
      WHERE id = p_job_id;
      RETURN v_result;

    WHEN 'add_keyword' THEN
      -- Fase contactos
      IF v_job.phase = 'contacts' OR v_job.phase IS NULL THEN
        v_contacts_result := public.process_add_keyword_contacts(
          v_job.signal_id, v_job.signal_type, v_job.keyword,
          p_batch_size, v_job.contacts_cursor
        );
        v_total_signals := (v_contacts_result->>'signals_created')::INTEGER;

        UPDATE public.dictionary_jobs
        SET contacts_processed = COALESCE(contacts_processed, 0) + (v_contacts_result->>'processed')::INTEGER,
            contacts_cursor = NULLIF(v_contacts_result->>'cursor', '')::uuid,
            phase = 'contacts'
        WHERE id = p_job_id;

        IF (v_contacts_result->>'has_more')::BOOLEAN THEN
          v_has_more := true;
        ELSE
          UPDATE public.dictionary_jobs SET phase = 'job_postings' WHERE id = p_job_id;
          v_job.phase := 'job_postings';
        END IF;
      END IF;

      -- Fase job_postings (solo si contactos terminó en esta corrida)
      IF v_job.phase = 'job_postings' AND NOT v_has_more THEN
        v_jobs_result := public.process_add_keyword_job_postings(
          v_job.signal_id, v_job.signal_type, v_job.keyword,
          p_batch_size, v_job.job_postings_cursor
        );
        v_total_signals := v_total_signals + (v_jobs_result->>'signals_created')::INTEGER;

        UPDATE public.dictionary_jobs
        SET job_postings_processed = COALESCE(job_postings_processed, 0) + (v_jobs_result->>'processed')::INTEGER,
            job_postings_cursor = NULLIF(v_jobs_result->>'cursor', '')::uuid
        WHERE id = p_job_id;

        v_has_more := (v_jobs_result->>'has_more')::BOOLEAN;

        IF NOT v_has_more THEN
          UPDATE public.dictionary_jobs SET phase = 'done' WHERE id = p_job_id;
        END IF;
      END IF;

      -- Estado / progreso (heurístico: cosmético para la UI)
      IF v_has_more THEN
        UPDATE public.dictionary_jobs
        SET processed_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0),
            progress = LEAST(99, GREATEST(progress, CASE WHEN phase = 'job_postings' THEN 60 ELSE 30 END))
        WHERE id = p_job_id;
      ELSE
        UPDATE public.dictionary_jobs
        SET status = 'completed', completed_at = NOW(), progress = 100,
            processed_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0),
            total_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0)
        WHERE id = p_job_id;
      END IF;

      SELECT * INTO v_job FROM public.dictionary_jobs WHERE id = p_job_id;

      RETURN jsonb_build_object(
        'success', true,
        'phase', v_job.phase,
        'processed', COALESCE(v_job.contacts_processed, 0) + COALESCE(v_job.job_postings_processed, 0),
        'signals_created', v_total_signals,
        'has_more', v_has_more
      );

    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'Unknown job type');
  END CASE;
END;
$function$;
