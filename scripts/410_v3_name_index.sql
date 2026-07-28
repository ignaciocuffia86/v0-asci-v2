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

-- ── Tabla de grupos ya detectados ───────────────────────────────────────────
--
-- Segundo nivel de precalculo, y el que hace que el boton sea confiable.
--
-- Medicion que lo motivo: agrupar las 485k costaba 16s con cache frio y 4,7s
-- con cache caliente. O sea que el primer clic del dia fallaba igual, aunque
-- el segundo pasara. Un boton que depende del cache de disco no sirve.
--
-- Con los grupos precalculados quedan 21.508 filas: el boton lee un lote de ahi
-- en milisegundos y el tiempo deja de depender del cache.

CREATE TABLE IF NOT EXISTS v3.company_dup_groups (
  group_key    TEXT PRIMARY KEY,
  company_ids  UUID[] NOT NULL,
  n            INTEGER NOT NULL,
  peso         BIGINT  NOT NULL DEFAULT 0,
  promoted_at  TIMESTAMPTZ,          -- ya paso a company_dup_candidates
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indice para la consulta exacta del boton: pendientes, mas pesados primero.
CREATE INDEX IF NOT EXISTS company_dup_groups_pendientes_idx
  ON v3.company_dup_groups (peso DESC, n DESC)
  WHERE promoted_at IS NULL;

ALTER TABLE v3.company_dup_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_dup_groups_service_only ON v3.company_dup_groups;
CREATE POLICY company_dup_groups_service_only
  ON v3.company_dup_groups FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE v3.company_dup_groups FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE v3.company_dup_groups TO service_role;

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
  v_grupos   INT := 0;
  v_inicio   TIMESTAMPTZ := clock_timestamp();
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

  -- 5. Recalcular los grupos. Es la parte cara (16s con cache frio) y por eso
  --    vive aca, en la sincronizacion pesada, y no en el clic del boton.
  --    Se preserva `promoted_at` para no volver a proponer lo ya decidido.
  WITH nuevos AS (
    SELECT core AS group_key,
           array_agg(company_id ORDER BY company_id) AS ids,
           count(*)::int AS n,
           sum(weight)::bigint AS peso
    FROM v3.company_name_index
    WHERE core IS NOT NULL AND length(core) >= 3
    GROUP BY core
    HAVING count(*) > 1
  ), up AS (
    INSERT INTO v3.company_dup_groups (group_key, company_ids, n, peso)
    SELECT group_key, ids, n, peso FROM nuevos
    ON CONFLICT (group_key) DO UPDATE
      SET company_ids = EXCLUDED.company_ids,
          n           = EXCLUDED.n,
          peso        = EXCLUDED.peso,
          detected_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_grupos FROM up;

  -- Grupos que dejaron de serlo (quedo una sola empresa tras un merge).
  -- El UPSERT de arriba puso `detected_at = now()` en todos los vigentes, asi
  -- que los que quedaron con timestamp viejo ya no son grupos. Es un filtro por
  -- fecha y nada mas.
  --
  -- La primera version hacia `NOT EXISTS (... GROUP BY ... HAVING count(*)>1)`
  -- correlacionado: un agregado sobre el indice por cada uno de los 21.508
  -- grupos. Se colgo a los 120s.
  DELETE FROM v3.company_dup_groups
  WHERE promoted_at IS NULL AND detected_at < v_inicio;

  RETURN jsonb_build_object(
    'altas', v_altas, 'renombres', v_cambios,
    'bajas', v_bajas, 'pesos_actualizados', v_pesos,
    'grupos_detectados', v_grupos,
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
  v_nuevos  INT := 0;
  v_trgm    INT := 0;
BEGIN
  -- Ya no se agrupa nada aca: los grupos vienen precalculados por
  -- `sync_company_name_index()`. Esta funcion solo toma un lote pendiente,
  -- ordenado por peso, y arma el payload de esos pocos grupos.
  --
  -- Historial de lo que se probo y descarto, todo medido:
  --   - agrupar las 485k en el clic: 16s cache frio / 4,7s caliente -> el
  --     primer clic del dia fallaba igual. Inaceptable.
  --   - tablas temporales: 15s. Sin stats el planner degrada el join.
  WITH elegidos AS MATERIALIZED (
    SELECT g.group_key, g.company_ids AS ids, g.n, g.peso
    FROM v3.company_dup_groups g
    WHERE g.promoted_at IS NULL
      -- No re-proponer lo que ya se decidio (mergeado, descartado, en IA).
      AND NOT EXISTS (
        SELECT 1 FROM v3.company_dup_candidates d
        WHERE d.group_key = g.group_key AND d.method = 'core'
      )
    -- Se recorren TODAS las empresas (decision del usuario), pero las que no
    -- tienen contactos ni vacantes quedan al final de la cola por su peso.
    ORDER BY g.peso DESC, g.n DESC
    LIMIT p_limit
  ),
  miembros AS (
    SELECT e.group_key, c.id, c.linkedin_url, c.country, i.weight
    FROM elegidos e
    JOIN public.companies c ON c.id = ANY(e.ids)
    LEFT JOIN v3.company_name_index i ON i.company_id = c.id
  ),
  -- Los atributos que deciden si el grupo es ambiguo salen de companies, pero
  -- solo para los miembros de los grupos elegidos: pocas filas, por PK.
  atributos AS (
    SELECT group_key,
           count(DISTINCT linkedin_url) AS li_distintas,
           count(DISTINCT nullif(btrim(lower(country)), '')) AS paises
    FROM miembros
    GROUP BY group_key
  ),
  -- Master elegido con el `weight` ya precalculado, en una sola pasada.
  -- `public.pick_merge_master()` hacia 3 subqueries por empresa (~4.500
  -- lookups por lote). No se la toca porque la usan los merges de v2.
  masters AS (
    SELECT DISTINCT ON (group_key) group_key, id AS master_id
    FROM miembros
    ORDER BY group_key, weight DESC NULLS LAST, id
  ),
  ins AS (
    INSERT INTO v3.company_dup_candidates
      (group_key, method, company_ids, master_id, classification, payload)
    SELECT
      e.group_key, 'core', e.ids, m.master_id,
      CASE
        WHEN a.li_distintas >= 2 OR a.paises >= 2 THEN 'ambiguo'
        ELSE 'seguro'
      END,
      v3.build_dup_payload(e.ids)
    FROM elegidos e
    JOIN atributos a ON a.group_key = e.group_key
    JOIN masters   m ON m.group_key = e.group_key
    ON CONFLICT (group_key, method) DO NOTHING
    RETURNING group_key
  ),
  -- Marcar los grupos ya promovidos: el indice parcial de la tabla los saca de
  -- la cola, asi el proximo clic arranca donde quedo este.
  marcados AS (
    UPDATE v3.company_dup_groups g
    SET promoted_at = now()
    WHERE g.group_key IN (SELECT group_key FROM ins)
    RETURNING 1
  )
  SELECT count(*) INTO v_nuevos FROM marcados;

  RETURN jsonb_build_object(
    'indexadas',       (SELECT count(*) FROM v3.company_name_index),
    'grupos_totales',  (SELECT count(*) FROM v3.company_dup_groups),
    'grupos_restantes',(SELECT count(*) FROM v3.company_dup_groups WHERE promoted_at IS NULL),
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
