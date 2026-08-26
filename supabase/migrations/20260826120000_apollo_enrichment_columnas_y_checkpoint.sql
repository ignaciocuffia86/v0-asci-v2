-- ============================================================================
-- Apollo Fase 1 — Columnas para el enrichment de organizaciones + checkpoint
--
-- Contexto: `organizations/enrich` devuelve ~45 campos por empresa y hoy
-- persistimos 5 (id, status, synced_at, employees, industry). Todo lo demas
-- se descartaba: tecnologias, facturacion, año de fundacion, keywords y el
-- crecimiento de headcount.
--
-- REGLA DE NAMESPACE (decision del dueño del proyecto, 26-ago-2026):
--   Los datos que vienen de Apollo viven en columnas `apollo_*` SEPARADAS.
--   Las señales propias (jobs, contactos, noticias, tech radar) son la fuente
--   preferida y NUNCA se pisan con datos de Apollo. Las columnas genericas
--   (country, description, logo_url, linkedin_url) solo se rellenan cuando
--   estan vacias, igual que hace el enrichment de LinkedIn (scripts/437).
--
-- Por eso `apollo_technologies` NO alimenta el Tech Radar: es un insumo
-- complementario y de menor precedencia que los hallazgos propios.
-- ============================================================================

-- ── 1. Columnas apollo_* nuevas en public.companies ────────────────────────

ALTER TABLE public.companies
  -- technology_names[]: 47-66 tecnologias por empresa segun la muestra de
  -- produccion. Se guarda crudo; la precedencia frente al Tech Radar propio
  -- la resuelve quien consulta, no la ingesta.
  ADD COLUMN IF NOT EXISTS apollo_technologies text[],
  -- annual_revenue: entero en USD (Apollo tambien manda annual_revenue_printed
  -- tipo "573M", que no guardamos: es presentacion, no dato).
  ADD COLUMN IF NOT EXISTS apollo_annual_revenue bigint,
  ADD COLUMN IF NOT EXISTS apollo_founded_year integer,
  ADD COLUMN IF NOT EXISTS apollo_keywords text[],
  -- organization_headcount_{six,twelve,twenty_four}_month_growth como jsonb:
  -- Apollo solo lo manda para ~18% de las empresas y el shape cambia seguido.
  ADD COLUMN IF NOT EXISTS apollo_headcount_growth jsonb,
  -- Cotizacion: NO escribimos is_public/ticker/stock_exchange, que son de la
  -- pipeline de SEC EDGAR. Apollo queda como segunda opinion, aparte.
  ADD COLUMN IF NOT EXISTS apollo_publicly_traded_symbol text,
  ADD COLUMN IF NOT EXISTS apollo_publicly_traded_exchange text;

COMMENT ON COLUMN public.companies.apollo_technologies IS
  'technology_names de Apollo. Insumo complementario: las señales propias (tech radar, vacantes) tienen precedencia.';
COMMENT ON COLUMN public.companies.apollo_publicly_traded_symbol IS
  'Ticker segun Apollo. La fuente de verdad de is_public/ticker sigue siendo SEC EDGAR.';

-- Buscar empresas por tecnologia de Apollo sin escanear 500k filas.
CREATE INDEX IF NOT EXISTS idx_companies_apollo_technologies
  ON public.companies USING gin (apollo_technologies);

-- ── 2. Checkpoint de enrichment (mismo patron que v3.linkedin_company_enrichment) ──
-- Guarda el payload crudo y permite reanudar un barrido sin volver a pagar
-- por las empresas ya resueltas.

CREATE TABLE IF NOT EXISTS v3.apollo_company_enrichment (
  company_id        uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_domain  text,
  -- 'found' | 'not_found' | 'error'
  status            text NOT NULL,
  apollo_organization_id text,
  payload           jsonb,
  -- Que columnas de companies llenó efectivamente esta corrida. Permite
  -- auditar el aporte real del enrichment sin diffear la tabla entera.
  filled_columns    text[],
  error_message     text,
  attempts          integer NOT NULL DEFAULT 1,
  processed_at      timestamptz NOT NULL DEFAULT now(),
  next_attempt_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_apollo_company_enrichment_status
  ON v3.apollo_company_enrichment (status, processed_at DESC);

COMMENT ON TABLE v3.apollo_company_enrichment IS
  'Checkpoint del barrido de organizations/enrich. payload guarda la respuesta cruda de Apollo para poder promover campos nuevos sin volver a llamar.';
