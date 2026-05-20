-- ═══════════════════════════════════════════════════════════════════════════
-- ASCI V3 - Schema Creation
-- Script: 200_v3_schema.sql
-- 
-- IMPORTANTE: Este script crea TODAS las tablas en el schema v3.
-- NO modifica ninguna tabla del schema public (v2).
-- Puede ejecutarse multiples veces (usa IF NOT EXISTS).
--
-- Referencia: docs/BOT-BIGUA-LAT-ARCHITECTURE.md seccion 2.3
-- ═══════════════════════════════════════════════════════════════════════════

-- Crear schema v3 si no existe
CREATE SCHEMA IF NOT EXISTS v3;

-- ═══════════════════════════════════════════════════════════
-- 1. WORKSPACE Y MULTI-TENANT
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.workspaces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain        TEXT UNIQUE NOT NULL,       -- extraido del email del primer usuario
  name          TEXT NOT NULL,              -- nombre de la empresa
  website_url   TEXT,
  logo_url      TEXT,
  account_count INTEGER DEFAULT 0,          -- total de cuentas en todas las campanias
  max_accounts  INTEGER DEFAULT 100,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v3.workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT CHECK (role IN ('admin', 'editor', 'viewer')) NOT NULL,
  status        TEXT CHECK (status IN ('pending', 'active', 'rejected')) DEFAULT 'pending',
  invited_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);

-- Indices para workspace_members
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON v3.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON v3.workspace_members(workspace_id);

-- ═══════════════════════════════════════════════════════════
-- 2. DOCUMENTOS DEL WORKSPACE
-- Separado de user_documents de v2. Compartido entre miembros.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.workspace_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  uploaded_by       UUID REFERENCES auth.users(id),
  filename          TEXT NOT NULL,
  file_url          TEXT NOT NULL,          -- Supabase Storage URL
  file_size         INTEGER,                -- bytes
  mime_type         TEXT,
  document_type     TEXT CHECK (document_type IN (
    'landing', 'case_study', 'brochure', 'deck', 'other'
  )),

  -- Output del procesamiento IA (matcheado contra el diccionario de v2)
  processing_status TEXT CHECK (processing_status IN (
    'pending', 'processing', 'completed', 'failed'
  )) DEFAULT 'pending',
  extracted_industries   TEXT[],
  extracted_processes    TEXT[],            -- nombres de dictionary_processes
  extracted_technologies TEXT[],            -- nombres de dictionary_products
  extracted_kpis         TEXT[],
  extracted_roi_signals  TEXT[],
  raw_extracted_text     TEXT,

  version      INTEGER DEFAULT 1,           -- incrementa al reprocesar
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_documents_workspace ON v3.workspace_documents(workspace_id);

-- Tags extraidos de los documentos (analogo a document_tags de v2)
CREATE TABLE IF NOT EXISTS v3.workspace_document_tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES v3.workspace_documents(id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  tag_type        TEXT CHECK (tag_type IN ('industry', 'technology', 'process')) NOT NULL,
  tag_value       TEXT NOT NULL,
  tag_reference_id UUID,                       -- ID en dictionary_processes o dictionary_products de v2
  confidence      REAL DEFAULT 0.5,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_tags_document ON v3.workspace_document_tags(document_id);
CREATE INDEX IF NOT EXISTS idx_document_tags_workspace ON v3.workspace_document_tags(workspace_id);

-- Perfil de valor consolidado del workspace (analogo a user_value_profiles de v2)
CREATE TABLE IF NOT EXISTS v3.workspace_value_profiles (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  profile_summary    TEXT,
  target_industries  JSONB DEFAULT '[]'::jsonb,
  target_technologies JSONB DEFAULT '[]'::jsonb,
  target_processes   JSONB DEFAULT '[]'::jsonb,
  raw_analysis       JSONB,
  generated_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id)
);

-- ═══════════════════════════════════════════════════════════
-- 3. JOB TITLES POR PROCESO/TECNOLOGIA
-- Pre-laburados en el diccionario. ASCI infiere nuevos con IA.
-- Referencia: public.dictionary_processes y public.dictionary_products
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.dictionary_job_titles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Uno de estos dos debe estar presente (o ambos)
  -- NO usamos FK cross-schema para evitar problemas de dependencia
  process_id  UUID,                           -- ID en public.dictionary_processes
  product_id  UUID,                           -- ID en public.dictionary_products
  
  job_title   TEXT NOT NULL,                  -- "CTO", "VP Engineering", "Head of IT"
  seniority   TEXT CHECK (seniority IN (
    'c_level', 'vp', 'director', 'manager', 'senior', 'individual_contributor'
  )),
  
  -- Metadata
  is_inferred BOOLEAN DEFAULT false,          -- true = inferido por IA, false = pre-cargado
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT at_least_one_reference CHECK (
    process_id IS NOT NULL OR product_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_job_titles_process ON v3.dictionary_job_titles(process_id) WHERE process_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_titles_product ON v3.dictionary_job_titles(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_titles_title ON v3.dictionary_job_titles(job_title);

-- ═══════════════════════════════════════════════════════════
-- 4. BUYER PERSONAS
-- Por campana. Inferidas de docs. Editables por el usuario.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.buyer_personas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  campaign_id   UUID,                       -- FK a v3.campaigns (se agrega con ALTER luego)
  name          TEXT NOT NULL,              -- "CTO en SaaS Fintech"

  -- Inferido de workspace_documents cruzado con el diccionario de v2
  target_processes       TEXT[],            -- nombres de public.dictionary_processes
  target_technologies    TEXT[],            -- nombres de public.dictionary_products
  target_industries      TEXT[],
  kpi_signals            TEXT[],
  roi_signals            TEXT[],

  -- Job titles recomendados
  recommended_job_titles TEXT[],

  -- Señales que se consideran relevantes para el digest de esta persona
  relevant_signal_types  TEXT[],

  is_inferred  BOOLEAN DEFAULT true,        -- true = generado por ASCI, false = editado por usuario
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buyer_personas_workspace ON v3.buyer_personas(workspace_id);

-- ═══════════════════════════════════════════════════════════
-- 5. CAMPANIAS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES auth.users(id),
  name          TEXT NOT NULL,

  type TEXT CHECK (type IN (
    'monitor',   -- solo señales de cuentas conocidas. Sin DMs, sin Tech Radar on-demand
    'prospect',  -- buscar DMs en cuentas conocidas: Tech Radar + Apollo + email agent
    'discover'   -- ASCI recomienda cuentas con señales: todo lo de prospect + recomendaciones
  )) NOT NULL,

  -- Solo para prospect / discover
  buyer_persona_id UUID,                    -- FK a v3.buyer_personas (post ALTER)
  country_filter   TEXT[],

  -- Feature flags calculados al crear segun tipo. Editables.
  enable_tech_radar   BOOLEAN DEFAULT false,
  enable_apollo       BOOLEAN DEFAULT false,
  enable_email_agent  BOOLEAN DEFAULT false,
  enable_signals_only BOOLEAN DEFAULT true,

  status  TEXT CHECK (status IN ('active', 'paused', 'archived')) DEFAULT 'active',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_workspace ON v3.campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON v3.campaigns(status) WHERE status = 'active';

-- FKs circulares se agregan despues de crear ambas tablas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_buyer_persona_campaign' AND table_schema = 'v3'
  ) THEN
    ALTER TABLE v3.buyer_personas
      ADD CONSTRAINT fk_buyer_persona_campaign
      FOREIGN KEY (campaign_id) REFERENCES v3.campaigns(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_campaign_buyer_persona' AND table_schema = 'v3'
  ) THEN
    ALTER TABLE v3.campaigns
      ADD CONSTRAINT fk_campaign_buyer_persona
      FOREIGN KEY (buyer_persona_id) REFERENCES v3.buyer_personas(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- 6. CUENTAS EN CAMPANIAS
-- Una company puede estar en multiples campanias del mismo workspace.
-- Puede ser whitelisted en una y blacklisted en otra.
-- Referencia: public.companies (sin FK cross-schema)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.campaign_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID REFERENCES v3.campaigns(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL,               -- referencia a public.companies (sin FK cross-schema)

  -- Estado en esta campania
  list_status TEXT CHECK (list_status IN ('whitelisted', 'blacklisted')) DEFAULT 'whitelisted',
  match_source TEXT CHECK (match_source IN (
    'csv_import',          -- vino de un CSV upload
    'manual',              -- el usuario lo agrego manualmente
    'asci_recommendation'  -- ASCI lo recomendo (solo para campanias discover)
  )),

  -- Estado de prospeccion (solo relevante para prospect / discover)
  prospection_status TEXT CHECK (prospection_status IN (
    'pending',     -- en espera de ser seleccionada
    'queued',      -- encolada en Trigger.dev
    'running',     -- job en ejecucion
    'completed',   -- tech radar corrido, datos disponibles
    'failed'       -- fallo el job
  )) DEFAULT 'pending',

  tech_radar_run_at   TIMESTAMPTZ,
  apollo_checked_at   TIMESTAMPTZ,

  -- Para cron mensual
  last_refresh_at  TIMESTAMPTZ,
  next_refresh_at  TIMESTAMPTZ,             -- = last_refresh_at + 30 dias

  added_at  TIMESTAMPTZ DEFAULT NOW(),
  added_by  UUID REFERENCES auth.users(id),

  UNIQUE (campaign_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_accounts_campaign ON v3.campaign_accounts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_accounts_company ON v3.campaign_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_campaign_accounts_status ON v3.campaign_accounts(prospection_status) WHERE prospection_status IN ('pending', 'queued', 'running');

-- ═══════════════════════════════════════════════════════════
-- 7. DIGEST FILTRADO POR CAMPANA/CUENTA
-- Capa por encima del cache global de v2, filtrada por buyer_persona
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.campaign_account_digest (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_account_id  UUID REFERENCES v3.campaign_accounts(id) ON DELETE CASCADE UNIQUE,

  -- Referencias al cache global de v2 (solo IDs, no duplicamos contenido)
  -- IMPORTANTE: Para leer company_news y company_implementations desde v3,
  -- usar service_role key porque las RLS de v2 filtran por bookmarks.
  news_ids             UUID[],              -- IDs de public.company_news
  implementation_ids   UUID[],              -- IDs de public.company_implementations
  contact_ids          UUID[],              -- IDs de public.apollo_contacts_cache (DMs disponibles)

  -- Metadatos del filtrado
  buyer_persona_id     UUID,                -- referencia a v3.buyer_personas
  signal_types_matched TEXT[],              -- señales que matchearon con el buyer_persona

  -- Cargos recomendados (si no hay contactos en cache)
  recommended_job_titles TEXT[],            -- calculados desde v3.dictionary_job_titles

  -- Timeline para badge "NUEVAS"
  last_fetched_at   TIMESTAMPTZ,
  new_items_count   INTEGER DEFAULT 0,
  last_user_seen_at TIMESTAMPTZ,            -- se actualiza cuando el usuario abre el digest

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- 8. CSV IMPORT DE CUENTAS
-- Completamente separado del ETL de v2 (import_batches / import_rows)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.csv_imports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID REFERENCES v3.campaigns(id) ON DELETE CASCADE,
  uploaded_by  UUID REFERENCES auth.users(id),
  filename     TEXT NOT NULL,
  total_rows   INTEGER DEFAULT 0,
  status       TEXT CHECK (status IN (
    'processing', 'pending_review', 'completed', 'failed'
  )) DEFAULT 'processing',

  -- Resumen del matching
  auto_matched  INTEGER DEFAULT 0,
  needs_review  INTEGER DEFAULT 0,
  no_match      INTEGER DEFAULT 0,
  ignored       INTEGER DEFAULT 0,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csv_imports_campaign ON v3.csv_imports(campaign_id);

CREATE TABLE IF NOT EXISTS v3.csv_import_rows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id   UUID REFERENCES v3.csv_imports(id) ON DELETE CASCADE,
  row_number  INTEGER NOT NULL,

  -- Datos crudos
  raw_company_name  TEXT NOT NULL,
  raw_domain        TEXT,

  -- Datos normalizados (calculados al procesar)
  normalized_name   TEXT,                  -- lowercase, sin sufijos legales, sin puntuacion
  normalized_domain TEXT,                  -- sin www, sin protocolo

  -- Resultado del matching
  match_status TEXT CHECK (match_status IN (
    'auto_matched',  -- dominio exacto + nombre similar >= 85%
    'needs_review',  -- dominio exacto pero nombre diferente, o nombre exacto sin dominio
    'ambiguous',     -- multiples candidatos con score similar
    'no_match',      -- ningun match encontrado en public.companies
    'confirmed',     -- usuario confirmo manualmente
    'ignored'        -- usuario descarto esta fila
  )) DEFAULT 'needs_review',

  matched_company_id  UUID,                -- referencia a public.companies (sin FK cross-schema)
  match_candidates    JSONB,               -- [{company_id, name, domain, score, method}]
  match_method        TEXT,                -- 'domain_exact', 'name_fuzzy', 'domain_fuzzy', 'manual'
  match_score         FLOAT,               -- 0.0 a 1.0

  reviewed_at  TIMESTAMPTZ,
  reviewed_by  UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_csv_import_rows_import ON v3.csv_import_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_csv_import_rows_status ON v3.csv_import_rows(match_status);

-- ═══════════════════════════════════════════════════════════
-- 9. COLA DE PROSPECCION (jobs de Trigger.dev)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.prospection_jobs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID REFERENCES v3.workspaces(id),
  campaign_account_id  UUID REFERENCES v3.campaign_accounts(id),

  job_type TEXT CHECK (job_type IN (
    'tech_radar',         -- ejecuta lib/tech-radar.ts existente (Parallel o Gemini fallback)
    'apollo_cache_check'  -- verifica y trae contactos del cache de Apollo
  )) NOT NULL,

  status TEXT CHECK (status IN (
    'pending', 'running', 'completed', 'failed'
  )) DEFAULT 'pending',

  trigger_job_id  TEXT,                    -- ID del job en Trigger.dev para tracking
  used_fallback   BOOLEAN DEFAULT false,   -- true si se uso Gemini en lugar de Parallel

  result_summary  JSONB,   -- { news_found: 3, techs: ["Salesforce"], contacts_cached: 5 }
  error_message   TEXT,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prospection_jobs_status ON v3.prospection_jobs(status) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_prospection_jobs_workspace ON v3.prospection_jobs(workspace_id);

-- ═══════════════════════════════════════════════════════════
-- 10. MCP API KEYS
-- 1 key por usuario. Scoped al workspace_id.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.mcp_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  key_hash    TEXT UNIQUE NOT NULL,         -- SHA-256. El key en claro se muestra una sola vez al crear
  key_prefix  TEXT NOT NULL,                -- primeros 8 chars para identificar ("asci_k1_...")
  name        TEXT,                         -- nombre descriptivo ("Claude en Cursor")

  scopes  TEXT[] DEFAULT ARRAY['read'],     -- ['read', 'write', 'email_draft']

  -- Rate limiting basado en plan del workspace
  rate_limit_per_hour  INTEGER DEFAULT 100,

  is_active         BOOLEAN DEFAULT true,
  last_used_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,            -- null = no expira
  revoked_at        TIMESTAMPTZ,
  revocation_reason TEXT,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (workspace_id, user_id)            -- 1 key por usuario
);

CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_hash ON v3.mcp_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_workspace ON v3.mcp_api_keys(workspace_id);

-- ═══════════════════════════════════════════════════════════
-- 11. REQUEST LOGS PARA MCP (rate limiting y auditing)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.mcp_request_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id  UUID REFERENCES v3.mcp_api_keys(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  method      TEXT NOT NULL,
  status_code INTEGER,
  duration_ms INTEGER,
  request_body_preview TEXT,                -- primeros 500 chars
  error_message TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_request_logs_key ON v3.mcp_request_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_mcp_request_logs_created ON v3.mcp_request_logs(created_at DESC);

-- Particionar o limpiar periodicamente (sugerencia: borrar logs > 30 dias)

-- ═══════════════════════════════════════════════════════════
-- 12. BORRADORES Y SECUENCIAS DE EMAIL (para post-MVP, pero creamos la estructura)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.email_drafts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  campaign_account_id  UUID REFERENCES v3.campaign_accounts(id),

  -- Destinatario
  contact_id    UUID,                       -- referencia a public.contacts
  to_email      TEXT NOT NULL,
  to_name       TEXT,
  subject       TEXT NOT NULL,
  body_html     TEXT NOT NULL,
  body_text     TEXT,

  -- Contexto usado para generar el draft
  icebreaker_signals  JSONB,               -- señales usadas como contexto
  buyer_persona_id    UUID,                -- referencia a v3.buyer_personas

  -- Estado de aprobacion
  status TEXT CHECK (status IN (
    'pending_approval',  -- esperando al usuario en el dashboard
    'approved',          -- usuario aprobo
    'rejected',          -- usuario rechazo
    'sent',              -- enviado via Gmail
    'failed'             -- fallo el envio
  )) DEFAULT 'pending_approval',

  generated_by  TEXT CHECK (generated_by IN ('agent', 'copilot', 'user')) DEFAULT 'agent',

  reviewed_at  TIMESTAMPTZ,
  reviewed_by  UUID REFERENCES auth.users(id),
  sent_at      TIMESTAMPTZ,

  -- TBD: threading y reply tracking (post-MVP)
  gmail_message_id  TEXT,
  gmail_thread_id   TEXT,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_drafts_workspace ON v3.email_drafts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_email_drafts_status ON v3.email_drafts(status) WHERE status = 'pending_approval';

CREATE TABLE IF NOT EXISTS v3.email_sequences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  campaign_id   UUID REFERENCES v3.campaigns(id),
  name          TEXT NOT NULL,
  steps         JSONB NOT NULL,  -- [{day: 0, subject: "...", body: "..."}, {day: 3, ...}]
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- 13. WEBHOOKS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.webhook_endpoints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  secret_hash   TEXT NOT NULL,             -- SHA-256. El agente verifica HMAC-SHA256
  events        TEXT[] NOT NULL,
  is_active     BOOLEAN DEFAULT true,
  last_fired_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- 14. CONFIGURACION DKIM/SPF
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.email_domain_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  domain        TEXT NOT NULL,

  spf_valid     BOOLEAN DEFAULT false,
  dkim_valid    BOOLEAN DEFAULT false,
  dmarc_valid   BOOLEAN DEFAULT false,

  last_checked_at  TIMESTAMPTZ,
  check_details    JSONB,   -- { spf_record: "...", dkim_selector: "...", errors: [] }

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (workspace_id, domain)
);

-- ═══════════════════════════════════════════════════════════
-- FIN DEL SCHEMA v3
-- ═══════════════════════════════════════════════════════════

COMMENT ON SCHEMA v3 IS 'ASCI v3 (BOT.BIGUA.LAT) - Aislado de v2. No modifica public.*';
