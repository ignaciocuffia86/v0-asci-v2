-- 414 — Bookmarks con contexto de señales en el merge de empresas
--
-- PROBLEMA
-- `bookmarks` no tiene ningun UNIQUE mas que la PK, asi que el merge movia los
-- bookmarks de la duplicada al master sin mirar nada: el usuario terminaba con
-- la misma empresa repetida en el kanban.
--
-- Pero NO todos los repetidos son duplicados. La app ya define la identidad de
-- un bookmark como (user_id, company_id, filterSignalIds ordenados, filterType)
-- — ver checkBookmarkWithContext en app/actions/bookmarks.ts:98-111. Dos
-- bookmarks de la misma empresa con filtros de diccionario distintos son
-- BUSQUEDAS DISTINTAS y deben seguir existiendo por separado.
--
-- Medido en produccion: de 69 pares (mismo user + misma empresa master), solo
-- 8 tenian contexto identico. Los otros 61 son legitimos.
--
-- QUE HACE
-- 1. `v3.bookmark_context_key()` replica en SQL la regla de identidad de la app.
-- 2. `v3.premerge_bookmarks()` consolida SOLO los de contexto identico, moviendo
--    el contenido de las 8 tablas hijas antes de borrar (4 son CASCADE: se
--    perderian resumenes, icebreakers y estrategias sin esto).
-- 3. Todo queda en `company_merges.bookmark_merge` para poder revertir.
--
-- NO hace falta invalidar `bookmark_summaries.context_hash`: calculateContextHash
-- (lib/brief/prepare-brief-context.ts:471) incluye companyId, contactos, vacantes
-- y noticias, y la ruta lo recalcula sobre datos vivos y lo compara contra el
-- guardado. Al unificar, el hash cambia solo y el resumen se regenera. Escribir
-- NULL ahi seria una escritura en produccion sin efecto.
--
-- Las señales (`public.signals`) ya se unifican por company_id solas: tienen
-- UNIQUE (contact_id, company_id, signal_type, signal_id), asi que al pasar al
-- master la misma señal del mismo contacto colisiona y se deduplica. Verificado:
-- 0 señales exactamente duplicadas en las empresas ya unificadas.

ALTER TABLE v3.company_merges ADD COLUMN IF NOT EXISTS bookmark_merge JSONB;

COMMENT ON COLUMN v3.company_merges.bookmark_merge IS
  'Consolidacion de bookmarks de contexto identico: fila borrada, hijas movidas '
  'y valores previos del sobreviviente. Habilita el revert.';

-- ---------------------------------------------------------------------------
-- 1. Clave de contexto — misma regla que la app
-- ---------------------------------------------------------------------------
-- JS:  (ctx.filterSignalIds || []).sort().join(",")  y  ctx.filterType || "generic"
--
-- `COLLATE "C"` no es un detalle: el .sort() de JS ordena por code unit (bytes,
-- para ASCII), mientras que el ORDER BY de Postgres usa la collation de la base
-- (en_US.utf8), que ignora los guiones al comparar. Con UUIDs eso da ordenes
-- distintos y dos bookmarks identicos parecerian diferentes.
--
-- `nullif(...,'')` porque en JS "" es falsy y cae en "generic".
CREATE OR REPLACE FUNCTION v3.bookmark_context_key(p_ctx JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
           (SELECT string_agg(x, ',' ORDER BY x COLLATE "C")
              FROM jsonb_array_elements_text(
                     CASE WHEN jsonb_typeof(p_ctx -> 'filterSignalIds') = 'array'
                          THEN p_ctx -> 'filterSignalIds'
                          ELSE '[]'::jsonb END) t(x)),
           '')
         || '|' ||
         coalesce(nullif(p_ctx ->> 'filterType', ''), 'generic');
$$;

-- Orden del kanban. 'descartado' va ultimo a proposito: si el usuario descarto
-- una fila y en la otra llego a 'reunion', gana el estado activo.
CREATE OR REPLACE FUNCTION v3.bookmark_status_rank(p_status TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
           WHEN 'reunion'      THEN 5
           WHEN 'respondio'    THEN 4
           WHEN 'contactado'   THEN 3
           WHEN 'investigando' THEN 2
           WHEN 'nuevo'        THEN 1
           WHEN 'descartado'   THEN 0
           ELSE 0
         END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Consolidacion de bookmarks redundantes
-- ---------------------------------------------------------------------------
-- Se llama por par (master, duplicada) desde merge_companies. Para grupos de 3+
-- empresas alcanza: apply_dup_candidate mergea de a una, asi que cuando entra la
-- segunda duplicada los bookmarks de la primera ya estan bajo el master.
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
  v_par     RECORD;
  v_child   RECORD;
  v_out     JSONB := '[]'::jsonb;
  v_moved   JSONB;
  v_deleted JSONB;
  v_ids     JSONB;
  v_rows    JSONB;
  v_drop    JSONB;
  v_prev    JSONB;
BEGIN
  -- Atajo: hay 2.280 bookmarks sobre 485k empresas, asi que el 99% de los
  -- merges no tiene nada que hacer aca. Sin este EXISTS se pagaria el costo
  -- de la deteccion en todos.
  IF NOT EXISTS (
    SELECT 1 FROM public.bookmarks WHERE company_id = p_duplicate
  ) THEN
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
    v_moved   := '{}'::jsonb;
    v_deleted := '{}'::jsonb;

    -- Guardar la fila que se va a borrar y el estado previo del sobreviviente.
    SELECT to_jsonb(b) INTO v_drop FROM public.bookmarks b WHERE b.id = v_par.drop_id;

    SELECT jsonb_build_object(
             'notes', b.notes, 'status', b.status,
             'priority', b.priority, 'updated_at', b.updated_at)
      INTO v_prev
      FROM public.bookmarks b WHERE b.id = v_par.keep_id;

    -- Mover todo lo que cuelga del bookmark. La lista sale de pg_constraint, no
    -- hardcodeada: son 8 tablas hoy y 4 estan en CASCADE (bookmark_summaries,
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
        ) INTO v_ids USING v_par.keep_id, v_par.drop_id;

        IF jsonb_array_length(v_ids) > 0 THEN
          v_moved := v_moved || jsonb_build_object(v_child.tbl, v_ids);
        END IF;

      EXCEPTION WHEN unique_violation THEN
        -- El sobreviviente ya tiene su propia fila (bookmark_summaries es
        -- UNIQUE (bookmark_id) y user_company_strategies UNIQUE
        -- (bookmark_id, user_id)). Se conserva la del sobreviviente y la otra
        -- se guarda entera antes de borrarla.
        EXECUTE format(
          'SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM %s t WHERE t.%I = $1',
          v_child.tbl, v_child.col
        ) INTO v_rows USING v_par.drop_id;

        EXECUTE format('DELETE FROM %s WHERE %I = $1', v_child.tbl, v_child.col)
          USING v_par.drop_id;

        IF jsonb_array_length(v_rows) > 0 THEN
          v_deleted := v_deleted || jsonb_build_object(v_child.tbl, v_rows);
        END IF;
      END;
    END LOOP;

    -- Conciliar el contenido propio del bookmark. Las notas las escribio el
    -- usuario a mano: se concatenan, nunca se descarta una.
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
        -- 'alta' / 'transaccional' / 'baja' no son una escala comparable, asi
        -- que solo se completa si el sobreviviente no tenia nada.
        priority = coalesce(k.priority, d.priority),
        updated_at = now()
    FROM public.bookmarks d
    WHERE k.id = v_par.keep_id AND d.id = v_par.drop_id;

    DELETE FROM public.bookmarks WHERE id = v_par.drop_id;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'keep_id',   v_par.keep_id,
      'drop_row',  v_drop,
      'keep_prev', v_prev,
      'moved',     v_moved,
      'deleted',   v_deleted
    ));
  END LOOP;

  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION v3.premerge_bookmarks(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION v3.premerge_bookmarks(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION v3.bookmark_context_key(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION v3.bookmark_status_rank(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION v3.bookmark_context_key(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION v3.bookmark_status_rank(TEXT) TO authenticated, service_role;
