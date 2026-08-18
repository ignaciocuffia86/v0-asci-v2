-- Remediacion de los ERRORs del Security Advisor (2026-08-18).
--
-- 1) security_definer_view (lint 0010): las 4 vistas pasan a SECURITY INVOKER
--    para que cada consulta aplique los permisos y RLS del rol que consulta,
--    no los del dueño (postgres). Verificado por dry-run transaccional: el
--    superadmin sigue viendo import_batches_inconsistent (policies
--    is_superadmin() en import_batches/import_rows) y el cron de reverify usa
--    service_role, que tiene BYPASSRLS.
alter view public.apollo_reverify_candidates set (security_invoker = on);
alter view public.apollo_title_catalog_ranked set (security_invoker = on);
alter view public.import_batches_inconsistent set (security_invoker = on);
alter view public.v_unmapped_industries set (security_invoker = on);

-- 2) rls_disabled_in_public (lint 0013): se habilita RLS en las 7 tablas
--    expuestas por la API. Todos los escritores reales (crons con
--    service_role, conexion directa superuser de lib/db/direct.ts, funciones
--    SECURITY DEFINER) esquivan RLS, asi que el backend no cambia; solo se
--    cierra el acceso via PostgREST con las keys anon/authenticated.
alter table public.dictionary_job_matches enable row level security;
alter table public.country_mappings enable row level security;
alter table public.dictionary_patterns_cache enable row level security;
alter table public.cron_executions enable row level security;
alter table v3.radar_micro_agents enable row level security;
alter table v3.linkedin_company_enrichment enable row level security;
alter table v3.explore_sessions enable row level security;

-- getCronHealth (app/actions/processing.ts) lee cron_executions con el client
-- de sesion del usuario desde /admin/processing: el superadmin necesita SELECT.
create policy cron_executions_superadmin_select on public.cron_executions
  for select to authenticated using (public.is_superadmin());

-- Policies explicitas para service_role: no cambian nada funcional (el rol
-- tiene BYPASSRLS) pero documentan la intencion y evitan el lint INFO
-- rls_enabled_no_policy en tablas que son solo de backend.
create policy dictionary_job_matches_service_all on public.dictionary_job_matches
  for all to service_role using (true) with check (true);
create policy country_mappings_service_all on public.country_mappings
  for all to service_role using (true) with check (true);
create policy dictionary_patterns_cache_service_all on public.dictionary_patterns_cache
  for all to service_role using (true) with check (true);
create policy cron_executions_service_all on public.cron_executions
  for all to service_role using (true) with check (true);
create policy radar_micro_agents_service_all on v3.radar_micro_agents
  for all to service_role using (true) with check (true);
create policy linkedin_company_enrichment_service_all on v3.linkedin_company_enrichment
  for all to service_role using (true) with check (true);
create policy explore_sessions_service_all on v3.explore_sessions
  for all to service_role using (true) with check (true);
