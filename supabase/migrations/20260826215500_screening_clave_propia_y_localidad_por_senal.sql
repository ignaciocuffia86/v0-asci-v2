-- ═══════════════════════════════════════════════════════════
-- El matching del screening: consolidar variantes y entender la localidad.
--
-- Sale de la primera corrida real del perfil admin (75 cuentas de Chile, señal
-- Power BI): 21 de 75 no llegaban al enrichment por defectos de matching, no por
-- falta de datos. 14 quedaban "hay que confirmar cuál es" y 7 "no está en ASCI"
-- cuando 6 de esas 7 sí estaban.
--
-- ── POR QUÉ UNA CLAVE NUEVA Y NO TOCAR company_core_name ──────────────────
--
-- El diagnóstico decía que la ambigüedad venía de `company_core_name`, que no
-- saca puntuación: "Antofagasta Minerals (AMSA)" y "Antofagasta Minerals AMSA"
-- quedan como dos entidades rivales por dos paréntesis, y "Cia. Pesquera
-- Camanchaca S.A." contra "Cia.Pesquera Camanchaca S.A." por UN espacio.
--
-- El primer impulso fue aflojar esa función. NO se hace, y la razón apareció
-- mirando quién la usa: `normalized_name` se deriva de ella (verificado: 15.922
-- de 20.000 filas coinciden exacto, 0 divergen), y de esa columna dependen
-- `upsert_company` —que decide si una empresa ya existe al ingestar— y
-- `auto_merge_safe_duplicates`, que agrupa `GROUP BY normalized_name` y FUSIONA
-- el grupo. Aflojar el normalizador y backfillear haría que ese cron empiece a
-- fusionar empresas hoy separadas, sobre 517.326 filas y sin vuelta atrás.
--
-- Por eso la clave laxa es SEPARADA y la usa solo el screening. Se calcula al
-- vuelo sobre el puñado de candidatas de cada consulta: sin backfill, sin tocar
-- la ingesta, sin riesgo para el merge.
--
-- ── POR QUÉ EL TOPE DE 6 CARACTERES EN EL PLURAL ──────────────────────────
--
-- Medido sobre 120.000 empresas reales: singularizar cualquier token agrega 248
-- fusiones y algunas están mal, siempre en siglas cortas donde la `s` es parte
-- del acrónimo ("NC Group" con "NCS Group", "serh" con "serhs"). Exigiendo 6+
-- caracteres quedan 163 fusiones y las revisadas son todas correctas
-- ("abogado/abogados", "acero/aceros hochschild", "180 degree/degrees
-- consulting"). El tope no es estético: es lo que separa un plural de una sigla.
--
-- ── LA LOCALIDAD PASA A SER POR SEÑAL ─────────────────────────────────────
--
-- `countries` comparaba contra `companies.country`, que es el país de la CASA
-- MATRIZ. Reproducido: con `array['Chile']` los 7 dan no_match y
-- filteredByCountry=1; sin países, 6 matchean contra su ficha global (MAPFRE →
-- Spain, SURA → Colombia, Principal Financial → United States). Una
-- multinacional con operación en Chile quedaba afuera por tener la sede en
-- España.
--
-- La evidencia gana sobre la ficha, y los datos lo respaldan: `companies.country`
-- tiene 12,6% de cobertura y `contacts.country_normalized` 94,4%. MAPFRE tiene 25
-- contactos en Chile de 291; EWOS, 1 de 1.
--
-- El cambio es ADITIVO a propósito: solo RESCATA candidatas que hoy se excluyen,
-- nunca excluye una que hoy pasa. Un filtro que empieza a sacar cosas es mucho
-- más difícil de notar que uno que empieza a dejarlas entrar.
--
-- ── Y NUNCA MÁS "no_match" HABIENDO EXCLUIDO NOSOTROS ─────────────────────
--
-- `no_match` significa "no está en el catálogo". Decir eso cuando la candidata
-- existía y la descartó nuestro propio filtro es reportar mal, y es lo que hizo
-- perder 6 empresas. Ahora esas filas salen como `matched_ambiguous` con motivo
-- `country_mismatch` y con las candidatas excluidas a la vista, SIN elegir una:
-- la decisión es de quien mira, no nuestra.
-- ═══════════════════════════════════════════════════════════

-- ── 1. La clave de consolidación del screening ────────────────────────────
--
-- El cuerpo va con tag NOMBRADO (`$screen_key$`) y no con `$$`. No es estilo: con
-- `$$` y comentarios adentro, el runner de migraciones de Supabase cortó el
-- statement en medio del cuerpo y falló con "syntax error at end of input",
-- mientras el mismo archivo parsea limpio en un Postgres 16 local. De las
-- migraciones ya aplicadas, la única con comentarios dentro del cuerpo
-- (20260824205956) usa `$function$`; la que usa `$$` no tiene ninguno.
create or replace function public.company_screen_key(p_name text)
returns text
language sql
immutable
set search_path to 'public', 'extensions', 'pg_catalog'
as $screen_key$
  select nullif(btrim(regexp_replace(
    -- 3) Espacios colapsados: "cia.  pesquera" y "cia. pesquera" son el mismo nombre.
    regexp_replace(
      -- 2) Plural en tokens de 6+ caracteres. El guard evita comerse la `s` de
      --    una sigla ("NCS", "SERHS"): ahí la `s` es parte del nombre.
      regexp_replace(
        -- 1) Puntuación a ESPACIO, no a vacío. Es la diferencia entre que
        --    "cia.pesquera" se vuelva "cia pesquera" (y colapse con
        --    "cia. pesquera") o "ciapesquera" (y no colapse con nada).
        regexp_replace(public.company_core_name(p_name), '[().,:&+_\[\]{}«»-]+', ' ', 'g'),
      '(\w{5})s\M', '\1', 'g'),
    '\s+', ' ', 'g')), '')
$screen_key$;

comment on function public.company_screen_key(text) is
  'Clave de consolidación LAXA, solo para v3.screen_account_list. Deliberadamente separada de company_core_name/normalized_name, de las que dependen upsert_company y auto_merge_safe_duplicates: aflojar aquéllas haría que el merge automático fusione empresas hoy separadas.';

-- ── 2. El screening ───────────────────────────────────────────────────────
create or replace function v3.screen_account_list(
  p_accounts jsonb,
  p_product_ids uuid[] default null::uuid[],
  p_process_ids uuid[] default null::uuid[],
  p_countries text[] default null::text[],
  p_min_signals integer default 2,
  p_max_candidates integer default 5,
  p_match_threshold numeric default 0.75
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_catalog'
as $function$
DECLARE
  v_count           integer;
  v_has_terms       boolean;
  v_min_conf        constant numeric := 0.50;
  v_max_inputs      constant integer := 100;
  -- Tope de contactos que se miran por candidata para decidir la localidad. Con
  -- EXISTS alcanzaría para decidir, pero entonces no se podría DECIR cuánta
  -- evidencia había; y sin tope, una candidata con 100.000 contactos haría un
  -- scan completo por cada corrida. 50 responde las dos cosas.
  v_locality_probe  constant integer := 50;
  v_countries_norm  text[];
  v_result          jsonb;
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

  -- Los países pedidos, normalizados UNA vez con la misma función que normalizó
  -- `contacts.country_normalized`. Comparar "Chile" contra "CL" sin esto daría
  -- cero localidad para todo el mundo, en silencio.
  IF p_countries IS NOT NULL THEN
    SELECT array_agg(lower(btrim(public.normalize_country(x))))
      INTO v_countries_norm
      FROM unnest(p_countries) AS x;
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
  -- LOCALIDAD POR SEÑAL. Cuánta gente de esta empresa está en los países
  -- pedidos. Acotado a v_locality_probe para que el costo no dependa del tamaño
  -- de la empresa.
  locality AS (
    SELECT cd.idx, cd.company_id, z.local_contacts
    FROM candidates cd
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS local_contacts
      FROM (
        SELECT 1
        FROM public.contacts ct
        WHERE v_countries_norm IS NOT NULL
          AND ct.current_company_id = cd.company_id
          AND lower(btrim(ct.country_normalized)) = ANY (v_countries_norm)
        LIMIT v_locality_probe
      ) s
    ) z
  ),
  enriched AS (
    SELECT
      cd.idx, cd.company_id, cd.tier, cd.sim, cd.core_match, cd.domain_match, cd.core_contained,
      c.name, c.website, nullif(btrim(c.country), '') AS country, c.industry,
      -- La clave laxa, calculada al vuelo. Antes era `c.normalized_name`, y por
      -- eso dos paréntesis convertían una empresa en dos entidades rivales.
      coalesce(public.company_screen_key(c.name), cd.company_id::text) AS core_key,
      coalesce(loc.local_contacts, 0) AS local_contacts,
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
        -- El rescate por evidencia: la ficha dice otro país pero la gente está
        -- acá. Va DESPUÉS de las reglas viejas, así que solo agrega candidatas.
        WHEN coalesce(loc.local_contacts, 0) > 0 THEN false
        ELSE true
      END AS excluded_by_country
    FROM candidates cd
    JOIN public.companies c ON c.id = cd.company_id
    LEFT JOIN locality loc ON loc.idx = cd.idx AND loc.company_id = cd.company_id
  ),
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
      e.confidence, e.tier, e.local_contacts,
      coalesce(ot.own_signals, 0)  AS own_signals,
      coalesce(ct.core_signals, 0) AS core_signals,
      ct.hits,
      row_number() OVER w AS rank,
      first_value(e.core_key) OVER w AS winner_core,
      first_value(e.confidence) OVER w AS winner_confidence,
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
  -- CONTENDIENTES, que no es lo mismo que candidatas. El informe decía "elegir
  -- entre 19" cuando la contienda real era entre 2: 19 es el pool entero, y
  -- pedirle a alguien que elija entre 19 es lo que hacía sentir roto el reporte.
  contenders AS (
    SELECT idx, count(*)::integer AS contender_count
    FROM ranked
    WHERE core_key <> winner_core AND confidence >= winner_confidence - 0.10
    GROUP BY idx
  ),
  rival AS (
    SELECT DISTINCT ON (idx) idx, confidence AS rival_confidence, core_signals AS rival_signals
    FROM ranked WHERE core_key <> winner_core ORDER BY idx, rank
  ),
  candidate_lists AS (
    SELECT idx, jsonb_agg(jsonb_build_object(
             'companyId', company_id, 'name', name, 'domain', website, 'country', country,
             'confidence', round(confidence, 2), 'signalsForTerms', core_signals,
             'localContacts', local_contacts,
             'isDuplicateOfWinner', core_key = winner_core
           ) ORDER BY rank) AS candidates
    FROM ranked WHERE rank <= p_max_candidates GROUP BY idx
  ),
  country_filtered AS (
    SELECT idx, count(*)::integer AS filtered_by_country FROM enriched WHERE excluded_by_country GROUP BY idx
  ),
  -- LA RED DE SEGURIDAD. Las candidatas que sacó el filtro de país, para poder
  -- mostrarlas cuando no quedó ninguna otra en vez de decir "no está".
  excluded_lists AS (
    SELECT idx, jsonb_agg(jsonb_build_object(
             'companyId', company_id, 'name', name, 'domain', website, 'country', country,
             'confidence', round(confidence, 2), 'signalsForTerms', 0,
             'localContacts', local_contacts,
             'isDuplicateOfWinner', false
           ) ORDER BY confidence DESC, name) AS candidates
    FROM (
      SELECT *, row_number() OVER (PARTITION BY idx ORDER BY confidence DESC, name) AS rk
      FROM enriched WHERE excluded_by_country AND confidence >= v_min_conf
    ) x
    WHERE rk <= p_max_candidates
    GROUP BY idx
  ),
  best AS (SELECT * FROM ranked WHERE rank = 1),
  rows_out AS (
    SELECT
      i.idx, i.input,
      CASE
        -- No hay ganadora, PERO habíamos excluido candidatas por país: eso no es
        -- "no está en el catálogo", es "está y la descartamos nosotros".
        WHEN b.company_id IS NULL AND el.candidates IS NOT NULL THEN 'matched_ambiguous'
        WHEN b.company_id IS NULL THEN 'no_match'
        WHEN b.confidence < p_match_threshold
          OR (r.rival_confidence IS NOT NULL
              AND r.rival_confidence >= b.confidence - 0.10
              AND (r.rival_signals > 0 OR b.core_signals = 0))
          THEN 'matched_ambiguous'
        WHEN v_has_terms AND b.core_signals = 0 THEN 'matched_no_signal'
        ELSE 'matched'
      END AS status,
      CASE
        WHEN b.company_id IS NULL AND el.candidates IS NOT NULL THEN 'country_mismatch'
        WHEN b.company_id IS NULL THEN NULL
        WHEN r.rival_confidence IS NOT NULL AND r.rival_confidence >= b.confidence - 0.10
             AND (r.rival_signals > 0 OR b.core_signals = 0) THEN 'multiple_candidates'
        WHEN b.confidence < p_match_threshold THEN 'low_confidence'
        ELSE NULL
      END AS ambiguity_reason,
      b.company_id, b.name, b.website, b.country, b.industry,
      b.confidence, b.own_signals, b.core_signals, b.hits, b.candidate_count,
      b.local_contacts,
      CASE
        WHEN NOT v_has_terms      THEN 'not_evaluated'
        WHEN b.core_signals = 0   THEN 'none'
        WHEN b.core_signals < p_min_signals THEN 'weak'
        ELSE 'solid'
      END AS signal_strength,
      coalesce(d.duplicate_entities, 0) AS duplicate_entities,
      coalesce(cn.contender_count, 0) AS contender_count,
      coalesce(cf.filtered_by_country, 0) AS filtered_by_country,
      coalesce(cl.candidates, el.candidates) AS candidates
    FROM inputs i
    LEFT JOIN best b              ON b.idx  = i.idx
    LEFT JOIN duplicates d        ON d.idx  = i.idx
    LEFT JOIN contenders cn       ON cn.idx = i.idx
    LEFT JOIN rival r             ON r.idx  = i.idx
    LEFT JOIN candidate_lists cl  ON cl.idx = i.idx
    LEFT JOIN excluded_lists el   ON el.idx = i.idx
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
      'signalsForTerms', coalesce(r.core_signals, 0),
      'signalsOwn',      coalesce(r.own_signals, 0),
      'duplicateEntities', r.duplicate_entities,
      'signalStrength',  r.signal_strength,
      'termHits',        coalesce(r.hits, '[]'::jsonb),
      'candidateCount',  coalesce(r.candidate_count, 0),
      'contenderCount',  r.contender_count,
      'localContacts',   coalesce(r.local_contacts, 0),
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
      'countryMismatch', count(*) FILTER (WHERE r.ambiguity_reason = 'country_mismatch'),
      'solidSignal',     count(*) FILTER (WHERE r.signal_strength = 'solid'),
      'weakSignal',      count(*) FILTER (WHERE r.signal_strength = 'weak')
    ),
    'appliedFilters', jsonb_build_object(
      'countries', p_countries, 'minSignals', p_min_signals,
      'matchThreshold', p_match_threshold, 'minConfidence', v_min_conf,
      'maxInputs', v_max_inputs, 'termsEvaluated', v_has_terms,
      'localityBySignal', true
    )
  )
  INTO v_result
  FROM rows_out r;

  RETURN v_result;
END;
$function$;
