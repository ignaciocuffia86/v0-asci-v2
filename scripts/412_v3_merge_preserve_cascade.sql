-- ============================================================================
-- 412 — El merge no puede perder datos en cascada
-- ============================================================================
--
-- PROBLEMA
--
-- Cuando `merge_companies` mueve las filas hijas al master y choca con un
-- UNIQUE, no aborta: BORRA la fila que sobra y la guarda en `deleted` para
-- poder revertir. Eso esta bien para la fila en si, pero **lo que cuelga de esa
-- fila con ON DELETE CASCADE se borra sin quedar registrado en ningun lado**.
--
-- Medido en produccion, las tablas que el merge puede borrar y que arrastran
-- hijos en cascada:
--
--   company_implementations  -> user_implementation_interactions   (730 filas)
--   company_news             -> user_news_interactions           (1.225 filas)
--   company_public_docs      -> user_public_doc_interactions          (0 filas)
--   v3.followed_accounts     -> v3.followed_account_subscribers
--                            -> v3.digest_log
--   v3.research_jobs         -> v3.research_stage_runs
--
-- O sea: ~1.955 interacciones de usuarios reales (guardados, marcas de leido)
-- que un merge podia borrar en silencio, y que revertir NO recuperaba.
--
-- SOLUCION
--
-- ORDEN DE APLICACION: este script depende del 414 (usa la columna
-- `bookmark_merge` y la funcion `v3.premerge_bookmarks`). Aplicar 414 primero.
-- El cuerpo de una funcion plpgsql no se valida al crearla, asi que al revés
-- crea sin error y recién falla al ejecutar el primer merge.
--
-- 1. `v3.snapshot_cascade()` — antes de borrar una fila, se guardan todos sus
--    descendientes en cascada, recursivamente, en orden padre-primero.
-- 2. `v3.premerge_followed_accounts()` — caso especial de las cuentas seguidas:
--    en vez de dejar que los suscriptores se borren, se copian al follow del
--    master y se concilian `is_active` / `refresh_day`.
-- 3. `revert_company_merge()` restaura tambien lo de la cascada.
--
-- Todo es reversible: ver la prueba al final del archivo.

-- ── Columnas nuevas en el log de merges ─────────────────────────────────────

ALTER TABLE v3.company_merges ADD COLUMN IF NOT EXISTS cascade_deleted JSONB;
ALTER TABLE v3.company_merges ADD COLUMN IF NOT EXISTS follow_merge    JSONB;

COMMENT ON COLUMN v3.company_merges.cascade_deleted IS
  'Filas borradas por ON DELETE CASCADE al borrar una fila hija en conflicto. '
  'Array ordenado padre-primero: [{"tabla": "...", "rows": [...]}]. '
  'El orden importa para restaurar sin violar las FKs.';

COMMENT ON COLUMN v3.company_merges.follow_merge IS
  'Que se hizo con las cuentas seguidas: suscriptores copiados al follow del '
  'master y estado previo de ese follow, para poder revertir.';

-- Para buscar follows por empresa. El UNIQUE existente es (workspace_id,
-- company_id), que no sirve para filtrar solo por company_id.
CREATE INDEX IF NOT EXISTS idx_v3_followed_accounts_company
  ON v3.followed_accounts (company_id);

-- ── 1. Snapshot recursivo de la cascada ─────────────────────────────────────

CREATE OR REPLACE FUNCTION v3.snapshot_cascade(
  p_tbl   TEXT,
  p_ids   UUID[],
  p_depth INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_out       JSONB := '[]'::jsonb;
  v_child     RECORD;
  v_rows      JSONB;
  v_child_ids UUID[];
  v_tiene_id  BOOLEAN;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Corte de seguridad ante ciclos de FKs.
  IF p_depth > 5 THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_child IN
    SELECT (con.conrelid::regclass)::text AS tbl,
           (SELECT a.attname
              FROM pg_attribute a
             WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) AS col,
           con.conrelid AS rel
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid = p_tbl::regclass
      AND con.confdeltype = 'c'                 -- solo CASCADE
      AND array_length(con.conkey, 1) = 1
      AND con.conrelid <> p_tbl::regclass       -- ignorar self-FK
    ORDER BY 1
  LOOP
    -- Sin columna `id` no se puede recursar; se guarda igual pero sin bajar mas.
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = v_child.rel AND attname = 'id' AND attnum > 0
    ) INTO v_tiene_id;

    IF v_tiene_id THEN
      EXECUTE format(
        'SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb),
                coalesce(array_agg(t.id), ''{}''::uuid[])
           FROM %s t WHERE t.%I = ANY($1)',
        v_child.tbl, v_child.col
      ) INTO v_rows, v_child_ids USING p_ids;
    ELSE
      EXECUTE format(
        'SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb)
           FROM %s t WHERE t.%I = ANY($1)',
        v_child.tbl, v_child.col
      ) INTO v_rows USING p_ids;
      v_child_ids := '{}'::uuid[];
    END IF;

    IF jsonb_array_length(v_rows) > 0 THEN
      -- El padre va antes que sus hijos: asi se puede restaurar en orden.
      v_out := v_out || jsonb_build_array(
        jsonb_build_object('tabla', v_child.tbl, 'rows', v_rows)
      );
      v_out := v_out || v3.snapshot_cascade(v_child.tbl, v_child_ids, p_depth + 1);
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION v3.snapshot_cascade(TEXT, UUID[], INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION v3.snapshot_cascade(TEXT, UUID[], INTEGER) TO service_role;

-- ── 2. Conciliacion de cuentas seguidas ─────────────────────────────────────
--
-- El follow no guarda ningun filtro: el filtro de scraping se DERIVA de la fila
-- de `companies` (nombre + pais). Asi que unificar no pierde criterios de
-- busqueda, pero si puede perder:
--   - los suscriptores del follow duplicado (se van en cascada)
--   - el estado `is_active` (si el master estaba dado de baja, ganaba el master
--     y la cuenta dejaba de seguirse en silencio)
--
-- Esta funcion NO borra el follow duplicado: solo copia lo que hay que salvar y
-- concilia el del master. El borrado lo hace despues el camino generico de
-- `merge_companies`, que ya guarda la fila y su cascada.

CREATE OR REPLACE FUNCTION v3.premerge_followed_accounts(
  p_master UUID,
  p_dup    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_out     JSONB := '[]'::jsonb;
  r         RECORD;
  v_creados UUID[];
  v_flip    UUID[];
  v_prev    JSONB;
BEGIN
  FOR r IN
    SELECT fd.id AS dup_fa, fm.id AS master_fa, fd.workspace_id,
           fd.is_active AS dup_active, fd.refresh_day AS dup_day,
           fd.last_refreshed_at AS dup_last
    FROM v3.followed_accounts fd
    JOIN v3.followed_accounts fm
      ON fm.workspace_id = fd.workspace_id AND fm.company_id = p_master
    WHERE fd.company_id = p_dup
  LOOP
    SELECT to_jsonb(f) INTO v_prev
    FROM v3.followed_accounts f WHERE f.id = r.master_fa;

    -- Suscriptores que estaban en el duplicado y no en el master: se copian.
    -- Los originales se borran despues en cascada, pero quedan en el snapshot.
    WITH nuevos AS (
      INSERT INTO v3.followed_account_subscribers
        (followed_account_id, workspace_id, user_id, subscribed)
      SELECT r.master_fa, s.workspace_id, s.user_id, s.subscribed
      FROM v3.followed_account_subscribers s
      WHERE s.followed_account_id = r.dup_fa
        AND NOT EXISTS (
          SELECT 1 FROM v3.followed_account_subscribers m
           WHERE m.followed_account_id = r.master_fa AND m.user_id = s.user_id
        )
      RETURNING id
    )
    SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_creados FROM nuevos;

    -- Ya estaba suscrito al master pero apagado, y en el duplicado prendido:
    -- gana el prendido (no se le saca una suscripcion que tenia).
    WITH flip AS (
      UPDATE v3.followed_account_subscribers m
      SET subscribed = true, updated_at = now()
      FROM v3.followed_account_subscribers s
      WHERE s.followed_account_id = r.dup_fa AND s.subscribed
        AND m.followed_account_id = r.master_fa AND m.user_id = s.user_id
        AND NOT m.subscribed
      RETURNING m.id
    )
    SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_flip FROM flip;

    UPDATE v3.followed_accounts m
    SET is_active   = m.is_active OR r.dup_active,
        refresh_day = least(m.refresh_day, r.dup_day),
        -- Si alguno de los dos nunca se refresco, el unificado cuenta como
        -- nunca refrescado: el filtro cambio y conviene volver a scrapear.
        last_refreshed_at = CASE
          WHEN m.last_refreshed_at IS NULL OR r.dup_last IS NULL THEN NULL
          ELSE least(m.last_refreshed_at, r.dup_last)
        END,
        unfollowed_at = CASE WHEN m.is_active OR r.dup_active THEN NULL ELSE m.unfollowed_at END,
        unfollowed_by = CASE WHEN m.is_active OR r.dup_active THEN NULL ELSE m.unfollowed_by END,
        updated_at  = now()
    WHERE m.id = r.master_fa;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'workspace_id',      r.workspace_id,
      'dup_fa',            r.dup_fa,
      'master_fa',         r.master_fa,
      'master_prev',       v_prev,
      'subs_creados',      to_jsonb(v_creados),
      'subs_reactivados',  to_jsonb(v_flip)
    ));
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION v3.premerge_followed_accounts(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION v3.premerge_followed_accounts(UUID, UUID) TO service_role;

-- ── 3. merge_companies con la cascada preservada ────────────────────────────
--
-- Identica a la version anterior salvo por tres cosas, marcadas con [NUEVO]:
--   a) llama a premerge_followed_accounts antes de mover
--   b) guarda la cascada antes de cada DELETE
--   c) persiste cascade_deleted y follow_merge en el log
--
-- Nota: el `SET LOCAL statement_timeout` que estaba aca NO servia. El timer
-- arranca con la sentencia que invoca la funcion, asi que subirlo adentro llega
-- tarde. El corte real lo maneja auto_merge_safe_candidates por presupuesto de
-- tiempo (script 411).

CREATE OR REPLACE FUNCTION public.merge_companies(
  p_master_company_id    UUID,
  p_duplicate_company_id UUID,
  p_dry_run              BOOLEAN DEFAULT false,
  p_method               TEXT    DEFAULT 'manual',
  p_confidence           NUMERIC DEFAULT NULL,
  p_reasoning            TEXT    DEFAULT NULL,
  p_decided_by           UUID    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $function$
DECLARE
  v_snapshot   JSONB;
  v_child      RECORD;
  v_tbl        TEXT;
  v_col        TEXT;
  v_moved      JSONB := '{}'::jsonb;
  v_deleted    JSONB := '{}'::jsonb;
  v_cascade    JSONB := '[]'::jsonb;   -- [NUEVO]
  v_follow     JSONB := '[]'::jsonb;   -- [NUEVO]
  v_bookmarks  JSONB := '[]'::jsonb;   -- [414]
  v_tiene_cascada BOOLEAN;             -- [NUEVO]
  v_ids        JSONB;
  v_rows       JSONB;
  v_row        JSONB;
  v_row_id     UUID;
  v_merge_id   UUID;
  v_result     JSONB;
BEGIN
  IF p_master_company_id IS NULL OR p_duplicate_company_id IS NULL THEN
    RAISE EXCEPTION 'merge_companies: los ids no pueden ser NULL';
  END IF;

  IF p_master_company_id = p_duplicate_company_id THEN
    RAISE EXCEPTION 'merge_companies: master y duplicada son la misma fila (%)',
      p_master_company_id;
  END IF;

  SELECT to_jsonb(c) INTO v_snapshot
  FROM public.companies c WHERE c.id = p_duplicate_company_id;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'merge_companies: no existe la empresa duplicada %',
      p_duplicate_company_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_master_company_id) THEN
    RAISE EXCEPTION 'merge_companies: no existe la empresa master %',
      p_master_company_id;
  END IF;

  BEGIN
    -- [NUEVO] (a) Salvar suscriptores y conciliar el follow del master antes de
    -- que el camino generico borre el follow duplicado.
    v_follow := v3.premerge_followed_accounts(p_master_company_id, p_duplicate_company_id);

    -- [414] Consolidar los bookmarks que quedarian repetidos. Solo toca los de
    -- contexto IDENTICO (mismas señales del diccionario + mismo filterType):
    -- dos bookmarks de la misma empresa con filtros distintos son busquedas
    -- distintas y se mueven los dos, sin tocarse. Ver script 414.
    v_bookmarks := v3.premerge_bookmarks(p_master_company_id, p_duplicate_company_id);

    FOR v_child IN
      SELECT (con.conrelid::regclass)::text AS tbl, a.attname AS col
      FROM pg_constraint con
      JOIN pg_attribute a
        ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
      WHERE con.contype = 'f'
        AND con.confrelid = 'public.companies'::regclass
        AND array_length(con.conkey, 1) = 1
      ORDER BY 1
    LOOP
      v_tbl := v_child.tbl;
      v_col := v_child.col;

      BEGIN
        EXECUTE format(
          'WITH upd AS (UPDATE %s SET %I = $1 WHERE %I = $2 RETURNING id)
           SELECT coalesce(jsonb_agg(id), ''[]''::jsonb) FROM upd',
          v_tbl, v_col, v_col
        ) INTO v_ids USING p_master_company_id, p_duplicate_company_id;

      EXCEPTION WHEN unique_violation THEN
        v_ids  := '[]'::jsonb;
        v_rows := '[]'::jsonb;

        -- Se resuelve UNA VEZ por tabla, no por fila: snapshot_cascade cuesta
        -- ~9ms por llamada (consulta pg_constraint y recursa), y llamarla por
        -- cada fila borrada bajaba el lote de 139 a 36 grupos por pasada.
        -- Solo 5 tablas tienen hijos en cascada; el resto no paga nada.
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE contype = 'f'
             AND confrelid = v_tbl::regclass
             AND confdeltype = 'c'
             AND conrelid <> v_tbl::regclass
        ) INTO v_tiene_cascada;

        FOR v_row_id IN
          EXECUTE format('SELECT id FROM %s WHERE %I = $1', v_tbl, v_col)
          USING p_duplicate_company_id
        LOOP
          BEGIN
            EXECUTE format('UPDATE %s SET %I = $1 WHERE id = $2', v_tbl, v_col)
              USING p_master_company_id, v_row_id;
            v_ids := v_ids || to_jsonb(v_row_id);
          EXCEPTION WHEN unique_violation THEN
            -- [NUEVO] (b) Guardar lo que se va a ir en cascada ANTES de borrar.
            IF v_tiene_cascada THEN
              v_cascade := v_cascade || v3.snapshot_cascade(v_tbl, ARRAY[v_row_id]);
            END IF;

            EXECUTE format(
              'WITH del AS (DELETE FROM %s WHERE id = $1 RETURNING *)
               SELECT coalesce(jsonb_agg(to_jsonb(del)), ''[]''::jsonb) FROM del',
              v_tbl
            ) INTO v_row USING v_row_id;
            v_rows := v_rows || v_row;
          END;
        END LOOP;

        IF jsonb_array_length(v_rows) > 0 THEN
          v_deleted := v_deleted || jsonb_build_object(v_tbl, v_rows);
        END IF;
      END;

      IF jsonb_array_length(v_ids) > 0 THEN
        v_moved := v_moved || jsonb_build_object(v_tbl, v_ids);
      END IF;
    END LOOP;

    DELETE FROM public.companies WHERE id = p_duplicate_company_id;

    UPDATE public.companies m SET
      linkedin_url           = coalesce(m.linkedin_url,           v_snapshot->>'linkedin_url'),
      linkedin_slug          = coalesce(m.linkedin_slug,          v_snapshot->>'linkedin_slug'),
      website                = coalesce(m.website,                v_snapshot->>'website'),
      industry               = coalesce(m.industry,               v_snapshot->>'industry'),
      country                = coalesce(nullif(m.country, ''),    nullif(v_snapshot->>'country', '')),
      country_normalized     = coalesce(m.country_normalized,     v_snapshot->>'country_normalized'),
      logo_url               = coalesce(m.logo_url,               v_snapshot->>'logo_url'),
      description            = coalesce(m.description,            v_snapshot->>'description'),
      ticker                 = coalesce(m.ticker,                 v_snapshot->>'ticker'),
      cik                    = coalesce(m.cik,                    v_snapshot->>'cik'),
      stock_exchange         = coalesce(m.stock_exchange,         v_snapshot->>'stock_exchange'),
      apollo_organization_id = coalesce(m.apollo_organization_id, v_snapshot->>'apollo_organization_id'),
      apollo_industry        = coalesce(m.apollo_industry,        v_snapshot->>'apollo_industry'),
      updated_at             = now()
    WHERE m.id = p_master_company_id;

    INSERT INTO v3.company_merges (
      master_id, duplicate_id, duplicate_snapshot, moved, deleted,
      cascade_deleted, follow_merge, bookmark_merge,
      method, confidence, reasoning, decided_by
    ) VALUES (
      p_master_company_id, p_duplicate_company_id, v_snapshot, v_moved, v_deleted,
      v_cascade, v_follow, v_bookmarks,
      p_method, p_confidence, p_reasoning, p_decided_by
    )
    RETURNING id INTO v_merge_id;

    v_result := jsonb_build_object(
      'dry_run',        p_dry_run,
      'merge_id',       v_merge_id,
      'master_id',      p_master_company_id,
      'duplicate_id',   p_duplicate_company_id,
      'duplicate_name', v_snapshot->>'name',
      'moved',          v_moved,
      'deleted',        v_deleted,
      'cascade_deleted', v_cascade,
      'follow_merge',   v_follow,
      'bookmark_merge', v_bookmarks,
      'bookmarks_consolidados', jsonb_array_length(v_bookmarks),
      'moved_total',    (SELECT coalesce(sum(jsonb_array_length(value)), 0)
                         FROM jsonb_each(v_moved)),
      'deleted_total',  (SELECT coalesce(sum(jsonb_array_length(value)), 0)
                         FROM jsonb_each(v_deleted)),
      'cascade_total',  (SELECT coalesce(sum(jsonb_array_length(e->'rows')), 0)
                         FROM jsonb_array_elements(v_cascade) e)
    );

    IF p_dry_run THEN
      RAISE EXCEPTION 'dry run' USING ERRCODE = 'YY001';
    END IF;

  EXCEPTION WHEN SQLSTATE 'YY001' THEN
    v_result := v_result || jsonb_build_object('merge_id', NULL, 'applied', false);
  END;

  RETURN coalesce(v_result, '{}'::jsonb) ||
         jsonb_build_object('applied', NOT p_dry_run);
END;
$function$;

-- ── 4. revert que tambien restaura la cascada ───────────────────────────────

CREATE OR REPLACE FUNCTION public.revert_company_merge(p_merge_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $function$
DECLARE
  v_log      v3.company_merges;
  v_tbl      TEXT;
  v_ids      JSONB;
  v_restored INT := 0;
  v_cols     TEXT;
  v_cand     INT := 0;
  v_elem     JSONB;
  v_fm       JSONB;
  v_bm       JSONB;   -- [414]
  v_bm_tbl   RECORD;  -- [414]
BEGIN
  SELECT * INTO v_log FROM v3.company_merges WHERE id = p_merge_id;
  IF v_log.id IS NULL THEN
    RAISE EXCEPTION 'revert_company_merge: no existe el merge %', p_merge_id;
  END IF;
  IF v_log.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'revert_company_merge: el merge % ya fue revertido', p_merge_id;
  END IF;

  SELECT string_agg(quote_ident(key), ', ') INTO v_cols
  FROM jsonb_each_text(v_log.duplicate_snapshot);

  EXECUTE format(
    'INSERT INTO public.companies (%s) SELECT %s FROM jsonb_populate_record(NULL::public.companies, $1)',
    v_cols, v_cols
  ) USING v_log.duplicate_snapshot;

  FOR v_tbl, v_ids IN SELECT key, value FROM jsonb_each(v_log.moved)
  LOOP
    EXECUTE format(
      'UPDATE %s SET %I = $1 WHERE id = ANY($2)',
      v_tbl,
      (SELECT a.attname
       FROM pg_constraint con
       JOIN pg_attribute a
         ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
       WHERE con.contype = 'f'
         AND con.confrelid = 'public.companies'::regclass
         AND con.conrelid = v_tbl::regclass
       LIMIT 1)
    ) USING v_log.duplicate_id,
            (SELECT array_agg((value #>> '{}')::uuid) FROM jsonb_array_elements(v_ids));
    v_restored := v_restored + jsonb_array_length(v_ids);
  END LOOP;

  FOR v_tbl, v_ids IN SELECT key, value FROM jsonb_each(v_log.deleted)
  LOOP
    SELECT string_agg(quote_ident(key), ', ') INTO v_cols
    FROM jsonb_each_text(v_ids->0);

    EXECUTE format(
      'INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%s, $1)',
      v_tbl, v_cols, v_cols, v_tbl
    ) USING v_ids;
    v_restored := v_restored + jsonb_array_length(v_ids);
  END LOOP;

  -- [NUEVO] Restaurar la cascada. Se recorre EN ORDEN (padre antes que hijo),
  -- por eso es un array y no un objeto: con jsonb_each el orden lo decide
  -- Postgres y las FKs fallarian.
  FOR v_elem IN
    SELECT value FROM jsonb_array_elements(coalesce(v_log.cascade_deleted, '[]'::jsonb))
  LOOP
    v_tbl  := v_elem->>'tabla';
    v_ids  := v_elem->'rows';

    SELECT string_agg(quote_ident(key), ', ') INTO v_cols
    FROM jsonb_each_text(v_ids->0);

    EXECUTE format(
      'INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%s, $1)
       ON CONFLICT DO NOTHING',
      v_tbl, v_cols, v_cols, v_tbl
    ) USING v_ids;
    v_restored := v_restored + jsonb_array_length(v_ids);
  END LOOP;

  -- [NUEVO] Deshacer la conciliacion de follows: sacar las suscripciones que
  -- se habian copiado al master y devolver su estado previo.
  FOR v_fm IN
    SELECT value FROM jsonb_array_elements(coalesce(v_log.follow_merge, '[]'::jsonb))
  LOOP
    DELETE FROM v3.followed_account_subscribers
    WHERE id = ANY (SELECT (value #>> '{}')::uuid
                      FROM jsonb_array_elements(v_fm->'subs_creados'));

    UPDATE v3.followed_account_subscribers
    SET subscribed = false, updated_at = now()
    WHERE id = ANY (SELECT (value #>> '{}')::uuid
                      FROM jsonb_array_elements(v_fm->'subs_reactivados'));

    UPDATE v3.followed_accounts f
    SET is_active         = (v_fm->'master_prev'->>'is_active')::boolean,
        refresh_day       = (v_fm->'master_prev'->>'refresh_day')::smallint,
        last_refreshed_at = (v_fm->'master_prev'->>'last_refreshed_at')::timestamptz,
        unfollowed_at     = (v_fm->'master_prev'->>'unfollowed_at')::timestamptz,
        unfollowed_by     = (v_fm->'master_prev'->>'unfollowed_by')::uuid,
        updated_at        = now()
    WHERE f.id = (v_fm->>'master_fa')::uuid;
  END LOOP;

  -- [414] Deshacer la consolidacion de bookmarks: reponer la fila borrada, y
  -- recien despues devolverle las hijas. El orden importa: las hijas tienen FK
  -- al bookmark, asi que si se mueven antes de reinsertarlo fallan.
  FOR v_bm IN
    SELECT value FROM jsonb_array_elements(coalesce(v_log.bookmark_merge, '[]'::jsonb))
  LOOP
    SELECT string_agg(quote_ident(key), ', ') INTO v_cols
    FROM jsonb_each_text(v_bm->'drop_row');

    EXECUTE format(
      'INSERT INTO public.bookmarks (%s)
       SELECT %s FROM jsonb_populate_record(NULL::public.bookmarks, $1)
       ON CONFLICT DO NOTHING',
      v_cols, v_cols
    ) USING v_bm->'drop_row';

    -- Hijas que se habian movido al sobreviviente.
    FOR v_bm_tbl IN SELECT key AS tbl, value AS ids FROM jsonb_each(coalesce(v_bm->'moved','{}'::jsonb))
    LOOP
      EXECUTE format(
        'UPDATE %s SET bookmark_id = $1 WHERE id = ANY (SELECT (value #>> ''{}'')::uuid
           FROM jsonb_array_elements($2))',
        v_bm_tbl.tbl
      ) USING (v_bm->'drop_row'->>'id')::uuid, v_bm_tbl.ids;
    END LOOP;

    -- Hijas que se habian borrado por choque de unique (resumenes, estrategias).
    FOR v_bm_tbl IN SELECT key AS tbl, value AS rows FROM jsonb_each(coalesce(v_bm->'deleted','{}'::jsonb))
    LOOP
      SELECT string_agg(quote_ident(key), ', ') INTO v_cols
      FROM jsonb_each_text(v_bm_tbl.rows->0);

      EXECUTE format(
        'INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%s, $1)
         ON CONFLICT DO NOTHING',
        v_bm_tbl.tbl, v_cols, v_cols, v_bm_tbl.tbl
      ) USING v_bm_tbl.rows;
    END LOOP;

    -- Y devolver las notas / estado / prioridad que tenia el sobreviviente.
    UPDATE public.bookmarks b
    SET notes      = v_bm->'keep_prev'->>'notes',
        status     = v_bm->'keep_prev'->>'status',
        priority   = v_bm->'keep_prev'->>'priority',
        updated_at = (v_bm->'keep_prev'->>'updated_at')::timestamptz
    WHERE b.id = (v_bm->>'keep_id')::uuid;
  END LOOP;

  UPDATE v3.company_merges SET reverted_at = now() WHERE id = p_merge_id;

  WITH reabrir AS (
    UPDATE v3.company_dup_candidates d
    SET status = 'pending', merge_ids = NULL, resolved_at = NULL
    WHERE d.merge_ids @> ARRAY[p_merge_id]
      AND NOT EXISTS (
        SELECT 1 FROM v3.company_merges m
        WHERE m.id = ANY(d.merge_ids)
          AND m.id <> p_merge_id
          AND m.reverted_at IS NULL
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_cand FROM reabrir;

  RETURN jsonb_build_object(
    'merge_id',            p_merge_id,
    'restored_id',         v_log.duplicate_id,
    'restored_name',       v_log.duplicate_snapshot->>'name',
    'rows_restored',       v_restored,
    'candidates_reopened', v_cand
  );
END;
$function$;

-- Permisos: se REPONEN los que ya tenian. `authenticated` estaba en el ACL y lo
-- usa el dedupe de v2 en produccion, asi que sacarlo lo rompia. Solo se saca a
-- PUBLIC/anon (que no deberian estar nunca).
REVOKE ALL ON FUNCTION public.merge_companies(UUID, UUID, BOOLEAN, TEXT, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revert_company_merge(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_companies(UUID, UUID, BOOLEAN, TEXT, NUMERIC, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revert_company_merge(UUID) TO authenticated, service_role;
