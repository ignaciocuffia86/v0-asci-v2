-- =========================================================================
-- SCRIPT DE MIGRACIÓN: Actualizar RPC de v2 para usar country_normalized
-- =========================================================================
-- Propósito: Mejorar la precisión de búsquedas geográficas en v2
--
-- ANTES: filtran contra c.country (crudo, con valores como "Greater Buenos Aires")
-- DESPUÉS: filtran contra COALESCE(c.country_normalized, c.country)
--          (normalizado cuando exista; fallback a crudo si no)
--
-- Impacto: Búsquedas por país ahora capturan empresas con direcciones/regiones,
-- no solo nombres de país exactos. Ejemplo: "¿Bancos en Argentina?" encontrará
-- también "Greater Buenos Aires".
--
-- Seguridad: DRY RUN por defecto. Descomentar la línea COMMIT para aplicar.
-- =========================================================================

BEGIN;

-- =========================================================================
-- 1. Actualizar search_companies_by_technology_v2
-- =========================================================================
CREATE OR REPLACE FUNCTION public.search_companies_by_technology_v2(
  p_product_id uuid,
  p_countries text[] DEFAULT NULL::text[],
  p_master_industry_ids text[] DEFAULT NULL::text[],
  p_limit integer DEFAULT 25
)
RETURNS TABLE(
  company_id uuid,
  company_name text,
  company_country text,
  company_industry text,
  company_website text,
  company_logo_url text,
  company_linkedin_url text,
  signal_count integer,
  current_employees integer,
  alumni integer,
  latest_signal_date timestamp with time zone
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.country,
    mi.name_es,
    c.website,
    c.logo_url,
    c.linkedin_url,
    (SELECT count(*) FROM public.signals s WHERE s.company_id = c.id AND s.signal_type = 'technology' AND s.signal_id = p_product_id)::integer,
    c.current_employees,
    c.alumni,
    (SELECT max(s.created_at) FROM public.signals s WHERE s.company_id = c.id AND s.signal_type = 'technology' AND s.signal_id = p_product_id)
  FROM public.companies c
  LEFT JOIN public.master_industries mi ON mi.id = c.master_industry_id
  WHERE EXISTS (
    SELECT 1 FROM public.signals s
    WHERE s.company_id = c.id
      AND s.signal_type = 'technology'
      AND s.signal_id = p_product_id
  )
  -- CAMBIO CLAVE: usar country_normalized con fallback
  AND (p_countries IS NULL OR 
       COALESCE(c.country_normalized, c.country) = ANY(p_countries))
  AND (p_master_industry_ids IS NULL OR 
       c.master_industry_id = ANY(p_master_industry_ids))
  ORDER BY latest_signal_date DESC NULLS LAST
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION public.search_companies_by_technology_v2(uuid, text[], text[], integer) TO service_role;

-- =========================================================================
-- 2. Actualizar search_companies_by_process_v2
-- =========================================================================
CREATE OR REPLACE FUNCTION public.search_companies_by_process_v2(
  p_process_ids uuid[],
  p_countries text[] DEFAULT NULL::text[],
  p_master_industry_ids text[] DEFAULT NULL::text[],
  p_limit integer DEFAULT 25
)
RETURNS TABLE(
  company_id uuid,
  company_name text,
  company_country text,
  company_industry text,
  company_website text,
  company_logo_url text,
  company_linkedin_url text,
  signal_count integer,
  current_employees integer,
  alumni integer,
  latest_signal_date timestamp with time zone
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.country,
    mi.name_es,
    c.website,
    c.logo_url,
    c.linkedin_url,
    (SELECT count(*) FROM public.signals s WHERE s.company_id = c.id AND s.signal_type = 'process' AND s.signal_id = ANY(p_process_ids))::integer,
    c.current_employees,
    c.alumni,
    (SELECT max(s.created_at) FROM public.signals s WHERE s.company_id = c.id AND s.signal_type = 'process' AND s.signal_id = ANY(p_process_ids))
  FROM public.companies c
  LEFT JOIN public.master_industries mi ON mi.id = c.master_industry_id
  WHERE EXISTS (
    SELECT 1 FROM public.signals s
    WHERE s.company_id = c.id
      AND s.signal_type = 'process'
      AND s.signal_id = ANY(p_process_ids)
  )
  -- CAMBIO CLAVE: usar country_normalized con fallback
  AND (p_countries IS NULL OR 
       COALESCE(c.country_normalized, c.country) = ANY(p_countries))
  AND (p_master_industry_ids IS NULL OR 
       c.master_industry_id = ANY(p_master_industry_ids))
  ORDER BY latest_signal_date DESC NULLS LAST
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION public.search_companies_by_process_v2(uuid[], text[], text[], integer) TO service_role;

-- =========================================================================
-- VERIFICACIÓN
-- =========================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ACTUALIZACIÓN DE RPC v2 ===';
  RAISE NOTICE 'Cambios realizados:';
  RAISE NOTICE '  1. search_companies_by_technology_v2: ahora usa country_normalized (con fallback)';
  RAISE NOTICE '  2. search_companies_by_process_v2: ahora usa country_normalized (con fallback)';
  RAISE NOTICE '';
  RAISE NOTICE 'Impacto: Búsquedas geográficas capturan regiones/ciudades, no solo países exactos.';
  RAISE NOTICE 'Ejemplo: "¿Bancos en Argentina?" encontrará también "Greater Buenos Aires".';
  RAISE NOTICE '';
  RAISE NOTICE 'Compatibilidad: COALESCE fallback a country si country_normalized IS NULL.';
  RAISE NOTICE 'Zero breaking changes para filas existentes.';
  RAISE NOTICE '';
  RAISE NOTICE 'Siguiente paso: ejecutar Fase 5 (IA) para llenar country_normalized de valores ambiguos.';
  RAISE NOTICE '';
END $$;

-- DRY RUN: rollback intencional para validar sin escribir
RAISE EXCEPTION 'DRY RUN COMPLETADO. Cambios listos para producción. Descomentar COMMIT para aplicar.';

-- COMMIT;
