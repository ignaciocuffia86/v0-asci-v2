-- ═══════════════════════════════════════════════════════════════════════════
-- search_companies_by_capability v2
--
-- YA APLICADA en el proyecto (asciv2-database) mientras se iteraba: quedó
-- registrada bajo los nombres capability_search_v2, _lateral_term_hits,
-- _page_hits y _revoke_anon. Este archivo es el estado final consolidado y es
-- idempotente (DROP IF EXISTS de la firma vieja + CREATE OR REPLACE +
-- REVOKE/GRANT), así que volver a aplicarlo no cambia nada.
--
-- La v1 devolvía un resultado INTERPRETABLE pero no ACCIONABLE: para llegar a
-- 89 cuentas había que bajar 889 y descartar 800 a mano, y `matchedTerms`
-- hacía ver iguales a dos cuentas que no lo son (Mercado Libre: 115 señales de
-- Angular y 7 de Oracle Forms; La Segunda: 16 / 13 / 19). Todo ese trabajo
-- terminaba post-procesado afuera del MCP, contra Supabase, con accesos que el
-- usuario final no tiene.
--
-- Cambios:
--   1. p_min_signals       — filtra por volumen ANTES del LIMIT.
--   2. termHits            — [{term, signals}] en vez de una lista de nombres.
--   3. p_terms_mode='all'  — intersección real entre términos (no suma).
--   4. p_offset            — paginación; `truncated` ya no es un callejón.
--   5. excluded            — cuántas cuentas descartó el filtro de proveedores.
--   6. p_include_firmographics — LinkedIn, dominio, dotación Apollo, si cotiza.
--   7. currentEmployees → contactsInBase / alumniInBase (ver nota abajo).
--
-- RENOMBRE DELIBERADO: `currentEmployees` no eran empleados, eran CONTACTOS de
-- la base de ASCI. Mercado Libre figuraba con 122 teniendo 85.000 empleados, y
-- un usuario final lo lee como dotación el 100% de las veces. La dotación real
-- vive ahora en firmographics.employeesApollo, y viene explícitamente en null
-- cuando no la tenemos (cobertura ~1%), para que "chica" no se confunda con
-- "no sabemos".
--
-- PERFORMANCE (medido en producción, 1,7M señales):
--
--   peor caso  = los 2 procesos más grandes, sin filtros, detail 50 filas
--                + firmographics  →  4,96 s   (screening: 6,4 s)
--   caso real  = Angular + Oracle Forms, Argentina, minSignals 6, AND
--                + firmographics  →  0,24 s
--
-- El techo sigue siendo los 8 s de PostgREST y el costo dominante sigue siendo
-- la lectura de disco de public.signals: los 2 procesos más grandes son 365.040
-- filas y 51.058 bloques, ~2,7 s solo en el Index Scan. Esta versión no le
-- agrega nada a ese camino:
--
--   · Sale el JOIN a dictionary_products/processes de dentro de `matched`. En v1
--     el nombre del término se resolvía por cada una de las ~365.000 filas de
--     señal; ahora se resuelve contra `terms`, que tiene ≤ 22 filas.
--   · Sale el array_agg(DISTINCT term) de `per_company`, que ordenaba el input
--     de CADA grupo.
--   · `termHits` se agrega SOLO para las ≤ 50 filas de la página (ver la nota
--     de `page_hits`: las otras dos variantes que se probaron costaban 1,1 s y
--     33 s respectivamente).
--   · `page` / `page_hits` solo se referencian desde el brazo 'detail' del CASE,
--     así que el screening no los ejecuta.
--   · `per_company_groups` (el modo AND) solo se evalúa con p_term_groups: con
--     `groups` vacío el nested loop corta sin tocar `per_company_term`.
--
-- Los topes de 2 procesos / 20 productos se mantienen.
-- ═══════════════════════════════════════════════════════════════════════════

-- Firma nueva: hay que DROPear. CREATE OR REPLACE con otra lista de argumentos
-- crea una SOBRECARGA, no reemplaza, y PostgREST quedaría con dos candidatas
-- ambiguas para la llamada vieja.
DROP FUNCTION IF EXISTS v3.search_companies_by_capability(uuid[], uuid[], text[], text[], boolean, text, integer);

CREATE OR REPLACE FUNCTION v3.search_companies_by_capability(
  p_product_ids uuid[] DEFAULT NULL::uuid[],
  p_process_ids uuid[] DEFAULT NULL::uuid[],
  p_countries text[] DEFAULT NULL::text[],
  p_master_industry_ids text[] DEFAULT NULL::text[],
  p_exclude_providers boolean DEFAULT true,
  p_mode text DEFAULT 'screening'::text,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_min_signals integer DEFAULT 1,
  p_terms_mode text DEFAULT 'any'::text,
  p_term_groups jsonb DEFAULT NULL::jsonb,
  p_include_firmographics boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_result jsonb;
  v_group_count integer;
  v_min_signals integer := greatest(coalesce(p_min_signals, 1), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF p_product_ids IS NULL AND p_process_ids IS NULL THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_NO_TERMS: hay que pasar al menos un producto o un proceso';
  END IF;
  IF p_mode NOT IN ('screening', 'detail') THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_BAD_MODE: % (esperado screening|detail)', p_mode;
  END IF;
  IF coalesce(p_terms_mode, 'any') NOT IN ('any', 'all') THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_BAD_TERMS_MODE: % (esperado any|all)', p_terms_mode;
  END IF;

  -- `p_term_groups` es [{"term": "...", "ids": ["uuid", ...]}, ...]: un grupo por
  -- TÉRMINO PEDIDO POR EL USUARIO, no por entrada del diccionario. La distinción
  -- es todo el punto del modo AND: "Dynamics 365" resuelve a CRM y ERP, y exigir
  -- las dos sería exigir algo que nadie pidió. Un ID puede estar en más de un
  -- grupo ("Oracle" y "Oracle EBS" se solapan): una señal de EBS satisface los
  -- dos, que es la lectura correcta.
  v_group_count := coalesce(jsonb_array_length(p_term_groups), 0);
  IF p_terms_mode = 'all' AND v_group_count = 0 THEN
    RAISE EXCEPTION 'CAPABILITY_SEARCH_GROUPS_REQUIRED: terms_mode="all" necesita p_term_groups (un grupo por término pedido)';
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
  -- Lo mismo vale para p_min_signals: acota el resultado, no el escaneo.
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

  -- Una sola sentencia con CTEs. `matched` se referencia varias veces y Postgres
  -- materializa automaticamente un CTE referenciado mas de una vez, asi que el
  -- escaneo de public.signals ocurre UNA sola vez.
  --
  -- Se descarto la version con tabla temporal: obliga a marcar la funcion
  -- VOLATILE (Postgres rechaza INSERT/DELETE dentro de una funcion STABLE con
  -- "is not allowed in a non-volatile function") y agrega overhead de catalogo
  -- en cada llamada, sin ninguna ventaja sobre el CTE materializado.
  WITH terms AS (
    -- Nombres del diccionario, resueltos UNA vez. En v1 esto era un JOIN dentro
    -- de `matched`, o sea una busqueda de nombre por cada fila de señal.
    SELECT dp.id, dp.name
    FROM public.dictionary_products dp
    WHERE p_product_ids IS NOT NULL AND dp.id = ANY(p_product_ids)
    UNION ALL
    SELECT dpr.id, dpr.name
    FROM public.dictionary_processes dpr
    WHERE p_process_ids IS NOT NULL AND dpr.id = ANY(p_process_ids)
  ),
  groups AS (
    SELECT (g.ord)::integer AS group_idx,
           ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(g.value->'ids') AS x) AS ids
    FROM jsonb_array_elements(coalesce(p_term_groups, '[]'::jsonb)) WITH ORDINALITY AS g(value, ord)
  ),
  matched AS (
    -- UNION ALL y no un OR con dos ANY: el OR obliga a un scan que no puede
    -- aprovechar idx_signals_signal_id en cada rama.
    SELECT s.company_id, s.signal_id AS dict_id, s.contact_id, s.job_posting_id,
           s.is_current_employee, s.created_at
    FROM public.signals s
    WHERE p_product_ids IS NOT NULL
      AND s.signal_type = 'technology'
      AND s.signal_id = ANY(p_product_ids)
    UNION ALL
    SELECT s.company_id, s.signal_id, s.contact_id, s.job_posting_id,
           s.is_current_employee, s.created_at
    FROM public.signals s
    WHERE p_process_ids IS NOT NULL
      AND s.signal_type = 'process'
      AND s.signal_id = ANY(p_process_ids)
  ),
  per_company AS (
    SELECT
      m.company_id,
      -- count(*) y NO count(DISTINCT signals.id): `signals.id` es PRIMARY KEY,
      -- asi que el DISTINCT es redundante por definicion. No es cosmetico:
      -- obligaba a un sort en DISCO (external merge, 16952kB) y era el
      -- verdadero cuello de botella de la rama de procesos.
      count(*)::integer AS signals,
      count(DISTINCT m.contact_id) FILTER (
        WHERE m.is_current_employee = true AND m.contact_id IS NOT NULL)::integer AS contacts_in_base,
      count(DISTINCT m.contact_id) FILTER (
        WHERE m.is_current_employee = false AND m.contact_id IS NOT NULL)::integer AS alumni_in_base,
      count(DISTINCT m.job_posting_id) FILTER (
        WHERE m.job_posting_id IS NOT NULL)::integer AS job_postings,
      max(m.created_at) AS latest_signal_at
    FROM matched m
    GROUP BY m.company_id
  ),
  per_company_term AS (
    -- Conteo por (empresa, termino): un HashAggregate sobre uuids, no sobre
    -- texto. Es lo que v1 tiraba a la basura con array_agg(DISTINCT nombre).
    SELECT m.company_id, m.dict_id, count(*)::integer AS n
    FROM matched m
    GROUP BY 1, 2
  ),
  per_company_groups AS (
    -- Cuantos GRUPOS distintos toca cada empresa. Solo se usa en terms_mode
    -- 'all'; con p_term_groups nulo `groups` esta vacio, el nested loop corta
    -- de entrada y `per_company_term` ni se materializa.
    SELECT t.company_id, count(DISTINCT g.group_idx)::integer AS groups_hit
    FROM per_company_term t
    JOIN groups g ON t.dict_id = ANY(g.ids)
    GROUP BY t.company_id
  ),
  base AS (
    -- Todos los filtros MENOS el de proveedores, para poder contar despues
    -- cuantas cuentas descarta ese filtro. En v1 descartaba en silencio.
    SELECT
      pc.company_id,
      c.name AS company_name,
      -- public.companies.country mezcla NULL y string vacio para el mismo caso
      -- (pais desconocido). Sin este nullif el screening devolvia DOS entradas
      -- distintas para lo mismo, que se quedaban con los dos primeros puestos
      -- del ranking y empujaban a los paises reales fuera del top 5 que lee el
      -- modelo.
      nullif(btrim(c.country), '') AS country,
      c.master_industry_id AS industry_id,
      mi.name_es AS industry_name,
      c.website,
      c.linkedin_url,
      c.apollo_employees_count,
      c.is_public,
      c.ticker,
      c.stock_exchange,
      pc.signals, pc.contacts_in_base, pc.alumni_in_base, pc.job_postings,
      pc.latest_signal_at
    FROM per_company pc
    JOIN public.companies c ON c.id = pc.company_id
    LEFT JOIN public.master_industries mi ON mi.id = c.master_industry_id
    LEFT JOIN per_company_groups pcg ON pcg.company_id = pc.company_id
    -- El filtro compara contra el pais YA normalizado y sin distinguir
    -- mayusculas, para que el modelo pueda reenviar tal cual el nombre que le
    -- devolvio el screening ("Argentina", "Costa Rica") sin depender de como
    -- quedo escrito en la fila.
    WHERE (p_countries IS NULL OR lower(btrim(c.country)) = ANY(
             SELECT lower(btrim(x)) FROM unnest(p_countries) AS x))
      AND (p_master_industry_ids IS NULL OR c.master_industry_id = ANY(p_master_industry_ids))
      AND pc.signals >= v_min_signals
      AND (p_terms_mode <> 'all' OR coalesce(pcg.groups_hit, 0) >= v_group_count)
  ),
  provider_cut AS (
    SELECT count(*)::integer AS service_providers
    FROM base b
    WHERE b.industry_id = 'service_provider'
  ),
  filtered AS (
    SELECT b.* FROM base b
    -- IS DISTINCT FROM conserva las de industria NULL: son 3197 empresas en el
    -- peor caso y descartarlas perderia prospectos reales.
    WHERE NOT p_exclude_providers OR b.industry_id IS DISTINCT FROM 'service_provider'
  ),
  totals AS (
    SELECT count(*)::integer AS total_companies,
           coalesce(sum(signals), 0)::integer AS total_signals
    FROM filtered
  ),
  page AS (
    -- La pagina, materializada ANTES de resolver termHits. Solo la referencia el
    -- brazo 'detail' del CASE, asi que en screening este CTE nunca se ejecuta.
    -- company_id como ultimo desempate: sin el, el ORDER BY no es total y la
    -- paginacion por offset podria repetir o saltear filas empatadas.
    SELECT f.* FROM filtered f
    ORDER BY f.signals DESC, f.contacts_in_base DESC, f.company_name, f.company_id
    LIMIT p_limit OFFSET v_offset
  ),
  page_hits AS (
    -- termHits SOLO para las <= 50 filas devueltas, con un semi-join que se
    -- resuelve en UN hash aggregate.
    --
    -- Se probaron y descartaron dos variantes: (a) precalcular los hits para
    -- TODAS las empresas costaba 1,1 s en el peor caso (jsonb_agg sobre 110.042
    -- empresas, 37 batches con spill a disco) y el 99,95% se tiraba en el LIMIT;
    -- (b) un LEFT JOIN LATERAL por fila era MUCHO peor (33 s), porque Postgres
    -- inlinea el CTE dentro del lateral y re-escanea las 365.040 filas de
    -- `matched` una vez por cada fila de la pagina.
    SELECT k.company_id,
           jsonb_agg(jsonb_build_object('term', d.name, 'signals', k.n)
                     ORDER BY k.n DESC, d.name) AS term_hits
    FROM per_company_term k
    JOIN terms d ON d.id = k.dict_id
    WHERE k.company_id IN (SELECT p.company_id FROM page p)
    GROUP BY k.company_id
  )
  SELECT CASE WHEN p_mode = 'screening' THEN
    -- Sin nombres de empresa a proposito: el objetivo es que el modelo sepa
    -- CUANTO hay y DONDE esta para pedirle al usuario que acote, sin gastar
    -- contexto en cientos de filas.
    jsonb_build_object(
      'mode', 'screening',
      'totalCompanies', t.total_companies,
      'totalSignals', t.total_signals,
      'excluded', jsonb_build_object(
        'serviceProviders', CASE WHEN p_exclude_providers THEN e.service_providers ELSE 0 END,
        'providersIncluded', NOT p_exclude_providers
      ),
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
      'offset', v_offset,
      'returned', least(greatest(t.total_companies - v_offset, 0), p_limit),
      'truncated', t.total_companies > v_offset + p_limit,
      'excluded', jsonb_build_object(
        'serviceProviders', CASE WHEN p_exclude_providers THEN e.service_providers ELSE 0 END,
        'providersIncluded', NOT p_exclude_providers
      ),
      'companies', coalesce((
        SELECT jsonb_agg(z) FROM (
          SELECT p.company_id AS "companyId",
                 p.company_name AS name,
                 p.country,
                 p.industry_id AS "industryId",
                 p.industry_name AS industry,
                 p.website,
                 p.signals,
                 coalesce(h.term_hits, '[]'::jsonb) AS "termHits",
                 -- Nombres honestos: son contactos de la base de ASCI, no la
                 -- dotacion de la empresa. La dotacion sale de firmographics.
                 p.contacts_in_base AS "contactsInBase",
                 p.alumni_in_base AS "alumniInBase",
                 p.job_postings AS "jobPostings",
                 p.latest_signal_at AS "latestSignalAt",
                 -- Detras de un flag: cinco campos por fila x 50 filas inflan el
                 -- payload y no toda busqueda los necesita. Cuando se piden, las
                 -- claves vienen SIEMPRE, con null explicito: la cobertura de
                 -- employeesApollo es ~1%, y el usuario tiene que poder
                 -- distinguir "empresa chica" de "no sabemos".
                 CASE WHEN p_include_firmographics THEN jsonb_build_object(
                   'linkedinUrl', p.linkedin_url,
                   'domain', nullif(split_part(
                     regexp_replace(lower(btrim(coalesce(p.website, ''))), '^(https?://)?(www\.)?', ''),
                     '/', 1), ''),
                   'employeesApollo', p.apollo_employees_count,
                   'isPublic', p.is_public,
                   'ticker', p.ticker,
                   'stockExchange', p.stock_exchange
                 ) END AS firmographics
          FROM page p
          LEFT JOIN page_hits h ON h.company_id = p.company_id
          ORDER BY p.signals DESC, p.contacts_in_base DESC, p.company_name, p.company_id
        ) z), '[]'::jsonb)
    )
  END
  INTO v_result
  FROM totals t CROSS JOIN provider_cut e;

  RETURN v_result;
END;
$function$;

-- La v1 tenia proacl {postgres=X/postgres,service_role=X/postgres}: EXECUTE solo
-- para service_role, que es por donde entra el MCP (admin client). El DROP se
-- llevo esos privilegios y hay que reponerlos.
--
-- OJO con revocar SOLO de PUBLIC: no alcanza. El proyecto tiene ALTER DEFAULT
-- PRIVILEGES que le da EXECUTE a `anon` y `authenticated` DIRECTAMENTE (no via
-- PUBLIC) sobre cada funcion nueva del schema, asi que despues del CREATE la
-- funcion quedaba con proacl {postgres,anon,authenticated,service_role}. Siendo
-- SECURITY DEFINER, eso es un lector anonimo de companies y signals completo.
-- Verificado contra el catalogo despues de aplicar: tiene que quedar
-- {postgres=X/postgres,service_role=X/postgres}.
REVOKE ALL ON FUNCTION v3.search_companies_by_capability(uuid[], uuid[], text[], text[], boolean, text, integer, integer, integer, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION v3.search_companies_by_capability(uuid[], uuid[], text[], text[], boolean, text, integer, integer, integer, text, jsonb, boolean) TO service_role;
