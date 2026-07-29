-- 415 — Prueba del merge de bookmarks con contexto. CORRER SIN --commit.
--
-- Verifica las dos mitades de la decision:
--   A) contexto IDENTICO  -> se consolida en un solo bookmark, sin perder nada
--   B) contexto DISTINTO  -> se mueve tal cual y sobrevive aparte
-- y despues que el revert devuelve todo a como estaba.

DO $$
DECLARE
  v_user    UUID := (SELECT user_id FROM public.bookmarks LIMIT 1);
  v_master  UUID;
  v_dup     UUID;
  v_bm_keep UUID;  -- master, contexto X
  v_bm_drop UUID;  -- duplicada, contexto X  -> redundante
  v_bm_otro UUID;  -- duplicada, contexto Y  -> legitimo
  v_ice     UUID;
  v_dueno   UUID;
  v_res     JSONB;
  v_merge   UUID;
  v_ctx_x   JSONB := '{"filterSignalIds":["11111111-1111-1111-1111-111111111111"],"filterType":"technology"}';
  v_ctx_y   JSONB := '{"filterSignalIds":["22222222-2222-2222-2222-222222222222"],"filterType":"process"}';
  v_n       INTEGER;
  v_txt     TEXT;
BEGIN
  INSERT INTO public.companies (name) VALUES ('ZZ Test Master 415') RETURNING id INTO v_master;
  INSERT INTO public.companies (name) VALUES ('ZZ Test Dup 415')    RETURNING id INTO v_dup;

  -- A) mismo contexto en las dos empresas
  INSERT INTO public.bookmarks (user_id, company_id, search_context, notes, status, priority)
  VALUES (v_user, v_master, v_ctx_x, 'nota del master', 'nuevo', NULL)
  RETURNING id INTO v_bm_keep;

  INSERT INTO public.bookmarks (user_id, company_id, search_context, notes, status, priority)
  VALUES (v_user, v_dup, v_ctx_x, 'nota de la duplicada', 'reunion', 'alta')
  RETURNING id INTO v_bm_drop;

  -- B) contexto distinto: NO debe consolidarse
  INSERT INTO public.bookmarks (user_id, company_id, search_context, notes, status)
  VALUES (v_user, v_dup, v_ctx_y, 'otra busqueda', 'contactado')
  RETURNING id INTO v_bm_otro;

  -- Resumen en los dos: choca contra UNIQUE (bookmark_id) al mover
  INSERT INTO public.bookmark_summaries (bookmark_id, summary) VALUES (v_bm_keep, 'resumen master');
  INSERT INTO public.bookmark_summaries (bookmark_id, summary) VALUES (v_bm_drop, 'resumen duplicada');
  -- Icebreaker solo en la duplicada: se tiene que mover (es CASCADE, se perderia)
  INSERT INTO public.user_icebreakers (user_id, company_id, bookmark_id)
  VALUES (v_user, v_dup, v_bm_drop) RETURNING id INTO v_ice;

  -- ---- MERGE ----
  v_res := public.merge_companies(v_master, v_dup, false, 'manual', NULL, 'test 415', NULL);
  v_merge := (v_res->>'merge_id')::uuid;

  IF (v_res->>'bookmarks_consolidados')::int <> 1 THEN
    RAISE EXCEPTION 'FALLO: se esperaba 1 bookmark consolidado, hubo %',
      v_res->>'bookmarks_consolidados';
  END IF;

  IF EXISTS (SELECT 1 FROM public.bookmarks WHERE id = v_bm_drop) THEN
    RAISE EXCEPTION 'FALLO: el bookmark redundante sigue existiendo';
  END IF;

  -- B) el de contexto distinto sobrevive, ahora bajo el master
  SELECT company_id INTO v_dueno FROM public.bookmarks WHERE id = v_bm_otro;
  IF v_dueno IS NULL THEN
    RAISE EXCEPTION 'FALLO: se borro el bookmark de contexto DISTINTO';
  END IF;
  IF v_dueno <> v_master THEN
    RAISE EXCEPTION 'FALLO: el bookmark de contexto distinto no quedo en el master';
  END IF;
  RAISE NOTICE 'OK contexto distinto: sobrevive aparte';

  -- Notas concatenadas, no descartadas
  SELECT notes INTO v_txt FROM public.bookmarks WHERE id = v_bm_keep;
  IF v_txt NOT LIKE '%nota del master%' OR v_txt NOT LIKE '%nota de la duplicada%' THEN
    RAISE EXCEPTION 'FALLO: se perdio una nota del usuario -> %', v_txt;
  END IF;
  RAISE NOTICE 'OK notas concatenadas';

  -- Estado mas avanzado gana ('reunion' sobre 'nuevo')
  SELECT status INTO v_txt FROM public.bookmarks WHERE id = v_bm_keep;
  IF v_txt <> 'reunion' THEN
    RAISE EXCEPTION 'FALLO: status quedo en % y se esperaba reunion', v_txt;
  END IF;
  -- Prioridad: el sobreviviente no tenia, hereda la de la duplicada
  SELECT priority INTO v_txt FROM public.bookmarks WHERE id = v_bm_keep;
  IF v_txt <> 'alta' THEN
    RAISE EXCEPTION 'FALLO: priority quedo en % y se esperaba alta', v_txt;
  END IF;
  RAISE NOTICE 'OK status y priority conciliados';

  -- El icebreaker se movio (no se perdio por CASCADE)
  SELECT bookmark_id INTO v_txt FROM public.user_icebreakers WHERE id = v_ice;
  IF v_txt IS DISTINCT FROM v_bm_keep::text THEN
    RAISE EXCEPTION 'FALLO: el icebreaker no se movio al sobreviviente (%)', v_txt;
  END IF;
  RAISE NOTICE 'OK icebreaker movido, no borrado por cascada';

  -- El resumen del sobreviviente se conserva; el otro quedo guardado en el log
  SELECT summary INTO v_txt FROM public.bookmark_summaries WHERE bookmark_id = v_bm_keep;
  IF v_txt <> 'resumen master' THEN
    RAISE EXCEPTION 'FALLO: el resumen del sobreviviente cambio -> %', v_txt;
  END IF;
  SELECT count(*) INTO v_n
  FROM v3.company_merges m,
       jsonb_array_elements(m.bookmark_merge) e
  WHERE m.id = v_merge AND e->'deleted' ? 'bookmark_summaries';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO: el resumen borrado no quedo en el log (n=%)', v_n;
  END IF;
  RAISE NOTICE 'OK resumen en conflicto guardado en el log';

  -- ---- REVERT ----
  PERFORM public.revert_company_merge(v_merge);

  IF NOT EXISTS (SELECT 1 FROM public.bookmarks WHERE id = v_bm_drop) THEN
    RAISE EXCEPTION 'FALLO revert: no volvio el bookmark redundante';
  END IF;
  SELECT notes INTO v_txt FROM public.bookmarks WHERE id = v_bm_keep;
  IF v_txt <> 'nota del master' THEN
    RAISE EXCEPTION 'FALLO revert: las notas quedaron en % ', v_txt;
  END IF;
  SELECT bookmark_id INTO v_txt FROM public.user_icebreakers WHERE id = v_ice;
  IF v_txt IS DISTINCT FROM v_bm_drop::text THEN
    RAISE EXCEPTION 'FALLO revert: el icebreaker no volvio (%)', v_txt;
  END IF;
  SELECT count(*) INTO v_n FROM public.bookmark_summaries WHERE bookmark_id = v_bm_drop;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO revert: no volvio el resumen borrado (n=%)', v_n;
  END IF;
  RAISE NOTICE 'OK revert: bookmark, notas, icebreaker y resumen restaurados';

  RAISE NOTICE '=== TODO OK ===';
END $$;
