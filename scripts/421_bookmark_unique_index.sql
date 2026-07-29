-- ============================================================================
-- 421: el UNIQUE real sobre la identidad del bookmark
-- ============================================================================
--
-- APLICAR SOLO DESPUES DE DEPLOYAR el cambio de app/actions/bookmarks.ts que
-- pasa `bookmarkCompany` y `bookmarkCompanyBatch` a usar public.create_bookmarks
-- (script 420). Ver la nota de orden en el 420.
--
-- Con el codigo viejo deployado, este indice ROMPE el guardado masivo: ese INSERT
-- manda todas las empresas en un unico statement, y Postgres aborta el comando
-- completo ante un choque. Resultado: el usuario selecciona 50 empresas, ya tenia
-- 1 guardada, y no se guarda ninguna. Con la RPC, cada empresa va en su propia
-- subtransaccion y un choque no arrastra al resto.
--
-- QUE HACE
-- Lleva a la base la regla que hasta ahora vivia solo en TypeScript
-- (`checkBookmarkWithContext`, app/actions/bookmarks.ts:99): un bookmark por
-- (usuario, empresa, contexto de señales). No habia NINGUN constraint, solo la
-- PK, y es un read-then-write clasico: la app lee, no encuentra nada, inserta.
-- Dos clicks rapidos pasan los dos por la lectura antes de que alguno escriba.
-- De los 21 grupos redundantes que habia, 13 NO los causo la unificacion de
-- empresas: los genero esta carrera.
--
-- POR QUE UN INDICE DE EXPRESION Y NO UNA COLUMNA GENERADA
-- Una columna `GENERATED ALWAYS AS (v3.bookmark_context_key(search_context))`
-- seria mas comoda (el `onConflict` de PostgREST acepta nombres de columna, no
-- expresiones), pero crea una dependencia rigida: Postgres deja de permitir
-- `CREATE OR REPLACE FUNCTION v3.bookmark_context_key`, y los scripts 414 y 417
-- dejarian de ser reaplicables. Verificado que con indice de expresion el CREATE
-- OR REPLACE sigue funcionando.
--
-- NULLS NOT DISTINCT: `user_id` y `company_id` son nullable. Por defecto Postgres
-- trata cada NULL como distinto, asi que un par (NULL, NULL) se podria duplicar
-- libre y el constraint no serviria justo ahi. Hoy no hay filas con NULL, pero se
-- cierra el hueco. Requiere PG15+ (hay 17.6).

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
    RAISE EXCEPTION
      'Hay % grupos redundantes: correr v3.dedupe_bookmarks_legacy(500, false) antes',
      v_dups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_user_company_context_uniq
  ON public.bookmarks (user_id, company_id, v3.bookmark_context_key(search_context))
  NULLS NOT DISTINCT;

COMMENT ON INDEX public.bookmarks_user_company_context_uniq IS
  'Identidad del bookmark: usuario + empresa + contexto de señales. Dos bookmarks '
  'de la misma empresa con filtros de diccionario DISTINTOS son busquedas distintas '
  'y conviven; lo que se impide es el duplicado exacto. Espeja la regla de '
  'app/actions/bookmarks.ts:99. Para insertar usar public.create_bookmarks().';

-- Nota para el futuro: con este indice puesto, revertir una consolidacion
-- historica (v3.revert_bookmark_dedupe) falla a proposito, porque reponer la fila
-- borrada recrea el duplicado que el indice prohibe. El 417 lo avisa con un
-- mensaje claro. Para revertir hay que dropear el indice, revertir, y recrearlo.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index
    WHERE indrelid = 'public.bookmarks'::regclass
      AND indexrelid = 'public.bookmarks_user_company_context_uniq'::regclass
      AND indisunique
  ) THEN
    RAISE EXCEPTION 'El indice unico no quedo creado';
  END IF;

  RAISE NOTICE 'OK: UNIQUE de contexto activo';
END $$;
