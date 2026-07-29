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
-- ORDEN DE DESPLIEGUE (importante). Este script trae SOLO la RPC; el indice
-- unico va aparte, en el 421. No es capricho: v2 esta en produccion y el codigo
-- deployado hoy hace INSERT crudos. Si el indice se crea antes de que salga el
-- deploy con la RPC, `bookmarkCompanyBatch` (que manda las 50 empresas en un
-- unico INSERT) pasa de duplicar en silencio a fallar entero: el usuario
-- selecciona 50, ya tenia 1 guardada, y no se guarda NINGUNA.
--
-- Por eso la secuencia es:
--   1. 417 + dedupe_bookmarks_legacy  -> limpiar los redundantes (hecho)
--   2. 420 (este)                     -> crear la RPC. Inofensivo: nadie la usa aun
--   3. deploy del cambio en app/actions/bookmarks.ts
--   4. 421                            -> recien ahi el indice unico
--
-- La RPC funciona con o sin el indice puesto (ver la nota de abajo), asi que los
-- pasos 2 y 3 no dependen del 4.

-- ---------------------------------------------------------------------------
-- API de creacion: un solo camino, a prueba de carreras
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
DECLARE
  v_cid  UUID;
  v_id   UUID;
  v_ck   TEXT := v3.bookmark_context_key(p_search_context);
BEGIN
  -- Se recorre empresa por empresa, cada INSERT en su propio bloque con
  -- EXCEPTION. Dos motivos para hacerlo asi en vez de un INSERT ... ON CONFLICT:
  --
  --  1. Aislamiento: un choque no puede tumbar a las otras 49. Cada bloque
  --     BEGIN/EXCEPTION es una subtransaccion, asi que si una empresa falla, esa
  --     sola se descarta y el resto se guarda igual. Ese era exactamente el bug
  --     de bookmarkCompanyBatch.
  --  2. No depende del indice. `ON CONFLICT (expresion)` exige que exista un
  --     indice unico que matchee, asi que la RPC no se podria crear antes del
  --     421. Con el handler, esto funciona con el indice y sin el, y por eso se
  --     puede deployar la app sin haber creado todavia el constraint.
  --
  -- El DISTINCT importa: si el array trae la misma empresa repetida, el segundo
  -- INSERT choca contra el primero de esta misma llamada.
  FOR v_cid IN SELECT DISTINCT unnest(p_company_ids) LOOP
    v_id := NULL;

    -- Camino feliz: no existe, se crea.
    BEGIN
      INSERT INTO public.bookmarks (user_id, company_id, search_context)
      SELECT p_user_id, v_cid, p_search_context
      WHERE NOT EXISTS (
        SELECT 1 FROM public.bookmarks b
        WHERE b.user_id = p_user_id
          AND b.company_id = v_cid
          AND v3.bookmark_context_key(b.search_context) = v_ck
      )
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      -- Perdio la carrera contra otra pestaña entre el NOT EXISTS y el INSERT.
      -- No es un error para el usuario: el bookmark existe, que es lo que pedia.
      v_id := NULL;
    END;

    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT v_id, v_cid, true;
    ELSE
      -- Ya estaba (o lo acaba de crear el otro request). Se devuelve el id igual,
      -- asi el caller no necesita distinguir "lo cree" de "ya existia" para poder
      -- navegar al bookmark.
      RETURN QUERY
      SELECT b.id, v_cid, false
      FROM public.bookmarks b
      WHERE b.user_id = p_user_id
        AND b.company_id = v_cid
        AND v3.bookmark_context_key(b.search_context) = v_ck
      ORDER BY b.created_at, b.id
      LIMIT 1;
    END IF;
  END LOOP;
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
-- Verificacion
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_bookmarks'
  ) THEN
    RAISE EXCEPTION 'create_bookmarks no quedo creada';
  END IF;

  IF has_function_privilege('anon',
       'public.create_bookmarks(UUID, UUID[], JSONB)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_bookmarks quedo abierta a anon';
  END IF;

  RAISE NOTICE 'OK: create_bookmarks lista (el indice unico va en el 421)';
END $$;
