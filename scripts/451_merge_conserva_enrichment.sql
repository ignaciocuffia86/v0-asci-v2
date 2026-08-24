-- =============================================================================
-- 451 - merge_companies: el master hereda el registro de enrichment
-- =============================================================================
--
-- EL PROBLEMA
--
-- v3.linkedin_company_enrichment es hoy la unica tabla hija de companies SIN
-- columna `id` (su PK es company_id). Por eso merge_companies la trata aparte:
-- en vez de re-apuntar la fila al master, la BORRA con snapshot dentro de
-- `deleted`, para que revert_company_merge la pueda reinsertar.
--
-- El efecto colateral aparece del otro lado, en el cron de Apify. Su consulta
-- de candidatas (lib/v3/services/linkedin-company-enrichment.ts) es:
--
--     LEFT JOIN v3.linkedin_company_enrichment e ON e.company_id = c.id
--     WHERE c.linkedin_url ~ 'linkedin.com/company/'
--       AND (e.company_id IS NULL OR (e.status='error' AND ...))
--       AND (falta industry OR website OR country OR description OR logo)
--
-- O sea: toda empresa SIN registro de enrichment vuelve a la cola. Si la
-- duplicada estaba enriquecida y el master no, el merge borra el unico
-- registro que habia y el master queda como candidato virgen: se vuelve a
-- consultar y a pagar por una empresa que ya se habia enriquecido.
--
-- Medido: paso 141 veces (v3.company_merges donde `deleted` trae la clave
-- linkedin_company_enrichment). Hoy no hay re-gasto pendiente porque esas
-- empresas quedaron con sus columnas completas y no entran por la segunda
-- condicion, asi que esto es prevencion, no reparacion.
--
-- EL ARREGLO
--
-- Antes de borrar, el master HEREDA la fila si no tiene una propia.
--
-- Se COPIA y despues se borra, en lugar de re-apuntarla. La diferencia importa:
-- revert_company_merge recorre `moved` con
--
--     UPDATE <tabla> SET <fk> = duplicate_id WHERE id = ANY($2)
--
-- que sobre una tabla sin `id` falla. Copiando, `deleted` sigue guardando el
-- snapshot completo y el revert no se toca.
--
-- Efecto conocido y aceptado: despues de un revert las dos empresas quedan con
-- registro de enrichment (la duplicada reinsertada desde el snapshot y la copia
-- del master). No viola la PK porque son company_id distintos, y en esta tabla
-- es inocuo: el registro solo deja constancia de que esa URL ya se consulto.
--
-- Probado de punta a punta con dos empresas de descarte: el master hereda el
-- registro, el revert restaura la duplicada, y se limpio todo.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.merge_companies(p_master_company_id uuid, p_duplicate_company_id uuid, p_dry_run boolean DEFAULT false, p_method text DEFAULT 'manual'::text, p_confidence numeric DEFAULT NULL::numeric, p_reasoning text DEFAULT NULL::text, p_decided_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
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
  v_has_id     BOOLEAN;
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

      -- [FIX ago-2026] Tabla hija sin columna `id` (hoy solo
      -- v3.linkedin_company_enrichment, PK company_id): el camino general
      -- explota en el RETURNING id antes de tocar filas. Su fila es un
      -- checkpoint por empresa: se borra con snapshot (revert la reinserta).
      SELECT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = v_tbl::regclass AND attname = 'id'
          AND NOT attisdropped AND attnum > 0
      ) INTO v_has_id;

      IF NOT v_has_id THEN
        -- [450] Antes de borrar, el master HEREDA la fila si no tiene una propia.
        -- Importa para v3.linkedin_company_enrichment (hoy la unica tabla hija
        -- sin `id`): el cron de Apify re-consulta toda empresa sin registro, asi
        -- que perderlo en un merge significa volver a pagar por una empresa ya
        -- enriquecida. Paso 141 veces antes de este arreglo.
        --
        -- Se COPIA y despues se borra, en vez de re-apuntar la fila: asi
        -- `deleted` sigue guardando el snapshot completo y revert_company_merge
        -- no cambia (su loop sobre `moved` hace UPDATE ... WHERE id = ANY(...),
        -- que sobre una tabla sin `id` explotaria).
        EXECUTE format(
          'INSERT INTO %s
           SELECT (jsonb_populate_record(NULL::%s,
                     to_jsonb(d) || jsonb_build_object(%L, $1))).*
             FROM %s d
            WHERE d.%I = $2
              AND NOT EXISTS (SELECT 1 FROM %s m WHERE m.%I = $1)',
          v_tbl, v_tbl, v_col, v_tbl, v_col, v_tbl, v_col
        ) USING p_master_company_id, p_duplicate_company_id;

        EXECUTE format(
          'WITH del AS (DELETE FROM %s WHERE %I = $1 RETURNING *)
           SELECT coalesce(jsonb_agg(to_jsonb(del)), ''[]''::jsonb) FROM del',
          v_tbl, v_col
        ) INTO v_rows USING p_duplicate_company_id;
        IF jsonb_array_length(v_rows) > 0 THEN
          v_deleted := v_deleted || jsonb_build_object(v_tbl, v_rows);
        END IF;
        CONTINUE;
      END IF;

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
