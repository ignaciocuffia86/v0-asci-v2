-- =============================================================================
-- screen_account_list: cuatro correcciones que aparecieron VALIDANDO CONTRA
-- PRODUCCION (514.269 empresas, 1.676.533 señales), despues de que la version
-- anterior pasara todas las pruebas locales sobre datos sinteticos.
--
-- En produccion se aplico en tres pasos (screen_account_list_core_consolidation,
-- _confidence_floor, _trgm_threshold_and_cap). Aca van consolidados en un solo
-- CREATE OR REPLACE, que deja exactamente el mismo estado final.
--
-- ── 1. AMBIGUEDAD FALSA ──────────────────────────────────────────────────────
-- El catalogo tiene la misma empresa cargada varias veces: "AFP HABITAT",
-- "AFP HABITAT" y "AFP HABITAT SA" comparten nucleo canonico. La regla del
-- segundo mejor las trataba como candidatos RIVALES, asi que 6 de 9 nombres
-- reales salian matched_ambiguous. En una lista de 61 serian ~40 confirmaciones
-- inutiles: la tool no habria servido para el caso que vino a resolver.
--
-- Ahora las entidades que comparten NUCLEO son duplicados de la misma empresa, no
-- competidoras. Solo un candidato de nucleo DISTINTO puede volver ambigua la
-- fila, y solo si la evidencia no lo desempata.
--
-- ── 2. SUBCONTEO POR FRAGMENTACION ───────────────────────────────────────────
-- Las señales se contaban sobre la entidad ganadora sola, asi que un "0 señales"
-- podia ser falso cuando la cuenta esta partida en varias entidades. Ahora se
-- suman por nucleo y viajan las dos cifras: signalsOwn (la entidad devuelta) y
-- signalsForTerms (la empresa consolidada).
--
-- Ademas el desempate DENTRO del mismo nucleo elige la entidad que TIENE la
-- evidencia. Entre tres "AFP Habitat" identicas en confianza, sin eso podia
-- devolver el companyId de la variante vacia, y ese id es el que despues usan
-- research y enrichment.
--
-- La identidad sigue mandando sobre la evidencia: probado contra produccion, el
-- orden inverso elegia "Bata Chile" (confianza 0.44, 1 señal) para el input
-- "BAKELITE Chile" por encima de "Bakels Chile" (0.65, 0 señales).
--
-- ── 3. PISO DE CONFIANZA ─────────────────────────────────────────────────────
-- Sin piso, el operador % de pg_trgm definia el contrato de la tool: devuelve
-- cualquier cosa por encima de 0.3, asi que "Empresa Que No Existe SpA" volvia
-- como matched_ambiguous apuntando a "empresa no listada" con 0.43 de confianza.
-- Decir matched_* de una empresa que NO esta en ASCI destruye justo la distincion
-- que los cuatro estados existen para preservar: "esta y no tiene la señal" es un
-- descarte legitimo, "no la tenemos" se resuelve scrapeando.
--
-- 0.50 sale de los datos: los matches difusos legitimos medidos contra produccion
-- dan 0.90 y 0.65. Por debajo de 0.50 no hubo ninguno real.
--
-- ── 4. LA MEDICION LOCAL DE PERFORMANCE NO SE SOSTUVO ────────────────────────
-- El header de la migracion base afirma "200 nombres, todos difusos, 5,6 s" sobre
-- 300.000 empresas sinteticas. Contra las 514.269 reales eran 6,65 s cada 50
-- nombres (~133 ms por nombre, ~26 s para 200): muy por encima del techo de 8 s
-- de PostgREST. Los nombres sinteticos eran artificialmente parecidos entre si, lo
-- que PARECIA el peor caso pero producia menos trabajo de heap que los reales.
--
-- Dos correcciones, las dos medidas con EXPLAIN contra produccion:
--
--   a) Umbral del operador % a 0.45 (el default de pg_trgm es 0.3). A 0.3 el GIN
--      devolvia 3.480 filas por nombre y el recheck de heap tocaba 145.261
--      bloques; a 0.45 son 505 filas y 23.805 bloques. La pasada difusa de 50
--      nombres baja de 4,5 s a 2,5 s. Es gratis en resultados porque el piso de
--      0.50 ya descarta lo que queda por debajo, y se verifico que los matches
--      legitimos sobreviven ("CIA PESQUERA CAMANCHACA" contra "Compañía Pesquera
--      Camanchaca S.A." tiene similitud de nombre 0.571).
--
--      Va con set_config(..., LOCAL). NO con una clausula SET de la funcion, que
--      el rol de Supabase rechaza ("permission denied to set parameter"), ni con
--      set_limit(), que cambia el GUC de la SESION: con pooling de conexiones esa
--      sesion la reusa despues la aplicacion. LOCAL vive hasta el fin de la
--      transaccion, y PostgREST corre cada RPC en la suya.
--
--   b) Tope de 100 nombres, no 200. Medido: 100 nombres TODOS difusos = 5,7 s,
--      con aire bajo el techo. El caso real de esta sesion (61 cuentas) sigue
--      siendo UNA sola llamada; una lista de 139 son dos.
-- =============================================================================

CREATE OR REPLACE FUNCTION v3.screen_account_list(
  p_accounts        jsonb,
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
  v_count       integer;
  v_has_terms   boolean;
  v_min_conf    constant numeric := 0.50;
  v_max_inputs  constant integer := 100;
  v_result      jsonb;
BEGIN
  IF p_accounts IS NULL OR jsonb_typeof(p_accounts) <> 'array' THEN
    RAISE EXCEPTION 'SCREEN_LIST_BAD_INPUT: p_accounts tiene que ser un array json de {input, domain?}';
  END IF;
  v_count := jsonb_array_length(p_accounts);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'SCREEN_LIST_EMPTY: la lista no tiene ningun nombre';
  END IF;
  IF v_count > v_max_inputs THEN
    RAISE EXCEPTION 'SCREEN_LIST_TOO_MANY: % nombres (max %). Parti la lista en lotes de %.', v_count, v_max_inputs, v_max_inputs;
  END IF;

  -- LOCAL: se restaura al terminar la transaccion, asi que no contamina la sesion
  -- que despues reusa el pool.
  PERFORM set_config('pg_trgm.similarity_threshold', '0.45', true);

  v_has_terms := coalesce(array_length(p_product_ids, 1), 0) > 0
              OR coalesce(array_length(p_process_ids, 1), 0) > 0;

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
  pending AS (
    SELECT i.* FROM inputs i WHERE NOT EXISTS (SELECT 1 FROM strong s WHERE s.idx = i.idx)
  ),
  fuzzy AS (
    SELECT p.idx, m.company_id, m.tier, m.sim, m.contained
    FROM pending p
    CROSS JOIN LATERAL (
      SELECT c.id AS company_id, 2 AS tier,
             greatest(similarity(c.name, p.input),
                      similarity(coalesce(c.normalized_name, ''), coalesce(p.core, ''))) AS sim,
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
  raw_candidates AS (SELECT * FROM strong UNION ALL SELECT * FROM fuzzy),
  candidates AS (
    SELECT rc.idx, rc.company_id, min(rc.tier) AS tier, max(rc.sim) AS sim,
           bool_or(rc.tier = 0) AS core_match, bool_or(rc.tier = 1) AS domain_match,
           bool_or(rc.contained) AS core_contained
    FROM raw_candidates rc GROUP BY rc.idx, rc.company_id
  ),
  enriched AS (
    SELECT
      cd.idx, cd.company_id, cd.tier, cd.sim, cd.core_match, cd.domain_match, cd.core_contained,
      c.name, c.website, nullif(btrim(c.country), '') AS country, c.industry,
      -- Clave de IDENTIDAD: las entidades que comparten nucleo canonico son la
      -- misma empresa cargada varias veces. Sin normalized_name cae al id, o sea
      -- que la fila es su propio nucleo y no se consolida con nadie.
      coalesce(c.normalized_name, cd.company_id::text) AS core_key,
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
  -- El piso se aplica ACA: un candidato por debajo no es un match debil, no es un
  -- candidato. Si ninguno sobrevive, la fila sale no_match.
  in_country AS (
    SELECT * FROM enriched WHERE NOT excluded_by_country AND confidence >= v_min_conf
  ),
  own_hits AS (
    SELECT e.idx, e.company_id, e.core_key, t.term_name, t.signal_type,
           count(*)::integer                                                  AS signals,
           count(*) FILTER (WHERE s.is_current_employee IS TRUE)::integer     AS from_current_employees,
           count(*) FILTER (WHERE s.is_current_employee IS NOT TRUE)::integer AS from_alumni_or_jobs,
           max(coalesce(s.job_posted_at, s.created_at))                       AS latest_at
    FROM in_country e
    JOIN public.signals s ON s.company_id = e.company_id
    JOIN terms t ON t.signal_type = s.signal_type AND t.term_id = s.signal_id
    GROUP BY e.idx, e.company_id, e.core_key, t.term_name, t.signal_type
  ),
  own_totals AS (
    SELECT idx, company_id, sum(signals)::integer AS own_signals FROM own_hits GROUP BY idx, company_id
  ),
  core_terms AS (
    SELECT idx, core_key, term_name, signal_type,
           sum(signals)::integer AS signals,
           sum(from_current_employees)::integer AS from_current_employees,
           sum(from_alumni_or_jobs)::integer AS from_alumni_or_jobs,
           max(latest_at) AS latest_at
    FROM own_hits GROUP BY idx, core_key, term_name, signal_type
  ),
  core_totals AS (
    SELECT idx, core_key, sum(signals)::integer AS core_signals,
           jsonb_agg(jsonb_build_object(
             'term', term_name, 'kind', signal_type, 'signals', signals,
             'fromCurrentEmployees', from_current_employees,
             'fromAlumniOrJobs', from_alumni_or_jobs, 'latestAt', latest_at
           ) ORDER BY signals DESC, term_name) AS hits
    FROM core_terms GROUP BY idx, core_key
  ),
  ranked AS (
    SELECT
      e.idx, e.company_id, e.name, e.website, e.country, e.industry, e.core_key,
      e.confidence, e.tier,
      coalesce(ot.own_signals, 0)  AS own_signals,
      coalesce(ct.core_signals, 0) AS core_signals,
      ct.hits,
      row_number() OVER w AS rank,
      first_value(e.core_key) OVER w AS winner_core,
      count(*) OVER (PARTITION BY e.idx) AS candidate_count
    FROM in_country e
    LEFT JOIN own_totals  ot ON ot.idx = e.idx AND ot.company_id = e.company_id
    LEFT JOIN core_totals ct ON ct.idx = e.idx AND ct.core_key   = e.core_key
    WINDOW w AS (
      PARTITION BY e.idx
      ORDER BY e.confidence DESC, coalesce(ct.core_signals, 0) DESC,
               coalesce(ot.own_signals, 0) DESC, e.tier, e.name, e.company_id
    )
  ),
  duplicates AS (
    SELECT idx, count(*)::integer AS duplicate_entities FROM ranked WHERE core_key = winner_core GROUP BY idx
  ),
  -- El mejor candidato de nucleo DISTINTO: el unico que puede volver ambigua la fila.
  rival AS (
    SELECT DISTINCT ON (idx) idx, confidence AS rival_confidence, core_signals AS rival_signals
    FROM ranked WHERE core_key <> winner_core ORDER BY idx, rank
  ),
  candidate_lists AS (
    SELECT idx, jsonb_agg(jsonb_build_object(
             'companyId', company_id, 'name', name, 'domain', website, 'country', country,
             'confidence', round(confidence, 2), 'signalsForTerms', core_signals,
             'isDuplicateOfWinner', core_key = winner_core
           ) ORDER BY rank) AS candidates
    FROM ranked WHERE rank <= p_max_candidates GROUP BY idx
  ),
  country_filtered AS (
    SELECT idx, count(*)::integer AS filtered_by_country FROM enriched WHERE excluded_by_country GROUP BY idx
  ),
  best AS (SELECT * FROM ranked WHERE rank = 1),
  rows_out AS (
    SELECT
      i.idx, i.input,
      CASE
        WHEN b.company_id IS NULL THEN 'no_match'
        WHEN b.confidence < p_match_threshold
          -- Solo un nucleo DISTINTO compite, y solo si la evidencia no desempata:
          -- si el ganador tiene señales y el rival no, la eleccion es clara.
          OR (r.rival_confidence IS NOT NULL
              AND r.rival_confidence >= b.confidence - 0.10
              AND (r.rival_signals > 0 OR b.core_signals = 0))
          THEN 'matched_ambiguous'
        WHEN v_has_terms AND b.core_signals = 0 THEN 'matched_no_signal'
        ELSE 'matched'
      END AS status,
      CASE
        WHEN b.company_id IS NULL THEN NULL
        WHEN r.rival_confidence IS NOT NULL AND r.rival_confidence >= b.confidence - 0.10
             AND (r.rival_signals > 0 OR b.core_signals = 0) THEN 'multiple_candidates'
        WHEN b.confidence < p_match_threshold THEN 'low_confidence'
        ELSE NULL
      END AS ambiguity_reason,
      b.company_id, b.name, b.website, b.country, b.industry,
      b.confidence, b.own_signals, b.core_signals, b.hits, b.candidate_count,
      CASE
        WHEN NOT v_has_terms      THEN 'not_evaluated'
        WHEN b.core_signals = 0   THEN 'none'
        WHEN b.core_signals < p_min_signals THEN 'weak'
        ELSE 'solid'
      END AS signal_strength,
      coalesce(d.duplicate_entities, 0) AS duplicate_entities,
      coalesce(cf.filtered_by_country, 0) AS filtered_by_country,
      cl.candidates
    FROM inputs i
    LEFT JOIN best b              ON b.idx  = i.idx
    LEFT JOIN duplicates d        ON d.idx  = i.idx
    LEFT JOIN rival r             ON r.idx  = i.idx
    LEFT JOIN candidate_lists cl  ON cl.idx = i.idx
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
      -- Consolidado por nucleo: es el numero de la EMPRESA.
      'signalsForTerms', coalesce(r.core_signals, 0),
      -- Solo de la entidad devuelta. Si difiere, la cuenta esta fragmentada.
      'signalsOwn',      coalesce(r.own_signals, 0),
      'duplicateEntities', r.duplicate_entities,
      'signalStrength',  r.signal_strength,
      'termHits',        coalesce(r.hits, '[]'::jsonb),
      'candidateCount',  coalesce(r.candidate_count, 0),
      'ambiguityReason', r.ambiguity_reason,
      'filteredByCountry', r.filtered_by_country,
      'candidates', CASE WHEN r.status = 'matched_ambiguous' THEN coalesce(r.candidates, '[]'::jsonb) ELSE NULL END
    ) ORDER BY r.idx), '[]'::jsonb),
    'summary', jsonb_build_object(
      'inputs',          count(*),
      'matched',         count(*) FILTER (WHERE r.status = 'matched'),
      'ambiguous',       count(*) FILTER (WHERE r.status = 'matched_ambiguous'),
      'matchedNoSignal', count(*) FILTER (WHERE r.status = 'matched_no_signal'),
      'noMatch',         count(*) FILTER (WHERE r.status = 'no_match'),
      'solidSignal',     count(*) FILTER (WHERE r.signal_strength = 'solid'),
      'weakSignal',      count(*) FILTER (WHERE r.signal_strength = 'weak')
    ),
    'appliedFilters', jsonb_build_object(
      'countries', p_countries, 'minSignals', p_min_signals,
      'matchThreshold', p_match_threshold, 'minConfidence', v_min_conf,
      'maxInputs', v_max_inputs, 'termsEvaluated', v_has_terms
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
