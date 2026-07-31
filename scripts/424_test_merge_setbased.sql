-- ═══════════════════════════════════════════════════════════════════════════
-- 424 — El merge en conjunto tiene que dar EL MISMO resultado, pero rapido
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Que ande rapido no alcanza: el fix del 423 borra filas en conflicto en bloque
-- en lugar de una por una, asi que hay que probar que decide EXACTAMENTE lo
-- mismo que el camino viejo. Si moviera o borrara un conjunto distinto, seria
-- perdida de datos silenciosa.
--
-- Estrategia: en UNA transaccion que se revierte,
--   1. se corre dry_run con la funcion VIEJA sobre cada candidato ai_same,
--   2. se aplica el 423,
--   3. se corre dry_run de nuevo con la NUEVA,
--   4. se comparan `moved` y `deleted` fila por fila, y los tiempos.
--
-- La conexion directa no tiene el limite de 8s, asi que la version vieja puede
-- terminar sus 23s y se la puede comparar.
--
-- COMO CORRERLO: este archivo necesita que el 423 se aplique en el MEDIO (entre
-- la medicion vieja y la nueva), y run-sql.mjs no soporta el `\ir` de psql. Se
-- ensambla con:
--
--   awk '/@@INCLUDE_423@@/{system("cat scripts/423_merge_setbased_conflicts.sql");next}1' \
--     scripts/424_test_merge_setbased.sql > /tmp/424_combined.sql
--   node scripts/run-sql.mjs /tmp/424_combined.sql
--
-- SIEMPRE en dry-run (sin --commit).
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r           RECORD;
  v_res       JSONB;
  t0          TIMESTAMPTZ;
  ms          NUMERIC;
  v_dup       UUID;
  v_master    UUID;
  v_fallos    INT := 0;
  v_comparados INT := 0;
  v_ms_viejo  NUMERIC := 0;
  v_ms_nuevo  NUMERIC := 0;
BEGIN
  -- OJO: la clave es (candidate_id, duplicate_id), no solo candidate_id. Un
  -- candidato puede tener VARIOS duplicados, asi que joinear solo por candidato
  -- arma un producto cruzado y compara el dup A viejo contra el dup B nuevo,
  -- reportando diferencias que no existen.
  CREATE TEMP TABLE _cmp (
    candidate_id UUID,
    duplicate_id UUID,
    version      TEXT,
    moved        JSONB,
    deleted      JSONB,
    moved_total  BIGINT,
    deleted_total BIGINT,
    ms           NUMERIC
  ) ON COMMIT DROP;

  -- ── Paso 1: resultados con la funcion VIEJA (la que esta en produccion) ───
  RAISE NOTICE '--- midiendo la version VIEJA (fila por fila) ---';
  FOR r IN
    SELECT id, group_key, company_ids, master_id
    FROM v3.company_dup_candidates
    WHERE status = 'ai_same'
    ORDER BY array_length(company_ids, 1) DESC
  LOOP
    v_master := coalesce(r.master_id, r.company_ids[1]);
    FOREACH v_dup IN ARRAY r.company_ids LOOP
      CONTINUE WHEN v_dup = v_master;
      t0 := clock_timestamp();
      -- 'manual' porque company_merges_method_check solo acepta
      -- exact|core|trgm|ai|manual. Es dry_run, no se persiste igual.
      v_res := public.merge_companies(v_master, v_dup, true, 'manual');
      ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      v_ms_viejo := v_ms_viejo + ms;
      INSERT INTO _cmp VALUES (
        r.id, v_dup, 'viejo', v_res->'moved', v_res->'deleted',
        (v_res->>'moved_total')::bigint, (v_res->>'deleted_total')::bigint, ms
      );
    END LOOP;
  END LOOP;
  RAISE NOTICE 'total viejo: % ms', round(v_ms_viejo);
END $$;

-- ── Paso 2: aplicar el fix dentro de la misma transaccion ──────────────────
-- @@INCLUDE_423@@

DO $$
DECLARE
  r           RECORD;
  v_res       JSONB;
  t0          TIMESTAMPTZ;
  ms          NUMERIC;
  v_dup       UUID;
  v_master    UUID;
  v_ms_nuevo  NUMERIC := 0;
  c           RECORD;
  v_fallos    INT := 0;
  v_comparados INT := 0;
  v_max_viejo NUMERIC;
  v_max_nuevo NUMERIC;
BEGIN
  -- ── Paso 3: los mismos dry_run con la version NUEVA ─────────────────────
  RAISE NOTICE '--- midiendo la version NUEVA (en conjunto) ---';
  FOR r IN
    SELECT id, group_key, company_ids, master_id
    FROM v3.company_dup_candidates
    WHERE status = 'ai_same'
    ORDER BY array_length(company_ids, 1) DESC
  LOOP
    v_master := coalesce(r.master_id, r.company_ids[1]);
    FOREACH v_dup IN ARRAY r.company_ids LOOP
      CONTINUE WHEN v_dup = v_master;
      t0 := clock_timestamp();
      v_res := public.merge_companies(v_master, v_dup, true, 'manual');
      ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
      v_ms_nuevo := v_ms_nuevo + ms;
      INSERT INTO _cmp VALUES (
        r.id, v_dup, 'nuevo', v_res->'moved', v_res->'deleted',
        (v_res->>'moved_total')::bigint, (v_res->>'deleted_total')::bigint, ms
      );
    END LOOP;
  END LOOP;
  RAISE NOTICE 'total nuevo: % ms', round(v_ms_nuevo);

  -- ── Paso 4: comparar decision por decision ──────────────────────────────
  RAISE NOTICE '--- comparando resultados ---';
  FOR c IN
    SELECT v.candidate_id,
           v.moved_total   AS mv_viejo, n.moved_total   AS mv_nuevo,
           v.deleted_total AS dl_viejo, n.deleted_total AS dl_nuevo,
           v.moved         AS moved_viejo, n.moved      AS moved_nuevo,
           v.deleted       AS del_viejo,  n.deleted     AS del_nuevo,
           v.ms AS ms_viejo, n.ms AS ms_nuevo,
           (SELECT group_key FROM v3.company_dup_candidates WHERE id = v.candidate_id) AS gk
    FROM _cmp v
    JOIN _cmp n ON n.candidate_id = v.candidate_id
               AND n.duplicate_id = v.duplicate_id
               AND n.version = 'nuevo'
    WHERE v.version = 'viejo'
  LOOP
    v_comparados := v_comparados + 1;

    IF c.mv_viejo <> c.mv_nuevo OR c.dl_viejo <> c.dl_nuevo THEN
      v_fallos := v_fallos + 1;
      RAISE NOTICE 'FALLO % : movidas %->% , borradas %->%',
        left(c.gk, 28), c.mv_viejo, c.mv_nuevo, c.dl_viejo, c.dl_nuevo;
    ELSE
      -- Comparar tambien el CONJUNTO de ids borrados, no solo la cantidad:
      -- podrian coincidir los totales y ser filas distintas.
      IF coalesce(
           (SELECT count(*) FROM (
              SELECT jsonb_object_keys(c.del_viejo)
              EXCEPT SELECT jsonb_object_keys(c.del_nuevo)) x), 0) > 0 THEN
        v_fallos := v_fallos + 1;
        RAISE NOTICE 'FALLO % : distintas TABLAS con borrados', left(c.gk, 28);
      ELSE
        RAISE NOTICE 'OK % | mov % del % | % ms -> % ms',
          rpad(left(c.gk, 26), 26), c.mv_nuevo, c.dl_nuevo,
          lpad(round(c.ms_viejo)::text, 6), lpad(round(c.ms_nuevo)::text, 5);
      END IF;
    END IF;
  END LOOP;

  SELECT max(ms) INTO v_max_viejo FROM _cmp WHERE version = 'viejo';
  SELECT max(ms) INTO v_max_nuevo FROM _cmp WHERE version = 'nuevo';

  RAISE NOTICE '';
  RAISE NOTICE 'comparados: % | peor caso: % ms -> % ms',
    v_comparados, round(v_max_viejo), round(v_max_nuevo);

  IF v_fallos > 0 THEN
    RAISE EXCEPTION 'FALLO: % de % dieron resultado distinto', v_fallos, v_comparados;
  END IF;

  -- El techo real de PostgREST es 8s. Si el peor caso sigue arriba de ~4s el fix
  -- no alcanza y hay que sacar los merges del request.
  IF v_max_nuevo > 4000 THEN
    RAISE EXCEPTION 'FALLO: el peor caso sigue en % ms, demasiado cerca del techo de 8s',
      round(v_max_nuevo);
  END IF;

  RAISE NOTICE 'TODO OK: mismo resultado, peor caso % ms (techo 8s)', round(v_max_nuevo);
END $$;
