-- =============================================================================
-- Aclara qué indexa v3.tech_radar_runs (sólo comentarios, cero DDL de datos)
--
-- El nombre y `findings_count` sugieren que la tabla indexa TODAS las corridas
-- de research y que sus hallazgos viven en public.radar_findings. Ninguna de las
-- dos cosas es cierta, y el diagnóstico equivocado ya pasó: en agosto se vieron
-- corridas `completed` con findings_count entre 5 y 21 los días 10, 11, 12 y 13,
-- mientras radar_findings no tenía una sola fila posterior al 07/08. Parecía
-- pérdida de datos y no lo era: son pipelines distintos.
--
-- Contrato real:
--   - Escriben acá: app/actions/v3/tech-radar.ts (caller='campaign') y
--     app/api/research/implementations/route.ts (caller='drilldown').
--   - Sus hallazgos aterrizan en public.company_implementations, NO en
--     public.radar_findings.
--   - public.radar_findings lo escribe lib/v3/services/radar.ts, que lleva su
--     propio índice de corridas en public.radar_research_runs.
--   - El research de noticias NO se indexa acá a propósito: el camino
--     client-assisted del MCP se audita en v3.client_ai_executions y
--     v3.client_ai_stage_submissions, y el server-side deja atribución por
--     artículo (requested_by, ai_provider) más el costo en v3.ai_usage_log.
--     Meterlo en una tabla llamada "tech_radar_runs" haría el nombre más
--     engañoso, no menos.
-- =============================================================================

comment on table v3.tech_radar_runs is
  'Índice de corridas del Tech Radar cuyos hallazgos aterrizan en public.company_implementations. NO indexa public.radar_findings (ése lleva su propio índice en public.radar_research_runs) ni el research de noticias (auditado en v3.client_ai_executions y, por artículo, en public.company_news). Ver caller para distinguir el origen.';

comment on column v3.tech_radar_runs.caller is
  'Origen de la corrida: campaign (app/actions/v3/tech-radar.ts) o drilldown (app/api/research/implementations/route.ts). Ambos escriben sus hallazgos en public.company_implementations.';

comment on column v3.tech_radar_runs.findings_count is
  'Hallazgos escritos en public.company_implementations por esta corrida. NO es un conteo de public.radar_findings.';
