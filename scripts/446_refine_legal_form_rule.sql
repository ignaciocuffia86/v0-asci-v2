-- =============================================================================
-- 446 - La forma legal deja de ser, por si sola, motivo de revision
-- =============================================================================
--
-- QUE SE APRENDIO REVISANDO
--
-- El script 443 agrego una regla: si en un grupo conviven dos formas legales
-- declaradas distintas (S.A. y S.R.L.), no se auto-unifica. La intencion era
-- buena y sigue siendo valida para el caso que la motivo:
--
--     union -> Union S.A / Union S.R.L / UNION SRL / The Union
--
-- Pero al revisar los 1.915 grupos que la regla mando a revision, resulto que
-- casi ninguno era ese caso. El patron dominante es otro:
--
--     Alicorp        <alicorpoficial | Food Production | Peru>   830 contactos
--     Alicorp S.A                                                  0
--     Alicorp s.a.s                                                0
--     Alicorp SA                                                   1 contacto
--
-- Una sola fila tiene identidad externa y todos los datos; las demas son
-- nombres tipeados por contactos, con el sufijo societario puesto de memoria.
-- Ese "s.a.s" no declara otra sociedad: es ruido. De los 12 grupos mas pesados
-- que la regla freno (Belcorp, Alicorp, PCR, TGS, Minera Alumbrera, Escorial,
-- Turbus...), los 12 eran la misma empresa.
--
-- Medido sobre los 1.915: 1.914 tenian A LO SUMO UNA fila con identidad
-- externa. O sea que la regla practicamente nunca estaba separando dos
-- entidades que compiten por la misma identidad, que es lo que se queria.
--
-- ── El discriminador que si sirve ───────────────────────────────────────────
--
-- No es la forma legal ni el largo del nombre: es si el grupo tiene un ANCLA
-- VERIFICABLE. Es decir, exactamente una fila con identidad externa, y que esa
-- identidad se corresponda con el nombre del grupo.
--
-- Lo segundo importa. Ejemplo real que la regla nueva sigue frenando:
--
--     atc -> "ATC / RED ENLACE" <red-enlace>  ::  ATC  ::  ATC Ltda  ::  ATC S.A.
--
-- El ancla dice llamarse ATC pero su slug de LinkedIn es "red-enlace": es una
-- fila "empresa / cliente" tipeada por un contacto que se enriquecio con la
-- empresa equivocada. Unificar ahi juntaria todas las ATC del pais bajo Red
-- Enlace. Comparando el slug contra el nucleo, el caso salta solo.
--
-- El chequeo tiene falsos positivos conocidos: acronimos y acentos codificados
-- ("cosud" por Constructora Sudamericana, "gyssrl" por Gestion y Servicios,
-- "danplantengineering" por DPE, "soluciones-anal-ticas-sa"). Por eso NO
-- rechaza: solo evita el auto-merge y manda a revision, que es barato.
--
-- ── Grupos sin ninguna identidad ────────────────────────────────────────────
--
-- Cuando NINGUNA fila tiene LinkedIn ni website no hay con que verificar, pero
-- un nombre largo casi no se repite por casualidad: "Falabella Tecnologia
-- Corporativa", "Compania Naviera Horamar", "Automotores Gildemeister". Ahi se
-- unifica igual. Con nombres cortos (ACA, BIT, gasco) se mantiene la revision:
-- son justo los que un homonimo puede compartir.
--
-- ── Regla final ─────────────────────────────────────────────────────────────
--
-- Dos formas legales distintas mandan a revision, SALVO que pase una de estas:
--   a) hay exactamente una fila con identidad externa y esa identidad se
--      corresponde con el nombre nucleo  -> ancla verificada;
--   b) no hay ninguna identidad, pero el nucleo tiene 8+ caracteres
--      -> nombre distintivo.
--
-- Las demas condiciones de 443 no cambian.
-- =============================================================================

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
  v_nuevos INT := 0;
  v_trgm   INT := 0;
BEGIN
  WITH elegidos AS MATERIALIZED (
    SELECT g.group_key, g.company_ids AS ids, g.n, g.peso
    FROM v3.company_dup_groups g
    WHERE g.promoted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM v3.company_dup_candidates d
        WHERE d.group_key = g.group_key AND d.method = 'core'
      )
    ORDER BY g.peso DESC, g.n DESC
    LIMIT p_limit
  ),
  miembros AS (
    SELECT e.group_key, c.id, c.name, c.linkedin_url, c.website, c.country, i.weight
    FROM elegidos e
    JOIN public.companies c ON c.id = ANY(e.ids)
    LEFT JOIN v3.company_name_index i ON i.company_id = c.id
  ),
  atributos AS (
    SELECT group_key,
           count(DISTINCT linkedin_url) AS li_distintas,
           count(DISTINCT nullif(btrim(lower(country)), '')) AS paises,
           count(DISTINCT public.company_legal_form(name)) AS formas,
           count(*) FILTER (
             WHERE linkedin_url IS NOT NULL OR nullif(btrim(website), '') IS NOT NULL
           ) AS con_identidad,
           -- ¿Alguna fila con identidad externa se corresponde con el nombre
           -- del grupo? Se comparan sin acentos ni separadores: el slug
           -- "grupo-mavesa" contiene el nucleo "mavesa".
           bool_or(
             (linkedin_url IS NOT NULL OR nullif(btrim(website), '') IS NOT NULL)
             AND regexp_replace(lower(coalesce(linkedin_url, website)), '[^a-z0-9]', '', 'g')
                 LIKE '%' || regexp_replace(group_key, '[^a-z0-9]', '', 'g') || '%'
           ) AS ancla_consistente,
           max(length(group_key)) AS largo_nucleo
    FROM miembros
    GROUP BY group_key
  ),
  follows_en_conflicto AS (
    SELECT x.group_key
    FROM (
      SELECT mi.group_key, f.workspace_id, count(*) AS n
      FROM miembros mi
      JOIN v3.followed_accounts f ON f.company_id = mi.id
      GROUP BY mi.group_key, f.workspace_id
    ) x
    WHERE x.n > 1
    GROUP BY x.group_key
  ),
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
        WHEN a.li_distintas >= 2      THEN 'ambiguo'
        WHEN a.paises >= 2            THEN 'ambiguo'
        WHEN fc.group_key IS NOT NULL THEN 'ambiguo'
        -- [446] La forma legal sola ya no alcanza: hace falta que ademas NO
        -- haya ancla verificada ni nombre distintivo. Ver cabecera.
        WHEN a.formas >= 2 AND NOT (
               (a.con_identidad = 1 AND a.ancla_consistente)
            OR (a.con_identidad = 0 AND a.largo_nucleo >= 8)
             ) THEN 'ambiguo'
        WHEN a.largo_nucleo < 8 AND a.con_identidad = 0 THEN 'ambiguo'
        ELSE 'seguro'
      END,
      v3.build_dup_payload(e.ids)
    FROM elegidos e
    JOIN atributos a ON a.group_key = e.group_key
    JOIN masters   m ON m.group_key = e.group_key
    LEFT JOIN follows_en_conflicto fc ON fc.group_key = e.group_key
    ON CONFLICT (group_key, method) DO NOTHING
    RETURNING group_key
  ),
  marcados AS (
    UPDATE v3.company_dup_groups g
    SET promoted_at = now()
    WHERE g.group_key IN (SELECT group_key FROM ins)
    RETURNING 1
  )
  SELECT count(*) INTO v_nuevos FROM marcados;

  RETURN jsonb_build_object(
    'indexadas',        (SELECT count(*) FROM v3.company_name_index),
    'grupos_totales',   (SELECT count(*) FROM v3.company_dup_groups),
    'grupos_restantes', (SELECT count(*) FROM v3.company_dup_groups WHERE promoted_at IS NULL),
    'nuevos_grupos',    v_nuevos,
    'grupos_trgm',      v_trgm,
    'pendientes',       (SELECT count(*) FROM v3.company_dup_candidates WHERE status = 'pending'),
    'seguros',          (SELECT count(*) FROM v3.company_dup_candidates
                           WHERE status = 'pending' AND classification = 'seguro'),
    'ambiguos',         (SELECT count(*) FROM v3.company_dup_candidates
                           WHERE status = 'pending' AND classification = 'ambiguo')
  );
END;
$$;

REVOKE ALL ON FUNCTION v3.refresh_company_dup_candidates(INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION v3.refresh_company_dup_candidates(INTEGER, BOOLEAN) TO authenticated, service_role;

-- ── Los 1.915 ya revisados ──────────────────────────────────────────────────
--
-- La revision de esta tanda se hizo con Claude leyendo los grupos, no con el
-- pipeline de gemini de lib/v3/dedupe-ai.ts, porque la sesion no tenia
-- credenciales del gateway. El veredicto quedo escrito en las mismas columnas
-- (status / ai_confidence / ai_reasoning) y los merges se aplicaron con
-- v3.apply_dup_candidate, asi que quedan como method='ai' en v3.company_merges
-- y se revierten igual que cualquier otro.
--
--   1.336 unificados
--       550  con ancla verificada (0,95 / 0,85 de confianza)
--       786  sin identidad pero nombre distintivo (0,80)
--       5 de esos 1.336 fallaron por 'deadlock detected' con el ETL corriendo
--         en paralelo; se reintentaron y entraron.
--       5 retenidos como ai_different: atc, estudio contable,
--         servicios y consultoria, mi casa, fenix international
--         -> nombre generico, o slug del ancla que apunta a otra empresa.
--     573 grupos de nucleo corto sin identidad quedan pendientes a proposito
--         (ACA, BIT, gasco): no hay evidencia para decidirlos y su peso
--         combinado es 117 contactos.
