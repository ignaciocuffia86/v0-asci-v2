-- =============================================================================
-- 443 - Correccion del nombre nucleo y nueva clasificacion de duplicados
-- =============================================================================
--
-- CONTEXTO
--
-- La deteccion de duplicados (scripts 408 y 410) agrupa por `company_core_name`,
-- que saca prefijos ("Grupo") y sufijos societarios ("S.A.") para que
-- "Grupo Arcor" y "Arcor S.A.I.C." caigan en el mismo grupo. Funciona, pero
-- tenia tres agujeros que este script cierra. Los tres se encontraron mirando
-- los grupos que la funcion arma hoy en produccion.
--
-- ── 1. El sufijo se comia PARTE DE LA PALABRA ────────────────────────────────
--
-- El regex de sufijos abria con `\s*`, o sea CERO espacios. Al estar anclado
-- al final, se llevaba puestas las ultimas letras de cualquier nombre que
-- terminara en "co", "sa", "ag", "bv", "spa"... aunque fueran parte de la
-- palabra. Medido contra la base:
--
--     Cisco   -> cis      Visa    -> vi       Costco -> cost
--     Adecco  -> adec     Alicorp -> ali      Banco  -> ban
--
-- 4.523 nombres de una sola palabra quedaban truncados. Y como el nucleo es la
-- clave de agrupamiento, el truncado FABRICA duplicados: "Alicorp" y "ALICO"
-- comparten el nucleo "ali", asi que el auto-merge los unifico (son la
-- alimenticia peruana y una aseguradora: no tienen nada que ver).
--
-- La auditoria de los 1.304 auto-merges ya aplicados encontro 27 casos con
-- este patron; se revierten en el script 444.
--
-- Arreglo: exigir un separador real (espacio, coma o punto) antes del sufijo.
-- "Danone.S.A" -> danone (el punto separa), "Alicorp" -> alicorp (la "corp"
-- viene pegada a la palabra, no se toca).
--
-- ── 2. Las URLs se agrupaban entre si ────────────────────────────────────────
--
-- El ETL a veces guarda una URL en `name` (130 filas: 45 son URLs de vacantes
-- de LinkedIn, el resto sitios web). Todas empiezan igual, asi que el nucleo
-- las mandaba al mismo grupo:
--
--     nucleo "https:" -> 99 empresas    nucleo "http:" -> 31 empresas
--
-- Un solo merge de ese grupo habria fusionado 99 empresas sin relacion. Ahora
-- un nombre que es una URL, o que menciona linkedin.com, o los "Unknown
-- Company <uuid>" que genera `upsert_company` (33.887 filas) devuelven NULL:
-- no son nombres de empresa y no participan de ningun grupo.
--
-- ── 3. S.A. y S.R.L. son personas juridicas distintas ────────────────────────
--
-- El nucleo saca el sufijo societario a proposito, para que "YPF" y "YPF S.A."
-- se junten. El efecto colateral es que tambien junta "Union S.A." con
-- "Union S.R.L.", que son dos empresas distintas que comparten una palabra
-- comun. Se ve claro en los nucleos genericos:
--
--     union  -> Union S.A / Union S.R.L / UNION SRL / The Union / GRUPO UNION
--     itc    -> ITC Inc / ITC Limited / ITC Ltda. / ITC S.A / ITC S.A.S / ITC SRL
--
-- Por eso se agrega `company_legal_form()`: si en un grupo conviven dos formas
-- legales declaradas distintas, el grupo NO se auto-unifica y va a revision.
-- La regla es consistente con la decision ya tomada para filiales
-- ("Accenture Argentina" != "Accenture"): ante dos entidades declaradas como
-- distintas, decide una persona o la IA, no el batch.
--
-- Nota: esto manda a revision casos como "Cargill Inc" vs "Cargill S.A.C.I.",
-- que son la matriz y la filial argentina. Es exactamente lo que se busca.
--
-- ── Efecto medido de todo junto (grupos con contactos o vacantes) ────────────
--
--     seguro -> auto-merge                8.476 grupos / 20.007 empresas
--     ambiguo: 2+ formas legales            814 grupos /  2.834 empresas
--     ambiguo: 2+ linkedin                  492 grupos /  1.519 empresas
--     ambiguo: nombre corto sin identidad   604 grupos /  1.425 empresas
--     ambiguo: 2+ paises                      6 grupos /     15 empresas
--
-- =============================================================================

-- ── 1. Nombre nucleo corregido ──────────────────────────────────────────────
-- STABLE y no IMMUTABLE porque unaccent() depende del diccionario instalado.

CREATE OR REPLACE FUNCTION public.company_core_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_catalog
AS $$
  SELECT CASE
    -- Basura estructural: no son nombres de empresa. Sin esto todas las URLs
    -- comparten nucleo y forman un grupo gigante de empresas sin relacion.
    WHEN btrim(coalesce(p_name, '')) ~* '^(https?://|www\.)' THEN NULL
    WHEN p_name ~* 'linkedin\.com'                           THEN NULL
    WHEN p_name ~* '^unknown company'                        THEN NULL
    ELSE nullif(
      btrim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              -- "Acme S.A. / Acme Argentina" -> se corta en la barra
              split_part(
                regexp_replace(unaccent(lower(btrim(p_name))), '["''`]', '', 'g'),
                '/', 1
              ),
              -- prefijos que no distinguen a la empresa
              '^(grupo|group|holding|the)\s+', ''
            ),
            -- Sufijos societarios, incluido el S.A.I.C. de Arcor.
            -- [FIX] `[[:space:],\.]+` en lugar de `\s*`: exige un separador
            -- real. Con `\s*` (cero o mas) el sufijo matcheaba pegado a la
            -- palabra y truncaba Cisco -> cis, Alicorp -> ali.
            '[[:space:],\.]+\s*(s\.?a\.?i\.?c\.?f?\.?|s\.?a\.?c\.?i\.?|s\.?a\.?s\.?|s\.?a\.?u\.?|s\.?a\.?|s\.?r\.?l\.?|s\.?c\.?a\.?|inc|llc|ltda?|corp|co|plc|gmbh|ag|nv|bv|spa|srl|pty|limited)\.?\s*$',
            ''
          ),
          -- espacios colapsados
          '\s+', ' ', 'g'
        )
      ),
      ''
    )
  END;
$$;

-- ── 2. Forma legal declarada ────────────────────────────────────────────────
--
-- Devuelve la forma societaria que el nombre declara, o NULL si no declara
-- ninguna. Se usa como DISCRIMINADOR: dos formas distintas en un grupo son dos
-- personas juridicas distintas y el grupo deja de ser auto-unificable.
--
-- Las variantes del S.A. argentino (S.A.C.I., S.A.I.C.) se colapsan en 'saci'
-- a proposito: "Techint SACI" y "TECHINT S.A.C.I." son la misma sociedad
-- escrita de dos formas, no dos entidades.

CREATE OR REPLACE FUNCTION public.company_legal_form(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_name ~* '[[:space:],\.]s\.?a\.?[[:space:]\.]*(i|c)\.?(c|i)?\.?f?\.?$' THEN 'saci'
    WHEN p_name ~* '[[:space:],\.]s\.?a\.?s\.?$'  THEN 'sas'
    WHEN p_name ~* '[[:space:],\.]s\.?r\.?l\.?$'  THEN 'srl'
    WHEN p_name ~* '[[:space:],\.]s\.?p\.?a\.?$'  THEN 'spa'
    WHEN p_name ~* '[[:space:],\.]s\.?a\.?u\.?$'  THEN 'sau'
    WHEN p_name ~* '[[:space:],\.]s\.?a\.?$'      THEN 'sa'
    WHEN p_name ~* '[[:space:],\.]ltda?\.?$'      THEN 'ltda'
    WHEN p_name ~* '[[:space:],\.]inc\.?$'        THEN 'inc'
    WHEN p_name ~* '[[:space:],\.]llc\.?$'        THEN 'llc'
    WHEN p_name ~* '[[:space:],\.]corp\.?$'       THEN 'corp'
    WHEN p_name ~* '[[:space:],\.](plc|gmbh|ag|nv|bv|pty|limited)\.?$' THEN 'otra'
    ELSE NULL
  END;
$$;

-- ── 3. Recalculo del indice ─────────────────────────────────────────────────
--
-- `sync_company_name_index` solo recalcula el nucleo de las empresas cuyo
-- NOMBRE cambio (compara contra name_snapshot). Aca no cambio ningun nombre,
-- cambio la funcion, asi que el recalculo hay que forzarlo una vez.
--
-- Se hace por lotes: son 540.712 filas y la conexion de la API de gestion
-- tiene su propio limite de tiempo. `WHERE core IS DISTINCT FROM ...` hace que
-- el reintento sea idempotente y que cada pasada haga menos trabajo.

UPDATE v3.company_name_index i
SET core = public.company_core_name(i.name_snapshot),
    refreshed_at = now()
WHERE i.core IS DISTINCT FROM public.company_core_name(i.name_snapshot);

-- ── 4. Reconstruccion de los grupos ─────────────────────────────────────────
--
-- Los group_key son nucleos, asi que al cambiar la funcion cambian las claves.
-- Se borra la cola pendiente y se rearma; los ya promovidos se dejan como
-- lapida para no volver a proponer lo que ya se decidio.

DELETE FROM v3.company_dup_groups WHERE promoted_at IS NULL;

INSERT INTO v3.company_dup_groups (group_key, company_ids, n, peso)
SELECT core,
       array_agg(company_id ORDER BY company_id),
       count(*)::int,
       sum(weight)::bigint
FROM v3.company_name_index
WHERE core IS NOT NULL AND length(core) >= 3
GROUP BY core
HAVING count(*) > 1
ON CONFLICT (group_key) DO UPDATE
  SET company_ids = EXCLUDED.company_ids,
      n           = EXCLUDED.n,
      peso        = EXCLUDED.peso,
      detected_at = now();

-- ── 5. Nueva clasificacion ──────────────────────────────────────────────────
--
-- Misma estructura que la version de 410. Cambian solo las condiciones que
-- mandan un grupo a revision, que ahora son cinco:
--
--   1. dos linkedin_url distintas   (ya estaba)
--   2. dos paises distintos         (ya estaba)
--   3. follows en conflicto         (ya estaba)
--   4. dos formas legales distintas (nuevo, ver cabecera)
--   5. nucleo corto (< 8) y NINGUN miembro con identidad externa (nuevo)
--
-- La 5 es la corroboracion que se pidio para nombres cortos: un nucleo de
-- pocas letras es facil de compartir por casualidad ("cima", "nova", "sat"),
-- asi que se exige que al menos una de las empresas del grupo tenga
-- linkedin_url o website. Sin eso el grupo son dos filas flacas cuyo unico
-- dato es un nombre corto: no hay con que confirmar, y tampoco hay mucho que
-- ganar unificandolas. Van a revision, al fondo de la cola por su peso.

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
           -- Formas legales DECLARADAS: el NULL (no declara ninguna) no cuenta
           -- como una forma mas, si no cualquier grupo con un nombre "pelado"
           -- mas uno con sufijo caeria en ambiguo.
           count(DISTINCT public.company_legal_form(name)) AS formas,
           -- Identidad externa: algo verificable fuera de la base.
           count(*) FILTER (
             WHERE linkedin_url IS NOT NULL OR nullif(btrim(website), '') IS NOT NULL
           ) AS con_identidad,
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
        WHEN a.li_distintas >= 2                          THEN 'ambiguo'
        WHEN a.paises >= 2                                THEN 'ambiguo'
        WHEN a.formas >= 2                                THEN 'ambiguo'
        WHEN fc.group_key IS NOT NULL                     THEN 'ambiguo'
        WHEN a.largo_nucleo < 8 AND a.con_identidad = 0   THEN 'ambiguo'
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

-- ── 6. Permisos ─────────────────────────────────────────────────────────────
-- Postgres da EXECUTE a PUBLIC por defecto; estas funciones alimentan
-- decisiones de merge, asi que anon no las toca.

REVOKE ALL ON FUNCTION public.company_core_name(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.company_legal_form(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION v3.refresh_company_dup_candidates(INTEGER, BOOLEAN) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.company_core_name(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_legal_form(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION v3.refresh_company_dup_candidates(INTEGER, BOOLEAN) TO authenticated, service_role;
