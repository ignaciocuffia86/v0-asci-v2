-- ============================================================================
-- OPT-03: quitar EXECUTE de `anon`/PUBLIC en las RPC de export SECURITY DEFINER.
--
-- Estas funciones devuelven datos de contactos/empresas y estaban ejecutables
-- por el rol anon (unas por GRANT explícito a anon, otras por el grant por
-- defecto a PUBLIC que nunca se revocó). Al ser SECURITY DEFINER, saltean RLS,
-- así que anon podía exfiltrar datos llamándolas directo.
--
-- Todos los llamadores de la app usan el cliente con sesión (rol authenticated)
-- o el service_role, así que revocar anon/PUBLIC no rompe el flujo autenticado.
--
-- Se itera por nombre (regprocedure) para cubrir todas las sobrecargas sin tener
-- que fijar cada firma a mano. Idempotente.
-- ============================================================================

do $$
declare
  r record;
  fns text[] := array[
    'export_contacts',
    'export_companies',
    'export_companies_countries',
    'export_companies_industries',
    'export_companies_with_signals',
    'get_companies_for_export',
    'get_export_stats',
    'get_available_countries_for_export',
    'get_bookmark_export_data'
  ];
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(fns)
  loop
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('revoke execute on function %s from public', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;
