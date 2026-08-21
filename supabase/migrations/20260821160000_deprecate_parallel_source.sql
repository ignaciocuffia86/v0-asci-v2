-- ═══════════════════════════════════════════════════════════════════════════
-- Deprecar 'parallel' como procedencia de la evidencia (21-ago-2026)
--
-- `company_news.source` nació con DEFAULT 'parallel' cuando Parallel era el
-- buscador del research de v2. Parallel se retiró hace meses (no es enrutable
-- por el AI Gateway; lo reemplazó `collect` con búsqueda server-side de
-- Anthropic), pero la columna siguió estampando su nombre. Medido hoy:
--
--   source='parallel' → 1.137 filas, de las cuales el ai_provider real es
--   'perplexity' (244), 'gemini-2.0-flash' (190), 'google/gemini-2.5-flash-lite'
--   (65), 'gemini' (65), 'serpapi' (48) y 'parallel' (457).
--
-- O sea: la columna decía "parallel" para filas producidas por cinco motores
-- distintos. No se podía medir quién generó qué.
--
-- Este cambio renombra el valor a 'research' (= el pipeline de research del
-- servidor, sea cual sea el buscador de turno) y deja explícito que la
-- procedencia REAL vive en `produced_by` (qué motor) + `ai_provider` (qué
-- modelo), que es el contrato de lib/shared/evidence.ts.
--
-- ── Por qué el CHECK sigue aceptando 'parallel' ──
-- Entre esta migración y el deploy del código nuevo, producción sigue
-- escribiendo 'parallel'. Sacarlo del CHECK acá rompería el scrape de noticias
-- en esa ventana — que es EXACTAMENTE el bug que se acaba de arreglar (dos
-- scrapes de ARAUCO perdidos por un CHECK que el código no conocía). El valor
-- se retira en una segunda migración, una vez que el deploy esté vivo.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. El CHECK viejo sale PRIMERO. No es cosmético: el valor nuevo ('research')
--    no está en su lista, así que el backfill del paso 2 falla contra él.
alter table public.company_news drop constraint if exists company_news_source_check;

-- 2. Historia: las filas que decían 'parallel' pasan a decir 'research'.
--    No se toca `ai_provider`: sus valores viejos SON el registro forense de
--    qué modelo corrió en cada época (así se pudo datar el incidente del
--    modelo retirado). Reescribirlos cambiaría una imprecisión por otra.
update public.company_news set source = 'research' where source = 'parallel';

-- 3. El default deja de mentir. Importa porque `/api/research/news` (v2) NO
--    setea la columna: todas sus filas la toman de acá.
alter table public.company_news alter column source set default 'research';

-- 4. CHECK con el valor nuevo. 'parallel' queda transitoriamente permitido
--    (ver arriba); ningún camino del código lo escribe después de este deploy.
alter table public.company_news add constraint company_news_source_check
  check (source = any (array['research'::text, 'client_mcp'::text, 'tech_radar'::text, 'parallel'::text]));

-- 5. Que la próxima persona no tenga que reconstruir esto leyendo git.
comment on column public.company_news.source is
  'LEGACY. Procedencia gruesa: research (pipeline del servidor) | client_mcp (búsqueda del cliente vía MCP) | tech_radar. ''parallel'' está deprecado y sólo sigue en el CHECK por compatibilidad de deploy. La procedencia real es produced_by (motor) + ai_provider (modelos).';

comment on column public.company_news.produced_by is
  'Motor que produjo la fila (vocabulario de lib/shared/evidence.ts: v2_research, v2_manual, v3_news, v3_radar, v3_drilldown, mcp_client, etl_apify, cron_refresh). Es la procedencia autoritativa.';

comment on column public.company_news.ai_provider is
  'Modelos REALES que generaron la fila, en formato "<modelo-de-búsqueda>+<modelo-de-estructuración>" (ej: anthropic/claude-haiku-4.5+google/gemini-2.5-flash-lite). Las filas anteriores a ago-2026 guardan un solo valor y algunas nombran al buscador (parallel, serpapi) en vez del generador. El costo por modelo se mide en v3.ai_usage_log.';
