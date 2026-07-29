-- =============================================================================
-- 422 - Test de public.create_bookmarks + el UNIQUE de contexto
--
-- Corre SIN --commit. Crea el indice del 421 DENTRO de la transaccion, asi se
-- prueba el comportamiento final (con constraint puesto) y el dry-run del runner
-- lo revierte junto con los datos sinteticos.
-- =============================================================================

DO $$
DECLARE
  v_user  UUID;
  v_c1    UUID;
  v_c2    UUID;
  v_c3    UUID;
  v_n     INTEGER;
  v_id1   UUID;
  v_ctx   JSONB := '{"filterType":"technology","filterSignalIds":["s1","s2"]}'::jsonb;
  v_otro  JSONB := '{"filterType":"process","filterSignalIds":["s9"]}'::jsonb;
BEGIN
  SELECT user_id INTO v_user FROM public.bookmarks WHERE user_id IS NOT NULL LIMIT 1;

  INSERT INTO public.companies (name) VALUES ('ZZ Test RPC 1') RETURNING id INTO v_c1;
  INSERT INTO public.companies (name) VALUES ('ZZ Test RPC 2') RETURNING id INTO v_c2;
  INSERT INTO public.companies (name) VALUES ('ZZ Test RPC 3') RETURNING id INTO v_c3;

  -- El constraint que va a estar en produccion despues del 421.
  CREATE UNIQUE INDEX bookmarks_user_company_context_uniq
    ON public.bookmarks (user_id, company_id, v3.bookmark_context_key(search_context))
    NULLS NOT DISTINCT;

  -- ------------------------------------------------------- creacion inicial --
  SELECT count(*) INTO v_n FROM public.create_bookmarks(v_user, ARRAY[v_c1, v_c2], v_ctx)
  WHERE was_created;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FALLO: esperaba crear 2, creo %', v_n;
  END IF;
  RAISE NOTICE 'OK creo los 2 bookmarks nuevos';

  -- ------------------------------------------- idempotencia (doble click) --
  SELECT count(*) INTO v_n FROM public.create_bookmarks(v_user, ARRAY[v_c1], v_ctx)
  WHERE was_created;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALLO: volvio a crear uno que ya existia';
  END IF;

  SELECT count(*) INTO v_n FROM public.bookmarks
  WHERE user_id = v_user AND company_id = v_c1;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO: quedaron % bookmarks para la misma empresa', v_n;
  END IF;
  RAISE NOTICE 'OK idempotente: no duplica ni tira error';

  -- Y devuelve el id del que ya existia, para poder navegar
  SELECT bookmark_id INTO v_id1 FROM public.create_bookmarks(v_user, ARRAY[v_c1], v_ctx);
  IF v_id1 IS NULL THEN
    RAISE EXCEPTION 'FALLO: no devolvio el id del bookmark existente';
  END IF;
  RAISE NOTICE 'OK devuelve el id aunque ya existiera';

  -- --------------------------------- EL BUG DEL BATCH: mezcla nuevos y viejos --
  -- c1 y c2 ya estan, c3 no. Con el INSERT viejo esto fallaba entero y no se
  -- guardaba NINGUNA. Tienen que guardarse las nuevas y saltearse las repetidas.
  SELECT count(*) INTO v_n
  FROM public.create_bookmarks(v_user, ARRAY[v_c1, v_c2, v_c3], v_ctx)
  WHERE was_created;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO: esperaba crear solo c3, creo %', v_n;
  END IF;

  SELECT count(*) INTO v_n
  FROM public.create_bookmarks(v_user, ARRAY[v_c1, v_c2, v_c3], v_ctx);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'FALLO: esperaba 3 filas devueltas, hubo %', v_n;
  END IF;
  RAISE NOTICE 'OK batch mixto: guarda las nuevas sin abortar por las repetidas';

  -- ------------------------------------------- misma empresa repetida en el array --
  SELECT count(*) INTO v_n
  FROM public.create_bookmarks(v_user, ARRAY[v_c1, v_c1, v_c1], v_ctx);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO: el array con repetidos devolvio % filas', v_n;
  END IF;
  RAISE NOTICE 'OK deduplica el array de entrada';

  -- ------------------------------------------- contexto DISTINTO si convive --
  SELECT count(*) INTO v_n FROM public.create_bookmarks(v_user, ARRAY[v_c1], v_otro)
  WHERE was_created;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FALLO: no creo el bookmark de contexto distinto';
  END IF;

  SELECT count(*) INTO v_n FROM public.bookmarks
  WHERE user_id = v_user AND company_id = v_c1;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FALLO: esperaba 2 bookmarks (contextos distintos), hay %', v_n;
  END IF;
  RAISE NOTICE 'OK dos contextos distintos conviven en la misma empresa';

  -- ------------------------------------------- el orden de las señales no cuenta --
  SELECT count(*) INTO v_n FROM public.create_bookmarks(
    v_user, ARRAY[v_c1],
    '{"filterType":"technology","filterSignalIds":["s2","s1"]}'::jsonb) WHERE was_created;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALLO: creo un duplicado cambiando el orden de las señales';
  END IF;
  RAISE NOTICE 'OK el orden de filterSignalIds no crea duplicados';

  -- ------------------------------------------- el INSERT crudo si tiene que fallar --
  BEGIN
    INSERT INTO public.bookmarks (user_id, company_id, search_context)
    VALUES (v_user, v_c1, v_ctx);
    RAISE EXCEPTION 'FALLO: el INSERT crudo duplicado deberia haber fallado';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK el constraint bloquea el INSERT crudo duplicado';
  END;

  RAISE NOTICE 'TODO OK - create_bookmarks + UNIQUE de contexto';
END $$;
