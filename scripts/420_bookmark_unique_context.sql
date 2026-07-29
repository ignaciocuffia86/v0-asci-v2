-- ============================================================================
-- 420: UNIQUE real sobre la identidad del bookmark + API de creacion segura
-- ============================================================================
--
-- PROBLEMA
-- La regla "un bookmark por (usuario, empresa, contexto de señales)" vivia solo
-- en TypeScript (`checkBookmarkWithContext`, app/actions/bookmarks.ts:99). En la
-- base no habia NINGUN constraint: `public.bookmarks` solo tiene la PK.
--
-- Es un read-then-write clasico: la app lee, no encuentra nada, e inserta. Dos
-- clicks rapidos (o dos pestañas) pasan los dos por la lectura antes de que
-- alguno escriba, y quedan dos bookmarks identicos. De los 21 grupos redundantes
-- que habia, 13 NO los causo la unificacion de empresas: los genero esta carrera.
--
-- POR QUE UN INDICE DE EXPRESION Y NO UNA COLUMNA GENERADA
-- Una columna `GENERATED ALWAYS AS (v3.bookmark_context_key(search_context))`
-- seria mas comoda para el `onConflict` de PostgREST (acepta nombres de columna,
-- no expresiones), pero crea una dependencia rigida: Postgres deja de permitir
-- `CREATE OR REPLACE FUNCTION v3.bookmark_context_key`, y los scripts 414 y 417
-- dejarian de ser reaplicables. Verificado que con un indice de expresion el
-- CREATE OR REPLACE sigue funcionando. Por eso: indice de expresion + una RPC
-- propia que usa ON CONFLICT nativo, que si acepta la expresion.
--
-- NULLS NOT DISTINCT: `user_id` y `company_id` son nullable. Por defecto Postgres
-- considera cada NULL distinto de otro, asi que un par (NULL, NULL) se podria
-- duplicar libremente y el constraint no serviria en ese caso. Hoy no hay filas
-- con NULL, pero se cierra el hueco de una vez. Requiere PG15+ (hay 17.6).
--
-- ORDEN: aplicar despues de 414 y 417, y despues de correr
-- `v3.dedupe_bookmarks_legacy(500, false)`. Si quedan grupos redundantes, la
-- creacion del indice falla (a proposito: avisa en vez de borrar datos sola).

-- ---------------------------------------------------------------------------
-- 1. El constraint
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_user_company_context_uniq
  ON public.bookmarks (user_id, company_id, v3.bookmark_context_key(search_context))
  NULLS NOT DISTINCT;

COMMENT ON INDEX public.bookmarks_user_company_context_uniq IS
  'Identidad del bookmark: usuario + empresa + contexto de señales. Dos bookmarks '
  'de la misma empresa con filtros de diccionario DISTINTOS son busquedas distintas '
  'y conviven; lo que se impide es el duplicado exacto. Espeja la regla de '
  'app/actions/bookmarks.ts:99. Para insertar usar public.create_bookmarks().';

-- ---------------------------------------------------------------------------
-- 2. API de creacion: un solo camino, a prueba de carreras
-- ---------------------------------------------------------------------------
--
-- Reemplaza los dos INSERT crudos de la app, que con el constraint puesto
-- pasarian de "duplicar en silencio" a "explotar en la cara del usuario":
--
--   * bookmarkCompany (bookmarks.ts:12) -> .insert() sin manejo de conflicto:
--     un doble click ahora devolveria error 23505 en vez de duplicar.
--   * bookmarkCompanyBatch (bookmarks.ts:455) -> manda un ARRAY en un solo
--     INSERT. Postgres aborta el comando entero ante un choque, asi que si el
--     usuario selecciona 50 empresas y ya tenia 1 guardada, no se guardaba
--     NINGUNA. Este era el peor de los dos.
--
-- SECURITY INVOKER (el default, explicito para que se lea): la funcion corre con
-- los permisos de quien la llama, asi que la policy de RLS de bookmarks
-- (auth.uid() = user_id) sigue aplicando adentro. Con SECURITY DEFINER un usuario
-- podria crear bookmarks a nombre de otro pasando un p_user_id ajeno.
CREATE OR REPLACE FUNCTION public.create_bookmarks(
  p_user_id        UUID,
  p_company_ids    UUID[],
  p_search_context JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (bookmark_id UUID, company_id UUID, was_created BOOLEAN)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, v3, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  WITH entrada AS (
    -- DISTINCT porque si el array trae la misma empresa dos veces, el ON CONFLICT
    -- no la puede frenar: el conflicto es contra filas ya existentes, no contra
    -- otra fila del mismo INSERT.
    SELECT DISTINCT unnest(p_company_ids) AS cid
  ),
  creados AS (
    INSERT INTO public.bookmarks (user_id, company_id, search_context)
    SELECT p_user_id, e.cid, p_search_context
    FROM entrada e
    ON CONFLICT (user_id, company_id, v3.bookmark_context_key(search_context))
      DO NOTHING
    RETURNING bookmarks.id, bookmarks.company_id
  )
  SELECT c.id, c.company_id, true FROM creados c
  UNION ALL
  -- Los que ya estaban: se devuelve el id igual, asi el caller no necesita
  -- distinguir "lo cree" de "ya existia" para poder navegar al bookmark.
  SELECT b.id, b.company_id, false
  FROM public.bookmarks b
  WHERE b.user_id = p_user_id
    AND b.company_id = ANY (p_company_ids)
    AND v3.bookmark_context_key(b.search_context)
        = v3.bookmark_context_key(p_search_context)
    AND NOT EXISTS (SELECT 1 FROM creados c WHERE c.id = b.id);
END $$;

COMMENT ON FUNCTION public.create_bookmarks(UUID, UUID[], JSONB) IS
  'Crea bookmarks de forma idempotente respetando el UNIQUE de contexto. Devuelve '
  'una fila por empresa con was_created indicando si se creo o ya existia. Sirve '
  'para uno o para muchos: la app usa el mismo camino en los dos casos.';

-- Es la API del usuario final, asi que `authenticated` SI la necesita. RLS la
-- contiene. `anon` no tiene por que crear bookmarks.
REVOKE ALL ON FUNCTION public.create_bookmarks(UUID, UUID[], JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_bookmarks(UUID, UUID[], JSONB) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Verificacion
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dups INTEGER;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT 1 FROM public.bookmarks
    GROUP BY user_id, company_id, v3.bookmark_context_key(search_context)
    HAVING count(*) > 1
  ) x;

  IF v_dups > 0 THEN
    RAISE EXCEPTION 'Quedan % grupos redundantes: el indice no se pudo crear', v_dups;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indrelid = 'public.bookmarks'::regclass
      AND indexrelid = 'public.bookmarks_user_company_context_uniq'::regclass
      AND indisunique
  ) THEN
    RAISE EXCEPTION 'El indice unico no quedo creado';
  END IF;

  RAISE NOTICE 'OK: UNIQUE de contexto activo y sin redundantes';
END $$;
