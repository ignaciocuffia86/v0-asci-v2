-- =============================================================================
-- 429: busqueda INVERSA de empresas por capacidad (tecnologia o proceso)
--      para el MCP de v3.
--
-- POR QUE EXISTE
--   El buscador de v2 ya resuelve "que bancos usan Dynamics 365" con
--   public.search_companies_by_technology_v2 / _by_process_v2, pero el MCP nunca
--   expuso esa capacidad: el modelo solo podia ir de empresa -> señales, nunca de
--   señal -> empresas. Resultado medido: un cliente IA respondia "ASCI no permite
--   este tipo de busqueda inversa" cuando los datos SI estaban (43 bancos con
--   Dynamics 365 CRM).
--
-- POR QUE NO SE REUSAN DIRECTO LAS RPC DE v2
--   1) search_companies_by_technology_v2 toma UN SOLO p_product_id uuid. En el
--      diccionario "Dynamics 365" son DOS productos (CRM y ERP) y "Microsoft" son
--      10. Con la RPC de v2 habria que hacer N viajes, y peor: el resolvedor
--      existente (resolveProductByName) matchea por "contains" y devolveria SOLO
--      el CRM, perdiendo 27 bancos en silencio.
--      (_by_process_v2 SI acepta uuid[]; la asimetria es solo de tecnologia.)
--   2) Devuelven el set COMPLETO sin limite: Azure sin filtro son 1681 filas con
--      logo_url y website, ~840 KB de JSON directo al contexto del modelo.
--   3) No ofrecen vista agregada para decidir donde mirar antes de traer detalle.
--
-- QUE HACE DISTINTO
--   - Acepta varios productos Y varios procesos en una sola llamada (UNION ALL).
--   - Dos modos: 'screening' (agregados por pais/industria, sin nombres) y
--     'detail' (empresas concretas con limite duro).
--   - Devuelve jsonb ya con la forma final: un viaje, sin logo_url.
--   - Informa matchedTerms para que el modelo pueda distinguir CRM de ERP.
--
-- SOLO LECTURA. No escribe nada. No toca ninguna estructura de v2.
--
-- PERFORMANCE (medido sobre public.signals: 1.538.509 filas, 986 MB)
--   Peor caso = "todo Microsoft" (10 productos) sin filtro de industria, 8999
--   empresas. Con cache caliente: 57 ms. En frio la primera corrida fue 5.2 s,
--   por I/O (16.150 bloques leidos de disco), no por el plan.
--   Se PROBO un indice compuesto (signal_type, signal_id, company_id) dentro de
--   un dry-run: baja las lecturas de 16.150 a 141 bloques, pero en caliente solo
--   mejora 57ms -> 35ms. NO se agrega: public.signals ya tiene 491 MB de indices
--   y la escribe el ETL de v2; sumar un cuarto indice encarece los inserts para
--   ganar 22 ms en el camino caliente. La tabla la usa el buscador de v2 todo el
--   dia, asi que el cache esta caliente en produccion.
--
-- SEGURIDAD
--   SECURITY DEFINER porque lee tablas de v2 cuyas politicas RLS estan atadas a
--   bookmarks personales (ver asci-company-news-pool). search_path fijado y todo
--   calificado con public. para que no se pueda secuestrar por search_path.
--   Postgres da EXECUTE a PUBLIC por defecto: se REVOCA explicitamente y se
--   concede solo a service_role (el MCP), como en el resto de v3.
-- =============================================================================

DROP FUNCTION IF EXISTS v3.search_companies_by_capability(uuid[], uuid[], text[], text[], boolean, text, integer);

CREATE FUNCTION v3.search_companies_by_capability(
  p_product_ids uuid[] DEFAULT NULL,
  p_process_ids uuid[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_master_industry_ids text[] DEFAULT NULL,
  p_exclude_providers boolean DEFAULT true,
  p_mode text DEFAULT 'screening',
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_product_ids IS NULL AND p_process_ids IS NULL THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_NO_TERMS: hay que pasar al menos un producto o un proceso';
  END IF;
  IF p_mode NOT IN ('screening', 'detail') THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_BAD_MODE: % (esperado screening|detail)', p_mode;
  END IF;

  -- TOPES DE TERMINOS: no son arbitrarios, salen de medir contra el limite de 8s
  -- que impone PostgREST (por donde entra el MCP).
  --
  -- Los procesos del diccionario son MUY gruesos: hay solo 23 y el mas grande
  -- ("Control administrativo financiero") tiene 183.072 señales. Medido en
  -- caliente: 1 proceso = ~1,0 s (60.757 empresas); los 23 juntos = 22,5 s, o
  -- sea que el costo escala casi lineal con la cantidad de procesos y con 8
  -- procesos ya se choca el techo. Con 3 quedan ~3 s de peor caso, que deja
  -- margen para cache frio (medido 2,4x mas lento en la primera corrida).
  --
  -- Los productos son finos (73 en total, la señal mas grande es chica): "todo
  -- Microsoft" son 10 productos y tarda 722 ms, asi que 20 es holgado.
  --
  -- No se puede resolver con SET LOCAL statement_timeout adentro de la funcion:
  -- no tiene efecto (ya verificado en este proyecto para las RPC de merge).
  IF coalesce(array_length(p_process_ids, 1), 0) > 3 THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_TOO_MANY_PROCESSES: % procesos (max 3). Los procesos son categorias amplias; buscá de a pocos o filtrá por industria/pais.',
      array_length(p_process_ids, 1);
  END IF;
  IF coalesce(array_length(p_product_ids, 1), 0) > 20 THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_TOO_MANY_PRODUCTS: % productos (max 20)', array_length(p_product_ids, 1);
  END IF;

  -- Una sola sentencia con CTEs. `filtered` se referencia varias veces (total,
  -- agregado por pais, agregado por industria), y Postgres materializa
  -- automaticamente un CTE referenciado mas de una vez, asi que el escaneo de
  -- public.signals ocurre UNA sola vez.
  --
  -- Se descarto la version con tabla temporal: obliga a marcar la funcion
  -- VOLATILE (Postgres rechaza INSERT/DELETE dentro de una funcion STABLE con
  -- "is not allowed in a non-volatile function") y agrega overhead de catalogo
  -- en cada llamada, sin ninguna ventaja sobre el CTE materializado.
  WITH matched AS (
    -- UNION ALL y no un OR con dos ANY: el OR obliga a un scan que no puede
    -- aprovechar idx_signals_signal_id en cada rama.
    SELECT s.company_id, s.id AS signal_row_id, s.contact_id, s.job_posting_id,
           s.is_current_employee, s.created_at, dp.name AS term
    FROM public.signals s
    JOIN public.dictionary_products dp ON dp.id = s.signal_id
    WHERE p_product_ids IS NOT NULL
      AND s.signal_type = 'technology'
      AND s.signal_id = ANY(p_product_ids)
    UNION ALL
    SELECT s.company_id, s.id, s.contact_id, s.job_posting_id,
           s.is_current_employee, s.created_at, dpr.name
    FROM public.signals s
    JOIN public.dictionary_processes dpr ON dpr.id = s.signal_id
    WHERE p_process_ids IS NOT NULL
      AND s.signal_type = 'process'
      AND s.signal_id = ANY(p_process_ids)
  ),
  per_company AS (
    SELECT
      m.company_id,
      count(DISTINCT m.signal_row_id)::integer AS signals,
      count(DISTINCT m.contact_id) FILTER (
        WHERE m.is_current_employee = true AND m.contact_id IS NOT NULL)::integer AS current_employees,
      count(DISTINCT m.contact_id) FILTER (
        WHERE m.is_current_employee = false AND m.contact_id IS NOT NULL)::integer AS alumni,
      count(DISTINCT m.job_posting_id) FILTER (
        WHERE m.job_posting_id IS NOT NULL)::integer AS job_postings,
      max(m.created_at) AS latest_signal_at,
      array_agg(DISTINCT m.term) FILTER (WHERE m.term IS NOT NULL) AS matched_terms
    FROM matched m
    GROUP BY m.company_id
  ),
  filtered AS (
    SELECT
      pc.company_id,
      c.name AS company_name,
      c.country,
      c.master_industry_id AS industry_id,
      mi.name_es AS industry_name,
      c.website,
      pc.signals, pc.current_employees, pc.alumni, pc.job_postings,
      pc.latest_signal_at, pc.matched_terms
    FROM per_company pc
    JOIN public.companies c ON c.id = pc.company_id
    LEFT JOIN public.master_industries mi ON mi.id = c.master_industry_id
    WHERE (p_countries IS NULL OR c.country = ANY(p_countries))
      AND (p_master_industry_ids IS NULL OR c.master_industry_id = ANY(p_master_industry_ids))
      -- IS DISTINCT FROM conserva las de industria NULL, igual que la RPC de v2.
      -- Son 3197 empresas en el peor caso: descartarlas perderia prospectos reales.
      AND (NOT p_exclude_providers OR c.master_industry_id IS DISTINCT FROM 'service_provider')
  ),
  totals AS (
    SELECT count(*)::integer AS total_companies,
           coalesce(sum(signals), 0)::integer AS total_signals
    FROM filtered
  )
  SELECT CASE WHEN p_mode = 'screening' THEN
    -- Sin nombres de empresa a proposito: el objetivo es que el modelo sepa
    -- CUANTO hay y DONDE esta para pedirle al usuario que acote, sin gastar
    -- contexto en 1681 filas.
    jsonb_build_object(
      'mode', 'screening',
      'totalCompanies', t.total_companies,
      'totalSignals', t.total_signals,
      'byCountry', coalesce((
        SELECT jsonb_agg(x) FROM (
          SELECT coalesce(f.country, '(sin pais)') AS country,
                 count(*)::integer AS companies,
                 sum(f.signals)::integer AS signals
          FROM filtered f GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 20
        ) x), '[]'::jsonb),
      'byIndustry', coalesce((
        SELECT jsonb_agg(y) FROM (
          SELECT coalesce(f.industry_id, '(sin industria)') AS "industryId",
                 coalesce(f.industry_name, '(sin clasificar)') AS industry,
                 count(*)::integer AS companies,
                 sum(f.signals)::integer AS signals
          FROM filtered f GROUP BY 1, 2 ORDER BY count(*) DESC, 2 LIMIT 20
        ) y), '[]'::jsonb)
    )
  ELSE
    jsonb_build_object(
      'mode', 'detail',
      'totalCompanies', t.total_companies,
      'totalSignals', t.total_signals,
      'returned', least(t.total_companies, p_limit),
      'truncated', t.total_companies > p_limit,
      'companies', coalesce((
        SELECT jsonb_agg(z) FROM (
          SELECT f.company_id AS "companyId",
                 f.company_name AS name,
                 f.country,
                 f.industry_id AS "industryId",
                 f.industry_name AS industry,
                 f.website,
                 f.signals,
                 f.current_employees AS "currentEmployees",
                 f.alumni,
                 f.job_postings AS "jobPostings",
                 f.latest_signal_at AS "latestSignalAt",
                 f.matched_terms AS "matchedTerms"
          FROM filtered f
          ORDER BY f.signals DESC, f.current_employees DESC, f.company_name
          LIMIT p_limit
        ) z), '[]'::jsonb)
    )
  END
  INTO v_result
  FROM totals t;

  RETURN v_result;
END;
$function$;

-- Postgres concede EXECUTE a PUBLIC por defecto. Sin este REVOKE, cualquier
-- usuario anonimo de la API podria barrer el catalogo completo de v2.
REVOKE ALL ON FUNCTION v3.search_companies_by_capability(uuid[], uuid[], text[], text[], boolean, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v3.search_companies_by_capability(uuid[], uuid[], text[], text[], boolean, text, integer) TO service_role;

COMMENT ON FUNCTION v3.search_companies_by_capability(uuid[], uuid[], text[], text[], boolean, text, integer) IS
  'Busqueda inversa para el MCP de v3: dadas tecnologias y/o procesos del diccionario, devuelve empresas con evidencia. Modo screening = agregados por pais/industria; modo detail = empresas con limite. Solo lectura sobre el catalogo global de v2.';
