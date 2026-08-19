-- job_postings: policy de lectura para authenticated (fix "Búsquedas Laborales: 0").
--
-- La tabla tiene RLS habilitado desde la baseline pero NUNCA tuvo ninguna
-- policy: para anon/authenticated está vacía. Casi todos los lectores de la app
-- lo disimulaban porque son SECURITY DEFINER (get_company_drawer_data,
-- get_company_job_postings, los export_*), pero dos RPCs corren como INVOKER y
-- por eso mostraban 0 aun con vacantes reales en la tabla:
--
--   * get_company_signal_summary  -> tarjeta "Búsquedas Laborales" de la
--     búsqueda por empresa (v2). Con YPF: total_signals 6783 correcto (signals
--     sí tiene policy de lectura) y job_postings_count 0 con 135 filas reales.
--   * search_companies_by_process -> contadores de vacantes en "Por Proceso".
--
-- El criterio es el mismo que ya rige para signals y companies: son datos de
-- mercado compartidos, todo usuario autenticado los ve. Se replica el par de
-- policies exacto de signals. Los escritores no cambian: el ETL entra por
-- funciones SECURITY DEFINER o service_role (BYPASSRLS).
--
-- cron_locks y pending_signals también están en RLS-sin-policy y quedan así a
-- propósito: son tablas de backend que ningún client de sesión consulta.

drop policy if exists "Everyone can view job postings" on public.job_postings;
create policy "Everyone can view job postings" on public.job_postings as permissive for SELECT to public
  using ((auth.role() = 'authenticated'::text));

drop policy if exists "Superadmins can manage job postings" on public.job_postings;
create policy "Superadmins can manage job postings" on public.job_postings as permissive for ALL to public
  using (is_superadmin());
