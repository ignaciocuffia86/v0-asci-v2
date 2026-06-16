-- ═══════════════════════════════════════════════════════════════════════════════
-- V3 SCHEMA SETUP - Script completo para crear todas las tablas de v3
-- Ejecutar en Supabase SQL Editor
-- 
-- IMPORTANTE: 
-- 1. Si ya existen tablas, ejecutar primero: DROP SCHEMA v3 CASCADE;
-- 2. Ejecutar este script completo
--
-- ⚠️ NOTA (multitenant): El modelo de membresía definido más abajo
-- (workspace_members con roles 'admin'/'editor'/'viewer' y status
-- 'pending'/'active'/'rejected') quedó SUPERSEDED por la migración
-- supabase/migrations/20260616000000_v3_multitenant.sql, que:
--   • colapsa los roles a 'admin'/'member'
--   • normaliza el status a 'active'/'revoked' (sin flujo de solicitud por dominio)
--   • agrega la tabla v3.workspace_invitations (ingreso solo por invitación)
-- Si recreás el schema desde cero con este script, volvé a aplicar esa migración.
-- Los scripts 200_v3_schema.sql / 201_v3_rls.sql son un diseño anterior NO vigente.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 1: CREAR SCHEMA Y PERMISOS BASE
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS v3;

GRANT USAGE ON SCHEMA v3 TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA v3 GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA v3 GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA v3 GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 2: TABLA WORKSPACES
-- Campos requeridos por lib/v3/workspace.ts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  website_url TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 3: TABLA WORKSPACE_MEMBERS
-- Campos requeridos por lib/v3/workspace.ts y app/actions/v3/workspace.ts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected')),
  invited_by UUID REFERENCES auth.users(id),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_v3_workspace_members_user_id ON v3.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_v3_workspace_members_workspace_id ON v3.workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_v3_workspace_members_status ON v3.workspace_members(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 4: TABLAS DE DOCUMENTOS
-- Campos requeridos por app/actions/v3/documents.ts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.workspace_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pdf', 'pptx', 'docx', 'url')),
  source_url TEXT,
  storage_path TEXT,
  file_size INTEGER,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('uploading', 'processing', 'ready', 'error')),
  processing_progress INTEGER DEFAULT 0 CHECK (processing_progress >= 0 AND processing_progress <= 100),
  processing_error TEXT,
  extracted_text TEXT,
  ai_summary TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_workspace_documents_workspace_id ON v3.workspace_documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_v3_workspace_documents_status ON v3.workspace_documents(status);

CREATE TABLE IF NOT EXISTS v3.workspace_document_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES v3.workspace_documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  tag_type TEXT NOT NULL CHECK (tag_type IN ('industry', 'technology', 'process')),
  tag_value TEXT NOT NULL,
  tag_reference_id UUID,
  confidence NUMERIC(3,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_workspace_document_tags_document_id ON v3.workspace_document_tags(document_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 5: TABLA VALUE PROFILES
-- Campos requeridos por app/actions/v3/documents.ts y lib/v3/digest.ts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.workspace_value_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  profile_summary TEXT,
  target_industries JSONB DEFAULT '[]'::jsonb,
  target_technologies JSONB DEFAULT '[]'::jsonb,
  target_processes JSONB DEFAULT '[]'::jsonb,
  raw_analysis JSONB,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 6: TABLA BUYER PERSONAS
-- Campos requeridos por lib/v3/digest.ts
-- ════════════════════════════════════════════════���══════════════════════════════

CREATE TABLE IF NOT EXISTS v3.buyer_personas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  recommended_job_titles TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 7: TABLA CAMPAIGNS
-- Campos requeridos por app/actions/v3/campaigns.ts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('monitorear', 'prospectar', 'descubrir')),
  buyer_persona_id UUID REFERENCES v3.buyer_personas(id),
  buyer_persona_text TEXT,
  country_filter TEXT[],
  account_count INTEGER NOT NULL DEFAULT 0,
  max_accounts INTEGER NOT NULL DEFAULT 100,
  enable_tech_radar BOOLEAN NOT NULL DEFAULT true,
  enable_apollo BOOLEAN NOT NULL DEFAULT true,
  enable_email_agent BOOLEAN NOT NULL DEFAULT false,
  enable_signals_only BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_campaigns_workspace_id ON v3.campaigns(workspace_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 8: TABLA CAMPAIGN_ACCOUNTS
-- Campos requeridos por app/actions/v3/campaigns.ts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.campaign_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES v3.campaigns(id) ON DELETE CASCADE,
  company_id UUID NOT NULL, -- References public.companies (v2 shared table)
  status TEXT NOT NULL DEFAULT 'whitelisted' CHECK (status IN ('whitelisted', 'blacklisted', 'pending_match')),
  match_source TEXT NOT NULL DEFAULT 'manual' CHECK (match_source IN ('csv_import', 'manual', 'asci_recommendation')),
  prospection_status TEXT CHECK (prospection_status IN ('pending', 'in_progress', 'completed')),
  tech_radar_run_at TIMESTAMPTZ,
  apollo_run_at TIMESTAMPTZ,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by UUID NOT NULL REFERENCES auth.users(id),
  
  UNIQUE(campaign_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_v3_campaign_accounts_campaign_id ON v3.campaign_accounts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_v3_campaign_accounts_company_id ON v3.campaign_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_v3_campaign_accounts_status ON v3.campaign_accounts(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 9: TABLA CAMPAIGN_ACCOUNT_DIGEST
-- Campos requeridos por lib/v3/digest.ts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.campaign_account_digest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_account_id UUID NOT NULL UNIQUE REFERENCES v3.campaign_accounts(id) ON DELETE CASCADE,
  news_ids UUID[] DEFAULT '{}',
  implementation_ids UUID[] DEFAULT '{}',
  contact_ids UUID[] DEFAULT '{}',
  buyer_persona_id UUID REFERENCES v3.buyer_personas(id),
  signal_types_matched TEXT[] DEFAULT '{}',
  recommended_job_titles TEXT[] DEFAULT '{}',
  last_fetched_at TIMESTAMPTZ,
  new_items_count INTEGER NOT NULL DEFAULT 0,
  last_user_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 10: TABLA DICTIONARY_JOB_TITLES
-- Campos requeridos por lib/v3/digest.ts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.dictionary_job_titles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_title TEXT NOT NULL,
  process_id UUID,
  product_id UUID,
  seniority TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_dictionary_job_titles_process_id ON v3.dictionary_job_titles(process_id);
CREATE INDEX IF NOT EXISTS idx_v3_dictionary_job_titles_product_id ON v3.dictionary_job_titles(product_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 11: TABLAS MCP API KEYS Y LOGS
-- Campos requeridos por app/actions/v3/api-keys.ts y lib/v3/mcp-auth.ts
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.mcp_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_v3_mcp_api_keys_workspace_id ON v3.mcp_api_keys(workspace_id);
CREATE INDEX IF NOT EXISTS idx_v3_mcp_api_keys_key_hash ON v3.mcp_api_keys(key_hash);

CREATE TABLE IF NOT EXISTS v3.mcp_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES v3.mcp_api_keys(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_mcp_request_logs_api_key_id ON v3.mcp_request_logs(api_key_id);
CREATE INDEX IF NOT EXISTS idx_v3_mcp_request_logs_created_at ON v3.mcp_request_logs(created_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 12: HABILITAR RLS EN TODAS LAS TABLAS
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE v3.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.workspace_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.workspace_document_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.workspace_value_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.buyer_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.campaign_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.campaign_account_digest ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.dictionary_job_titles ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.mcp_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.mcp_request_logs ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 13: FUNCION HELPER PARA RLS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION v3.user_workspace_id(user_uuid UUID)
RETURNS UUID AS $$
  SELECT workspace_id FROM v3.workspace_members 
  WHERE user_id = user_uuid AND status = 'active'
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 14: POLITICAS RLS
-- ═══════════════════════════════════════════════════════════════════════════════

-- WORKSPACES
DROP POLICY IF EXISTS "Users can view their workspace" ON v3.workspaces;
CREATE POLICY "Users can view their workspace" ON v3.workspaces
  FOR SELECT USING (
    id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid())
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS "Users can create workspaces" ON v3.workspaces;
CREATE POLICY "Users can create workspaces" ON v3.workspaces
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Service role full access workspaces" ON v3.workspaces;
CREATE POLICY "Service role full access workspaces" ON v3.workspaces
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- WORKSPACE MEMBERS
DROP POLICY IF EXISTS "Users can view members" ON v3.workspace_members;
CREATE POLICY "Users can view members" ON v3.workspace_members
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid())
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Users can insert own membership" ON v3.workspace_members;
CREATE POLICY "Users can insert own membership" ON v3.workspace_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can manage members" ON v3.workspace_members;
CREATE POLICY "Admins can manage members" ON v3.workspace_members
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM v3.workspace_members 
      WHERE user_id = auth.uid() AND status = 'active' AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Service role full access members" ON v3.workspace_members;
CREATE POLICY "Service role full access members" ON v3.workspace_members
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- WORKSPACE DOCUMENTS
DROP POLICY IF EXISTS "Users can access documents" ON v3.workspace_documents;
CREATE POLICY "Users can access documents" ON v3.workspace_documents
  FOR ALL USING (workspace_id = v3.user_workspace_id(auth.uid()));

DROP POLICY IF EXISTS "Service role full access documents" ON v3.workspace_documents;
CREATE POLICY "Service role full access documents" ON v3.workspace_documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- WORKSPACE DOCUMENT TAGS
DROP POLICY IF EXISTS "Users can access document tags" ON v3.workspace_document_tags;
CREATE POLICY "Users can access document tags" ON v3.workspace_document_tags
  FOR ALL USING (workspace_id = v3.user_workspace_id(auth.uid()));

DROP POLICY IF EXISTS "Service role full access document tags" ON v3.workspace_document_tags;
CREATE POLICY "Service role full access document tags" ON v3.workspace_document_tags
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- WORKSPACE VALUE PROFILES
DROP POLICY IF EXISTS "Users can access value profiles" ON v3.workspace_value_profiles;
CREATE POLICY "Users can access value profiles" ON v3.workspace_value_profiles
  FOR ALL USING (workspace_id = v3.user_workspace_id(auth.uid()));

DROP POLICY IF EXISTS "Service role full access value profiles" ON v3.workspace_value_profiles;
CREATE POLICY "Service role full access value profiles" ON v3.workspace_value_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- BUYER PERSONAS
DROP POLICY IF EXISTS "Users can access buyer personas" ON v3.buyer_personas;
CREATE POLICY "Users can access buyer personas" ON v3.buyer_personas
  FOR ALL USING (workspace_id = v3.user_workspace_id(auth.uid()));

DROP POLICY IF EXISTS "Service role full access buyer personas" ON v3.buyer_personas;
CREATE POLICY "Service role full access buyer personas" ON v3.buyer_personas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- CAMPAIGNS
DROP POLICY IF EXISTS "Users can access campaigns" ON v3.campaigns;
CREATE POLICY "Users can access campaigns" ON v3.campaigns
  FOR ALL USING (workspace_id = v3.user_workspace_id(auth.uid()));

DROP POLICY IF EXISTS "Service role full access campaigns" ON v3.campaigns;
CREATE POLICY "Service role full access campaigns" ON v3.campaigns
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- CAMPAIGN ACCOUNTS
DROP POLICY IF EXISTS "Users can access campaign accounts" ON v3.campaign_accounts;
CREATE POLICY "Users can access campaign accounts" ON v3.campaign_accounts
  FOR ALL USING (
    campaign_id IN (
      SELECT id FROM v3.campaigns WHERE workspace_id = v3.user_workspace_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Service role full access campaign accounts" ON v3.campaign_accounts;
CREATE POLICY "Service role full access campaign accounts" ON v3.campaign_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- CAMPAIGN ACCOUNT DIGEST
DROP POLICY IF EXISTS "Users can access digest" ON v3.campaign_account_digest;
CREATE POLICY "Users can access digest" ON v3.campaign_account_digest
  FOR ALL USING (
    campaign_account_id IN (
      SELECT ca.id FROM v3.campaign_accounts ca
      JOIN v3.campaigns c ON ca.campaign_id = c.id
      WHERE c.workspace_id = v3.user_workspace_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Service role full access digest" ON v3.campaign_account_digest;
CREATE POLICY "Service role full access digest" ON v3.campaign_account_digest
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- DICTIONARY JOB TITLES (public read)
DROP POLICY IF EXISTS "Anyone can read dictionary" ON v3.dictionary_job_titles;
CREATE POLICY "Anyone can read dictionary" ON v3.dictionary_job_titles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access dictionary" ON v3.dictionary_job_titles;
CREATE POLICY "Service role full access dictionary" ON v3.dictionary_job_titles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- MCP API KEYS
DROP POLICY IF EXISTS "Admins can manage api keys" ON v3.mcp_api_keys;
CREATE POLICY "Admins can manage api keys" ON v3.mcp_api_keys
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM v3.workspace_members 
      WHERE user_id = auth.uid() AND status = 'active' AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Service role full access api keys" ON v3.mcp_api_keys;
CREATE POLICY "Service role full access api keys" ON v3.mcp_api_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- MCP REQUEST LOGS
DROP POLICY IF EXISTS "Admins can view logs" ON v3.mcp_request_logs;
CREATE POLICY "Admins can view logs" ON v3.mcp_request_logs
  FOR SELECT USING (
    api_key_id IN (
      SELECT id FROM v3.mcp_api_keys WHERE workspace_id IN (
        SELECT workspace_id FROM v3.workspace_members 
        WHERE user_id = auth.uid() AND status = 'active' AND role = 'admin'
      )
    )
  );

DROP POLICY IF EXISTS "Service role full access logs" ON v3.mcp_request_logs;
CREATE POLICY "Service role full access logs" ON v3.mcp_request_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PASO 15: PERMISOS FINALES
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT ALL ON ALL TABLES IN SCHEMA v3 TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA v3 TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA v3 TO anon, authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN DEL SCRIPT
-- Si ya tenias tablas anteriores, primero ejecuta: DROP SCHEMA v3 CASCADE;
-- ═══════════════════════════════════════════════════════════════════════════════
