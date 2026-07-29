-- 416 — Verifica que al unificar empresas las SEÑALES de los bookmarks queden
-- unificadas bajo el company_id del master, sin duplicarse, y que los dos
-- bookmarks con contexto distinto sigan existiendo cada uno con su recorte.
--
-- CORRER SIN --commit.
--
-- Replica lo que hace getIcebreakerContacts() (app/actions/workspace.ts:645):
--     SELECT ... FROM signals
--     WHERE company_id = <la del bookmark> AND is_current_employee
--       AND signal_id IN <filterSignalIds del bookmark>
-- o sea: las señales se leen SIEMPRE por company_id, nunca se guarda una lista
-- de señales dentro del bookmark. Por eso la union tiene que salir sola.

DO $$
DECLARE
  v_user    UUID := (SELECT user_id FROM public.bookmarks LIMIT 1);
  v_master  UUID;
  v_dup     UUID;
  v_prod_a  UUID;
  v_prod_b  UUID;
  v_c1      UUID;  -- contacto de la master
  v_c2      UUID;  -- contacto de la duplicada
  v_bm_tech UUID;  -- bookmark filtrado por prod_a (technology)
  v_bm_proc UUID;  -- bookmark con OTRO contexto
  v_proc    UUID;
  v_res     JSONB;
  v_n       INTEGER;
  v_sig     INTEGER;
BEGIN
  SELECT id INTO v_prod_a FROM public.dictionary_products ORDER BY id LIMIT 1;
  SELECT id INTO v_prod_b FROM public.dictionary_products ORDER BY id OFFSET 1 LIMIT 1;
  SELECT id INTO v_proc   FROM public.dictionary_processes ORDER BY id LIMIT 1;

  INSERT INTO public.companies (name) VALUES ('ZZ Test Master 416') RETURNING id INTO v_master;
  INSERT INTO public.companies (name) VALUES ('ZZ Test Dup 416')    RETURNING id INTO v_dup;

  -- Un contacto en cada empresa (personas distintas)
  INSERT INTO public.contacts (linkedin_url, full_name, current_company_id)
  VALUES ('https://zz-test-416-a', 'ZZ Persona A', v_master) RETURNING id INTO v_c1;
  INSERT INTO public.contacts (linkedin_url, full_name, current_company_id)
  VALUES ('https://zz-test-416-b', 'ZZ Persona B', v_dup) RETURNING id INTO v_c2;

  -- LA MISMA tecnologia (prod_a) detectada en las DOS empresas, via personas
  -- distintas. Es el caso que importa: no es un duplicado, es mas evidencia.
  INSERT INTO public.signals (company_id, contact_id, signal_type, signal_id, is_current_employee, keyword_matched)
  VALUES (v_master, v_c1, 'technology', v_prod_a, true, 'kw-a');
  INSERT INTO public.signals (company_id, contact_id, signal_type, signal_id, is_current_employee, keyword_matched)
  VALUES (v_dup,    v_c2, 'technology', v_prod_a, true, 'kw-a');
  -- Y una tecnologia que SOLO tiene la duplicada: se tiene que sumar al master
  INSERT INTO public.signals (company_id, contact_id, signal_type, signal_id, is_current_employee, keyword_matched)
  VALUES (v_dup,    v_c2, 'technology', v_prod_b, true, 'kw-b');

  -- Dos bookmarks con CONTEXTO DISTINTO (uno por tecnologia, otro por proceso)
  INSERT INTO public.bookmarks (user_id, company_id, search_context)
  VALUES (v_user, v_master,
          jsonb_build_object('filterType','technology','filterSignalIds', jsonb_build_array(v_prod_a)))
  RETURNING id INTO v_bm_tech;

  INSERT INTO public.bookmarks (user_id, company_id, search_context)
  VALUES (v_user, v_dup,
          jsonb_build_object('filterType','process','filterSignalIds', jsonb_build_array(v_proc)))
  RETURNING id INTO v_bm_proc;

  -- Antes del merge: el bookmark de la master ve 1 sola señal de prod_a
  SELECT count(*) INTO v_sig FROM public.signals
  WHERE company_id = v_master AND is_current_employee AND signal_id = v_prod_a;
  IF v_sig <> 1 THEN
    RAISE EXCEPTION 'setup mal: se esperaba 1 señal antes del merge, hubo %', v_sig;
  END IF;

  -- ---- MERGE ----
  v_res := public.merge_companies(v_master, v_dup, false, 'manual', NULL, 'test 416', NULL);

  -- 1) Los dos bookmarks siguen vivos: contexto distinto => no se consolidan
  IF (v_res->>'bookmarks_consolidados')::int <> 0 THEN
    RAISE EXCEPTION 'FALLO: consolido bookmarks de contexto distinto (%)',
      v_res->>'bookmarks_consolidados';
  END IF;
  SELECT count(*) INTO v_n FROM public.bookmarks WHERE id IN (v_bm_tech, v_bm_proc);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FALLO: quedaron % bookmarks y se esperaban 2', v_n;
  END IF;
  RAISE NOTICE 'OK los 2 bookmarks con contexto distinto sobreviven';

  -- 2) Los dos apuntan al master
  SELECT count(*) INTO v_n FROM public.bookmarks
  WHERE id IN (v_bm_tech, v_bm_proc) AND company_id = v_master;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FALLO: algun bookmark no quedo apuntando al master';
  END IF;

  -- 3) UNION de señales: prod_a ahora tiene 2 filas (una por persona) bajo el
  --    master, y prod_b se sumo. Esto es lo que hace que el bookmark "vea" las
  --    señales de las dos empresas sin tocar su search_context.
  SELECT count(*) INTO v_sig FROM public.signals
  WHERE company_id = v_master AND is_current_employee AND signal_id = v_prod_a;
  IF v_sig <> 2 THEN
    RAISE EXCEPTION 'FALLO: prod_a deberia tener 2 filas bajo el master, tiene %', v_sig;
  END IF;
  SELECT count(*) INTO v_sig FROM public.signals
  WHERE company_id = v_master AND signal_id = v_prod_b;
  IF v_sig <> 1 THEN
    RAISE EXCEPTION 'FALLO: prod_b no se sumo al master (%)', v_sig;
  END IF;
  RAISE NOTICE 'OK señales unificadas bajo el master (prod_a x2 personas, prod_b sumada)';

  -- 4) No quedo NINGUNA señal huerfana apuntando a la empresa borrada
  SELECT count(*) INTO v_sig FROM public.signals WHERE company_id = v_dup;
  IF v_sig <> 0 THEN
    RAISE EXCEPTION 'FALLO: quedaron % señales en la empresa borrada', v_sig;
  END IF;

  -- 5) Y no se duplico ninguna: misma persona + misma tecnologia una sola vez
  SELECT count(*) INTO v_n FROM (
    SELECT contact_id, signal_id FROM public.signals
    WHERE company_id = v_master GROUP BY 1,2 HAVING count(*) > 1
  ) x;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FALLO: hay % señales duplicadas (misma persona, misma tecnologia)', v_n;
  END IF;
  RAISE NOTICE 'OK sin señales duplicadas por persona';

  -- 6) El recorte de cada bookmark se respeta: el de proceso NO ve las tecnologias
  SELECT count(*) INTO v_sig FROM public.signals s
  WHERE s.company_id = v_master AND s.is_current_employee
    AND s.signal_id IN (
      SELECT (jsonb_array_elements_text(b.search_context->'filterSignalIds'))::uuid
      FROM public.bookmarks b WHERE b.id = v_bm_proc
    );
  IF v_sig <> 0 THEN
    RAISE EXCEPTION 'FALLO: el bookmark de proceso ve % señales de tecnologia', v_sig;
  END IF;

  -- Y el de tecnologia ve las 2 (las de las dos empresas)
  SELECT count(*) INTO v_sig FROM public.signals s
  WHERE s.company_id = v_master AND s.is_current_employee
    AND s.signal_id IN (
      SELECT (jsonb_array_elements_text(b.search_context->'filterSignalIds'))::uuid
      FROM public.bookmarks b WHERE b.id = v_bm_tech
    );
  IF v_sig <> 2 THEN
    RAISE EXCEPTION 'FALLO: el bookmark de tecnologia ve % señales y deberia ver 2', v_sig;
  END IF;
  RAISE NOTICE 'OK cada bookmark mantiene su recorte, y el de tecnologia gano evidencia';

  RAISE NOTICE '=== TODO OK: la union de señales sale sola por company_id ===';
END $$;
