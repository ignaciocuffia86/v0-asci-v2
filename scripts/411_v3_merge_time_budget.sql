-- 411 — Auto-merge acotado por presupuesto de tiempo
--
-- Problema: "Unificar seguros" daba "canceling statement due to statement
-- timeout". El lote fijo de 100 no entra en los 8s de la conexion.
--
-- Medicion real (8 merges, transaccion revertida):
--   181, 26, 84, 115, 243, 62, 35, 95 ms  -> promedio ~105ms, pico 243ms
--   100 merges = 10,5s en el caso bueno y ~25s si toca grupos grandes.
--
-- Por que un lote fijo no alcanza: el costo por merge depende de cuantas filas
-- hijas tiene el grupo (recorre 25 tablas), y eso varia 10x entre grupos. Un
-- limite de 40 anda hoy y falla el dia que agarra 40 grupos pesados.
--
-- Por eso se corta por TIEMPO: la funcion mide cuanto lleva y sale del loop
-- antes de pasarse. El lote se autoajusta al costo real de cada grupo.
--
-- Nota sobre el bug de fondo: la version anterior hacia
-- `SET LOCAL statement_timeout = '300s'` dentro de la funcion creyendo que se
-- protegia. No sirve: el timer arranca cuando arranca la sentencia que llama a
-- la funcion, asi que cambiarlo adentro llega tarde. Verificado por separado.

CREATE OR REPLACE FUNCTION v3.auto_merge_safe_candidates(
  p_limit      INTEGER DEFAULT 500,
  p_dry_run    BOOLEAN DEFAULT false,
  p_decided_by UUID DEFAULT NULL,
  -- 2000ms. La cuenta que importa: el presupuesto se chequea ANTES de cada
  -- merge, asi que el peor caso NO es el presupuesto, es
  --     presupuesto + el merge mas lento que arranque justo al filo.
  -- Medido sobre 198 merges: promedio 27ms, p95 44ms, pero un outlier de 1446ms
  -- (y en otra corrida, 5102ms). Con el peor caso observado de ~5,1s:
  --     2000 + 5102 = 7,1s  -> entra en los 8s, con ~900ms de aire
  --     3500 + 5102 = 8,6s  -> TIMEOUT (esto es lo que fallaba)
  -- Por eso 2000 y no 3500: hace menos por pasada, pero no se pasa nunca.
  p_budget_ms  INTEGER DEFAULT 2000,
  -- Cuanto se espera por un lock antes de saltear el grupo. Ver nota abajo.
  p_lock_ms    INTEGER DEFAULT 250
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_id        UUID;
  v_res       JSONB;
  v_grupos    INT := 0;
  v_movidas   INT := 0;
  v_borradas  INT := 0;
  v_errores   JSONB := '[]'::jsonb;
  v_inicio    TIMESTAMPTZ := clock_timestamp();
  v_corto     BOOLEAN := false;
  v_transcurr NUMERIC;
  v_trabados  INT := 0;
BEGIN
  -- lock_timeout SI funciona seteado adentro de la funcion, a diferencia de
  -- statement_timeout: no es un timer que arranca con la sentencia, es cuanto
  -- espera CADA pedido de lock. Por eso este SET LOCAL no es como el que se
  -- saco antes: aca el mecanismo es otro.
  --
  -- Para que sirve: si el ETL esta escribiendo las mismas filas, el merge espera
  -- indefinidamente. Con esto falla en 250ms, se saltea, y queda 'pending' para
  -- la proxima pasada.
  --
  -- OJO, no es la causa del outlier lento. Se probo la hipotesis de que el peor
  -- caso (5102ms moviendo solo 7 filas) era espera de lock y resulto FALSA:
  -- con lock_timeout activo el outlier siguio apareciendo y trabados=0.
  -- El costo tampoco esta en los UPDATE de las 25 tablas hijas: perfilados uno
  -- por uno suman 325ms para 60 candidatos (~5ms por candidato).
  -- Es 1 caso en ~200 y el peor caso se acota con p_budget_ms (ver arriba).
  -- Queda como red de seguridad barata, no como el fix del outlier.
  EXECUTE format('SET LOCAL lock_timeout = %L', p_lock_ms || 'ms');

  FOR v_id IN
    SELECT id FROM v3.company_dup_candidates
    WHERE classification = 'seguro' AND status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
  LOOP
    -- Se chequea ANTES de cada merge, no despues: si ya no queda presupuesto
    -- para uno mas, se corta. Lo hecho hasta aca queda commiteado y el proximo
    -- clic sigue donde quedo (los mergeados ya no estan en 'pending').
    v_transcurr := extract(epoch FROM clock_timestamp() - v_inicio) * 1000;
    IF v_transcurr > p_budget_ms THEN
      v_corto := true;
      EXIT;
    END IF;

    BEGIN
      v_res := v3.apply_dup_candidate(v_id, p_dry_run, p_decided_by);
      v_grupos   := v_grupos + 1;
      v_movidas  := v_movidas + coalesce((v_res->>'rows_moved')::int, 0);
      v_borradas := v_borradas + coalesce((v_res->>'rows_deleted')::int, 0);
    EXCEPTION
      -- Trabado por otra transaccion (tipicamente el ETL). NO es un error del
      -- grupo: se deja en 'pending' a proposito para que el proximo clic lo
      -- reintente. Marcarlo 'failed' lo sacaria del lote para siempre por algo
      -- que era temporal.
      WHEN lock_not_available THEN
        v_trabados := v_trabados + 1;

      WHEN others THEN
        -- Un grupo que falla de verdad no puede frenar el lote entero.
        v_errores := v_errores || jsonb_build_object('candidate_id', v_id, 'error', SQLERRM);
        IF NOT p_dry_run THEN
          UPDATE v3.company_dup_candidates
          SET status = 'failed', error_message = SQLERRM
          WHERE id = v_id;
        END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run',      p_dry_run,
    'groups',       v_grupos,
    'rows_moved',   v_movidas,
    'rows_deleted', v_borradas,
    'errors',       v_errores,
    -- Salteados por lock, siguen 'pending'. Se informan aparte de los errores
    -- porque no requieren ninguna accion: se resuelven solos al reintentar.
    'trabados',     v_trabados,
    -- Para que la UI pueda decir "quedan N" y ofrecer seguir.
    'corto_por_tiempo', v_corto,
    'ms',           round(extract(epoch FROM clock_timestamp() - v_inicio) * 1000),
    'restantes',    (SELECT count(*) FROM v3.company_dup_candidates
                       WHERE classification = 'seguro' AND status = 'pending')
  );
END;
$$;

-- Las firmas viejas quedan colgadas al agregar argumentos. Se borran para que
-- no haya varias versiones y PostgREST no elija la equivocada.
DROP FUNCTION IF EXISTS v3.auto_merge_safe_candidates(INTEGER, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS v3.auto_merge_safe_candidates(INTEGER, BOOLEAN, UUID, INTEGER);

REVOKE ALL ON FUNCTION v3.auto_merge_safe_candidates(INTEGER, BOOLEAN, UUID, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION v3.auto_merge_safe_candidates(INTEGER, BOOLEAN, UUID, INTEGER, INTEGER) TO authenticated, service_role;
