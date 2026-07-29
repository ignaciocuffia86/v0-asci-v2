-- 417 — Limpieza de los bookmarks redundantes historicos + nucleo reutilizable
--
-- CONTEXTO
-- El script 414 evita que el merge de empresas genere bookmarks redundantes de
-- aca en adelante. Pero quedaron 21 grupos historicos (mismo user + misma
-- empresa + mismo contexto de señales). Medido: de esos 21, solo 8 los causo el
-- merge; los otros 13 ya existian, o sea que la validacion de
-- checkBookmarkWithContext (app/actions/bookmarks.ts:99) se escapa — no es
-- atomica, y dos requests concurrentes pasan los dos el chequeo.
--
-- QUE HACE
-- 1. Extrae el nucleo de consolidacion de `premerge_bookmarks` a
--    `v3.consolidate_bookmark_pair()`, y el de revert a
--    `v3.restore_bookmark_pair()`. Son ~60 lineas de EXECUTE format sobre las 8
--    tablas hijas (4 en CASCADE): duplicarlas para la limpieza historica era
--    pedir que las dos copias se desincronicen.
-- 2. `v3.dedupe_bookmarks_legacy()` aplica la MISMA regla a los grupos ya
--    existentes, con snapshot en `v3.bookmark_dedupe_log` para poder revertir.
--
-- La regla de identidad no cambia: solo se consolida contexto IDENTICO
-- (filterSignalIds ordenados + filterType). Dos bookmarks de la misma empresa
-- con filtros distintos son busquedas distintas y no se tocan.

-- ---------------------------------------------------------------------------
-- 1. Nucleo: consolidar un par (reutilizado por el merge y por la limpieza)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION v3.consolidate_bookmark_pair(
  p_keep UUID,
  p_drop UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_child   RECORD;
  v_moved   JSONB := '{}'::jsonb;
  v_deleted JSONB := '{}'::jsonb;
  v_ids     JSONB;
  v_rows    JSONB;
  v_drop    JSONB;
  v_prev    JSONB;
BEGIN
  IF p_keep = p_drop THEN
    RAISE EXCEPTION 'consolidate_bookmark_pair: keep y drop son el mismo bookmark (%)', p_keep;
  END IF;

  -- Fila que se borra y estado previo del sobreviviente, para el revert.
  SELECT to_jsonb(b) INTO v_drop FROM public.bookmarks b WHERE b.id = p_drop;
  IF v_drop IS NULL THEN
    RAISE EXCEPTION 'consolidate_bookmark_pair: no existe el bookmark a borrar (%)', p_drop;
  END IF;

  SELECT jsonb_build_object(
           'notes', b.notes, 'status', b.status,
           'priority', b.priority, 'updated_at', b.updated_at,
           'search_context', b.search_context)
    INTO v_prev
    FROM public.bookmarks b WHERE b.id = p_keep;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'consolidate_bookmark_pair: no existe el sobreviviente (%)', p_keep;
  END IF;

  -- Mover todo lo que cuelga del bookmark. La lista sale de pg_constraint, no
  -- hardcodeada: hoy son 8 tablas y 4 estan en CASCADE (bookmark_summaries,
  -- user_icebreakers, user_company_strategies, user_company_signals), asi que
  -- borrar sin mover primero perderia contenido del usuario en silencio.
  FOR v_child IN
    SELECT (con.conrelid::regclass)::text AS tbl, a.attname AS col
    FROM pg_constraint con
    JOIN pg_attribute a
      ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.bookmarks'::regclass
      AND array_length(con.conkey, 1) = 1
    ORDER BY 1
  LOOP
    BEGIN
      EXECUTE format(
        'WITH upd AS (UPDATE %s SET %I = $1 WHERE %I = $2 RETURNING id)
         SELECT coalesce(jsonb_agg(id), ''[]''::jsonb) FROM upd',
        v_child.tbl, v_child.col, v_child.col
      ) INTO v_ids USING p_keep, p_drop;

      IF jsonb_array_length(v_ids) > 0 THEN
        v_moved := v_moved || jsonb_build_object(v_child.tbl, v_ids);
      END IF;

    EXCEPTION WHEN unique_violation THEN
      -- El sobreviviente ya tiene su propia fila (bookmark_summaries es UNIQUE
      -- (bookmark_id), user_company_strategies UNIQUE (bookmark_id, user_id)).
      -- Se conserva la del sobreviviente y la otra se guarda entera.
      EXECUTE format(
        'SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM %s t WHERE t.%I = $1',
        v_child.tbl, v_child.col
      ) INTO v_rows USING p_drop;

      EXECUTE format('DELETE FROM %s WHERE %I = $1', v_child.tbl, v_child.col)
        USING p_drop;

      IF jsonb_array_length(v_rows) > 0 THEN
        v_deleted := v_deleted || jsonb_build_object(v_child.tbl, v_rows);
      END IF;
    END;
  END LOOP;

  -- Conciliar el contenido propio. Las notas las escribio el usuario a mano:
  -- se concatenan, nunca se descarta una.
  UPDATE public.bookmarks k
  SET notes = CASE
                WHEN d.notes IS NULL OR btrim(d.notes) = '' THEN k.notes
                WHEN k.notes IS NULL OR btrim(k.notes) = '' THEN d.notes
                WHEN k.notes = d.notes THEN k.notes
                ELSE k.notes || E'\n\n---\n' || d.notes
              END,
      status = CASE
                 WHEN v3.bookmark_status_rank(d.status)
                      > v3.bookmark_status_rank(k.status)
                 THEN d.status ELSE k.status
               END,
      -- 'alta' / 'transaccional' / 'baja' no son una escala comparable, asi que
      -- solo se completa si el sobreviviente no tenia nada.
      priority = coalesce(k.priority, d.priority),
      -- countryFilter vive en search_context pero NO es identidad (la app decide
      -- duplicado solo por filterSignalIds + filterType). Es preferencia de
      -- vista: se hereda solo si el sobreviviente nunca eligio. Ojo con la
      -- convencion: key presente en null = "Todos los paises" a proposito,
      -- distinto de key ausente = no eligio.
      search_context = CASE
        WHEN (k.search_context ? 'countryFilter') THEN k.search_context
        WHEN (d.search_context ? 'countryFilter')
          THEN coalesce(k.search_context, '{}'::jsonb)
               || jsonb_build_object('countryFilter', d.search_context->'countryFilter')
        ELSE k.search_context
      END,
      updated_at = now()
  FROM public.bookmarks d
  WHERE k.id = p_keep AND d.id = p_drop;

  DELETE FROM public.bookmarks WHERE id = p_drop;

  RETURN jsonb_build_object(
    'keep_id',   p_keep,
    'drop_row',  v_drop,
    'keep_prev', v_prev,
    'moved',     v_moved,
    'deleted',   v_deleted
  );
END $$;

-- ---------------------------------------------------------------------------
-- 2. Nucleo: deshacer un par consolidado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION v3.restore_bookmark_pair(p_entry JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_cols TEXT;
  v_tbl  RECORD;
BEGIN
  -- Reponer la fila borrada ANTES de devolverle las hijas: tienen FK al
  -- bookmark, asi que moverlas primero falla.
  --
  -- Las columnas se cruzan contra pg_attribute para excluir generadas: si mas
  -- adelante se agrega una columna GENERATED a `bookmarks`, `to_jsonb(b)` la
  -- captura y el INSERT explotaria con "cannot insert a non-DEFAULT value".
  SELECT string_agg(quote_ident(k.key), ', ') INTO v_cols
  FROM jsonb_object_keys(p_entry->'drop_row') AS k(key)
  JOIN pg_attribute a
    ON a.attrelid = 'public.bookmarks'::regclass
   AND a.attname = k.key
   AND a.attnum > 0
   AND NOT a.attisdropped
   AND a.attgenerated = '';

  EXECUTE format(
    'INSERT INTO public.bookmarks (%s)
     SELECT %s FROM jsonb_populate_record(NULL::public.bookmarks, $1)
     ON CONFLICT DO NOTHING',
    v_cols, v_cols
  ) USING p_entry->'drop_row';

  -- Hijas que se habian movido al sobreviviente.
  FOR v_tbl IN SELECT key AS tbl, value AS ids FROM jsonb_each(coalesce(p_entry->'moved','{}'::jsonb))
  LOOP
    EXECUTE format(
      'UPDATE %s SET bookmark_id = $1 WHERE id = ANY (SELECT (value #>> ''{}'')::uuid
         FROM jsonb_array_elements($2))',
      v_tbl.tbl
    ) USING (p_entry->'drop_row'->>'id')::uuid, v_tbl.ids;
  END LOOP;

  -- Hijas borradas por choque de unique.
  FOR v_tbl IN SELECT key AS tbl, value AS rows FROM jsonb_each(coalesce(p_entry->'deleted','{}'::jsonb))
  LOOP
    SELECT string_agg(quote_ident(key), ', ') INTO v_cols
    FROM jsonb_each_text(v_tbl.rows->0);

    EXECUTE format(
      'INSERT INTO %s (%s) SELECT %s FROM jsonb_populate_recordset(NULL::%s, $1)
       ON CONFLICT DO NOTHING',
      v_tbl.tbl, v_cols, v_cols, v_tbl.tbl
    ) USING v_tbl.rows;
  END LOOP;

  -- Y devolver notas / estado / prioridad / contexto del sobreviviente.
  UPDATE public.bookmarks b
  SET notes    = p_entry->'keep_prev'->>'notes',
      status   = p_entry->'keep_prev'->>'status',
      priority = p_entry->'keep_prev'->>'priority',
      search_context = CASE
        WHEN NOT (p_entry->'keep_prev' ? 'search_context') THEN b.search_context
        WHEN p_entry->'keep_prev'->'search_context' = 'null'::jsonb THEN NULL
        ELSE p_entry->'keep_prev'->'search_context'
      END,
      updated_at = (p_entry->'keep_prev'->>'updated_at')::timestamptz
  WHERE b.id = (p_entry->>'keep_id')::uuid;
END $$;

-- ---------------------------------------------------------------------------
-- 3. premerge_bookmarks ahora solo elige los pares y delega
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION v3.premerge_bookmarks(
  p_master    UUID,
  p_duplicate UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_par RECORD;
  v_out JSONB := '[]'::jsonb;
BEGIN
  -- Atajo: hay 2.280 bookmarks sobre 485k empresas, asi que el 99% de los
  -- merges no tiene nada que hacer aca.
  IF NOT EXISTS (SELECT 1 FROM public.bookmarks WHERE company_id = p_duplicate) THEN
    RETURN v_out;
  END IF;

  FOR v_par IN
    -- Sobreviviente: el del master; si el master no tiene, el mas viejo.
    SELECT d.id AS drop_id, s.id AS keep_id
    FROM public.bookmarks d
    JOIN LATERAL (
      SELECT b.id
      FROM public.bookmarks b
      WHERE b.company_id = p_master
        AND b.user_id = d.user_id
        AND v3.bookmark_context_key(b.search_context)
            = v3.bookmark_context_key(d.search_context)
      ORDER BY b.created_at, b.id
      LIMIT 1
    ) s ON true
    WHERE d.company_id = p_duplicate
  LOOP
    v_out := v_out || jsonb_build_array(
      v3.consolidate_bookmark_pair(v_par.keep_id, v_par.drop_id)
    );
  END LOOP;

  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Limpieza de los grupos historicos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3.bookmark_dedupe_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    UUID NOT NULL,
  keep_id     UUID NOT NULL,
  entry       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bookmark_dedupe_log_batch
  ON v3.bookmark_dedupe_log (batch_id);

COMMENT ON TABLE v3.bookmark_dedupe_log IS
  'Snapshot de la limpieza de bookmarks redundantes historicos. Estos no vienen '
  'de un merge, asi que no tienen fila en company_merges: el revert sale de aca.';

-- p_dry_run = true recorre y cuenta sin escribir nada.
CREATE OR REPLACE FUNCTION v3.dedupe_bookmarks_legacy(
  p_limit   INTEGER DEFAULT 500,
  p_dry_run BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_grupo    RECORD;
  v_drop     UUID;
  v_entry    JSONB;
  v_batch    UUID := gen_random_uuid();
  v_grupos   INTEGER := 0;
  v_filas    INTEGER := 0;
BEGIN
  FOR v_grupo IN
    SELECT user_id, company_id,
           v3.bookmark_context_key(search_context) AS ck,
           array_agg(id ORDER BY created_at, id) AS ids
    FROM public.bookmarks
    GROUP BY 1, 2, 3
    HAVING count(*) > 1
    ORDER BY user_id, company_id
    LIMIT p_limit
  LOOP
    v_grupos := v_grupos + 1;

    -- ids[1] es el mas viejo y sobrevive; el resto se consolidan sobre el.
    FOREACH v_drop IN ARRAY v_grupo.ids[2:]
    LOOP
      v_filas := v_filas + 1;
      IF NOT p_dry_run THEN
        v_entry := v3.consolidate_bookmark_pair(v_grupo.ids[1], v_drop);
        INSERT INTO v3.bookmark_dedupe_log (batch_id, keep_id, entry)
        VALUES (v_batch, v_grupo.ids[1], v_entry);
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run',   p_dry_run,
    'batch_id',  CASE WHEN p_dry_run THEN NULL ELSE v_batch END,
    'grupos',    v_grupos,
    'consolidados', v_filas
  );
END $$;

-- Deshace un batch completo. Se revierte en orden inverso por prolijidad.
CREATE OR REPLACE FUNCTION v3.revert_bookmark_dedupe(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_log   RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_log IN
    SELECT id, entry FROM v3.bookmark_dedupe_log
    WHERE batch_id = p_batch_id AND reverted_at IS NULL
    ORDER BY created_at DESC, id DESC
  LOOP
    PERFORM v3.restore_bookmark_pair(v_log.entry);
    UPDATE v3.bookmark_dedupe_log SET reverted_at = now() WHERE id = v_log.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('batch_id', p_batch_id, 'revertidos', v_count);
END $$;

-- PERMISOS. Estas 5 son de mantenimiento y son SECURITY DEFINER: si un usuario
-- logueado las pudiera llamar, consolidaria o restauraria bookmarks de CUALQUIER
-- otro usuario salteando RLS (le alcanza con pasar un UUID ajeno).
--
-- Ojo con la trampa: NO basta con revocar de PUBLIC. Ademas del EXECUTE a PUBLIC
-- que da Postgres, Supabase trae un `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON
-- FUNCTIONS TO anon, authenticated, service_role`, o sea que cada funcion nueva
-- nace con un GRANT **directo** a `authenticated`. Ese grant no se hereda de
-- PUBLIC, asi que `REVOKE ... FROM PUBLIC, anon` lo deja intacto. Hay que
-- nombrar a `authenticated` explicitamente.
--
-- Revocarselo a `authenticated` no rompe el merge: `public.merge_companies` es
-- SECURITY DEFINER, asi que corre como su owner y puede llamar a estas por
-- dentro sin importar los permisos de quien la invoco.
REVOKE ALL ON FUNCTION v3.consolidate_bookmark_pair(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION v3.restore_bookmark_pair(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION v3.premerge_bookmarks(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION v3.dedupe_bookmarks_legacy(INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION v3.revert_bookmark_dedupe(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION v3.consolidate_bookmark_pair(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION v3.restore_bookmark_pair(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION v3.premerge_bookmarks(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION v3.dedupe_bookmarks_legacy(INTEGER, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION v3.revert_bookmark_dedupe(UUID) TO service_role;

-- El log guarda filas enteras de bookmarks de otros usuarios: solo service_role.
REVOKE ALL ON TABLE v3.bookmark_dedupe_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE v3.bookmark_dedupe_log TO service_role;
