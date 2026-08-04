-- =========================================================================
-- 435. RESTAURAR EL CONTRATO DE v2 EN companies.country_normalized
-- =========================================================================
-- CONTEXTO DEL INCIDENTE
--   El script 432 y las Fases 5 escribieron codigos ISO alpha-2 ('AR') en
--   public.companies.country_normalized y despues un revert masivo puso NULL
--   en todo lo que no matcheaba '^[A-Z]{2}$'.
--
--   Eso rompio el contrato de v2: esa columna guarda NOMBRES COMPLETOS
--   ('Argentina'), los escribe public.normalize_country() y la mantienen 2
--   triggers en la tabla. La consumen los exports de admin de v2:
--     - 169_export_job_postings.sql       -> c.country_normalized = ANY(p_countries)
--     - 167_export_companies_by_signals.sql
--     - 161_fix_export_contacts_rpc.sql
--     - 108_create_export_rpc.sql
--     - 135_create_bookmark_export_rpc.sql
--     - 111_export_filter_enforcement.sql
--
-- QUE HACE ESTE SCRIPT
--   1. Crea la columna v3 `hq_country_iso` (ISO alpha-2) y preserva ahi los
--      mapeos de HQ que hoy estan mal ubicados en country_normalized.
--   2. Restaura country_normalized = normalize_country(country) en toda la
--      tabla, que es exactamente lo que hacen el script 107 y los triggers.
--   3. Elimina los 2 overloads de RPC que agrego el script 432.
--
-- IMPORTANTE
--   run-sql.mjs es DRY RUN salvo que se pase --commit.
--   NO incluir COMMIT aca: el runner maneja la transaccion.
-- =========================================================================

-- -------------------------------------------------------------------------
-- PASO 1: columna v3 para el ISO del HQ + preservar lo ya calculado
-- -------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS hq_country_iso text;

COMMENT ON COLUMN public.companies.hq_country_iso IS
  'ISO 3166-1 alpha-2 del HQ. Uso exclusivo de v3. NO confundir con country_normalized, que es el nombre completo del pais y lo consume v2.';

CREATE INDEX IF NOT EXISTS idx_companies_hq_country_iso
  ON public.companies (hq_country_iso)
  WHERE hq_country_iso IS NOT NULL;

-- Mover a hq_country_iso los ISO validos que quedaron en country_normalized
UPDATE public.companies
SET hq_country_iso = country_normalized
WHERE country_normalized ~ '^[A-Z]{2}$'
  AND hq_country_iso IS NULL;

-- -------------------------------------------------------------------------
-- PASO 2: restaurar el contrato de v2
-- -------------------------------------------------------------------------
-- normalize_country() devuelve el nombre completo o NULL si no puede mapear,
-- que es precisamente el comportamiento que esperan los exports de v2.
UPDATE public.companies
SET country_normalized = public.normalize_country(country)
WHERE country_normalized IS DISTINCT FROM public.normalize_country(country);

-- -------------------------------------------------------------------------
-- PASO 3: eliminar los overloads que agrego el script 432
-- -------------------------------------------------------------------------
-- Firmas propias del 432 (llevan p_limit). Las originales de v2 llevan
-- p_exclude_providers y NO se tocan.
DROP FUNCTION IF EXISTS public.search_companies_by_process_v2(uuid[], text[], text[], integer);
DROP FUNCTION IF EXISTS public.search_companies_by_technology_v2(uuid, text[], text[], integer);

-- -------------------------------------------------------------------------
-- VERIFICACION
-- -------------------------------------------------------------------------
DO $$
DECLARE
  v_v2_contract   int;
  v_iso_preserved int;
  v_iso_leftover  int;
  v_overloads     int;
BEGIN
  SELECT count(*) INTO v_v2_contract
  FROM public.companies WHERE country_normalized IS NOT NULL;

  SELECT count(*) INTO v_iso_preserved
  FROM public.companies WHERE hq_country_iso IS NOT NULL;

  SELECT count(*) INTO v_iso_leftover
  FROM public.companies WHERE country_normalized ~ '^[A-Z]{2}$';

  SELECT count(*) INTO v_overloads
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('search_companies_by_process_v2', 'search_companies_by_technology_v2');

  RAISE NOTICE '=== 435 RESTAURACION ===';
  RAISE NOTICE 'country_normalized con valor (contrato v2): %', v_v2_contract;
  RAISE NOTICE 'hq_country_iso preservado (v3):             %', v_iso_preserved;
  RAISE NOTICE 'ISO residual en country_normalized:         % (debe ser 0)', v_iso_leftover;
  RAISE NOTICE 'Overloads *_v2 restantes:                   % (debe ser 2)', v_overloads;

  IF v_iso_leftover > 0 THEN
    RAISE WARNING 'Quedo ISO en country_normalized. Revisar normalize_country().';
  END IF;

  IF v_overloads <> 2 THEN
    RAISE WARNING 'Se esperaban 2 funciones (las originales de v2), hay %.', v_overloads;
  END IF;
END $$;
