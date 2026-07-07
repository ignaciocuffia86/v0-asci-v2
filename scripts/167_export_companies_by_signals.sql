-- ============================================================================
-- 167_export_companies_by_signals.sql
-- Export de COMPAÑÍAS que cumplen filtros de señales del diccionario.
-- Espeja el patrón de export_contacts pero agregando por compañía y contando
-- la cantidad de FILAS de señal que matchean el filtro (incluye señales de
-- contactos y de job postings).
--
-- Diseño de performance (signals tiene ~1.5M filas):
--   1. Los nombres de señal se resuelven primero a signal_id (conjunto chico),
--      para filtrar signals por idx_signals_signal_id (índice) en vez de
--      joinear el diccionario contra las 1.5M filas.
--   2. Se agrega por company_id ANTES de joinear companies, así el join a
--      companies opera sobre el resultado agrupado (mucho más chico).
--   3. Los filtros de país/industria se aplican sobre companies (post-agg).
--   4. statement_timeout amplio: el caso sin filtros agrupa toda la tabla
--      (~200k compañías) y puede tardar varios segundos.
--
-- Filtros (todos opcionales / NULL = sin filtrar):
--   p_signal_type   : 'process' | 'technology' | NULL (ambos)
--   p_signal_names  : nombres del diccionario (multi-select)
--   p_countries     : companies.country_normalized
--   p_industries    : companies.industry
--   p_limit         : máximo de filas a devolver
--
-- SOLO v2 (schema public). No toca nada de v3.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.export_companies(
  p_signal_type text DEFAULT NULL::text,
  p_signal_names text[] DEFAULT NULL::text[],
  p_countries text[] DEFAULT NULL::text[],
  p_industries text[] DEFAULT NULL::text[],
  p_limit integer DEFAULT 10000
)
RETURNS TABLE(
  company_id uuid,
  company_name text,
  industry text,
  country text,
  linkedin_url text,
  website text,
  total_signals bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '55s'
AS $function$
DECLARE
  v_signal_ids uuid[];
BEGIN
  -- Resolver nombres del diccionario a signal_ids (rápido, tablas chicas).
  IF p_signal_names IS NOT NULL THEN
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
    -- Si se pidieron nombres pero ninguno existe, no debe matchear nada.
    v_signal_ids := COALESCE(v_signal_ids, '{}'::uuid[]);
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT s.company_id, COUNT(*)::BIGINT AS total
    FROM signals s
    WHERE s.company_id IS NOT NULL
      AND (p_signal_type IS NULL OR s.signal_type = p_signal_type)
      AND (v_signal_ids IS NULL OR s.signal_id = ANY(v_signal_ids))
    GROUP BY s.company_id
  )
  SELECT
    comp.id AS company_id,
    comp.name::TEXT AS company_name,
    comp.industry::TEXT AS industry,
    comp.country_normalized::TEXT AS country,
    comp.linkedin_url::TEXT AS linkedin_url,
    comp.website::TEXT AS website,
    a.total AS total_signals
  FROM agg a
  JOIN companies comp ON comp.id = a.company_id
  WHERE (p_countries IS NULL OR comp.country_normalized = ANY(p_countries))
    AND (p_industries IS NULL OR comp.industry = ANY(p_industries))
  ORDER BY a.total DESC, comp.name ASC
  LIMIT p_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.export_companies(text, text[], text[], text[], integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Helpers para poblar los dropdowns de filtros (país / industria).
-- Devuelven valores distintos de companies. Se ejecutan una sola vez al
-- montar la pantalla.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_companies_countries()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
  SELECT COALESCE(array_agg(c ORDER BY c), '{}')
  FROM (
    SELECT DISTINCT country_normalized AS c
    FROM companies
    WHERE country_normalized IS NOT NULL AND country_normalized <> ''
  ) x;
$function$;

CREATE OR REPLACE FUNCTION public.export_companies_industries()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
  SELECT COALESCE(array_agg(i ORDER BY i), '{}')
  FROM (
    SELECT DISTINCT industry AS i
    FROM companies
    WHERE industry IS NOT NULL AND industry <> ''
  ) x;
$function$;

GRANT EXECUTE ON FUNCTION public.export_companies_countries() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.export_companies_industries() TO authenticated, service_role;
