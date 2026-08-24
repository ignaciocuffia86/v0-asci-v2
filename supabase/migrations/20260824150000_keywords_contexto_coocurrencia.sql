-- ═══════════════════════════════════════════════════════════════════
-- Keywords con co-ocurrencia: contexto obligatorio y exclusiones
--
-- El problema
-- -----------
-- Hay keywords que son la única forma en que la gente nombra un producto y
-- que, aisladas, son palabras comunes. Hasta ahora había dos salidas: dejarlas
-- y comerse el ruido, o borrarlas y perder las señales reales. En los siete
-- lotes de limpieza se eligió borrar, y con eso se perdieron señales buenas:
--
--   Fabric          556 contactos la mencionan como palabra suelta. Sacándola
--                   del diccionario se perdieron ~137 perfiles que son de
--                   Microsoft Fabric de verdad.
--   Exchange        ~57% Microsoft Exchange, el resto "exchange rate",
--                   "stock exchange", "exchange program".
--   Commerce Cloud  Salesforce vs. SAP vs. Oracle vs. genérico.
--
-- Dos mecanismos, porque son dos errores distintos
-- ------------------------------------------------
-- Medido sobre el corpus, el ruido de "Fabric" viene de dos lugares y cada
-- uno necesita su remedio:
--
--  1. Ambigüedad de DOMINIO: la misma palabra en otra industria. Textil,
--     redes, arquitectura urbana. Se resuelve exigiendo que el texto además
--     mencione algo del dominio correcto → keywords_contexto.
--     556 → 154 contactos exigiendo Power BI / Synapse / OneLake / Lakehouse /
--     Data Factory / Databricks / DAX / Power Query / DP-600.
--
--  2. Ambigüedad de COLOCACIÓN: la palabra es parte del nombre de otro
--     producto. "Service Fabric" (Azure, microservicios), "Hyperledger
--     Fabric" (blockchain), "Data Fabric" (patrón de arquitectura), "Fabric
--     UI" (CSS de Office), "Fabric Manager" (Cisco), "K2View Fabric",
--     "Fabric Care" (P&G). El contexto NO las filtra: son gente de datos que
--     legítimamente dice "Power BI" y "Service Fabric" en el mismo perfil.
--     Se resuelve neutralizando la frase → keywords_excluye.
--     Descarta 17 de esos 154 que el contexto solo dejaba pasar.
--
-- Sobre la muestra de los 137 que sobreviven a los dos filtros, el error
-- residual medido fue 4/40 (10%), y las cuatro eran colocaciones que faltaban
-- en la lista. Con ellas agregadas la keyword queda por encima de 95:5, muy
-- arriba del umbral de 80:20 que se viene usando en toda la auditoría.
--
-- Dónde se aplica cada uno
-- ------------------------
-- No es una distinción cosmética:
--
--   keywords_contexto → a nivel ENTIDAD. Es evidencia sobre el dominio de la
--     persona o de la vacante, no sobre una oración. Un perfil de redes no
--     dice "Power BI" en ninguna parte; uno de datos sí, aunque "Fabric" esté
--     en el headline y "Power BI" en un puesto de 2019.
--
--   keywords_excluye → a nivel OCURRENCIA. Es sobre esta mención puntual. Se
--     enmascaran las frases excluidas y se exige que la keyword siga
--     apareciendo en lo que queda. Así un perfil que dice "Service Fabric" y
--     "Microsoft Fabric" conserva la señal, y uno que solo dice "Service
--     Fabric" la pierde.
--
-- Forma de los campos, objeto JSON keyword → array de términos:
--
--   keywords_contexto: {"Fabric": ["Power BI", "Synapse", "OneLake"]}
--   keywords_excluye:  {"Fabric": ["Service Fabric", "Hyperledger Fabric"]}
--
-- Compatibilidad
-- --------------
-- Sin entrada, los dos patrones quedan NULL y el comportamiento es idéntico
-- al de hoy: las 3.000 keywords existentes no cambian. El CASE (en vez de un
-- OR) garantiza que la rama cara no se evalúe cuando no hay contexto: en
-- Postgres el OR puede reordenarse por costo, el CASE no.
--
-- Rendimiento
-- -----------
-- Los guardas van SIEMPRE después del predicado crudo de la keyword, nunca en
-- su lugar. El predicado crudo es el que usa los índices GIN trgm por columna,
-- y como enmascarar solo puede quitar coincidencias, el conjunto crudo es un
-- superconjunto del filtrado. Poner dict_mask sobre la columna en el predicado
-- principal mataría el índice y convertiría el match de contactos en un seq
-- scan.
-- ═══════════════════════════════════════════════════════════════════

alter table public.dictionary_products
  add column if not exists keywords_contexto jsonb not null default '{}'::jsonb;
alter table public.dictionary_products
  add column if not exists keywords_excluye jsonb not null default '{}'::jsonb;

comment on column public.dictionary_products.keywords_contexto is
  'Co-ocurrencia obligatoria, a nivel entidad. Objeto keyword -> array de terminos. La keyword genera senal solo si el texto completo de la entidad tambien menciona al menos uno de esos terminos. Keyword sin entrada = matcheo directo.';
comment on column public.dictionary_products.keywords_excluye is
  'Colocaciones que neutralizan la ocurrencia. Objeto keyword -> array de frases. Se enmascaran del texto y se exige que la keyword siga apareciendo en lo que queda.';

-- El match de la keyword contra la clave del objeto es case-insensitive, asi
-- que no puede haber dos claves que difieran solo en mayusculas.
alter table public.dictionary_products
  drop constraint if exists dictionary_products_keywords_contexto_obj;
alter table public.dictionary_products
  add constraint dictionary_products_keywords_contexto_obj
  check (jsonb_typeof(keywords_contexto) = 'object');
alter table public.dictionary_products
  drop constraint if exists dictionary_products_keywords_excluye_obj;
alter table public.dictionary_products
  add constraint dictionary_products_keywords_excluye_obj
  check (jsonb_typeof(keywords_excluye) = 'object');

-- Enmascara las colocaciones excluidas. Con p_excl NULL devuelve el texto tal
-- cual (coalesceado), que es exactamente lo que hacian los COALESCE que
-- reemplaza: para las keywords sin exclusiones el resultado es identico.
create or replace function public.dict_mask(p_text text, p_excl text)
returns text language sql immutable parallel safe as $fn$
  select case
           when p_excl is null then coalesce(p_text, '')
           else regexp_replace(coalesce(p_text, ''), p_excl, ' ', 'gi')
         end
$fn$;

comment on function public.dict_mask(text, text) is
  'Quita del texto las colocaciones excluidas de una keyword, para que la ocurrencia dentro de "Service Fabric" no cuente como "Fabric". Ver dictionary_products.keywords_excluye.';

-- Arma el patron de alternancia para una keyword a partir de uno de los dos
-- mapas. Devuelve NULL si la keyword no tiene entrada, que es el caso de la
-- enorme mayoria y el que preserva el comportamiento actual.
--
-- El limite \y se agrega solo en los extremos alfanumericos del termino, por
-- la misma razon que en el matcher de TypeScript: ".NET" con \y adelante no
-- matchearia nunca, y "C++" con \y atras tampoco.
create or replace function public.dict_alt_pattern(p_map jsonb, p_keyword text)
returns text language sql stable parallel safe as $fn$
  select '(' || string_agg(
           case when t ~ '^\w' then '\y' else '' end ||
           public.escape_regex(t) ||
           case when t ~ '\w$' then '\y' else '' end,
           '|') || ')'
  from jsonb_each(coalesce(p_map, '{}'::jsonb)) as kv(k, v)
  cross join lateral jsonb_array_elements_text(kv.v) as t
  where lower(kv.k) = lower(coalesce(p_keyword, ''))
    and length(btrim(t)) > 0
$fn$;

comment on function public.dict_alt_pattern(jsonb, text) is
  'Patron regex de alternancia con los terminos que un mapa (keywords_contexto o keywords_excluye) asocia a una keyword. NULL si no hay entrada.';

CREATE OR REPLACE FUNCTION public.process_dictionary_job(p_job_id uuid, p_batch_size integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '40s'
AS $function$
DECLARE
  v_job RECORD;
  v_result JSONB;
  v_pattern text;
  v_ctx_pattern text;
  v_excl_pattern text;
  v_ids uuid[];
  v_new_cursor uuid;
  v_window_count integer;
  v_matched integer;
  v_signals_created integer := 0;
  v_inserted integer;
  v_has_more boolean := false;
  v_six_months_ago timestamptz := NOW() - INTERVAL '6 months';
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_job_id::text, 0)) THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'locked');
  END IF;

  SELECT * INTO v_job FROM public.dictionary_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Job not found');
  END IF;

  IF v_job.status = 'pending' THEN
    UPDATE public.dictionary_jobs
    SET status = 'processing', started_at = NOW()
    WHERE id = p_job_id;
    SELECT * INTO v_job FROM public.dictionary_jobs WHERE id = p_job_id;
  END IF;

  IF v_job.job_type = 'remove_keyword' THEN
    v_result := public.process_remove_keyword(v_job.signal_id, v_job.keyword);
    UPDATE public.dictionary_jobs
    SET status = 'completed', completed_at = NOW(), progress = 100,
        processed_records = (v_result->>'deleted_count')::INTEGER,
        total_records = (v_result->>'deleted_count')::INTEGER,
        phase = 'done'
    WHERE id = p_job_id;
    RETURN v_result;
  END IF;

  IF v_job.job_type <> 'add_keyword' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown job type');
  END IF;

  v_pattern := '\y' || public.escape_regex(v_job.keyword) || '\y';

  -- Co-ocurrencia. Ambos quedan NULL si la keyword no la usa, que es el caso
  -- de la enorme mayoria: ahi el resto de la funcion se comporta como antes.
  -- Solo los productos tienen los mapas; un job de proceso nunca los levanta.
  IF v_job.signal_type = 'technology' THEN
    SELECT public.dict_alt_pattern(p.keywords_contexto, v_job.keyword),
           public.dict_alt_pattern(p.keywords_excluye,  v_job.keyword)
      INTO v_ctx_pattern, v_excl_pattern
    FROM public.dictionary_products p
    WHERE p.id = v_job.signal_id;
  END IF;

  IF v_job.phase IS NULL OR v_job.phase = 'contacts' OR v_job.phase = 'match_contacts' THEN
    DELETE FROM public.dictionary_job_matches
    WHERE job_id = p_job_id AND entity_type = 'contact';

    -- El predicado crudo va primero y es el que usa los indices GIN trgm. Los
    -- dos guardas van despues, sobre el conjunto ya reducido: enmascarar solo
    -- puede quitar coincidencias, asi que el crudo es un superconjunto.
    INSERT INTO public.dictionary_job_matches (job_id, entity_type, entity_id)
    SELECT p_job_id, 'contact', c.id
    FROM public.contacts c
    WHERE (
      c.current_position_title       ~* v_pattern OR
      c.headline                      ~* v_pattern OR
      c.about                         ~* v_pattern OR
      c.current_position_description   ~* v_pattern OR
      public.contacts_prevpos_text(c.previous_positions) ~* v_pattern
    )
    AND CASE WHEN v_excl_pattern IS NULL THEN TRUE ELSE public.dict_mask(
      COALESCE(c.current_position_title, '')       || ' ' ||
      COALESCE(c.headline, '')                     || ' ' ||
      COALESCE(c.about, '')                        || ' ' ||
      COALESCE(c.current_position_description, '') || ' ' ||
      COALESCE(public.contacts_prevpos_text(c.previous_positions), ''),
      v_excl_pattern) ~* v_pattern END
    AND CASE WHEN v_ctx_pattern IS NULL THEN TRUE ELSE (
      COALESCE(c.current_position_title, '')       || ' ' ||
      COALESCE(c.headline, '')                     || ' ' ||
      COALESCE(c.about, '')                        || ' ' ||
      COALESCE(c.current_position_description, '') || ' ' ||
      COALESCE(public.contacts_prevpos_text(c.previous_positions), '')
    ) ~* v_ctx_pattern END
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_matched = ROW_COUNT;

    UPDATE public.dictionary_jobs
    SET phase = 'insert_contacts', contacts_cursor = NULL,
        total_records = v_matched, progress = LEAST(30, progress)
    WHERE id = p_job_id;

    RETURN jsonb_build_object('success', true, 'phase', 'insert_contacts',
      'processed', 0, 'signals_created', 0, 'matched', v_matched, 'has_more', true);
  END IF;

  IF v_job.phase = 'insert_contacts' THEN
    SELECT array_agg(entity_id ORDER BY entity_id) INTO v_ids
    FROM (
      SELECT m.entity_id FROM public.dictionary_job_matches m
      WHERE m.job_id = p_job_id AND m.entity_type = 'contact'
        AND (v_job.contacts_cursor IS NULL OR m.entity_id > v_job.contacts_cursor)
      ORDER BY m.entity_id LIMIT p_batch_size
    ) s;

    v_window_count := COALESCE(array_length(v_ids, 1), 0);

    IF v_window_count = 0 THEN
      UPDATE public.dictionary_jobs SET phase = 'match_jobs' WHERE id = p_job_id;
      RETURN jsonb_build_object('success', true, 'phase', 'match_jobs',
        'processed', 0, 'signals_created', 0, 'has_more', true);
    END IF;

    v_new_cursor := v_ids[v_window_count];

    -- La exclusion se vuelve a exigir aca, y sobre el texto del bloque actual,
    -- no sobre el de toda la entidad: el contacto puede haber pasado el match
    -- por un "Microsoft Fabric" en un puesto anterior mientras su headline
    -- dice "Service Fabric". Sin este guarda se insertaria la senal de puesto
    -- actual por la ocurrencia equivocada. El source_field se determina sobre
    -- el campo enmascarado por la misma razon.
    WITH ins AS (
      INSERT INTO public.signals (
        contact_id, company_id, signal_type, signal_id, keyword_matched,
        source_field, is_current_employee, snippet
      )
      SELECT c.id, c.current_company_id, v_job.signal_type, v_job.signal_id, v_job.keyword,
        CASE
          WHEN public.dict_mask(c.current_position_title, v_excl_pattern)       ~* v_pattern THEN 'current_position'
          WHEN public.dict_mask(c.headline, v_excl_pattern)                     ~* v_pattern THEN 'headline'
          WHEN public.dict_mask(c.about, v_excl_pattern)                        ~* v_pattern THEN 'about'
          ELSE 'current_position_description'
        END,
        TRUE,
        public.extract_snippet(
          public.dict_mask(
            COALESCE(c.current_position_title, '') || ' ' || COALESCE(c.headline, '') || ' ' ||
            COALESCE(c.about, '') || ' ' || COALESCE(c.current_position_description, ''),
            v_excl_pattern),
          v_job.keyword, 100)
      FROM public.contacts c
      WHERE c.id = ANY(v_ids)
        AND c.current_company_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.companies co WHERE co.id = c.current_company_id)
        AND (
          c.current_position_title     ~* v_pattern OR
          c.headline                    ~* v_pattern OR
          c.about                        ~* v_pattern OR
          c.current_position_description ~* v_pattern
        )
        AND CASE WHEN v_excl_pattern IS NULL THEN TRUE ELSE public.dict_mask(
          COALESCE(c.current_position_title, '') || ' ' || COALESCE(c.headline, '') || ' ' ||
          COALESCE(c.about, '') || ' ' || COALESCE(c.current_position_description, ''),
          v_excl_pattern) ~* v_pattern END
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;
    v_signals_created := v_signals_created + v_inserted;

    WITH ins AS (
      INSERT INTO public.signals (
        contact_id, company_id, signal_type, signal_id, keyword_matched,
        source_field, is_current_employee, snippet
      )
      SELECT c.id, (pos->>'company_id')::uuid, v_job.signal_type, v_job.signal_id, v_job.keyword,
        'previous_position', FALSE,
        public.extract_snippet(
          public.dict_mask(
            COALESCE(pos->>'title', '') || ' ' || COALESCE(pos->>'description', ''),
            v_excl_pattern),
          v_job.keyword, 100)
      FROM public.contacts c
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.previous_positions) = 'array'
             THEN c.previous_positions ELSE '[]'::jsonb END
      ) AS pos
      WHERE c.id = ANY(v_ids)
        AND (pos->>'company_id') IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.companies co WHERE co.id = (pos->>'company_id')::uuid)
        AND (COALESCE(pos->>'title', '') || ' ' || COALESCE(pos->>'description', '')) ~* v_pattern
        AND CASE WHEN v_excl_pattern IS NULL THEN TRUE ELSE public.dict_mask(
          COALESCE(pos->>'title', '') || ' ' || COALESCE(pos->>'description', ''),
          v_excl_pattern) ~* v_pattern END
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;
    v_signals_created := v_signals_created + v_inserted;

    v_has_more := (v_window_count = p_batch_size);

    UPDATE public.dictionary_jobs
    SET contacts_processed = COALESCE(contacts_processed, 0) + v_window_count,
        contacts_cursor = v_new_cursor,
        processed_records = COALESCE(contacts_processed, 0) + v_window_count,
        progress = CASE WHEN v_has_more THEN LEAST(59, GREATEST(progress, 40)) ELSE 60 END,
        phase = CASE WHEN v_has_more THEN 'insert_contacts' ELSE 'match_jobs' END
    WHERE id = p_job_id;

    RETURN jsonb_build_object('success', true,
      'phase', CASE WHEN v_has_more THEN 'insert_contacts' ELSE 'match_jobs' END,
      'processed', v_window_count, 'signals_created', v_signals_created, 'has_more', true);
  END IF;

  IF v_job.phase = 'match_jobs' OR v_job.phase = 'job_postings' THEN
    DELETE FROM public.dictionary_job_matches
    WHERE job_id = p_job_id AND entity_type = 'job_posting';

    INSERT INTO public.dictionary_job_matches (job_id, entity_type, entity_id)
    SELECT p_job_id, 'job_posting', jp.id
    FROM public.job_postings jp
    WHERE jp.posted_at >= v_six_months_ago
      AND (jp.title ~* v_pattern OR jp.description ~* v_pattern)
      AND CASE WHEN v_excl_pattern IS NULL THEN TRUE ELSE public.dict_mask(
        COALESCE(jp.title, '') || ' ' || COALESCE(jp.description, ''), v_excl_pattern) ~* v_pattern END
      AND CASE WHEN v_ctx_pattern IS NULL THEN TRUE ELSE
        (COALESCE(jp.title, '') || ' ' || COALESCE(jp.description, '')) ~* v_ctx_pattern END
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_matched = ROW_COUNT;

    UPDATE public.dictionary_jobs
    SET phase = 'insert_jobs', job_postings_cursor = NULL
    WHERE id = p_job_id;

    RETURN jsonb_build_object('success', true, 'phase', 'insert_jobs',
      'processed', 0, 'signals_created', 0, 'matched', v_matched, 'has_more', true);
  END IF;

  IF v_job.phase = 'insert_jobs' THEN
    SELECT array_agg(entity_id ORDER BY entity_id) INTO v_ids
    FROM (
      SELECT m.entity_id FROM public.dictionary_job_matches m
      WHERE m.job_id = p_job_id AND m.entity_type = 'job_posting'
        AND (v_job.job_postings_cursor IS NULL OR m.entity_id > v_job.job_postings_cursor)
      ORDER BY m.entity_id LIMIT p_batch_size
    ) s;

    v_window_count := COALESCE(array_length(v_ids, 1), 0);

    IF v_window_count = 0 THEN
      DELETE FROM public.dictionary_job_matches WHERE job_id = p_job_id;
      UPDATE public.dictionary_jobs
      SET status = 'completed', completed_at = NOW(), progress = 100, phase = 'done',
          processed_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0),
          total_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0)
      WHERE id = p_job_id;
      RETURN jsonb_build_object('success', true, 'phase', 'done',
        'processed', 0, 'signals_created', 0, 'has_more', false);
    END IF;

    v_new_cursor := v_ids[v_window_count];

    WITH ins AS (
      INSERT INTO public.signals (
        job_posting_id, company_id, signal_type, signal_id, keyword_matched,
        source_field, job_posted_at, snippet
      )
      SELECT jp.id, jp.company_id, v_job.signal_type, v_job.signal_id, v_job.keyword,
        CASE WHEN public.dict_mask(jp.title, v_excl_pattern) ~* v_pattern
             THEN 'job_title' ELSE 'job_description' END,
        jp.posted_at,
        public.extract_snippet(
          public.dict_mask(COALESCE(jp.title, '') || ' ' || COALESCE(jp.description, ''), v_excl_pattern),
          v_job.keyword, 100)
      FROM public.job_postings jp
      JOIN public.companies c ON c.id = jp.company_id
      WHERE jp.id = ANY(v_ids)
        AND (jp.title ~* v_pattern OR jp.description ~* v_pattern)
        AND CASE WHEN v_excl_pattern IS NULL THEN TRUE ELSE public.dict_mask(
          COALESCE(jp.title, '') || ' ' || COALESCE(jp.description, ''), v_excl_pattern) ~* v_pattern END
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_signals_created FROM ins;

    v_has_more := (v_window_count = p_batch_size);

    UPDATE public.dictionary_jobs
    SET job_postings_processed = COALESCE(job_postings_processed, 0) + v_window_count,
        job_postings_cursor = v_new_cursor,
        processed_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0) + v_window_count,
        progress = LEAST(99, GREATEST(progress, 70))
    WHERE id = p_job_id;

    IF NOT v_has_more THEN
      DELETE FROM public.dictionary_job_matches WHERE job_id = p_job_id;
      UPDATE public.dictionary_jobs
      SET status = 'completed', completed_at = NOW(), progress = 100, phase = 'done',
          processed_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0),
          total_records = COALESCE(contacts_processed, 0) + COALESCE(job_postings_processed, 0)
      WHERE id = p_job_id;
    END IF;

    RETURN jsonb_build_object('success', true,
      'phase', CASE WHEN v_has_more THEN 'insert_jobs' ELSE 'done' END,
      'processed', v_window_count, 'signals_created', v_signals_created, 'has_more', v_has_more);
  END IF;

  RETURN jsonb_build_object('success', true, 'phase', v_job.phase, 'processed', 0, 'has_more', false);
END;
$function$;
