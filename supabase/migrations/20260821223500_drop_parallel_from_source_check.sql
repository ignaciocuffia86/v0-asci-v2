-- ═══════════════════════════════════════════════════════════════════════════
-- Segundo paso: retirar 'parallel' del CHECK de company_news.source
--
-- La migración 20260821160000 renombró el valor a 'research' pero dejó
-- 'parallel' aceptado a propósito: entre esa migración y el deploy, producción
-- seguía escribiendo el valor viejo, y sacarlo antes habría roto el scrape en
-- esa ventana (que es exactamente el bug que costó los scrapes de ARAUCO).
--
-- Ahora el deploy está vivo y verificado en producción:
--   - `/api/cron/v3-scrape-news` corrió a las 22:30 UTC del 21-ago-2026.
--   - 17 filas nuevas con produced_by='v3_news', source='research' y
--     ai_provider='anthropic/claude-haiku-4.5+google/gemini-2.5-flash-lite'.
--   - 0 filas quedan con source='parallel'.
--
-- Con el valor fuera del CHECK, la base deja de aceptar el nombre de un
-- proveedor retirado como procedencia.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.company_news drop constraint if exists company_news_source_check;
alter table public.company_news add constraint company_news_source_check
  check (source = any (array['research'::text, 'client_mcp'::text, 'tech_radar'::text]));

comment on column public.company_news.source is
  'LEGACY. Procedencia gruesa: research (pipeline del servidor) | client_mcp (búsqueda del cliente vía MCP) | tech_radar. La procedencia real es produced_by (motor) + ai_provider (modelos).';
