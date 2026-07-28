-- ============================================================================
-- Fase 1 — Deteccion de duplicados sin IA (gratis)
-- ============================================================================
--
-- POR QUE LA DETECCION ACTUAL NO VE ARCOR
--
-- `get_duplicate_candidates` agrupa por IGUALDAD EXACTA de normalized_name.
-- "arcor" != "grupo arcor", asi que nunca los junta. Peor: de las 104.500
-- empresas con contactos o vacantes, 78.095 tienen normalized_name en NULL,
-- o sea que hoy son INVISIBLES para cualquier algoritmo que dependa de esa
-- columna.
--
-- Por eso el nombre nucleo se calcula sobre `name`, que siempre esta.
-- Medido: pasa de 958 a 2.303 grupos y captura ARCOR / Grupo Arcor.
--
-- Los candidatos se guardan en una tabla cache para que la UI no tenga que
-- recalcular sobre 485.206 filas en cada request (era la causa del
-- statement_timeout de 10s de la funcion vieja).
-- ============================================================================

-- ── Nombre nucleo ───────────────────────────────────────────────────────────
-- STABLE y no IMMUTABLE porque unaccent() depende del diccionario instalado.

CREATE OR REPLACE FUNCTION public.company_core_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_catalog
AS $$
  SELECT nullif(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            -- "Acme S.A. / Acme Argentina" -> se corta en la barra
            split_part(
              regexp_replace(unaccent(lower(btrim(coalesce(p_name, '')))), '["''`]', '', 'g'),
              '/', 1
            ),
            -- prefijos que no distinguen a la empresa
            '^(grupo|group|holding|the)\s+', ''
          ),
          -- sufijos societarios, incluido el S.A.I.C. de Arcor
          '\s*[,\.]?\s*(s\.?a\.?i\.?c\.?f?\.?|s\.?a\.?c\.?i\.?|s\.?a\.?s\.?|s\.?a\.?u\.?|s\.?a\.?|s\.?r\.?l\.?|s\.?c\.?a\.?|inc|llc|ltda?|corp|co|plc|gmbh|ag|nv|bv|spa|srl|pty|limited)\s*$',
          ''
        ),
        -- espacios colapsados
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

-- ── Nombre base: nucleo sin el pais ────────────────────────────────────────
--
-- Decision del usuario: "Accenture Argentina" y "Accenture" son la MISMA
-- empresa, igual que el mismo nombre en paises distintos. El nucleo no alcanza
-- para eso ("accenture argentina" != "accenture"), asi que hace falta un pase
-- que saque el sufijo geografico.
--
-- Esto es mas agresivo que el resto y tiene un falso positivo conocido:
-- "Banco Nacion Argentina" -> "banco nacion", donde el pais es parte del
-- nombre real. Por eso el pase `geo` SIEMPRE se clasifica como ambiguo y
-- nunca se auto-mergea: lo revisa la IA o una persona.

CREATE OR REPLACE FUNCTION public.company_base_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_catalog
AS $$
  SELECT nullif(btrim(regexp_replace(
    public.company_core_name(p_name),
    '\s+(argentina|arg|brasil|brazil|chile|mexico|peru|uruguay|paraguay|bolivia|ecuador|colombia|venezuela|espana|spain|usa|us|uk|latam|latinoamerica|america latina|sudamerica|cono sur|group|international|global|holdings?)$',
    '', 'g')), '');
$$;

-- ── Cache de candidatos ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3.company_dup_candidates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key      TEXT NOT NULL,
  method         TEXT NOT NULL CHECK (method IN ('exact','core','trgm','geo')),
  company_ids    UUID[] NOT NULL,
  master_id      UUID NOT NULL,
  -- 'seguro'  -> se puede auto-mergear, no paga IA
  -- 'ambiguo' -> va a la cola de IA
  --
  -- Lo que vuelve ambiguo a un grupo es tener DOS linkedin_url distintas:
  -- son dos entidades que LinkedIn considera separadas.
  --
  -- El pais NO lo vuelve ambiguo, por decision explicita del usuario: el mismo
  -- nombre en paises distintos se unifica. Es la contracara de esa decision que
  -- se pierda la granularidad por pais en senales y contactos; es reversible
  -- desde v3.company_merges.
  classification TEXT NOT NULL CHECK (classification IN ('seguro','ambiguo')),
  -- Datos ya listos para la UI y para el prompt, para no re-consultar.
  payload        JSONB NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','ai_same','ai_different','ai_unsure',
                                   'merged','dismissed','failed')),
  ai_confidence  NUMERIC,
  ai_reasoning   TEXT,
  ai_checked_at  TIMESTAMPTZ,
  merge_ids      UUID[],
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);

-- Un solo candidato vivo por grupo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dup_candidates_group
  ON v3.company_dup_candidates (group_key, method);
CREATE INDEX IF NOT EXISTS idx_dup_candidates_triage
  ON v3.company_dup_candidates (classification, status);

ALTER TABLE v3.company_dup_candidates ENABLE ROW LEVEL SECURITY;

-- ── Refresh de candidatos ───────────────────────────────────────────────────
--
-- p_include_trgm esta apagado por default a proposito. El pase de trigramas
-- necesita un self-join sobre el subconjunto relevante y es el unico paso con
-- costo dificil de acotar; el pase de nombre nucleo ya captura la mayoria
-- (incluido Arcor). Se puede prender cuando se quiera cazar tipeos.

CREATE OR REPLACE FUNCTION v3.refresh_company_dup_candidates(
  p_limit         INTEGER DEFAULT 500,
  p_include_trgm  BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, extensions, pg_catalog
AS $$
DECLARE
  v_core INT := 0;
  v_geo  INT := 0;
  v_trgm INT := 0;
BEGIN
  SET LOCAL statement_timeout = '300s';

  -- Empresas que valen el esfuerzo: las que tienen contactos o vacantes.
  -- Sin este filtro se estarian comparando 485k filas, la mayoria sin ningun
  -- dato asociado, o sea sin nada que perder ni que ganar en un merge.
  CREATE TEMP TABLE tmp_rel ON COMMIT DROP AS
  SELECT c.id, c.name, c.linkedin_url, c.country, c.created_at,
         public.company_core_name(c.name) AS core,
         public.company_base_name(c.name) AS base
  FROM public.companies c
  WHERE (
      EXISTS (SELECT 1 FROM public.contacts ct WHERE ct.current_company_id = c.id)
      OR EXISTS (SELECT 1 FROM public.job_postings jp WHERE jp.company_id = c.id)
    )
    AND lower(btrim(c.name)) <> 'unknown company'
    AND length(btrim(c.name)) >= 3;

  CREATE INDEX ON tmp_rel (core);
  CREATE INDEX ON tmp_rel (base);
  ANALYZE tmp_rel;

  -- ── Pase 1: nombre nucleo ────────────────────────────────────────────────
  WITH grp AS (
    SELECT r.core AS group_key, array_agg(r.id ORDER BY r.created_at) AS ids,
           count(*) AS n,
           count(DISTINCT r.linkedin_url) AS li_distintas
    FROM tmp_rel r
    WHERE r.core IS NOT NULL AND length(r.core) >= 3
    GROUP BY r.core
    HAVING count(*) > 1
  ),
  ranked AS (
    SELECT g.*,
           -- Se prioriza por volumen de datos: los grupos donde hay algo real
           -- en juego se resuelven primero.
           (SELECT count(*) FROM public.job_postings jp
             WHERE jp.company_id = ANY(g.ids)) AS jobs
    FROM grp g
    ORDER BY jobs DESC, n DESC
    LIMIT p_limit
  )
  INSERT INTO v3.company_dup_candidates
    (group_key, method, company_ids, master_id, classification, payload)
  SELECT
    r.group_key,
    'core',
    r.ids,
    public.pick_merge_master(r.ids),
    CASE WHEN r.li_distintas >= 2 THEN 'ambiguo' ELSE 'seguro' END,
    v3.build_dup_payload(r.ids)
  FROM ranked r
  ON CONFLICT (group_key, method) DO NOTHING;

  v_core := (SELECT count(*) FROM v3.company_dup_candidates WHERE method = 'core');

  -- ── Pase 2: trigramas (opcional) ─────────────────────────────────────────
  IF p_include_trgm THEN
    WITH pares AS (
      SELECT DISTINCT
        least(a.core, b.core)  AS c1,
        greatest(a.core, b.core) AS c2
      FROM tmp_rel a
      JOIN tmp_rel b
        ON a.id < b.id
       -- Blocking por los primeros 4 caracteres: sin esto el self-join es
       -- cuadratico sobre el subconjunto entero.
       AND left(a.core, 4) = left(b.core, 4)
       AND a.core <> b.core
       AND similarity(a.core, b.core) >= 0.85
      WHERE a.core IS NOT NULL AND b.core IS NOT NULL
        AND length(a.core) >= 4 AND length(b.core) >= 4
      LIMIT p_limit
    ),
    grp AS (
      SELECT p.c1 || ' ~ ' || p.c2 AS group_key,
             array_agg(DISTINCT r.id) AS ids,
             count(DISTINCT r.linkedin_url) AS li_distintas
      FROM pares p
      JOIN tmp_rel r ON r.core IN (p.c1, p.c2)
      GROUP BY p.c1, p.c2
    )
    INSERT INTO v3.company_dup_candidates
      (group_key, method, company_ids, master_id, classification, payload)
    SELECT g.group_key, 'trgm', g.ids,
           public.pick_merge_master(g.ids),
           -- Un tipeo nunca se auto-mergea: siempre pasa por revision.
           'ambiguo',
           v3.build_dup_payload(g.ids)
    FROM grp g
    ON CONFLICT (group_key, method) DO NOTHING;

    v_trgm := (SELECT count(*) FROM v3.company_dup_candidates WHERE method = 'trgm');
  END IF;

  RETURN jsonb_build_object(
    'relevantes',  (SELECT count(*) FROM tmp_rel),
    'grupos_core', v_core,
    'grupos_trgm', v_trgm,
    'pendientes',  (SELECT count(*) FROM v3.company_dup_candidates WHERE status = 'pending'),
    'seguros',     (SELECT count(*) FROM v3.company_dup_candidates
                     WHERE status = 'pending' AND classification = 'seguro'),
    'ambiguos',    (SELECT count(*) FROM v3.company_dup_candidates
                     WHERE status = 'pending' AND classification = 'ambiguo')
  );
END;
$$;

-- ── Payload de un grupo ─────────────────────────────────────────────────────
-- Se arma una sola vez y queda cacheado: lo consume tanto la UI como el prompt
-- de la IA. Deliberadamente NO incluye `description` (son ~3.100 caracteres
-- promedio en esta base) para que el prompt siga siendo barato.

CREATE OR REPLACE FUNCTION v3.build_dup_payload(p_ids UUID[])
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id',           c.id,
      'name',         c.name,
      'country',      nullif(btrim(coalesce(c.country, '')), ''),
      'industry',     c.industry,
      -- Solo el dominio del LinkedIn: es la senal fuerte, sin gastar tokens
      -- en la URL completa.
      'linkedin',     nullif(regexp_replace(coalesce(c.linkedin_url, ''),
                        '^https?://([a-z]{2,3}\.)?linkedin\.com/company/', ''), ''),
      'website',      nullif(regexp_replace(coalesce(c.website, ''),
                        '^https?://(www\.)?', ''), ''),
      'jobs',         (SELECT count(*) FROM public.job_postings jp WHERE jp.company_id = c.id),
      'contacts',     (SELECT count(*) FROM public.contacts ct WHERE ct.current_company_id = c.id),
      'news',         (SELECT count(*) FROM public.company_news cn WHERE cn.company_id = c.id)
    ) AS x
    FROM public.companies c
    WHERE c.id = ANY(p_ids)
  ) s;
$$;

-- ── Lectura para la UI ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_duplicate_candidates_v2(
  p_limit          INTEGER DEFAULT 100,
  p_classification TEXT DEFAULT NULL,
  p_status         TEXT DEFAULT 'pending'
)
RETURNS TABLE (
  id             UUID,
  group_key      TEXT,
  method         TEXT,
  classification TEXT,
  status         TEXT,
  master_id      UUID,
  company_ids    UUID[],
  companies      JSONB,
  ai_confidence  NUMERIC,
  ai_reasoning   TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, v3, pg_catalog
AS $$
  SELECT d.id, d.group_key, d.method, d.classification, d.status,
         d.master_id, d.company_ids, d.payload, d.ai_confidence, d.ai_reasoning
  FROM v3.company_dup_candidates d
  WHERE (p_status IS NULL OR d.status = p_status)
    AND (p_classification IS NULL OR d.classification = p_classification)
  ORDER BY
    -- Primero lo que ya viene con veredicto de IA y mas confianza, que es lo
    -- que se puede aprobar en bloque de un vistazo.
    CASE d.status WHEN 'ai_same' THEN 0 ELSE 1 END,
    d.ai_confidence DESC NULLS LAST,
    array_length(d.company_ids, 1) DESC
  LIMIT p_limit;
$$;

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Postgres da EXECUTE a PUBLIC por defecto y estas funciones son
-- SECURITY DEFINER: sin revocar, `anon` podria leerlas y dispararlas por REST.

REVOKE ALL ON FUNCTION v3.refresh_company_dup_candidates(INTEGER, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_duplicate_candidates_v2(INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_core_name(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION v3.build_dup_payload(UUID[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION v3.refresh_company_dup_candidates(INTEGER, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_duplicate_candidates_v2(INTEGER, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_core_name(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION v3.build_dup_payload(UUID[]) TO authenticated, service_role;
