-- ═══════════════════════════════════════════════════════════════════════════
-- 423 — El merge no puede tardar 23s por un fallback fila-por-fila
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SINTOMA: "canceling statement due to statement timeout" al aplicar un
-- candidato desde /admin/companies/duplicates. Medido: el grupo `falabella`
-- tarda 23.304ms contra un techo de 8s. Y `previewDupCandidate` (dry_run, o sea
-- que NO escribe) timeoutea igual, en los mismos 8.167ms.
--
-- CAUSA: `merge_companies` intenta un UPDATE masivo por tabla hija. Si UNA sola
-- fila choca contra un UNIQUE, cae a un fallback que recorre TODA la tabla fila
-- por fila, con un bloque EXCEPTION (= una subtransaccion) por fila. Medido en
-- falabella: el duplicado tiene 4.656 signals de las cuales 1.669 chocan (36%),
-- asi que esas 1.669 arrastran a las 4.656 al camino lento. Mas `contacts`, con
-- 2.080 filas y su propio UNIQUE.
--
-- No es el tamaño del grupo (son 3 empresas; grupos de 5 tardan 839ms), no es un
-- FK sin indice (las 25 hijas estan indexadas desde el 413) y no es la
-- escritura (el dry_run tambien timeoutea).
--
-- FIX: resolver los conflictos EN CONJUNTO. Una consulta identifica que filas
-- chocarian, se les hace snapshot y se borran en bloque, y despues el resto se
-- mueve con el UPDATE masivo. Pasa de ~4.656 subtransacciones a ~3 sentencias.
--
-- Se conserva el fallback fila-por-fila como ultima red: si la deteccion en
-- conjunto no cubre algun indice exotico (expresiones), el UPDATE vuelve a
-- fallar y ahi si se va fila por fila. Preferimos lento antes que incorrecto.
--
-- Idempotente: solo reemplaza funciones.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Deteccion de conflictos en conjunto ─────────────────────────────────
--
-- Devuelve los ids de las filas de `p_dup` que violarian algun UNIQUE si se
-- movieran a `p_master`.
--
-- Criterio (confirmado con el usuario): SOLO se miran los indices unicos que
-- CONTIENEN la columna FK. `signals` tiene otro unique sin company_id
-- (job_posting_id, signal_type, signal_id): mover company_id no puede violarlo,
-- asi que mirarlo haria borrar filas que no correspondia.
--
-- Sesgo deliberado: ante la duda, NO marcar. Un conflicto no detectado hace que
-- el UPDATE masivo falle y se caiga al fallback fila-por-fila (lento pero
-- correcto). Un falso positivo, en cambio, BORRARIA una fila que se podia
-- mover. Por eso se saltean los indices con expresiones en lugar de aproximar.

CREATE OR REPLACE FUNCTION v3.child_conflict_ids(
  p_tbl    TEXT,
  p_col    TEXT,
  p_master UUID,
  p_dup    UUID
)
RETURNS UUID[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $function$
DECLARE
  v_idx     RECORD;
  v_pred    TEXT;
  v_cmp     TEXT;
  v_sql     TEXT;
  v_found   UUID[];
  v_all     UUID[] := ARRAY[]::UUID[];
  v_fk_attnum SMALLINT;
BEGIN
  SELECT a.attnum INTO v_fk_attnum
  FROM pg_attribute a
  WHERE a.attrelid = p_tbl::regclass AND a.attname = p_col AND NOT a.attisdropped;

  IF v_fk_attnum IS NULL THEN
    RETURN v_all;
  END IF;

  FOR v_idx IN
    SELECT i.indexrelid,
           i.indnullsnotdistinct AS nulls_no_distintos,
           pg_get_expr(i.indpred, i.indrelid) AS predicado,
           -- Solo las columnas CLAVE del indice: las de INCLUDE no participan
           -- de la restriccion de unicidad.
           (SELECT array_agg(k.attnum ORDER BY k.ord)
              FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
             WHERE k.ord <= i.indnkeyatts) AS key_attnums
    FROM pg_index i
    WHERE i.indrelid = p_tbl::regclass
      AND i.indisunique
      AND i.indisvalid
      -- Un indice con expresiones (indkey trae 0) no se puede comparar columna a
      -- columna. Se saltea a proposito: lo resuelve el fallback fila-por-fila.
      -- Es el caso de `bookmarks_user_company_context_uniq`, que ademas ya viene
      -- consolidado antes por v3.premerge_bookmarks.
      AND NOT (0 = ANY(i.indkey::int2[]))
  LOOP
    -- El indice tiene que incluir la columna FK entre sus columnas clave.
    CONTINUE WHEN NOT (v_fk_attnum = ANY(v_idx.key_attnums));

    -- Comparacion de las demas columnas clave. La FK se excluye porque despues
    -- del UPDATE la fila de la duplicada va a tener justamente el valor del
    -- master, o sea que ahi siempre coincide.
    --
    -- `=` implementa la semantica NULLS DISTINCT del UNIQUE por default: si un
    -- valor es NULL la comparacion da NULL, el EXISTS es falso y la fila no se
    -- marca. Que es lo correcto: con NULLS DISTINCT una fila con NULL nunca
    -- choca. Con NULLS NOT DISTINCT (PG15+) si choca, y ahi hace falta
    -- IS NOT DISTINCT FROM.
    SELECT string_agg(
             format('m.%1$I %2$s d.%1$I', a.attname,
                    CASE WHEN v_idx.nulls_no_distintos THEN 'IS NOT DISTINCT FROM' ELSE '=' END),
             ' AND ')
      INTO v_cmp
    FROM unnest(v_idx.key_attnums) AS k(attnum)
    JOIN pg_attribute a ON a.attrelid = p_tbl::regclass AND a.attnum = k.attnum
    WHERE k.attnum <> v_fk_attnum;

    -- Un unique que es solo (company_id) haria que toda fila del duplicado
    -- choque. No existe hoy, pero si existiera hay que dejarlo al fallback en
    -- vez de borrar todo.
    CONTINUE WHEN v_cmp IS NULL;

    -- Indice parcial: el UNIQUE solo aplica a las filas que cumplen el
    -- predicado, asi que se aplica a AMBOS lados. Se envuelve cada lado en una
    -- subconsulta de una sola tabla para que las referencias sin calificar del
    -- predicado (`contact_id IS NOT NULL`) resuelvan solas.
    --
    -- Verificado que los predicados de este esquema son estables al mover la FK
    -- (`source_url IS NOT NULL`, `contact_id IS NOT NULL`, y el de
    -- research_jobs pide `company_id IS NOT NULL`, que sigue valiendo porque
    -- master y duplicada son ambas no nulas). Si mañana apareciera un predicado
    -- que dependa del VALOR de company_id, esto habria que revisarlo.
    v_pred := CASE WHEN v_idx.predicado IS NULL THEN '' ELSE ' AND (' || v_idx.predicado || ')' END;

    v_sql := format(
      'SELECT coalesce(array_agg(DISTINCT d.id), ARRAY[]::uuid[])
         FROM (SELECT * FROM %1$s WHERE %2$I = $1%3$s) d
        WHERE EXISTS (
                SELECT 1 FROM (SELECT * FROM %1$s WHERE %2$I = $2%3$s) m
                 WHERE %4$s
              )',
      p_tbl, p_col, v_pred, v_cmp
    );

    EXECUTE v_sql INTO v_found USING p_dup, p_master;

    IF v_found IS NOT NULL AND array_length(v_found, 1) > 0 THEN
      SELECT array_agg(DISTINCT x) INTO v_all
      FROM unnest(v_all || v_found) AS t(x);
    END IF;
  END LOOP;

  RETURN coalesce(v_all, ARRAY[]::UUID[]);
END;
$function$;

REVOKE ALL ON FUNCTION v3.child_conflict_ids(TEXT, TEXT, UUID, UUID) FROM PUBLIC;

COMMENT ON FUNCTION v3.child_conflict_ids(TEXT, TEXT, UUID, UUID) IS
  'Ids de las filas de la empresa duplicada que violarian un UNIQUE al moverse al master. Solo mira los unique que contienen la columna FK; saltea los que tienen expresiones.';

-- ── 2. merge_companies con resolucion en conjunto ───────────────────────────

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
  v_cascade    JSONB := '[]'::jsonb;
  v_follow     JSONB := '[]'::jsonb;
  v_bookmarks  JSONB := '[]'::jsonb;
  v_tiene_cascada BOOLEAN;
  v_ids        JSONB;
  v_rows       JSONB;
  v_row        JSONB;
  v_row_id     UUID;
  v_merge_id   UUID;
  v_result     JSONB;
  v_conflicts  UUID[];   -- [423]
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
    v_follow := v3.premerge_followed_accounts(p_master_company_id, p_duplicate_company_id);
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
        -- [423] Antes esto se iba fila por fila sobre TODA la tabla, con una
        -- subtransaccion por fila. Ahora se resuelven los conflictos en bloque
        -- y se reintenta el UPDATE masivo.
        v_ids  := '[]'::jsonb;
        v_rows := '[]'::jsonb;

        -- snapshot_cascade cuesta ~9ms por llamada (consulta pg_constraint y
        -- recursa), asi que se resuelve UNA VEZ por tabla. Solo 5 tablas tienen
        -- hijos en cascada; el resto no paga nada.
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE contype = 'f'
             AND confrelid = v_tbl::regclass
             AND confdeltype = 'c'
             AND conrelid <> v_tbl::regclass
        ) INTO v_tiene_cascada;

        v_conflicts := v3.child_conflict_ids(
          v_tbl, v_col, p_master_company_id, p_duplicate_company_id
        );

        IF array_length(v_conflicts, 1) > 0 THEN
          -- Guardar lo que se va a ir en cascada ANTES de borrar. Un solo
          -- llamado para todas las filas en conflicto.
          IF v_tiene_cascada THEN
            v_cascade := v_cascade || v3.snapshot_cascade(v_tbl, v_conflicts);
          END IF;

          EXECUTE format(
            'WITH del AS (DELETE FROM %s WHERE id = ANY($1) RETURNING *)
             SELECT coalesce(jsonb_agg(to_jsonb(del)), ''[]''::jsonb) FROM del',
            v_tbl
          ) INTO v_rows USING v_conflicts;
        END IF;

        BEGIN
          EXECUTE format(
            'WITH upd AS (UPDATE %s SET %I = $1 WHERE %I = $2 RETURNING id)
             SELECT coalesce(jsonb_agg(id), ''[]''::jsonb) FROM upd',
            v_tbl, v_col, v_col
          ) INTO v_ids USING p_master_company_id, p_duplicate_company_id;

        EXCEPTION WHEN unique_violation THEN
          -- Ultima red: la deteccion en conjunto no cubrio algun indice (por
          -- ejemplo uno con expresiones). Se vuelve al camino lento, que es
          -- correcto aunque cueste. Preferimos lento antes que incorrecto.
          v_ids := '[]'::jsonb;

          FOR v_row_id IN
            EXECUTE format('SELECT id FROM %s WHERE %I = $1', v_tbl, v_col)
            USING p_duplicate_company_id
          LOOP
            BEGIN
              EXECUTE format('UPDATE %s SET %I = $1 WHERE id = $2', v_tbl, v_col)
                USING p_master_company_id, v_row_id;
              v_ids := v_ids || to_jsonb(v_row_id);
            EXCEPTION WHEN unique_violation THEN
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
        END;

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

-- Postgres da EXECUTE a PUBLIC por default en funciones nuevas. Esta es
-- SECURITY DEFINER y mueve/borra datos, asi que hay que revocar explicitamente.
REVOKE ALL ON FUNCTION public.merge_companies(UUID, UUID, BOOLEAN, TEXT, NUMERIC, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_companies(UUID, UUID, BOOLEAN, TEXT, NUMERIC, TEXT, UUID) FROM anon;
