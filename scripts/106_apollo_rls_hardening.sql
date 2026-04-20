-- Fase 4: RLS endurecido para tablas del flujo Apollo
--
-- Problema: la migración 099 permite a cualquier usuario authenticated leer y
-- escribir TODO el cache global de Apollo. Esto es intencional para maximizar
-- cache hit rate, pero permite manipulación (un usuario malintencionado podría
-- corromper datos de otros).
--
-- Solución: separar lectura (authenticated, amplia) de escritura (service_role
-- sólo). Las server actions ya usan createServiceRoleClient() para las
-- operaciones de escritura.
-- ---------------------------------------------------------------------------

-- apollo_contacts_cache: lectura amplia, escritura sólo service_role
drop policy if exists "apollo_contacts_cache_authenticated_all" on apollo_contacts_cache;
drop policy if exists "apollo_contacts_cache_insert" on apollo_contacts_cache;
drop policy if exists "apollo_contacts_cache_update" on apollo_contacts_cache;
drop policy if exists "apollo_contacts_cache_select" on apollo_contacts_cache;
drop policy if exists "apollo_contacts_cache_read" on apollo_contacts_cache;
drop policy if exists "apollo_contacts_cache_write_service" on apollo_contacts_cache;

create policy "apollo_contacts_cache_read"
  on apollo_contacts_cache for select
  to authenticated
  using (true);

create policy "apollo_contacts_cache_write_service"
  on apollo_contacts_cache for all
  to service_role
  using (true)
  with check (true);

-- apollo_search_queries: lectura amplia, escritura service_role
drop policy if exists "apollo_search_queries_all" on apollo_search_queries;
drop policy if exists "apollo_search_queries_read" on apollo_search_queries;
drop policy if exists "apollo_search_queries_write_service" on apollo_search_queries;

create policy "apollo_search_queries_read"
  on apollo_search_queries for select
  to authenticated
  using (true);

create policy "apollo_search_queries_write_service"
  on apollo_search_queries for all
  to service_role
  using (true)
  with check (true);

-- apollo_search_results: lectura amplia, escritura service_role
drop policy if exists "apollo_search_results_all" on apollo_search_results;
drop policy if exists "apollo_search_results_read" on apollo_search_results;
drop policy if exists "apollo_search_results_write_service" on apollo_search_results;

create policy "apollo_search_results_read"
  on apollo_search_results for select
  to authenticated
  using (true);

create policy "apollo_search_results_write_service"
  on apollo_search_results for all
  to service_role
  using (true)
  with check (true);

-- apollo_title_catalog: lectura amplia (para autocomplete), escritura service_role
drop policy if exists "apollo_title_catalog_all" on apollo_title_catalog;
drop policy if exists "apollo_title_catalog_read" on apollo_title_catalog;
drop policy if exists "apollo_title_catalog_write_service" on apollo_title_catalog;

create policy "apollo_title_catalog_read"
  on apollo_title_catalog for select
  to authenticated
  using (true);

create policy "apollo_title_catalog_write_service"
  on apollo_title_catalog for all
  to service_role
  using (true)
  with check (true);

-- apollo_api_calls: lectura sólo admins o dueños, escritura service_role
-- (ya creadas en 101; aquí sólo nos aseguramos de que estén)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'apollo_api_calls'
      and policyname = 'apollo_api_calls_write_service'
  ) then
    create policy "apollo_api_calls_write_service"
      on apollo_api_calls for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;
