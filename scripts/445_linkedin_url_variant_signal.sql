-- =============================================================================
-- 445 - Senal de deteccion: variantes de la misma URL de LinkedIn
-- =============================================================================
--
-- QUE DETECTA
--
-- `companies.linkedin_url` es UNIQUE, asi que dos empresas nunca comparten la
-- URL exacta. Pero la MISMA pagina de LinkedIn se escribe de varias formas y
-- cada variante entra como una fila distinta:
--
--     https://www.linkedin.com/company/almacenes-la-ganga   -> "La Ganga"
--     https://ec.linkedin.com/company/almacenes-la-ganga    -> "Almacenes La Ganga"
--
-- El slug (lo que va despues de /company/) es el identificador real. Al
-- normalizar protocolo, subdominio de pais y barra final, esas dos filas se
-- ven como lo que son: la misma empresa.
--
-- Esta senal es independiente del nombre, asi que encuentra duplicados que el
-- nombre nucleo no puede ver: los dos nombres de arriba tienen nucleos
-- distintos ("la ganga" y "almacenes la ganga") y nunca caerian en el mismo
-- grupo.
--
-- POR QUE NUNCA SE AUTO-UNIFICA
--
-- Compartir slug DEBERIA implicar la misma empresa, pero en esta base no
-- alcanza: las filas con subdominio de pais tienen la URL mal asignada por el
-- scraper. Casos reales encontrados:
--
--     ar.linkedin.com/company/brubank  -> "Bank of Saint Lucia"  (deberia ser Brubank)
--     bm.linkedin.com/company/axaxl    -> "Maxam North America"  (deberia ser AXA XL)
--
-- Unificar por slug a ciegas fusionaria Brubank con el Bank of Saint Lucia. Por
-- eso todo grupo detectado por esta via entra como 'ambiguo': lo mira una
-- persona o la IA, que al ver los nombres nota la incoherencia. El valor de la
-- senal es traer el caso a la cola, no resolverlo sola.
--
-- Nota aparte: esas URLs mal asignadas son un bug del scraper, no del dedupe.
-- Quedan 1.412 filas con subdominio de pais para auditar por separado.
-- =============================================================================

-- El metodo nuevo necesita lugar en el CHECK.
ALTER TABLE v3.company_dup_candidates DROP CONSTRAINT IF EXISTS company_dup_candidates_method_check;
ALTER TABLE v3.company_dup_candidates ADD CONSTRAINT company_dup_candidates_method_check
  CHECK (method = ANY (ARRAY['exact','core','trgm','livar']));

COMMENT ON CONSTRAINT company_dup_candidates_method_check ON v3.company_dup_candidates IS
  'livar = LInkedin VARiant: mismo slug de LinkedIn escrito de formas distintas (script 445).';

CREATE OR REPLACE FUNCTION v3.detect_linkedin_url_variants(p_limit INTEGER DEFAULT 200)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, v3, extensions, pg_catalog
AS $$
DECLARE v_nuevos INT := 0;
BEGIN
  WITH grupos AS (
    SELECT
      -- El slug, sin protocolo, sin subdominio de pais y sin barra final.
      lower(regexp_replace(
        regexp_replace(linkedin_url, '^https?://([a-z]{2,3}\.)?linkedin\.com/company/', ''),
        '/+$', '')) AS slug,
      array_agg(id ORDER BY id) AS ids,
      count(*) AS n
    FROM public.companies
    WHERE linkedin_url ~* 'linkedin\.com/company/'
    GROUP BY 1
    HAVING count(*) > 1
  ),
  elegidos AS (
    SELECT g.*,
           -- Mismo criterio de master que el resto del pipeline: la fila con
           -- mas datos asociados se queda.
           (SELECT i.company_id FROM v3.company_name_index i
             WHERE i.company_id = ANY(g.ids)
             ORDER BY i.weight DESC NULLS LAST, i.company_id
             LIMIT 1) AS master_id
    FROM grupos g
    WHERE g.slug <> ''
    ORDER BY g.n DESC
    LIMIT p_limit
  ),
  ins AS (
    INSERT INTO v3.company_dup_candidates
      (group_key, method, company_ids, master_id, classification, payload)
    SELECT e.slug, 'livar', e.ids,
           -- Si ninguna de las dos esta en el indice todavia, se toma la
           -- primera: el master igual lo confirma quien revise.
           coalesce(e.master_id, e.ids[1]),
           'ambiguo',   -- SIEMPRE: ver cabecera (URLs mal asignadas)
           v3.build_dup_payload(e.ids)
    FROM elegidos e
    WHERE e.master_id IS NOT NULL OR array_length(e.ids, 1) > 0
    ON CONFLICT (group_key, method) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_nuevos FROM ins;

  RETURN jsonb_build_object(
    'nuevos', v_nuevos,
    'pendientes_livar', (SELECT count(*) FROM v3.company_dup_candidates
                          WHERE method = 'livar' AND status = 'pending')
  );
END;
$$;

REVOKE ALL ON FUNCTION v3.detect_linkedin_url_variants(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION v3.detect_linkedin_url_variants(INTEGER) TO authenticated, service_role;
