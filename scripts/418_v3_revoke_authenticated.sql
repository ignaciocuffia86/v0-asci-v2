-- 418: cerrar el bypass de requireAdmin en las funciones SECURITY DEFINER de v3.
--
-- EL PROBLEMA
-- Todas las funciones de mutacion de v3 tenian EXECUTE para `authenticated`. Son
-- SECURITY DEFINER, o sea que corren con los privilegios del owner y se saltean
-- RLS. Un usuario logueado comun podia llamarlas directo por la API REST de
-- Supabase (`POST /rest/v1/rpc/apply_dup_candidate`) y unificar o borrar empresas
-- de produccion, salteando por completo el `requireAdmin()` del server action.
-- El gate de superadmin vivia SOLO en TypeScript.
--
-- POR QUE NO ALCANZABA EL REVOKE QUE YA ESTABA
-- Los scripts 407-417 ya hacian `REVOKE ALL ... FROM PUBLIC, anon`. Pero Supabase
-- trae de fabrica un `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon,
-- authenticated, service_role`, asi que cada funcion nueva nace con un GRANT
-- **directo** a `authenticated`. Ese grant no viene de PUBLIC, y por lo tanto
-- `REVOKE ... FROM PUBLIC` no lo toca. Hay que nombrar al rol explicitamente.
--
-- POR QUE ES SEGURO REVOCARLO
-- Se verifico cada call site en app/actions/dedupe.ts: todas las mutaciones usan
-- `createAdminClient()` (service_role) y pasan por `requireAdmin()`. Ninguna usa
-- el cliente de sesion del usuario. Y las llamadas internas entre funciones
-- siguen funcionando porque quien llama es SECURITY DEFINER: corre como su owner,
-- no como el invocador.
--
-- QUE NO SE TOCA Y POR QUE
--  * `v3.user_workspace_id`  -> lo usan las policies de RLS, que se evaluan con el
--                              rol del usuario. Revocarlo romperia todo el acceso.
--  * `public.merge_companies` y `public.auto_merge_safe_duplicates`
--                           -> los llama la UI vieja de v2 (app/actions/companies.ts)
--                              con el cliente de sesion. v2 esta en produccion, asi
--                              que se dejan como estan. OJO: esa server action no
--                              tiene ningun chequeo de admin. Es un agujero de v2,
--                              anterior a este trabajo y fuera de este script.

-- Se recorre por nombre y se resuelve la firma desde el catalogo con
-- `oid::regprocedure`. Escribir las firmas a mano es fragil: algunas funciones
-- tienen mas parametros de los que parece (reserve_mcp_usage tiene 9) y varias
-- conviven en dos versiones de distinta aridad (auto_merge_safe_candidates quedo
-- con la firma del 409 y la del 411, y la vieja tambien era llamable).
--
-- Que hay en cada nombre:
--  * snapshot_cascade, premerge_followed_accounts -> helpers internos del merge
--  * apply_dup_candidate, auto_merge_safe_candidates, dismiss_dup_candidate,
--    exclude_from_dup_candidate, refresh_company_dup_candidates,
--    sync_company_name_index -> superficie de admin, siempre via service_role
--  * reserve_mcp_usage -> se llama con admin (lib/v3/mcp-usage.ts:75). Encima
--    tenia EXECUTE para `anon`: era invocable sin estar logueado.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'v3'
      AND p.proname IN (
        'snapshot_cascade', 'premerge_followed_accounts',
        'apply_dup_candidate', 'auto_merge_safe_candidates',
        'dismiss_dup_candidate', 'exclude_from_dup_candidate',
        'refresh_company_dup_candidates', 'sync_company_name_index',
        'reserve_mcp_usage'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    RAISE NOTICE 'cerrada %', r.sig;
  END LOOP;
END $$;

-- Verificacion: si algo quedo abierto, se aborta con la lista.
DO $$
DECLARE v_abiertas TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_abiertas
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'v3' AND p.prosecdef
    AND p.proname <> 'user_workspace_id'
    AND coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false);

  IF v_abiertas IS NOT NULL THEN
    RAISE EXCEPTION 'Quedaron funciones v3 ejecutables por authenticated: %', v_abiertas;
  END IF;

  RAISE NOTICE 'OK: ninguna funcion SECURITY DEFINER de v3 es ejecutable por authenticated (salvo user_workspace_id, que lo necesita RLS)';
END $$;
