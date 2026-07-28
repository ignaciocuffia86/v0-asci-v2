-- ============================================================================
-- Fase 3 (backend) — Aplicar candidatos de la cache
-- ============================================================================
--
-- Estas funciones son el UNICO camino por el que se ejecuta un merge desde la
-- gestion de duplicados. Siempre delegan en public.merge_companies, que mueve
-- las 25 tablas hijas y deja el registro reversible en v3.company_merges.
--
-- Tambien se reemplaza auto_merge_safe_duplicates. La version vieja elegia el
-- master por "tiene linkedin_url y el nombre mas largo", que en el caso Arcor
-- habria elegido "ARCOR" (0 vacantes) y absorbido "Grupo Arcor" (117 vacantes,
-- 443 contactos). Ahora el master lo decide pick_merge_master por volumen de
-- datos, y solo se auto-mergean los candidatos clasificados como 'seguro'.
-- ============================================================================

-- ── Aplicar un candidato ────────────────────────────────────────────────────
--
-- Mergea todos los ids del grupo dentro del master. Si p_dry_run es true no
-- escribe nada y devuelve el detalle de lo que haria: es lo que alimenta el
-- aviso previo en la UI.

CREATE OR REPLACE FUNCTION v3.apply_dup_candidate(
  p_candidate_id UUID,
  p_dry_run      BOOLEAN DEFAULT false,
  p_decided_by   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_cand     v3.company_dup_candidates;
  v_dup      UUID;
  v_res      JSONB;
  v_merges   UUID[] := '{}';
  v_detalle  JSONB := '[]'::jsonb;
  v_movidas  INT := 0;
  v_borradas INT := 0;
BEGIN
  SELECT * INTO v_cand FROM v3.company_dup_candidates WHERE id = p_candidate_id;

  IF v_cand.id IS NULL THEN
    RAISE EXCEPTION 'apply_dup_candidate: no existe el candidato %', p_candidate_id;
  END IF;

  IF v_cand.status = 'merged' THEN
    RAISE EXCEPTION 'apply_dup_candidate: el candidato % ya fue mergeado', p_candidate_id;
  END IF;

  -- Cada duplicada se mergea contra el master de forma independiente, asi cada
  -- una deja su propia fila en v3.company_merges y se puede revertir sola.
  FOREACH v_dup IN ARRAY v_cand.company_ids LOOP
    CONTINUE WHEN v_dup = v_cand.master_id;
    -- Puede haber desaparecido por un merge anterior.
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_dup);

    v_res := public.merge_companies(
      v_cand.master_id,
      v_dup,
      p_dry_run,
      CASE WHEN v_cand.status IN ('ai_same','ai_unsure') THEN 'ai' ELSE v_cand.method END,
      v_cand.ai_confidence,
      v_cand.ai_reasoning,
      p_decided_by
    );

    v_detalle  := v_detalle || v_res;
    v_movidas  := v_movidas + coalesce((v_res->>'moved_total')::int, 0);
    v_borradas := v_borradas + coalesce((v_res->>'deleted_total')::int, 0);

    IF NOT p_dry_run AND v_res->>'merge_id' IS NOT NULL THEN
      v_merges := v_merges || (v_res->>'merge_id')::uuid;
    END IF;
  END LOOP;

  IF NOT p_dry_run THEN
    UPDATE v3.company_dup_candidates
    SET status = 'merged', merge_ids = v_merges, resolved_at = now()
    WHERE id = p_candidate_id;
  END IF;

  RETURN jsonb_build_object(
    'candidate_id',  p_candidate_id,
    'dry_run',       p_dry_run,
    'master_id',     v_cand.master_id,
    'merges',        v_merges,
    'rows_moved',    v_movidas,
    'rows_deleted',  v_borradas,
    'detail',        v_detalle
  );
END;
$$;

-- ── Auto-merge de los seguros ───────────────────────────────────────────────
--
-- Solo toca candidatos 'seguro' + 'pending': un solo linkedin_url, un solo
-- pais, mismo nombre nucleo. No paga IA.

CREATE OR REPLACE FUNCTION v3.auto_merge_safe_candidates(
  p_limit      INTEGER DEFAULT 100,
  p_dry_run    BOOLEAN DEFAULT false,
  p_decided_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_id       UUID;
  v_res      JSONB;
  v_grupos   INT := 0;
  v_movidas  INT := 0;
  v_borradas INT := 0;
  v_errores  JSONB := '[]'::jsonb;
BEGIN
  SET LOCAL statement_timeout = '300s';

  FOR v_id IN
    SELECT id FROM v3.company_dup_candidates
    WHERE classification = 'seguro' AND status = 'pending'
    ORDER BY created_at
    LIMIT p_limit
  LOOP
    BEGIN
      v_res := v3.apply_dup_candidate(v_id, p_dry_run, p_decided_by);
      v_grupos   := v_grupos + 1;
      v_movidas  := v_movidas + coalesce((v_res->>'rows_moved')::int, 0);
      v_borradas := v_borradas + coalesce((v_res->>'rows_deleted')::int, 0);
    EXCEPTION WHEN others THEN
      -- Un grupo que falla no puede frenar el lote entero.
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
    'errors',       v_errores
  );
END;
$$;

-- ── Descartar un candidato ──────────────────────────────────────────────────
-- Para cuando una persona decide que no son la misma empresa.

CREATE OR REPLACE FUNCTION v3.dismiss_dup_candidate(p_candidate_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = v3, pg_catalog
AS $$
  UPDATE v3.company_dup_candidates
  SET status = 'dismissed', resolved_at = now()
  WHERE id = p_candidate_id;
$$;

-- ── Excluir una empresa de un grupo ─────────────────────────────────────────
-- Caso real que motivo esto: el grupo "arcor" juntaba 4 filas de Grupo Arcor
-- (Argentina, golosinas) con una telco alemana homonima (arcor.de). Descartar
-- el grupo entero desperdiciaba los 4 duplicados verdaderos; mergearlo entero
-- corrompia los datos. Hacia falta poder sacar al intruso y mergear el resto.

CREATE OR REPLACE FUNCTION v3.exclude_from_dup_candidate(
  p_candidate_id UUID,
  p_company_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_ids   UUID[];
  v_nuevo UUID[];
BEGIN
  SELECT company_ids INTO v_ids
  FROM v3.company_dup_candidates WHERE id = p_candidate_id;

  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'exclude_from_dup_candidate: no existe el candidato %', p_candidate_id;
  END IF;

  SELECT array_agg(x) INTO v_nuevo
  FROM unnest(v_ids) AS x WHERE x <> p_company_id;

  -- Con menos de 2 miembros ya no hay nada que comparar: el grupo se descarta.
  IF v_nuevo IS NULL OR array_length(v_nuevo, 1) < 2 THEN
    UPDATE v3.company_dup_candidates
    SET status = 'dismissed', resolved_at = now()
    WHERE id = p_candidate_id;

    RETURN jsonb_build_object('candidate_id', p_candidate_id,
      'remaining', 0, 'dismissed', true);
  END IF;

  -- Recalcular master y payload: al sacar un miembro puede cambiar quien es
  -- la ficha mas rica del grupo.
  UPDATE v3.company_dup_candidates
  SET company_ids = v_nuevo,
      master_id   = public.pick_merge_master(v_nuevo),
      payload     = v3.build_dup_payload(v_nuevo)
  WHERE id = p_candidate_id;

  RETURN jsonb_build_object('candidate_id', p_candidate_id,
    'remaining', array_length(v_nuevo, 1), 'dismissed', false);
END;
$$;

-- ── Resumen para el encabezado de la UI ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_dup_candidates_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'seguros_pendientes', count(*) FILTER (WHERE classification = 'seguro' AND status = 'pending'),
    'ambiguos_pendientes', count(*) FILTER (WHERE classification = 'ambiguo' AND status = 'pending'),
    'ia_misma',           count(*) FILTER (WHERE status = 'ai_same'),
    'ia_distinta',        count(*) FILTER (WHERE status = 'ai_different'),
    'ia_dudosa',          count(*) FILTER (WHERE status = 'ai_unsure'),
    'mergeados',          count(*) FILTER (WHERE status = 'merged'),
    'fallidos',           count(*) FILTER (WHERE status = 'failed'),
    'reversibles',        (SELECT count(*) FROM v3.company_merges WHERE reverted_at IS NULL),
    'costo_ia_usd',       (SELECT coalesce(round(sum(cost_usd)::numeric, 4), 0)
                             FROM v3.ai_usage_log WHERE feature = 'dedupe')
  )
  FROM v3.company_dup_candidates;
$$;

-- ── Historial de merges para poder deshacer ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_recent_company_merges(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id             UUID,
  master_id      UUID,
  master_name    TEXT,
  duplicate_name TEXT,
  method         TEXT,
  confidence     NUMERIC,
  reasoning      TEXT,
  rows_moved     INTEGER,
  created_at     TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
  SELECT m.id, m.master_id,
         c.name,
         m.duplicate_snapshot->>'name',
         m.method, m.confidence, m.reasoning,
         (SELECT coalesce(sum(jsonb_array_length(value)), 0)::int
            FROM jsonb_each(m.moved)),
         m.created_at
  FROM v3.company_merges m
  LEFT JOIN public.companies c ON c.id = m.master_id
  WHERE m.reverted_at IS NULL
  ORDER BY m.created_at DESC
  LIMIT p_limit;
$$;

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Son SECURITY DEFINER y ejecutan merges: `anon` no puede llegar a ellas.

REVOKE ALL ON FUNCTION v3.apply_dup_candidate(UUID, BOOLEAN, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION v3.auto_merge_safe_candidates(INTEGER, BOOLEAN, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION v3.dismiss_dup_candidate(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION v3.exclude_from_dup_candidate(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_dup_candidates_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_recent_company_merges(INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION v3.apply_dup_candidate(UUID, BOOLEAN, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION v3.auto_merge_safe_candidates(INTEGER, BOOLEAN, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION v3.dismiss_dup_candidate(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION v3.exclude_from_dup_candidate(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dup_candidates_summary() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_recent_company_merges(INTEGER) TO authenticated, service_role;

-- ── Compatibilidad ──────────────────────────────────────────────────────────
-- auto_merge_safe_duplicates se reemplaza por un wrapper en lugar de borrarse,
-- para no romper nada que todavia la invoque. La logica vieja (master por
-- linkedin_url + nombre mas largo, sobre normalized_name exacto) queda fuera
-- de uso: ahora delega en el camino seguro.

CREATE OR REPLACE FUNCTION public.auto_merge_safe_duplicates()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
DECLARE
  v_res JSONB;
BEGIN
  v_res := v3.auto_merge_safe_candidates(100, false, NULL);
  RETURN coalesce((v_res->>'groups')::int, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.auto_merge_safe_duplicates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_merge_safe_duplicates() TO authenticated, service_role;
