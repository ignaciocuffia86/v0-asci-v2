-- ============================================================================
-- Fase 0 — Merge de empresas seguro y reversible
-- ============================================================================
--
-- PROBLEMA QUE RESUELVE
--
-- `merge_companies` movia 3 tablas (contacts, signals, bookmarks) y despues
-- hacia DELETE de la empresa duplicada. Pero hay 25 FKs apuntando a
-- public.companies:
--
--   * 14 son NO ACTION  -> el DELETE FALLA y aborta el merge.
--     Verificado sobre las dos filas reales de Arcor:
--       violates foreign key constraint "followed_accounts_company_id_fkey"
--   * 10 son CASCADE    -> cuando el merge SI pasa, BORRA EN SILENCIO
--     company_news, company_public_docs, company_implementations y las
--     interacciones de usuario de v2.
--   *  1 es SET NULL    -> v3.ai_usage_log.
--
-- O sea: hoy el merge o falla, o pierde datos. Y no deja rastro para deshacer.
--
-- COMO LO RESUELVE
--
-- 1. La lista de tablas hijas se DERIVA de pg_constraint en tiempo de
--    ejecucion. No esta hardcodeada. Si manana alguien agrega una tabla con
--    FK a companies, el merge la mueve sola. Esto es lo que evita que el bug
--    vuelva a aparecer.
-- 2. Se mueve TODO (incluidas las CASCADE) ANTES del DELETE, para que la
--    cascada nunca se dispare.
-- 3. Los conflictos de unicidad NO se resuelven replicando la logica de los
--    indices: se intenta el UPDATE masivo y, si Postgres se queja, se cae a
--    fila por fila. Ver la nota sobre esto mas abajo.
-- 4. Todo queda registrado en v3.company_merges para poder revertir.
--
-- Numeracion 4xx = scripts de v3 (aunque la funcion viva en public, porque es
-- de v2 y la sigue llamando la UI de admin existente).
-- ============================================================================

-- ── Log de merges ───────────────────────────────────────────────────────────
-- Vive en el schema v3 a proposito: no se toca ninguna tabla de v2.

CREATE TABLE IF NOT EXISTS v3.company_merges (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id          UUID NOT NULL,
  duplicate_id       UUID NOT NULL,
  -- Fila completa de la empresa absorbida. Es lo que permite reconstruirla.
  duplicate_snapshot JSONB NOT NULL,
  -- { "public.job_postings": ["<id>", ...] } -> que filas se reasignaron.
  -- Se guardan los ids y no solo el conteo porque sin ellos no se puede saber
  -- cuales filas eran de la duplicada y cuales ya eran del master.
  moved              JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { "v3.followed_accounts": [ {fila completa}, ... ] } -> filas eliminadas
  -- por conflicto de unicidad. Se guarda la fila entera, no el id, porque el
  -- id ya no existe y sin el contenido no habria forma de restaurarla.
  deleted            JSONB NOT NULL DEFAULT '{}'::jsonb,
  method             TEXT NOT NULL DEFAULT 'manual'
                     CHECK (method IN ('exact','core','trgm','ai','manual')),
  confidence         NUMERIC,
  reasoning          TEXT,
  decided_by         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverted_at        TIMESTAMPTZ
);

-- Sin FK a companies a proposito: la duplicada se borra, y el master podria
-- borrarse mas adelante. El log tiene que sobrevivir a ambos.
CREATE INDEX IF NOT EXISTS idx_company_merges_master
  ON v3.company_merges (master_id);
CREATE INDEX IF NOT EXISTS idx_company_merges_pending
  ON v3.company_merges (created_at DESC) WHERE reverted_at IS NULL;

ALTER TABLE v3.company_merges ENABLE ROW LEVEL SECURITY;

-- ── Eleccion del master por calidad de datos ────────────────────────────────
--
-- El auto-merge viejo ordenaba por "tiene linkedin_url, despues mas antigua".
-- Con ese criterio el par Arcor se mergea AL REVES: gana ARCOR (que tiene
-- linkedin_url pero 0 vacantes) y se absorbe Grupo Arcor (117 vacantes y 7
-- noticias). Se pierde la fila que tiene el valor.
--
-- Ahora pesa primero el volumen de datos asociados. La linkedin_url no se
-- pierde igual: el merge la copia al master si al master le falta.

CREATE OR REPLACE FUNCTION public.pick_merge_master(p_ids UUID[])
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT c.id
  FROM public.companies c
  LEFT JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM public.job_postings jp WHERE jp.company_id = c.id)
      + (SELECT count(*) FROM public.contacts ct WHERE ct.current_company_id = c.id)
      + (SELECT count(*) FROM public.company_news cn WHERE cn.company_id = c.id)
      AS total
  ) d ON true
  WHERE c.id = ANY(p_ids)
  ORDER BY
    d.total DESC NULLS LAST,
    (c.linkedin_url IS NOT NULL) DESC,
    (c.website IS NOT NULL) DESC,
    c.created_at ASC
  LIMIT 1;
$$;

-- ── El merge ────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.merge_companies(UUID, UUID);
DROP FUNCTION IF EXISTS public.merge_companies(UUID, UUID, BOOLEAN);

-- Los nombres de los parametros se mantienen EXACTOS (p_master_company_id /
-- p_duplicate_company_id) porque la server action los pasa por nombre via
-- supabase.rpc(). Cambiarlos rompe /admin/companies/duplicates en silencio.
-- El tercer parametro tiene default, asi que las llamadas de 2 argumentos que
-- ya existen siguen resolviendo a esta funcion.
CREATE FUNCTION public.merge_companies(
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
AS $$
DECLARE
  v_snapshot   JSONB;
  v_child      RECORD;
  v_tbl        TEXT;
  v_col        TEXT;
  v_moved      JSONB := '{}'::jsonb;
  v_deleted    JSONB := '{}'::jsonb;
  v_ids        JSONB;
  v_rows       JSONB;
  v_row        JSONB;
  v_row_id     UUID;
  v_merge_id   UUID;
  v_result     JSONB;
BEGIN
  -- Un merge toca ~25 tablas; el default de la sesion puede ser corto.
  SET LOCAL statement_timeout = '180s';

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

  -- El bloque interno permite implementar dry_run de verdad: se ejecuta el
  -- merge completo (con deteccion REAL de conflictos, no estimada) y al final
  -- se aborta con un SQLSTATE propio para que la subtransaccion se revierta.
  -- Las variables de PL/pgSQL NO se revierten, asi que el reporte sobrevive.
  BEGIN
    -- Recorrido dinamico de las hijas. Se ordena para que el resultado sea
    -- estable y legible en el reporte.
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

      -- Camino rapido: un solo UPDATE para toda la tabla.
      --
      -- Los conflictos de unicidad NO se detectan replicando la logica de los
      -- indices. Se probo y es una trampa: sobre estas tablas hay indices
      -- unicos PARCIALES (company_news y company_implementations sobre
      -- (company_id, source_url) WHERE source_url IS NOT NULL, signals sobre
      -- (signal_id, contact_id, company_id) WHERE contact_id IS NOT NULL,
      -- v3.research_jobs con un WHERE sobre status). Reproducir a mano esos
      -- predicados, mas la semantica de NULL distinct, es fragil y silencioso
      -- cuando se equivoca.
      --
      -- En cambio se deja que Postgres decida: si el UPDATE masivo viola un
      -- unico, se cae a fila por fila y se descarta solo la fila que colisiona.
      BEGIN
        EXECUTE format(
          'WITH upd AS (UPDATE %s SET %I = $1 WHERE %I = $2 RETURNING id)
           SELECT coalesce(jsonb_agg(id), ''[]''::jsonb) FROM upd',
          v_tbl, v_col, v_col
        ) INTO v_ids USING p_master_company_id, p_duplicate_company_id;

      EXCEPTION WHEN unique_violation THEN
        v_ids  := '[]'::jsonb;
        v_rows := '[]'::jsonb;

        -- Se materializan los ids primero: iterar un cursor mientras se
        -- modifica la misma tabla es pedir problemas.
        FOR v_row_id IN
          EXECUTE format('SELECT id FROM %s WHERE %I = $1', v_tbl, v_col)
          USING p_duplicate_company_id
        LOOP
          BEGIN
            EXECUTE format('UPDATE %s SET %I = $1 WHERE id = $2', v_tbl, v_col)
              USING p_master_company_id, v_row_id;
            v_ids := v_ids || to_jsonb(v_row_id);
          EXCEPTION WHEN unique_violation THEN
            -- La fila equivalente ya existe bajo el master. Se guarda entera
            -- antes de borrarla para que el revert pueda restaurarla.
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

    -- Ahora si: ninguna hija apunta a la duplicada, asi que el DELETE no
    -- puede fallar por FK ni disparar cascadas.
    DELETE FROM public.companies WHERE id = p_duplicate_company_id;

    -- Enriquecer el master DESPUES del delete. El orden importa:
    -- companies.linkedin_url es unica, asi que copiarla mientras la duplicada
    -- todavia existe violaria el indice.
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
      method, confidence, reasoning, decided_by
    ) VALUES (
      p_master_company_id, p_duplicate_company_id, v_snapshot, v_moved, v_deleted,
      p_method, p_confidence, p_reasoning, p_decided_by
    )
    RETURNING id INTO v_merge_id;

    v_result := jsonb_build_object(
      'dry_run',       p_dry_run,
      'merge_id',      v_merge_id,
      'master_id',     p_master_company_id,
      'duplicate_id',  p_duplicate_company_id,
      'duplicate_name', v_snapshot->>'name',
      'moved',         v_moved,
      'deleted',       v_deleted,
      'moved_total',   (SELECT coalesce(sum(jsonb_array_length(value)), 0)
                        FROM jsonb_each(v_moved)),
      'deleted_total', (SELECT coalesce(sum(jsonb_array_length(value)), 0)
                        FROM jsonb_each(v_deleted))
    );

    IF p_dry_run THEN
      -- Revierte todo lo de arriba. v_result ya quedo armado en memoria.
      RAISE EXCEPTION 'dry run' USING ERRCODE = 'YY001';
    END IF;

  EXCEPTION WHEN SQLSTATE 'YY001' THEN
    -- Unico caso que se traga: el marcador propio del dry run. Cualquier otro
    -- error se propaga y aborta la transaccion entera, como debe ser.
    v_result := v_result || jsonb_build_object('merge_id', NULL, 'applied', false);
  END;

  RETURN coalesce(v_result, '{}'::jsonb) ||
         jsonb_build_object('applied', NOT p_dry_run);
END;
$$;

-- ── Revertir un merge ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.revert_company_merge(p_merge_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_log      v3.company_merges;
  v_tbl      TEXT;
  v_ids      JSONB;
  v_restored INT := 0;
  v_cols     TEXT;
  v_cand     INT := 0;
BEGIN
  SET LOCAL statement_timeout = '180s';

  SELECT * INTO v_log FROM v3.company_merges WHERE id = p_merge_id;
  IF v_log.id IS NULL THEN
    RAISE EXCEPTION 'revert_company_merge: no existe el merge %', p_merge_id;
  END IF;
  IF v_log.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'revert_company_merge: el merge % ya fue revertido', p_merge_id;
  END IF;

  -- 1. Reconstruir la empresa absorbida desde el snapshot, con su id original,
  --    para que las filas puedan volver a apuntarle.
  SELECT string_agg(quote_ident(key), ', ') INTO v_cols
  FROM jsonb_each_text(v_log.duplicate_snapshot);

  EXECUTE format(
    'INSERT INTO public.companies (%s) SELECT %s FROM jsonb_populate_record(NULL::public.companies, $1)',
    v_cols, v_cols
  ) USING v_log.duplicate_snapshot;

  -- 2. Devolver las filas movidas a su dueno original.
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

  -- 3. Restaurar las filas que se habian borrado por conflicto de unicidad.
  --    Ahora que la duplicada volvio a existir, ya no colisionan.
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

  UPDATE v3.company_merges SET reverted_at = now() WHERE id = p_merge_id;

  -- 4. Devolver el candidato a la cola de pendientes.
  --    Sin esto (bug encontrado al probar la reversion sobre datos reales) el
  --    grupo quedaba en 'merged' despues de revertirse: no volvia a aparecer
  --    nunca mas y era imposible re-decidirlo.
  --    Solo se reabre cuando ya no queda ningun merge vivo del grupo, porque un
  --    grupo de 3+ empresas genera varios merges y revertir uno solo no deshace
  --    el resto.
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
$$;

-- ── Permisos ────────────────────────────────────────────────────────────────
--
-- Postgres da EXECUTE a PUBLIC por defecto. Con SECURITY DEFINER (que saltea
-- RLS) y la API REST de Supabase, eso dejaria a `anon` capaz de mergear y
-- borrar empresas sin autenticarse. Un GRANT a authenticated NO alcanza:
-- hay que revocar explicitamente.

REVOKE ALL ON FUNCTION public.merge_companies(UUID, UUID, BOOLEAN, TEXT, NUMERIC, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revert_company_merge(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pick_merge_master(UUID[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.merge_companies(UUID, UUID, BOOLEAN, TEXT, NUMERIC, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revert_company_merge(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pick_merge_master(UUID[]) TO authenticated, service_role;
