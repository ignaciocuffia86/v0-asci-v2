-- 426: busqueda de empresas determinista y rankeada por evidencia real.
--
-- EL PROBLEMA
-- `searchCompanies` (lib/v3/mcp-read-tools.ts) traia candidatas asi:
--
--     .or(`name.ilike.%q%,website.ilike.%q%`)
--     .limit(Math.min(limit * 5, 100))
--
-- Ese LIMIT no tiene ORDER BY. Postgres devuelve entonces las filas en el orden
-- que le resulte comodo, que cambia entre ejecuciones. El ranking por evidencia
-- corria DESPUES, en TypeScript, sobre un conjunto ya recortado al azar. Un solo
-- bug con cuatro sintomas medidos:
--
--   1. No determinismo: 5 corridas de search_companies("Techint") devolvieron 5
--      `likelyCanonical` distintos.
--   2. La canonica real nunca aparecia: "Techint Engineering & Construction" (726
--      señales) no entraba en el top-3, ni Falabella (16.065) en el top-10.
--   3. `totalMatches` mentia: informaba el tamaño del recorte (`limit * 5`), no el
--      total. Decia 15 con limit=3 y 50 con limit=10, cuando "Techint" tiene 240.
--   4. `likelyCanonical` era solo "la de mas señales", sin exigir que el nombre
--      coincidiera: para "Falabella" marcaba Sodimac y para "Techint", Seatech
--      (que matchea por el website seatechint.com).
--
-- Consecuencia para el usuario: el modelo recomienda guardar la empresa
-- equivocada, se consume un lugar del plan, y el research posterior no encuentra
-- evidencia porque la entidad elegida esta vacia.
--
-- LA SOLUCION
-- Mover el filtro + ranking + conteo a una sola consulta, para que el recorte
-- ocurra DESPUES de ordenar y no antes. Tres piezas:
--
--   * `tier`: cuan literal es la coincidencia (0 exacta, 1 prefijo, 2 contiene,
--     3 solo el website). Sirve para armar el pool de forma determinista y para
--     distinguir "coincide el nombre" de "matcheo de rebote por la URL".
--   * `pool`: se acotan las candidatas con un ORDER BY total (tier, name, id), asi
--     la exacta y las de prefijo entran siempre, y dos corridas iguales dan el
--     mismo pool. El `id` final garantiza orden total: sin el, dos homonimos con
--     el mismo nombre podrian alternarse.
--   * conteo de evidencia solo sobre el pool, y recorte final a p_limit.
--
-- POR QUE ESTE ENFOQUE Y NO OTRO
--  * No se toca `public.search_companies_by_name_filtered`: es de v2, que esta en
--    produccion. Esta funcion vive en el schema v3 y no la usa nadie de v2.
--  * No se precalculan los counts en una tabla: medido, no hace falta. El peor
--    caso real ("a", 419.790 coincidencias) tarda 1,9s y el limite de PostgREST
--    son 8s. Si algun dia se acerca, ahi si conviene materializar.
--  * SECURITY INVOKER (el default, no DEFINER): la llama el MCP con service_role,
--    que ya lee estas tablas. No hace falta elevar privilegios.
--
-- COSTO: reemplaza 1 + 2N queries (hasta 201 por busqueda, dos counts por
-- candidata desde TypeScript) por una sola.

CREATE OR REPLACE FUNCTION v3.search_companies_ranked(
  p_query text,
  p_limit int DEFAULT 10
) RETURNS jsonb
LANGUAGE sql
STABLE
-- search_path fijo: la funcion nombra tablas de `public` sin calificar el schema.
SET search_path = public, pg_temp
AS $$
WITH q AS (
  -- Se limpian comas porque los nombres de razon social las traen ("Arcor, S.A.")
  -- y el usuario no las escribe igual.
  SELECT btrim(replace(coalesce(p_query, ''), ',', '')) AS t
),
matches AS (
  SELECT
    c.id, c.name, c.normalized_name, c.website, c.country, c.industry,
    CASE
      WHEN lower(c.name) = lower((SELECT t FROM q)) THEN 0
      WHEN c.name ILIKE (SELECT t FROM q) || '%' THEN 1
      WHEN c.name ILIKE '%' || (SELECT t FROM q) || '%' THEN 2
      ELSE 3
    END AS tier
  FROM public.companies c
  WHERE (SELECT t FROM q) <> ''
    AND (c.name ILIKE '%' || (SELECT t FROM q) || '%'
      OR c.website ILIKE '%' || (SELECT t FROM q) || '%')
),
-- Total REAL de coincidencias, antes de cualquier recorte. Es el numero que el
-- modelo necesita para avisarle al usuario cuantos homonimos hay.
total AS (SELECT count(*)::int AS n FROM matches),
pool AS (
  SELECT * FROM matches
  ORDER BY tier, name, id
  LIMIT least(greatest(p_limit * 10, 100), 300)
),
scored AS (
  SELECT
    p.*,
    (SELECT count(*) FROM public.signals s WHERE s.company_id = p.id) AS signals,
    (SELECT count(*) FROM public.job_postings j WHERE j.company_id = p.id) AS job_postings
  FROM pool p
),
ranked AS (
  SELECT * FROM scored
  -- Primero las que coinciden por nombre: una empresa que solo matcheo por su URL
  -- casi nunca es la que el usuario busca.
  ORDER BY (tier <= 2) DESC, signals DESC, job_postings DESC,
           (website IS NOT NULL) DESC, name, id
  LIMIT greatest(p_limit, 1)
)
SELECT jsonb_build_object(
  'totalMatches', (SELECT n FROM total),
  'companies', coalesce(
    (SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'normalized_name', r.normalized_name,
          'website', r.website,
          'country', r.country,
          'industry', r.industry,
          -- Distingue coincidencia de nombre de matcheo por URL. Lo usa
          -- `likelyCanonical` para no proponer Sodimac cuando se busca Falabella.
          'nameMatch', r.tier <= 2,
          'evidence', jsonb_build_object(
            'signals', r.signals,
            'jobPostings', r.job_postings,
            'hasWebsite', r.website IS NOT NULL
          )
        )
        ORDER BY (r.tier <= 2) DESC, r.signals DESC, r.job_postings DESC,
                 (r.website IS NOT NULL) DESC, r.name, r.id
      )
     FROM ranked r),
    '[]'::jsonb)
);
$$;

-- Supabase trae de fabrica un ALTER DEFAULT PRIVILEGES que le da EXECUTE a anon y
-- authenticated en cada funcion nueva. Ese grant es directo, asi que un
-- `REVOKE ... FROM PUBLIC` no lo saca: hay que nombrar los roles (ver script 418).
REVOKE ALL ON FUNCTION v3.search_companies_ranked(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION v3.search_companies_ranked(text, int) TO service_role;

DO $$
BEGIN
  IF coalesce(has_function_privilege('anon', 'v3.search_companies_ranked(text, int)', 'EXECUTE'), false)
     OR coalesce(has_function_privilege('authenticated', 'v3.search_companies_ranked(text, int)', 'EXECUTE'), false) THEN
    RAISE EXCEPTION 'search_companies_ranked quedo ejecutable por anon/authenticated';
  END IF;
  RAISE NOTICE 'OK: v3.search_companies_ranked creada y cerrada a service_role';
END $$;
