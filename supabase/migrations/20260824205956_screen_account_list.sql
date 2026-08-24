-- =============================================================================
-- 456: cruce de una LISTA DEL CLIENTE contra uno o varios terminos.
--
-- POR QUE EXISTE
--   Medido en el screening de Power BI sobre 61 cuentas chilenas (24-ago-2026).
--   El MCP tiene las dos mitades y no la que las cruza:
--     search_companies              1 nombre  -> empresas    (v3.search_companies_ranked, 426)
--     search_companies_by_capability 1 termino -> empresas    (v3.search_companies_by_capability, 429)
--   Para cruzar 61 nombres contra "Power BI" hubo que bajar el universo entero
--   paginando (9 llamadas, ~80k tokens) y matchear a mano. Peor: para las cuentas
--   SIN señales, la unica forma de afirmar "no tiene" fue inferir por ORDEN
--   ALFABETICO que el nombre no aparecia entre dos vecinos. Eso no es auditable.
--
-- QUE DEVUELVE
--   UNA FILA POR INPUT, nunca por match. Cuatro estados que hoy se colapsan en
--   "no aparece":
--     matched            la empresa esta y tiene el termino
--     matched_ambiguous  esta, pero hay mas de un candidato creible
--     matched_no_signal  esta en ASCI y NO tiene el termino  <- descarte legitimo
--     no_match           no esta en ASCI                     <- se resuelve scrapeando
--   La diferencia entre los dos ultimos es comercialmente enorme y hoy se pierde.
--
-- PERFORMANCE: es MAS BARATA que la busqueda inversa, no mas cara.
--   El costo dominante de 429 es el escaneo GLOBAL de public.signals (1,5M filas
--   / 986 MB; 6,6 s en frio). Aca el orden se invierte: primero se resuelven los
--   nombres a company_id por indice, y recien despues se cuentan señales
--   filtrando por company_id = ANY(...). El filtro mas selectivo va primero.
--
--   DOS PASADAS, y esa es la decision de diseño que hace que entre en el
--   presupuesto de 8 s de PostgREST:
--     fuerte  c.normalized_name = company_core_name(input)   btree, igualdad
--             c.website ILIKE %dominio%                      solo si vino dominio
--     difusa  c.name % input  (trigram)                      idx_companies_name_trgm
--             SOLO para los inputs que no resolvieron en la pasada fuerte
--
--   Medido en un Postgres 16 local contra 300.000 empresas sinteticas, con los
--   nombres deliberadamente parecidos entre si (prefijo comun + 4 sufijos), que
--   es el peor escenario posible para trigram:
--     lote de 200, mayoria resuelve exacto      1,9 s
--     lote de 200, TODOS necesitan la difusa    5,6 s
--     misma consulta con la difusa para todos   76 s   <- version anterior
--   O sea que sin las dos pasadas la tool no era viable, y con ellas el peor caso
--   entra con aire. En una lista real de cliente los nombres son mucho mas
--   diversos que en esta prueba, asi que el numero real deberia ser mejor.
--
--   La pasada difusa usa el operador % de pg_trgm y no ILIKE '%x%': el ILIKE con
--   comodin a izquierda sobre `name` no puede aprovechar el GIN, y ademas fallaria
--   por acentos (el nucleo viene sin acentos y `name` no). Con similarity,
--   "CIA PESQUERA CAMANCHACA" encuentra "Camanchaca S.A.", que es justo el caso
--   que el matching manual resolvia a ojo.
--
--   Cada input trae como maximo p_max_candidates candidatos, asi que el conteo de
--   señales toca a lo sumo 200 x 5 = 1.000 empresas, cada una por indice.
--
--   PENDIENTE (decision del dueño, mismo criterio que 429): si el peor caso se
--   acerca al techo en produccion, la salida NO es agrandar el lote sino bajarlo
--   a 100 por llamada. No se agrego ningun indice nuevo.
--
-- SEGURIDAD
--   SECURITY INVOKER (como 426, y a diferencia de 429): la llama el MCP con
--   service_role, que ya lee estas tablas. No hay motivo para elevar privilegios.
--   Igual se REVOCA de PUBLIC/anon/authenticated: solo service_role la ejecuta.
-- =============================================================================

DROP FUNCTION IF EXISTS v3.screen_account_list(jsonb, uuid[], uuid[], text[], integer, integer, numeric);

CREATE FUNCTION v3.screen_account_list(
  p_accounts        jsonb,                    -- [{"input": "AFP HABITAT", "domain": "afphabitat.cl"}]
  p_product_ids     uuid[]   DEFAULT NULL,
  p_process_ids     uuid[]   DEFAULT NULL,
  p_countries       text[]   DEFAULT NULL,
  p_min_signals     integer  DEFAULT 2,
  p_max_candidates  integer  DEFAULT 5,
  p_match_threshold numeric  DEFAULT 0.75
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions, pg_catalog
AS $function$
DECLARE
  v_count     integer;
  v_has_terms boolean;
  v_result    jsonb;
BEGIN
  IF p_accounts IS NULL OR jsonb_typeof(p_accounts) <> 'array' THEN
    RAISE EXCEPTION 'SCREEN_LIST_BAD_INPUT: p_accounts tiene que ser un array json de {input, domain?}';
  END IF;

  v_count := jsonb_array_length(p_accounts);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'SCREEN_LIST_EMPTY: la lista no tiene ningun nombre';
  END IF;
  -- 200 es el mismo techo que PAGINABLE_CEILING en capability-search: por encima
  -- de eso el resultado no entra en el contexto del modelo aunque la consulta
  -- corra bien, y la respuesta correcta es partir la lista, no agrandar el tope.
  IF v_count > 200 THEN
    RAISE EXCEPTION 'SCREEN_LIST_TOO_MANY: % nombres (max 200). Parti la lista en lotes.', v_count;
  END IF;

  -- Sin terminos la tool sigue sirviendo, y para algo que hoy tampoco se puede
  -- hacer: reconciliar una lista contra el catalogo ("¿de estas 61 cuentas,
  -- cuales tenemos?"). Ahi 0 señales NO es "no tiene la señal" sino "no se
  -- pregunto por ninguna", y confundir las dos cosas seria reportar un descarte
  -- que nadie pidio.
  v_has_terms := coalesce(array_length(p_product_ids, 1), 0) > 0
              OR coalesce(array_length(p_process_ids, 1), 0) > 0;

  -- Mismos topes de terminos que 429, y por la misma razon medida: los procesos
  -- del diccionario son categorias muy gruesas.
  IF coalesce(array_length(p_process_ids, 1), 0) > 2 THEN
    RAISE EXCEPTION 'SCREEN_LIST_TOO_MANY_PROCESSES: % procesos (max 2)', array_length(p_process_ids, 1);
  END IF;
  IF coalesce(array_length(p_product_ids, 1), 0) > 20 THEN
    RAISE EXCEPTION 'SCREEN_LIST_TOO_MANY_PRODUCTS: % productos (max 20)', array_length(p_product_ids, 1);
  END IF;

  WITH inputs AS (
    SELECT
      (ord - 1)::integer                                      AS idx,
      btrim(coalesce(item->>'input', ''))                     AS input,
      nullif(btrim(lower(coalesce(item->>'domain', ''))), '') AS domain,
      public.company_core_name(coalesce(item->>'input', ''))  AS core
    FROM jsonb_array_elements(p_accounts) WITH ORDINALITY AS t(item, ord)
  ),
  terms AS (
    SELECT dp.id AS term_id, 'technology'::text AS signal_type, dp.name AS term_name
    FROM public.dictionary_products dp
    WHERE p_product_ids IS NOT NULL AND dp.id = ANY(p_product_ids)
    UNION ALL
    SELECT dpr.id, 'process'::text, dpr.name
    FROM public.dictionary_processes dpr
    WHERE p_process_ids IS NOT NULL AND dpr.id = ANY(p_process_ids)
  ),
  -- PASADA FUERTE: identidad probada (nucleo canonico exacto y/o dominio).
  strong AS (
    SELECT i.idx, m.company_id, m.tier, m.sim, m.contained
    FROM inputs i
    CROSS JOIN LATERAL (
      SELECT c.id AS company_id, 0 AS tier, 1.0::real AS sim, false AS contained
      FROM public.companies c
      WHERE i.core IS NOT NULL AND c.normalized_name = i.core
      LIMIT 20
    ) m
    UNION ALL
    SELECT i.idx, m.company_id, m.tier, m.sim, m.contained
    FROM inputs i
    CROSS JOIN LATERAL (
      SELECT c.id AS company_id, 1 AS tier, 1.0::real AS sim, false AS contained
      FROM public.companies c
      WHERE i.domain IS NOT NULL AND c.website ILIKE '%' || i.domain || '%'
      LIMIT 20
    ) m
  ),
  -- Solo lo que NO resolvio por identidad probada paga la pasada difusa.
  --
  -- Esto no es una optimizacion cosmetica, es lo que hace que la tool entre en el
  -- presupuesto. Medido sobre 300.000 empresas: con la pasada trigram corriendo
  -- para los 200 nombres, un lote tardaba 76 s contra el techo de 8 s de
  -- PostgREST. Corriendola solo para los que no resolvieron exacto, el mismo lote
  -- entra. En una lista real de cliente la mayoria resuelve por nucleo.
  --
  -- El precio: un input que resolvio exacto no recibe candidatos difusos, asi que
  -- `candidateCount` puede subestimar los homonimos de nombre PARECIDO. Los de
  -- nucleo IGUAL si aparecen, que son los que importan para la ambiguedad.
  pending AS (
    SELECT i.* FROM inputs i
    WHERE NOT EXISTS (SELECT 1 FROM strong s WHERE s.idx = i.idx)
  ),
  fuzzy AS (
    SELECT p.idx, m.company_id, m.tier, m.sim, m.contained
    FROM pending p
    CROSS JOIN LATERAL (
      -- Dos similitudes y se toma la mejor. La del nombre crudo es la que puede
      -- usar el indice trigram (por eso va en el WHERE); la de NUCLEO contra
      -- NUCLEO es la comparacion justa, porque saca acentos, sufijos societarios
      -- y prefijos: "CIA PESQUERA CAMANCHACA" contra "Compañía Pesquera
      -- Camanchaca S.A." pasa de 0.57 a 0.70. Y no premia al homonimo: el mismo
      -- calculo deja a "Consorcio Persa" en 0.42.
      SELECT c.id AS company_id, 2 AS tier,
             greatest(
               similarity(c.name, p.input),
               similarity(coalesce(c.normalized_name, ''), coalesce(p.core, ''))
             ) AS sim,
             -- Contencion de nucleo: "AFP Habitat" dentro de "AFP Habitat S.A.".
             -- Es identidad casi probada y la similitud sola la subestima.
             --
             -- La guarda de DOS TOKENS no es opcional, y se descubrio probando:
             -- sin ella, "Consorcio" queda contenido en "CONSORCIO SEGUROS" y la
             -- entidad generica se llevaba 0.88 de confianza, o sea que la
             -- contencion premiaba justo al homonimo que hay que evitar. Un
             -- unico token generico no prueba identidad; dos ya son un nombre.
             (c.normalized_name IS NOT NULL AND p.core IS NOT NULL
              AND (c.normalized_name LIKE '%' || p.core || '%' OR p.core LIKE '%' || c.normalized_name || '%')
              AND array_length(string_to_array(
                    CASE WHEN length(c.normalized_name) <= length(p.core) THEN c.normalized_name ELSE p.core END,
                  ' '), 1) >= 2) AS contained
      FROM public.companies c
      WHERE length(p.input) >= 4 AND c.name % p.input
      ORDER BY similarity(c.name, p.input) DESC, c.name, c.id
      LIMIT 20
    ) m
  ),
  raw_candidates AS (
    SELECT * FROM strong
    UNION ALL
    SELECT * FROM fuzzy
  ),
  candidates AS (
    SELECT rc.idx, rc.company_id, min(rc.tier) AS tier, max(rc.sim) AS sim,
           bool_or(rc.tier = 0) AS core_match, bool_or(rc.tier = 1) AS domain_match,
           bool_or(rc.contained) AS core_contained
    FROM raw_candidates rc
    GROUP BY rc.idx, rc.company_id
  ),
  enriched AS (
    SELECT
      cd.idx, cd.company_id, cd.tier, cd.sim, cd.core_match, cd.domain_match, cd.core_contained,
      c.name, c.website, nullif(btrim(c.country), '') AS country, c.industry,
      CASE
        WHEN cd.domain_match AND cd.core_match THEN 1.00
        WHEN cd.domain_match                   THEN 0.97
        WHEN cd.core_match                     THEN 0.95
        WHEN cd.core_contained                 THEN greatest(0.88, least(0.90, cd.sim)::numeric)
        ELSE least(0.90, cd.sim)::numeric
      END AS confidence,
      CASE
        WHEN p_countries IS NULL THEN false
        WHEN nullif(btrim(c.country), '') IS NULL THEN false
        WHEN lower(btrim(c.country)) = ANY (SELECT lower(btrim(x)) FROM unnest(p_countries) AS x) THEN false
        ELSE true
      END AS excluded_by_country
    FROM candidates cd
    JOIN public.companies c ON c.id = cd.company_id
  ),
  in_country AS (
    SELECT * FROM enriched WHERE NOT excluded_by_country
  ),
  term_hits AS (
    SELECT
      e.idx, e.company_id, t.term_name, t.signal_type,
      count(*)::integer                                                  AS signals,
      count(*) FILTER (WHERE s.is_current_employee IS TRUE)::integer     AS from_current_employees,
      count(*) FILTER (WHERE s.is_current_employee IS NOT TRUE)::integer AS from_alumni_or_jobs,
      max(coalesce(s.job_posted_at, s.created_at))                       AS latest_at
    FROM in_country e
    JOIN public.signals s ON s.company_id = e.company_id
    JOIN terms t ON t.signal_type = s.signal_type AND t.term_id = s.signal_id
    GROUP BY e.idx, e.company_id, t.term_name, t.signal_type
  ),
  per_candidate AS (
    SELECT
      e.idx, e.company_id, e.name, e.website, e.country, e.industry,
      e.confidence, e.core_match, e.domain_match, e.core_contained, e.tier, e.sim,
      coalesce(th.signals_total, 0) AS signals_total,
      th.hits,
      -- IDENTIDAD PRIMERO, evidencia como desempate. El orden inverso parece
      -- razonable ("me quedo con el que tiene las señales") y esta MAL: probado
      -- contra los datos, para "CONSORCIO SEGUROS" elegia Consorcio Persa (7
      -- señales, similitud 0.42) por encima de Consorcio (6 señales, 0.56). Es
      -- exactamente la mis-atribucion que hay que evitar: la evidencia de otra
      -- empresa presentada como propia. Que un homonimo tenga mas señales no lo
      -- vuelve la empresa que preguntaron.
      row_number() OVER w AS rank,
      count(*)      OVER (PARTITION BY e.idx) AS candidate_count,
      -- El segundo mejor por VENTANA y no por subconsulta correlacionada. Medido:
      -- con las correlacionadas (una por fila para el conteo, otra para el
      -- runner-up, otra para los candidatos, otra para el filtro de pais) un lote
      -- de 200 nombres tardaba 80 s contra un techo de 8 s de PostgREST. Cada una
      -- reescaneaba el CTE materializado entero. Con ventanas, el mismo lote entra
      -- holgado.
      lead(e.confidence)            OVER w AS runner_up_confidence,
      lead(coalesce(th.signals_total, 0)) OVER w AS runner_up_signals
    FROM in_country e
    LEFT JOIN (
      SELECT idx, company_id, sum(signals)::integer AS signals_total,
             jsonb_agg(jsonb_build_object(
               'term', term_name, 'kind', signal_type, 'signals', signals,
               'fromCurrentEmployees', from_current_employees,
               'fromAlumniOrJobs', from_alumni_or_jobs, 'latestAt', latest_at
             ) ORDER BY signals DESC, term_name) AS hits
      FROM term_hits GROUP BY idx, company_id
    ) th ON th.idx = e.idx AND th.company_id = e.company_id
    WINDOW w AS (
      PARTITION BY e.idx
      ORDER BY e.confidence DESC, coalesce(th.signals_total, 0) DESC, e.tier, e.name, e.company_id
    )
  ),
  candidate_lists AS (
    SELECT idx, jsonb_agg(jsonb_build_object(
             'companyId', company_id, 'name', name, 'domain', website,
             'country', country, 'confidence', round(confidence, 2),
             'signalsForTerms', signals_total
           ) ORDER BY rank) AS candidates
    FROM per_candidate
    WHERE rank <= p_max_candidates
    GROUP BY idx
  ),
  country_filtered AS (
    SELECT idx, count(*)::integer AS filtered_by_country
    FROM enriched WHERE excluded_by_country GROUP BY idx
  ),
  best AS (
    SELECT * FROM per_candidate WHERE rank = 1
  ),
  rows_out AS (
    SELECT
      i.idx,
      i.input,
      CASE
        WHEN b.company_id IS NULL THEN 'no_match'
        WHEN b.confidence < p_match_threshold
          OR (b.runner_up_confidence IS NOT NULL
              AND b.runner_up_confidence >= b.confidence - 0.10)
          THEN 'matched_ambiguous'
        WHEN v_has_terms AND coalesce(b.signals_total, 0) = 0 THEN 'matched_no_signal'
        ELSE 'matched'
      END AS status,
      -- Los dos ambiguos piden acciones distintas y colapsarlos obliga al modelo
      -- a adivinar cual: con varios candidatos hay que ELEGIR, con uno solo hay
      -- que CONFIRMAR que es esa empresa.
      CASE
        WHEN b.company_id IS NULL THEN NULL
        WHEN b.runner_up_confidence IS NOT NULL AND b.runner_up_confidence >= b.confidence - 0.10 THEN 'multiple_candidates'
        WHEN b.confidence < p_match_threshold THEN 'low_confidence'
        ELSE NULL
      END AS ambiguity_reason,
      b.company_id, b.name, b.website, b.country, b.industry,
      b.confidence, b.signals_total, b.hits, b.candidate_count,
      -- §7.5 del diseño: 20 de 42 cuentas del screening tenian 1 o 2 señales.
      -- Presentarlas al mismo nivel que una con 14 le baja la credibilidad al
      -- reporte entero, asi que la fuerza viaja explicita en cada fila.
      CASE
        WHEN NOT v_has_terms                  THEN 'not_evaluated'
        WHEN coalesce(b.signals_total, 0) = 0 THEN 'none'
        WHEN b.signals_total < p_min_signals  THEN 'weak'
        ELSE 'solid'
      END AS signal_strength,
      coalesce(cf.filtered_by_country, 0) AS filtered_by_country,
      cl.candidates
    FROM inputs i
    LEFT JOIN best b             ON b.idx  = i.idx
    LEFT JOIN candidate_lists cl ON cl.idx = i.idx
    LEFT JOIN country_filtered cf ON cf.idx = i.idx
  )
  SELECT jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'input',           r.input,
      'status',          r.status,
      'companyId',       r.company_id,
      'matchedName',     r.name,
      'matchConfidence', round(coalesce(r.confidence, 0), 2),
      'domain',          r.website,
      'country',         r.country,
      'industry',        r.industry,
      'signalsForTerms', coalesce(r.signals_total, 0),
      'signalStrength',  r.signal_strength,
      'termHits',        coalesce(r.hits, '[]'::jsonb),
      'candidateCount',  coalesce(r.candidate_count, 0),
      'ambiguityReason', r.ambiguity_reason,
      'filteredByCountry', r.filtered_by_country,
      -- Los candidatos solo cuando aportan: en una fila resuelta son ruido que
      -- multiplicado por 200 filas no entra en el contexto.
      'candidates', CASE WHEN r.status = 'matched_ambiguous' THEN coalesce(r.candidates, '[]'::jsonb) ELSE NULL END
    ) ORDER BY r.idx), '[]'::jsonb),
    'summary', jsonb_build_object(
      'inputs',            count(*),
      'matched',           count(*) FILTER (WHERE r.status = 'matched'),
      'ambiguous',         count(*) FILTER (WHERE r.status = 'matched_ambiguous'),
      'matchedNoSignal',   count(*) FILTER (WHERE r.status = 'matched_no_signal'),
      'noMatch',           count(*) FILTER (WHERE r.status = 'no_match'),
      'solidSignal',       count(*) FILTER (WHERE r.signal_strength = 'solid'),
      'weakSignal',        count(*) FILTER (WHERE r.signal_strength = 'weak')
    ),
    'appliedFilters', jsonb_build_object(
      'countries', p_countries, 'minSignals', p_min_signals,
      'matchThreshold', p_match_threshold, 'termsEvaluated', v_has_terms
    )
  )
  INTO v_result
  FROM rows_out r;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION v3.screen_account_list(jsonb, uuid[], uuid[], text[], integer, integer, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION v3.screen_account_list(jsonb, uuid[], uuid[], text[], integer, integer, numeric) FROM anon;
REVOKE ALL ON FUNCTION v3.screen_account_list(jsonb, uuid[], uuid[], text[], integer, integer, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION v3.screen_account_list(jsonb, uuid[], uuid[], text[], integer, integer, numeric) TO service_role;
