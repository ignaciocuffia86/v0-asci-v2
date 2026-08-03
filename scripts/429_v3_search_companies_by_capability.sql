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
-- PERFORMANCE (medido sobre public.signals: 1.538.509 filas, 986 MB, 491 MB de
-- indices). El limite a respetar es el de PostgREST: 8 s.
--   El costo dominante es la LECTURA DE DISCO, no la CPU del agregado. La misma
--   consulta de 3 procesos pesados tarda 365 ms en caliente y 6,6 s en frio.
--
--   Tecnologia (productos, terminos finos): "todo Microsoft" = 10 productos,
--   8.999 empresas, 722 ms. Sin riesgo. Tope 20.
--   Procesos (terminos gruesos, solo 23 en el diccionario): 1 = 1,9 s |
--   2 = 6,1 s | 3 = 6,6 s | 23 = 22,5 s. Tope 2 (ver detalle en el cuerpo).
--
--   Un `count(DISTINCT s.id)` heredado del patron de v2 era el cuello real de la
--   rama de procesos: forzaba un sort en DISCO de 17 MB (external merge). Como
--   signals.id es PRIMARY KEY el DISTINCT es redundante; se cambio por count(*)
--   con resultados idenficos verificados (0 filas difieren sobre 105.369).
--   En cambio los count(DISTINCT contact_id/job_posting_id) SI son necesarios y
--   medidos en caliente salen gratis (365 ms vs 366 ms con y sin ellos).
--
--   NO se agrego ningun indice. Se probaron dos en dry-run; el mejor
--   ((signal_type, signal_id) INCLUDE (...)) baja la lectura de disco 4,7x
--   (47.682 -> 10.046 bloques) pero pesa 153 MB sobre una tabla de v2 EN
--   PRODUCCION que escribe el ETL. Queda como decision explicita del dueño.
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
  -- El costo dominante NO es la CPU del agregado sino la LECTURA DE DISCO de
  -- public.signals (1,5M filas / 986 MB). Con cache caliente el agregado de los
  -- 3 procesos mas grandes corre en 365 ms; con cache frio la misma consulta
  -- tarda 6,6 s. O sea: el techo lo marca el peor caso frio, que es el que se
  -- va a dar en produccion cuando nadie consulto ese proceso hace rato.
  --
  -- Los procesos del diccionario son MUY gruesos: hay solo 23 y el mas grande
  -- ("Control administrativo financiero") tiene 183.072 señales. Medido frio:
  -- 1 proceso = 1,9 s | 2 = 6,1 s | 3 = 6,6 s | los 23 juntos = 22,5 s.
  -- Con 2 el peor caso queda en ~6 s, que entra en los 8 s con algo de aire.
  -- Se probo con 3 y daba 7,7 s: demasiado al filo.
  --
  -- OJO: filtrar por industria NO abarata la consulta (2 procesos + bancos =
  -- 5,6 s para 2.128 empresas), porque el escaneo de signals ocurre ANTES del
  -- join con companies. El filtro sirve para acotar el RESULTADO, no el costo.
  --
  -- Los productos son finos (73 en total): "todo Microsoft" son 10 productos y
  -- tarda 722 ms, asi que 20 es holgado.
  --
  -- No se puede resolver con SET LOCAL statement_timeout adentro de la funcion:
  -- no tiene efecto (ya verificado en este proyecto para las RPC de merge).
  --
  -- PENDIENTE (decision del dueño del proyecto): un indice
  -- (signal_type, signal_id) INCLUDE (company_id, contact_id, job_posting_id,
  -- is_current_employee, created_at) baja la lectura de disco 4,7x (47.682 ->
  -- 10.046 bloques) y permitiria subir el tope, pero pesa 153 MB sobre una
  -- tabla de v2 EN PRODUCCION. No se creo por precaucion.
  IF coalesce(array_length(p_process_ids, 1), 0) > 2 THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_TOO_MANY_PROCESSES: % procesos (max 2). Los procesos son categorias muy amplias (el mas grande toca 60.757 empresas); buscá de a uno o dos.',
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
      -- count(*) y NO count(DISTINCT m.signal_row_id): `signals.id` es PRIMARY KEY,
      -- asi que el DISTINCT es redundante por definicion. No es cosmetico: obligaba
      -- a un `Sort Key: company_id, id` con `Sort Method: external merge Disk:
      -- 16952kB` (sort en DISCO), y era el verdadero cuello de botella de la rama
      -- de procesos. Verificado que ambas formas dan exactamente los mismos
      -- conteos (0 filas difieren sobre 105.369 empresas).
      count(*)::integer AS signals,
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
      -- public.companies.country mezcla NULL y string vacio para el mismo caso
      -- (pais desconocido). Sin este nullif el screening devolvia DOS entradas
      -- distintas -- "(sin pais)" con 1754 empresas y "" con 1210 -- que se
      -- quedaban con los dos primeros puestos del ranking y empujaban a los
      -- paises reales fuera del top 5 que lee el modelo.
      nullif(btrim(c.country), '') AS country,
      c.master_industry_id AS industry_id,
      mi.name_es AS industry_name,
      c.website,
      pc.signals, pc.current_employees, pc.alumni, pc.job_postings,
      pc.latest_signal_at, pc.matched_terms
    FROM per_company pc
    JOIN public.companies c ON c.id = pc.company_id
    LEFT JOIN public.master_industries mi ON mi.id = c.master_industry_id
    -- El filtro compara contra el pais YA normalizado y sin distinguir
    -- mayusculas, para que el modelo pueda reenviar tal cual el nombre que le
    -- devolvio el screening ("Argentina", "Costa Rica") sin depender de como
    -- quedo escrito en la fila.
    WHERE (p_countries IS NULL OR lower(btrim(c.country)) = ANY(
             SELECT lower(btrim(x)) FROM unnest(p_countries) AS x))
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

-- PERMISOS. Ojo, aca hay DOS mecanismos distintos y revocar de PUBLIC no alcanza:
--
--   1) Postgres concede EXECUTE a PUBLIC por defecto -> REVOKE FROM PUBLIC.
--   2) Supabase tiene un ALTER DEFAULT PRIVILEGES que concede EXECUTE a `anon` y
--      `authenticated` DIRECTAMENTE (no via PUBLIC). Verificado: tras el paso 1
--      la ACL seguia mostrando `anon=X/postgres` y `authenticated=X/postgres`,
--      y has_function_privilege('anon', ...) daba true.
--
-- Sin los REVOKE explicitos de abajo, cualquier visitante anonimo de la API podria
-- barrer el catalogo completo de empresas y señales de v2 (es SECURITY DEFINER, o
-- sea que esquiva RLS). El resto de las RPC de v3 tiene anon en false; esta debe
-- quedar igual.
REVOKE ALL ON FUNCTION v3.search_companies_by_capability(uuid[], uuid[], text[], text[], boolean, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.search_companies_by_capability(uuid[], uuid[], text[], text[], boolean, text, integer) FROM anon;
REVOKE ALL ON FUNCTION v3.search_companies_by_capability(uuid[], uuid[], text[], text[], boolean, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION v3.search_companies_by_capability(uuid[], uuid[], text[], text[], boolean, text, integer) TO service_role;

COMMENT ON FUNCTION v3.search_companies_by_capability(uuid[], uuid[], text[], text[], boolean, text, integer) IS
  'Busqueda inversa para el MCP de v3: dadas tecnologias y/o procesos del diccionario, devuelve empresas con evidencia. Modo screening = agregados por pais/industria; modo detail = empresas con limite. Solo lectura sobre el catalogo global de v2.';
