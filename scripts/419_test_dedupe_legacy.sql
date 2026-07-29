-- =============================================================================
-- 419 - Test del ciclo completo de la limpieza historica (script 417)
--
-- Corre SIN --commit: crea bookmarks sinteticos y el dry-run del runner los
-- revierte al final. Verifica que dedupe_bookmarks_legacy consolide solo lo que
-- tiene contexto identico, y que revert_bookmark_dedupe lo deshaga todo.
-- =============================================================================

DO $$
DECLARE
  v_user    UUID;
  v_comp    UUID;
  v_keep    UUID;
  v_drop    UUID;
  v_otro    UUID;
  v_ice     UUID;
  v_batch   UUID;
  v_res     JSONB;
  v_txt     TEXT;
  v_ctx     JSONB := '{"filterType":"technology","filterSignalIds":["s1","s2"]}'::jsonb;
BEGIN
  SELECT user_id INTO v_user FROM public.bookmarks WHERE user_id IS NOT NULL LIMIT 1;

  INSERT INTO public.companies (name) VALUES ('ZZ Test Legacy Dedupe')
  RETURNING id INTO v_comp;

  -- Dos con contexto IDENTICO pero con las señales en orden distinto: la clave
  -- las ordena, asi que tienen que reconocerse como el mismo contexto.
  INSERT INTO public.bookmarks (user_id, company_id, search_context, notes, status, priority)
  VALUES (v_user, v_comp, v_ctx, 'nota del sobreviviente', 'nuevo', NULL)
  RETURNING id INTO v_keep;

  INSERT INTO public.bookmarks (user_id, company_id, search_context, notes, status, priority)
  VALUES (v_user, v_comp,
          '{"filterType":"technology","filterSignalIds":["s2","s1"]}'::jsonb,
          'nota de la redundante', 'reunion', 'alta')
  RETURNING id INTO v_drop;

  -- Y una con contexto DISTINTO, que NO se debe tocar.
  INSERT INTO public.bookmarks (user_id, company_id, search_context, notes)
  VALUES (v_user, v_comp,
          '{"filterType":"process","filterSignalIds":["s9"]}'::jsonb, 'otra busqueda')
  RETURNING id INTO v_otro;

  INSERT INTO public.user_icebreakers (user_id, company_id, bookmark_id, generated_text)
  VALUES (v_user, v_comp, v_drop, 'icebreaker de la redundante')
  RETURNING id INTO v_ice;

  -- ---------------------------------------------------------------- limpieza --
  v_res := v3.dedupe_bookmarks_legacy(500, false);
  v_batch := (v_res->>'batch_id')::uuid;

  IF v_batch IS NULL THEN
    RAISE EXCEPTION 'FALLO: no devolvio batch_id';
  END IF;

  IF EXISTS (SELECT 1 FROM public.bookmarks WHERE id = v_drop) THEN
    RAISE EXCEPTION 'FALLO: no consolido el bookmark de contexto identico';
  END IF;
  RAISE NOTICE 'OK consolido el de contexto identico (orden de señales indistinto)';

  IF NOT EXISTS (SELECT 1 FROM public.bookmarks WHERE id = v_otro) THEN
    RAISE EXCEPTION 'FALLO: borro el bookmark de contexto DISTINTO';
  END IF;
  RAISE NOTICE 'OK respeto el de contexto distinto';

  SELECT notes INTO v_txt FROM public.bookmarks WHERE id = v_keep;
  IF v_txt NOT LIKE '%sobreviviente%' OR v_txt NOT LIKE '%redundante%' THEN
    RAISE EXCEPTION 'FALLO: se perdieron notas -> %', v_txt;
  END IF;
  RAISE NOTICE 'OK notas concatenadas';

  SELECT status INTO v_txt FROM public.bookmarks WHERE id = v_keep;
  IF v_txt <> 'reunion' THEN
    RAISE EXCEPTION 'FALLO: no gano el status mas avanzado -> %', v_txt;
  END IF;
  RAISE NOTICE 'OK gano el status mas avanzado';

  SELECT bookmark_id INTO v_txt FROM public.user_icebreakers WHERE id = v_ice;
  IF v_txt::uuid <> v_keep THEN
    RAISE EXCEPTION 'FALLO: el icebreaker no se movio al sobreviviente';
  END IF;
  RAISE NOTICE 'OK icebreaker reasignado';

  -- ------------------------------------------------------------------ revert --
  v_res := v3.revert_bookmark_dedupe(v_batch);

  IF NOT EXISTS (SELECT 1 FROM public.bookmarks WHERE id = v_drop) THEN
    RAISE EXCEPTION 'FALLO revert: no repuso el bookmark';
  END IF;

  SELECT notes INTO v_txt FROM public.bookmarks WHERE id = v_keep;
  IF v_txt <> 'nota del sobreviviente' THEN
    RAISE EXCEPTION 'FALLO revert: no restauro las notas -> %', v_txt;
  END IF;

  SELECT status INTO v_txt FROM public.bookmarks WHERE id = v_keep;
  IF v_txt <> 'nuevo' THEN
    RAISE EXCEPTION 'FALLO revert: no restauro el status -> %', v_txt;
  END IF;

  SELECT bookmark_id INTO v_txt FROM public.user_icebreakers WHERE id = v_ice;
  IF v_txt::uuid <> v_drop THEN
    RAISE EXCEPTION 'FALLO revert: el icebreaker no volvio';
  END IF;
  RAISE NOTICE 'OK revert: bookmark, notas, status e icebreaker restaurados';

  IF NOT EXISTS (
    SELECT 1 FROM v3.bookmark_dedupe_log
    WHERE batch_id = v_batch AND reverted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FALLO revert: no marco el log como revertido';
  END IF;
  RAISE NOTICE 'OK revert: batch marcado en el log';

  RAISE NOTICE 'TODO OK - limpieza historica reversible';
END $$;
