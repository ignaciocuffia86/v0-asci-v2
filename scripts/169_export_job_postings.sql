-- ============================================================================
-- 169_export_job_postings.sql
-- Export de JOB POSTINGS con filtros por fecha de posteo, pais, industria,
-- ubicacion, titulo, estado y senales del diccionario.
--
-- Decisiones de diseno (relevadas contra los datos reales de produccion):
--
--   1. PAIS: job_postings NO tiene columna de pais. Solo `location` en texto
--      libre (2.221 valores distintos) y muchos no incluyen el pais
--      ("Greater Buenos Aires", "Santiago Metropolitan Area"). Por eso el
--      filtro de pais usa companies.country_normalized (93,1% de cobertura,
--      50 paises ya normalizados) y ademas se expone `location` como filtro
--      de texto libre para ciudad/region.
--
--   2. SENALES: semantica OR (el job matchea si tiene CUALQUIERA de las
--      senales elegidas) y UNA FILA POR JOB. Las senales se agregan en dos
--      columnas ('; ' separadas) para que el CSV sea analizable en Excel sin
--      filas duplicadas. Se listan TODAS las senales del job, no solo las
--      que matchearon, porque da contexto adicional sin costo extra.
--
--   3. DESCRIPTION: opt-in via p_include_description. Las descripciones suman
--      ~105 MB (promedio 3.141 chars, max 25.757); incluirlas por defecto
--      generaria CSVs inmanejables.
--
--   4. salary_range NO se expone: esta 100% vacio (0 de 35.091 filas).
--
--   5. Paginacion estable (p_limit / p_offset + ORDER BY determinista) para
--      que el route handler pueda streamear los 35k jobs sin cargarlos todos
--      en memoria.
--
-- SOLO v2 (schema public). No toca nada de v3.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Indice faltante: posted_at es el filtro principal del export y no tenia
-- indice. La tabla es chica (35k filas) asi que se crea sin CONCURRENTLY.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_job_postings_posted_at
  ON public.job_postings USING btree (posted_at DESC NULLS LAST);

-- Soporta el JOIN a companies cuando NO se filtra por is_active
-- (idx_job_postings_company_active es parcial y no aplica en ese caso).
CREATE INDEX IF NOT EXISTS idx_job_postings_company_id
  ON public.job_postings USING btree (company_id);

-- ============================================================================
-- RPC principal: export_job_postings
-- ============================================================================
CREATE OR REPLACE FUNCTION public.export_job_postings(
  p_signal_type text DEFAULT NULL::text,
  p_signal_names text[] DEFAULT NULL::text[],
  p_countries text[] DEFAULT NULL::text[],
  p_industries text[] DEFAULT NULL::text[],
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_location_query text DEFAULT NULL::text,
  p_title_query text DEFAULT NULL::text,
  p_only_active boolean DEFAULT false,
  p_only_with_signals boolean DEFAULT false,
  p_include_description boolean DEFAULT false,
  p_limit integer DEFAULT 1000,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  job_id uuid,
  title text,
  company_name text,
  country text,
  industry text,
  location text,
  posted_at timestamptz,
  is_active boolean,
  job_url text,
  apply_url text,
  signal_count bigint,
  signals_process text,
  signals_technology text,
  description text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '55s'
AS $function$
DECLARE
  v_signal_ids uuid[];
  v_filter_signals boolean;
BEGIN
  v_filter_signals := p_signal_names IS NOT NULL
                      AND array_length(p_signal_names, 1) > 0;

  -- Resolver nombres del diccionario a signal_ids (tablas chicas: 23 + 77).
  -- Filtrar signals por signal_id usa indice, en vez de joinear el
  -- diccionario contra las ~1,5M filas de signals.
  IF v_filter_signals THEN
    SELECT array_agg(id) INTO v_signal_ids
    FROM (
      SELECT id FROM dictionary_processes
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'process')
      UNION ALL
      SELECT id FROM dictionary_products
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'technology')
    ) d;
    -- Si se pidieron nombres y ninguno existe, no debe matchear nada.
    v_signal_ids := COALESCE(v_signal_ids, '{}'::uuid[]);
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      j.id, j.title, j.location, j.posted_at, j.is_active,
      j.job_url, j.apply_url, j.description,
      c.name AS c_name,
      c.country_normalized AS c_country,
      c.industry AS c_industry
    FROM job_postings j
    LEFT JOIN companies c ON c.id = j.company_id
    WHERE (p_date_from IS NULL OR j.posted_at >= p_date_from::timestamptz)
      -- date_to inclusivo: se compara contra el dia siguiente a las 00:00.
      AND (p_date_to IS NULL OR j.posted_at < (p_date_to + 1)::timestamptz)
      AND (NOT p_only_active OR j.is_active = true)
      AND (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
      AND (p_industries IS NULL OR c.industry = ANY(p_industries))
      AND (p_location_query IS NULL OR j.location ILIKE '%' || p_location_query || '%')
      AND (p_title_query IS NULL OR j.title ILIKE '%' || p_title_query || '%')
      -- Filtro de senales: OR sobre las seleccionadas.
      AND (
        NOT v_filter_signals
        OR EXISTS (
          SELECT 1 FROM signals s
          WHERE s.job_posting_id = j.id
            AND s.signal_id = ANY(v_signal_ids)
            AND (p_signal_type IS NULL OR s.signal_type = p_signal_type)
        )
      )
      -- "Solo con senales": cualquier senal, independiente del filtro.
      AND (
        NOT p_only_with_signals
        OR EXISTS (SELECT 1 FROM signals s2 WHERE s2.job_posting_id = j.id)
      )
  )
  SELECT
    b.id AS job_id,
    b.title::TEXT,
    b.c_name::TEXT AS company_name,
    b.c_country::TEXT AS country,
    b.c_industry::TEXT AS industry,
    b.location::TEXT,
    b.posted_at,
    b.is_active,
    b.job_url::TEXT,
    b.apply_url::TEXT,
    COALESCE(sg.cnt, 0)::BIGINT AS signal_count,
    sg.procs AS signals_process,
    sg.techs AS signals_technology,
    CASE WHEN p_include_description THEN b.description::TEXT ELSE NULL END AS description
  FROM base b
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::BIGINT AS cnt,
      NULLIF(string_agg(DISTINCT dpr.name, '; '), '') AS procs,
      NULLIF(string_agg(DISTINCT dp.name, '; '), '') AS techs
    FROM signals s
    LEFT JOIN dictionary_processes dpr
      ON dpr.id = s.signal_id AND s.signal_type = 'process'
    LEFT JOIN dictionary_products dp
      ON dp.id = s.signal_id AND s.signal_type = 'technology'
    WHERE s.job_posting_id = b.id
  ) sg ON TRUE
  -- Orden determinista: imprescindible para paginar el streaming sin
  -- repetir ni saltear filas.
  ORDER BY b.posted_at DESC NULLS LAST, b.id
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.export_job_postings(
  text, text[], text[], text[], date, date, text, text, boolean, boolean, boolean, integer, integer
) TO authenticated, service_role;

-- ============================================================================
-- Conteo con los mismos filtros (para mostrar el total antes de exportar y
-- para que el streaming sepa cuantas paginas recorrer).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.export_job_postings_count(
  p_signal_type text DEFAULT NULL::text,
  p_signal_names text[] DEFAULT NULL::text[],
  p_countries text[] DEFAULT NULL::text[],
  p_industries text[] DEFAULT NULL::text[],
  p_date_from date DEFAULT NULL::date,
  p_date_to date DEFAULT NULL::date,
  p_location_query text DEFAULT NULL::text,
  p_title_query text DEFAULT NULL::text,
  p_only_active boolean DEFAULT false,
  p_only_with_signals boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '55s'
AS $function$
DECLARE
  v_signal_ids uuid[];
  v_filter_signals boolean;
  v_total bigint;
BEGIN
  v_filter_signals := p_signal_names IS NOT NULL
                      AND array_length(p_signal_names, 1) > 0;

  IF v_filter_signals THEN
    SELECT array_agg(id) INTO v_signal_ids
    FROM (
      SELECT id FROM dictionary_processes
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'process')
      UNION ALL
      SELECT id FROM dictionary_products
        WHERE name = ANY(p_signal_names)
          AND (p_signal_type IS NULL OR p_signal_type = 'technology')
    ) d;
    v_signal_ids := COALESCE(v_signal_ids, '{}'::uuid[]);
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM job_postings j
  LEFT JOIN companies c ON c.id = j.company_id
  WHERE (p_date_from IS NULL OR j.posted_at >= p_date_from::timestamptz)
    AND (p_date_to IS NULL OR j.posted_at < (p_date_to + 1)::timestamptz)
    AND (NOT p_only_active OR j.is_active = true)
    AND (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
    AND (p_industries IS NULL OR c.industry = ANY(p_industries))
    AND (p_location_query IS NULL OR j.location ILIKE '%' || p_location_query || '%')
    AND (p_title_query IS NULL OR j.title ILIKE '%' || p_title_query || '%')
    AND (
      NOT v_filter_signals
      OR EXISTS (
        SELECT 1 FROM signals s
        WHERE s.job_posting_id = j.id
          AND s.signal_id = ANY(v_signal_ids)
          AND (p_signal_type IS NULL OR s.signal_type = p_signal_type)
      )
    )
    AND (
      NOT p_only_with_signals
      OR EXISTS (SELECT 1 FROM signals s2 WHERE s2.job_posting_id = j.id)
    );

  RETURN COALESCE(v_total, 0);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.export_job_postings_count(
  text, text[], text[], text[], date, date, text, text, boolean, boolean
) TO authenticated, service_role;

-- ============================================================================
-- Helpers para poblar los dropdowns. Scopeados a compañias que TIENEN job
-- postings, para no ofrecer filtros que devuelvan 0 resultados.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.export_job_postings_countries()
RETURNS TABLE(country text, job_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
  SELECT c.country_normalized::TEXT AS country, COUNT(*)::BIGINT AS job_count
  FROM job_postings j
  JOIN companies c ON c.id = j.company_id
  WHERE c.country_normalized IS NOT NULL AND c.country_normalized <> ''
  GROUP BY c.country_normalized
  ORDER BY COUNT(*) DESC, c.country_normalized ASC;
$function$;

CREATE OR REPLACE FUNCTION public.export_job_postings_industries()
RETURNS TABLE(industry text, job_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
  SELECT c.industry::TEXT AS industry, COUNT(*)::BIGINT AS job_count
  FROM job_postings j
  JOIN companies c ON c.id = j.company_id
  WHERE c.industry IS NOT NULL AND c.industry <> ''
  GROUP BY c.industry
  ORDER BY COUNT(*) DESC, c.industry ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.export_job_postings_countries() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_job_postings_industries() TO authenticated, service_role;

-- ============================================================================
-- Stats para las tarjetas de la pantalla.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.export_job_postings_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '45s'
AS $function$
  SELECT jsonb_build_object(
    'total_jobs',       (SELECT COUNT(*) FROM job_postings),
    'active_jobs',      (SELECT COUNT(*) FROM job_postings WHERE is_active = true),
    'with_signals',     (SELECT COUNT(DISTINCT job_posting_id) FROM signals WHERE job_posting_id IS NOT NULL),
    'with_country',     (SELECT COUNT(*) FROM job_postings j JOIN companies c ON c.id = j.company_id
                          WHERE c.country_normalized IS NOT NULL AND c.country_normalized <> ''),
    'companies',        (SELECT COUNT(DISTINCT company_id) FROM job_postings WHERE company_id IS NOT NULL),
    'date_min',         (SELECT MIN(posted_at)::date FROM job_postings),
    'date_max',         (SELECT MAX(posted_at)::date FROM job_postings)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.export_job_postings_stats() TO authenticated, service_role;
