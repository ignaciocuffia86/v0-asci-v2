-- ============================================================================
-- Fase 0.1 — merge_companies deja de perder la identidad del duplicado
--
-- Problema (docs/analisis-inputs-companias-contactos-senales.md §4.1): la
-- lista de coalesce del merge no incluía linkedin_company_id, hq_country_iso,
-- is_public/public_status_checked_at ni los campos de Apollo que acompañan a
-- apollo_organization_id. Si el duplicado los tenía y el master no, se
-- borraban junto con la fila (recuperables solo desde duplicate_snapshot).
-- linkedin_company_id es además el decisor de máxima prioridad de
-- belongsToCompany (lib/v3/services/apify-job-ingest.ts): cada merge que lo
-- perdía degradaba la atribución de vacantes a matching por nombre.
--
-- Por qué es seguro heredar linkedin_company_id pese al UNIQUE parcial
-- (20260819100000): el DELETE de la fila duplicada ocurre ANTES del UPDATE
-- del master, y el índice garantiza que ninguna otra fila tiene ese id.
--
-- apollo_employees_count / apollo_org_status / apollo_org_synced_at viajan
-- CON apollo_organization_id: solo se heredan si el master no tenía org id
-- propio, para no mezclar el estado de sync de una organización con los
-- datos de otra. (apollo_industry conserva su coalesce incondicional
-- preexistente.)
--
-- El resto de la función es copia literal de producción (2026-08-25), que
-- vivía solo en scripts/451 — esto también la consolida en migraciones.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.merge_companies(p_master_company_id uuid, p_duplicate_company_id uuid, p_dry_run boolean DEFAULT false, p_method text DEFAULT 'manual'::text, p_confidence numeric DEFAULT NULL::numeric, p_reasoning text DEFAULT NULL::text, p_decided_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'v3', 'pg_catalog'
AS $function$
DECLARE
  v_snapshot JSONB; v_child RECORD; v_tbl TEXT; v_col TEXT;
  v_moved JSONB := '{}'::jsonb; v_deleted JSONB := '{}'::jsonb;
  v_cascade JSONB := '[]'::jsonb; v_follow JSONB := '[]'::jsonb; v_bookmarks JSONB := '[]'::jsonb;
  v_tiene_cascada BOOLEAN; v_has_id BOOLEAN; v_ids JSONB; v_rows JSONB; v_row JSONB;
  v_row_id UUID; v_merge_id UUID; v_result JSONB; v_conflicts UUID[];
BEGIN
  IF p_master_company_id IS NULL OR p_duplicate_company_id IS NULL THEN
    RAISE EXCEPTION 'merge_companies: los ids no pueden ser NULL'; END IF;
  IF p_master_company_id = p_duplicate_company_id THEN
    RAISE EXCEPTION 'merge_companies: master y duplicada son la misma fila (%)', p_master_company_id; END IF;

  SELECT to_jsonb(c) INTO v_snapshot FROM public.companies c WHERE c.id = p_duplicate_company_id;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'merge_companies: no existe la empresa duplicada %', p_duplicate_company_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_master_company_id) THEN
    RAISE EXCEPTION 'merge_companies: no existe la empresa master %', p_master_company_id; END IF;

  BEGIN
    v_follow := v3.premerge_followed_accounts(p_master_company_id, p_duplicate_company_id);
    v_bookmarks := v3.premerge_bookmarks(p_master_company_id, p_duplicate_company_id);

    FOR v_child IN
      SELECT (con.conrelid::regclass)::text AS tbl, a.attname AS col
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
      WHERE con.contype = 'f' AND con.confrelid = 'public.companies'::regclass
        AND array_length(con.conkey, 1) = 1
      ORDER BY 1
    LOOP
      v_tbl := v_child.tbl; v_col := v_child.col;

      SELECT EXISTS (SELECT 1 FROM pg_attribute
        WHERE attrelid = v_tbl::regclass AND attname = 'id'
          AND NOT attisdropped AND attnum > 0) INTO v_has_id;

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
             FROM %s d WHERE d.%I = $2
              AND NOT EXISTS (SELECT 1 FROM %s m WHERE m.%I = $1)',
          v_tbl, v_tbl, v_col, v_tbl, v_col, v_tbl, v_col
        ) USING p_master_company_id, p_duplicate_company_id;

        EXECUTE format(
          'WITH del AS (DELETE FROM %s WHERE %I = $1 RETURNING *)
           SELECT coalesce(jsonb_agg(to_jsonb(del)), ''[]''::jsonb) FROM del',
          v_tbl, v_col) INTO v_rows USING p_duplicate_company_id;
        IF jsonb_array_length(v_rows) > 0 THEN
          v_deleted := v_deleted || jsonb_build_object(v_tbl, v_rows); END IF;
        CONTINUE;
      END IF;

      BEGIN
        EXECUTE format('WITH upd AS (UPDATE %s SET %I = $1 WHERE %I = $2 RETURNING id)
           SELECT coalesce(jsonb_agg(id), ''[]''::jsonb) FROM upd', v_tbl, v_col, v_col)
        INTO v_ids USING p_master_company_id, p_duplicate_company_id;
      EXCEPTION WHEN unique_violation THEN
        v_ids := '[]'::jsonb; v_rows := '[]'::jsonb;
        SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE contype='f'
           AND confrelid = v_tbl::regclass AND confdeltype='c'
           AND conrelid <> v_tbl::regclass) INTO v_tiene_cascada;
        v_conflicts := v3.child_conflict_ids(v_tbl, v_col, p_master_company_id, p_duplicate_company_id);
        IF array_length(v_conflicts, 1) > 0 THEN
          IF v_tiene_cascada THEN v_cascade := v_cascade || v3.snapshot_cascade(v_tbl, v_conflicts); END IF;
          EXECUTE format('WITH del AS (DELETE FROM %s WHERE id = ANY($1) RETURNING *)
             SELECT coalesce(jsonb_agg(to_jsonb(del)), ''[]''::jsonb) FROM del', v_tbl)
          INTO v_rows USING v_conflicts;
        END IF;
        BEGIN
          EXECUTE format('WITH upd AS (UPDATE %s SET %I = $1 WHERE %I = $2 RETURNING id)
             SELECT coalesce(jsonb_agg(id), ''[]''::jsonb) FROM upd', v_tbl, v_col, v_col)
          INTO v_ids USING p_master_company_id, p_duplicate_company_id;
        EXCEPTION WHEN unique_violation THEN
          v_ids := '[]'::jsonb;
          FOR v_row_id IN EXECUTE format('SELECT id FROM %s WHERE %I = $1', v_tbl, v_col)
            USING p_duplicate_company_id LOOP
            BEGIN
              EXECUTE format('UPDATE %s SET %I = $1 WHERE id = $2', v_tbl, v_col)
                USING p_master_company_id, v_row_id;
              v_ids := v_ids || to_jsonb(v_row_id);
            EXCEPTION WHEN unique_violation THEN
              IF v_tiene_cascada THEN v_cascade := v_cascade || v3.snapshot_cascade(v_tbl, ARRAY[v_row_id]); END IF;
              EXECUTE format('WITH del AS (DELETE FROM %s WHERE id = $1 RETURNING *)
                 SELECT coalesce(jsonb_agg(to_jsonb(del)), ''[]''::jsonb) FROM del', v_tbl)
              INTO v_row USING v_row_id;
              v_rows := v_rows || v_row;
            END;
          END LOOP;
        END;
        IF jsonb_array_length(v_rows) > 0 THEN v_deleted := v_deleted || jsonb_build_object(v_tbl, v_rows); END IF;
      END;
      IF jsonb_array_length(v_ids) > 0 THEN v_moved := v_moved || jsonb_build_object(v_tbl, v_ids); END IF;
    END LOOP;

    DELETE FROM public.companies WHERE id = p_duplicate_company_id;

    UPDATE public.companies m SET
      linkedin_url = coalesce(m.linkedin_url, v_snapshot->>'linkedin_url'),
      linkedin_slug = coalesce(m.linkedin_slug, v_snapshot->>'linkedin_slug'),
      -- [Fase 0] El duplicado ya fue borrado, asi que el UNIQUE parcial sobre
      -- linkedin_company_id no puede chocar: la unica fila que lo tenia era el.
      linkedin_company_id = coalesce(m.linkedin_company_id, (v_snapshot->>'linkedin_company_id')::bigint),
      website = coalesce(m.website, v_snapshot->>'website'),
      industry = coalesce(m.industry, v_snapshot->>'industry'),
      country = coalesce(nullif(m.country,''), nullif(v_snapshot->>'country','')),
      country_normalized = coalesce(m.country_normalized, v_snapshot->>'country_normalized'),
      hq_country_iso = coalesce(m.hq_country_iso, v_snapshot->>'hq_country_iso'),
      logo_url = coalesce(m.logo_url, v_snapshot->>'logo_url'),
      description = coalesce(m.description, v_snapshot->>'description'),
      is_public = coalesce(m.is_public, (v_snapshot->>'is_public')::boolean),
      public_status_checked_at = coalesce(m.public_status_checked_at, (v_snapshot->>'public_status_checked_at')::timestamptz),
      ticker = coalesce(m.ticker, v_snapshot->>'ticker'),
      cik = coalesce(m.cik, v_snapshot->>'cik'),
      stock_exchange = coalesce(m.stock_exchange, v_snapshot->>'stock_exchange'),
      apollo_organization_id = coalesce(m.apollo_organization_id, v_snapshot->>'apollo_organization_id'),
      -- [Fase 0] Los acompañantes del org id viajan con el: solo se heredan si
      -- el master no tenia organizacion propia (los SET leen el valor viejo de
      -- m.apollo_organization_id, no el recien coalesceado).
      apollo_employees_count = CASE WHEN m.apollo_organization_id IS NULL
        THEN coalesce(m.apollo_employees_count, (v_snapshot->>'apollo_employees_count')::integer)
        ELSE m.apollo_employees_count END,
      -- apollo_org_status tiene DEFAULT 'unknown': ese valor es "no sincronizado
      -- todavia", no un estado real, asi que cuenta como ausencia.
      apollo_org_status = CASE WHEN m.apollo_organization_id IS NULL
        THEN coalesce(nullif(m.apollo_org_status, 'unknown'), v_snapshot->>'apollo_org_status')
        ELSE m.apollo_org_status END,
      apollo_org_synced_at = CASE WHEN m.apollo_organization_id IS NULL
        THEN coalesce(m.apollo_org_synced_at, (v_snapshot->>'apollo_org_synced_at')::timestamptz)
        ELSE m.apollo_org_synced_at END,
      apollo_industry = coalesce(m.apollo_industry, v_snapshot->>'apollo_industry'),
      updated_at = now()
    WHERE m.id = p_master_company_id;

    INSERT INTO v3.company_merges (master_id, duplicate_id, duplicate_snapshot, moved, deleted,
      cascade_deleted, follow_merge, bookmark_merge, method, confidence, reasoning, decided_by)
    VALUES (p_master_company_id, p_duplicate_company_id, v_snapshot, v_moved, v_deleted,
      v_cascade, v_follow, v_bookmarks, p_method, p_confidence, p_reasoning, p_decided_by)
    RETURNING id INTO v_merge_id;

    v_result := jsonb_build_object('dry_run', p_dry_run, 'merge_id', v_merge_id,
      'master_id', p_master_company_id, 'duplicate_id', p_duplicate_company_id,
      'duplicate_name', v_snapshot->>'name', 'moved', v_moved, 'deleted', v_deleted,
      'cascade_deleted', v_cascade, 'follow_merge', v_follow, 'bookmark_merge', v_bookmarks,
      'bookmarks_consolidados', jsonb_array_length(v_bookmarks),
      'moved_total', (SELECT coalesce(sum(jsonb_array_length(value)),0) FROM jsonb_each(v_moved)),
      'deleted_total', (SELECT coalesce(sum(jsonb_array_length(value)),0) FROM jsonb_each(v_deleted)),
      'cascade_total', (SELECT coalesce(sum(jsonb_array_length(e->'rows')),0) FROM jsonb_array_elements(v_cascade) e));

    IF p_dry_run THEN RAISE EXCEPTION 'dry run' USING ERRCODE = 'YY001'; END IF;
  EXCEPTION WHEN SQLSTATE 'YY001' THEN
    v_result := v_result || jsonb_build_object('merge_id', NULL, 'applied', false);
  END;

  RETURN coalesce(v_result, '{}'::jsonb) || jsonb_build_object('applied', NOT p_dry_run);
END;
$function$;
