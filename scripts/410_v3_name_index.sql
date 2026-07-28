-- =============================================================================
-- 410 - Indice de nombres precalculados + deteccion incremental
-- =============================================================================
--
-- PROBLEMA QUE RESUELVE
--
-- El boton "volver a detectar" fallaba con "canceling statement due to
-- statement timeout". Dos causas, ambas medidas:
--
--   1. El limite real es 8s, heredado del rol `authenticated`
--      (anon = 3s, authenticated = 8s). El `SET LOCAL statement_timeout` que
--      tenian las funciones NO servia de nada: Postgres arma el temporizador
--      al inicio de la sentencia y cambiarlo desde adentro no lo reprograma.
--
--   2. La deteccion recalculaba `company_core_name()` sobre las 485.203
--      empresas en cada clic. Medido: ~10s una sola pasada de ese regex, y la
--      funcion lo evaluaba 3 veces por fila. Imposible de meter en 8s.
--
-- ENFOQUE
--
-- El nucleo del nombre es caro de calcular pero casi nunca cambia. Se calcula
-- UNA vez para todo el historico (por fuera, con `scripts/run-sql.mjs`, que usa
-- conexion directa sin limite de tiempo) y se guarda en v3.company_name_index.
-- Despues cada clic solo agrupa sobre esa tabla ya indexada.
--
-- Medido con el indice cargado:
--   - agrupar las 485k y encontrar los 21.508 grupos duplicados: 1,25s
--   - antes: >35s y timeout
--
-- NOTAS DE AISLAMIENTO (regla #0: v3 no puede afectar a v2)
--   - La tabla vive en el schema v3, con RLS y acceso solo para service_role.
--   - A proposito NO tiene foreign key hacia public.companies: una FK obligaria
--     a cada DELETE de v2 a chequear esta tabla. Los huerfanos se limpian en la
--     sincronizacion.
--   - No se agrego ningun indice a public.companies. Por eso la sincronizacion
--     compara contra el snapshot del nombre en lugar de usar `updated_at`.
-- =============================================================================

-- ── Tabla ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3.company_name_index (
  company_id    UUID PRIMARY KEY,
  name_snapshot TEXT NOT NULL,   -- para detectar renombres sin tocar v2
  core          TEXT,
  weight        INTEGER NOT NULL DEFAULT 0,  -- contactos + vacantes, para priorizar
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_name_index_core_idx
  ON v3.company_name_index (core)
  WHERE core IS NOT NULL AND length(core) >= 3;

CREATE INDEX IF NOT EXISTS company_name_index_weight_idx
  ON v3.company_name_index (weight DESC);

ALTER TABLE v3.company_name_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_name_index_service_only ON v3.company_name_index;
CREATE POLICY company_name_index_service_only
  ON v3.company_name_index FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE v3.company_name_index FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE v3.company_name_index TO service_role;

-- ── Sincronizacion ──────────────────────────────────────────────────────────
--
-- Cuesta ~4s medidos (tres comparaciones de 485k contra 485k), asi que NO va
-- en el mismo clic que la deteccion: no cabe en los 8s. Se corre desde el cron
-- nocturno o desde su propio boton, despues de cada ETL.

CREATE OR REPLACE FUNCTION v3.sync_company_name_index(
  p_limit INTEGER DEFAULT 50000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_altas    INT := 0;
  v_cambios  INT := 0;
  v_bajas    INT := 0;
  v_pesos    INT := 0;
BEGIN
  -- 1. Altas: empresas nuevas que el ETL trajo y todavia no estan indexadas.
  WITH nuevas AS (
    SELECT c.id, c.name
    FROM public.companies c
    LEFT JOIN v3.company_name_index i ON i.company_id = c.id
    WHERE i.company_id IS NULL
    LIMIT p_limit
  ), ins AS (
    INSERT INTO v3.company_name_index (company_id, name_snapshot, core)
    SELECT n.id, n.name, public.company_core_name(n.name)
    FROM nuevas n
    ON CONFLICT (company_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_altas FROM ins;

  -- 2. Renombres: solo aca se vuelve a pagar el regex, y solo por las que
  --    efectivamente cambiaron de nombre.
  WITH cambiadas AS (
    SELECT c.id, c.name
    FROM public.companies c
    JOIN v3.company_name_index i ON i.company_id = c.id
    WHERE i.name_snapshot <> c.name
    LIMIT p_limit
  ), upd AS (
    UPDATE v3.company_name_index i
    SET name_snapshot = ch.name,
        core          = public.company_core_name(ch.name),
        refreshed_at  = now()
    FROM cambiadas ch
    WHERE i.company_id = ch.id
    RETURNING 1
  )
  SELECT count(*) INTO v_cambios FROM upd;

  -- 3. Bajas: huerfanos que quedaron porque no hay FK (decision deliberada).
  WITH borradas AS (
    DELETE FROM v3.company_name_index i
    WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = i.company_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_bajas FROM borradas;

  -- 4. Pesos: con agregados en una sola pasada. Buscar empresa por empresa
  --    costaba 9s (484.895 lookups); asi cuesta ~2s.
  WITH pesos AS (
    SELECT id, sum(n)::int AS total FROM (
      SELECT current_company_id AS id, count(*) AS n
      FROM public.contacts WHERE current_company_id IS NOT NULL
      GROUP BY current_company_id
      UNION ALL
      SELECT company_id AS id, count(*) AS n
      FROM public.job_postings WHERE company_id IS NOT NULL
      GROUP BY company_id
    ) u GROUP BY id
  ), upd AS (
    UPDATE v3.company_name_index i
    SET weight = p.total
    FROM pesos p
    WHERE i.company_id = p.id AND i.weight <> p.total
    RETURNING 1
  )
  SELECT count(*) INTO v_pesos FROM upd;

  RETURN jsonb_build_object(
    'altas', v_altas, 'renombres', v_cambios,
    'bajas', v_bajas, 'pesos_actualizados', v_pesos,
    'total_indexadas', (SELECT count(*) FROM v3.company_name_index),
    -- Si quedan pendientes, hay que volver a llamar: el lote esta acotado.
    'quedan_pendientes', (
      SELECT count(*) FROM public.companies c
      LEFT JOIN v3.company_name_index i ON i.company_id = c.id
      WHERE i.company_id IS NULL
    )
  );
END;
$$;

-- ── Deteccion ───────────────────────────────────────────────────────────────
--
-- Reescrita para leer del indice. Ya no toca companies para agrupar, ni
-- contacts/job_postings para priorizar (usa el weight precalculado).
--
-- Se saco el `SET LOCAL statement_timeout`: no tenia ningun efecto.

CREATE OR REPLACE FUNCTION v3.refresh_company_dup_candidates(
  p_limit        INTEGER DEFAULT 500,
  p_include_trgm BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, extensions, pg_catalog
AS $$
DECLARE
  v_nuevos INT := 0;
  v_trgm   INT := 0;
BEGIN
  -- Grupos por nucleo, priorizando los que tienen mas datos asociados.
  -- Se recorren TODAS las empresas (decision del usuario), pero las que no
  -- tienen contactos ni vacantes quedan al final de la cola por su weight.
  WITH grupos AS (
    SELECT core AS group_key,
           array_agg(company_id ORDER BY company_id) AS ids,
           count(*) AS n,
           sum(weight) AS peso
    FROM v3.company_name_index
    WHERE core IS NOT NULL AND length(core) >= 3
    GROUP BY core
    HAVING count(*) > 1
  ),
  elegidos AS (
    SELECT g.*
    FROM grupos g
    -- No re-proponer lo que ya se decidio (mergeado, descartado, en IA).
    WHERE NOT EXISTS (
      SELECT 1 FROM v3.company_dup_candidates d
      WHERE d.group_key = g.group_key AND d.method = 'core'
    )
    ORDER BY g.peso DESC, g.n DESC
    LIMIT p_limit
  ),
  -- Los atributos que deciden si el grupo es ambiguo salen de companies, pero
  -- solo para los miembros de los grupos elegidos: pocas filas, por PK.
  atributos AS (
    SELECT e.group_key,
           count(DISTINCT c.linkedin_url) AS li_distintas,
           count(DISTINCT nullif(btrim(lower(c.country)), '')) AS paises
    FROM elegidos e
    JOIN public.companies c ON c.id = ANY(e.ids)
    GROUP BY e.group_key
  ),
  ins AS (
    INSERT INTO v3.company_dup_candidates
      (group_key, method, company_ids, master_id, classification, payload)
    SELECT
      e.group_key, 'core', e.ids,
      public.pick_merge_master(e.ids),
      CASE
        WHEN a.li_distintas >= 2 OR a.paises >= 2 THEN 'ambiguo'
        ELSE 'seguro'
      END,
      v3.build_dup_payload(e.ids)
    FROM elegidos e
    JOIN atributos a ON a.group_key = e.group_key
    ON CONFLICT (group_key, method) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_nuevos FROM ins;

  RETURN jsonb_build_object(
    'indexadas',       (SELECT count(*) FROM v3.company_name_index),
    'grupos_totales',  (SELECT count(*) FROM (
                          SELECT 1 FROM v3.company_name_index
                          WHERE core IS NOT NULL AND length(core) >= 3
                          GROUP BY core HAVING count(*) > 1) x),
    'nuevos_grupos',   v_nuevos,
    'grupos_trgm',     v_trgm,
    'pendientes',      (SELECT count(*) FROM v3.company_dup_candidates WHERE status = 'pending'),
    'seguros',         (SELECT count(*) FROM v3.company_dup_candidates
                          WHERE status = 'pending' AND classification = 'seguro'),
    'ambiguos',        (SELECT count(*) FROM v3.company_dup_candidates
                          WHERE status = 'pending' AND classification = 'ambiguo')
  );
END;
$$;

REVOKE ALL ON FUNCTION v3.sync_company_name_index(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION v3.refresh_company_dup_candidates(INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION v3.sync_company_name_index(INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION v3.refresh_company_dup_candidates(INTEGER, BOOLEAN) TO authenticated, service_role;
