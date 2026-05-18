-- ============================================
-- V3 Schema Setup
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Create schema
CREATE SCHEMA IF NOT EXISTS v3;

-- 2. Grant permissions
GRANT USAGE ON SCHEMA v3 TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA v3 TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA v3 TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA v3 TO anon, authenticated, service_role;

-- 3. Default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA v3 GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA v3 GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA v3 GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- ============================================
-- V3 Tables
-- ============================================

-- Workspaces
CREATE TABLE IF NOT EXISTS v3.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workspace Members
CREATE TABLE IF NOT EXISTS v3.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

-- Workspace Documents
CREATE TABLE IF NOT EXISTS v3.workspace_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_path TEXT,
  file_type TEXT,
  file_size INTEGER,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  content TEXT,
  metadata JSONB DEFAULT '{}',
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workspace Value Profiles (generated from documents)
CREATE TABLE IF NOT EXISTS v3.workspace_value_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  profile_summary TEXT,
  target_technologies TEXT[],
  target_processes TEXT[],
  target_industries TEXT[],
  ideal_company_size TEXT[],
  value_propositions JSONB DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id)
);

-- Campaigns
CREATE TABLE IF NOT EXISTS v3.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'outbound' CHECK (type IN ('outbound', 'inbound', 'abm')),
  status TEXT DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  buyer_persona_id UUID,
  settings JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign Accounts (companies in a campaign)
CREATE TABLE IF NOT EXISTS v3.campaign_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES v3.campaigns(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id),
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'researching', 'ready', 'contacted', 'qualified', 'disqualified')),
  prospection_status TEXT DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  notes TEXT,
  tech_radar_run_at TIMESTAMPTZ,
  apollo_run_at TIMESTAMPTZ,
  last_digest_at TIMESTAMPTZ,
  digest_new_items INTEGER DEFAULT 0,
  assigned_to UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, company_id)
);

-- Campaign Imports (CSV imports tracking)
CREATE TABLE IF NOT EXISTS v3.campaign_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES v3.campaigns(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  total_rows INTEGER DEFAULT 0,
  processed_rows INTEGER DEFAULT 0,
  matched_rows INTEGER DEFAULT 0,
  created_rows INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  imported_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- MCP API Keys
CREATE TABLE IF NOT EXISTS v3.mcp_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  permissions JSONB DEFAULT '["read"]',
  rate_limit INTEGER DEFAULT 60,
  last_used_at TIMESTAMPTZ,
  request_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- MCP Request Logs
CREATE TABLE IF NOT EXISTS v3.mcp_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES v3.mcp_api_keys(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON v3.workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON v3.workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_documents_workspace ON v3.workspace_documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace ON v3.campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaign_accounts_campaign ON v3.campaign_accounts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_accounts_company ON v3.campaign_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_workspace ON v3.mcp_api_keys(workspace_id);

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE v3.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.workspace_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.workspace_value_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.campaign_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.campaign_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.mcp_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.mcp_request_logs ENABLE ROW LEVEL SECURITY;

-- Workspaces: users can see workspaces they are members of
CREATE POLICY "Users can view own workspaces" ON v3.workspaces
  FOR SELECT USING (
    id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create workspaces" ON v3.workspaces
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can update workspaces" ON v3.workspaces
  FOR UPDATE USING (
    id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Workspace Members: users can see members of their workspaces
CREATE POLICY "Users can view workspace members" ON v3.workspace_members
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert themselves as members" ON v3.workspace_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can manage members" ON v3.workspace_members
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Documents: users can manage documents in their workspaces
CREATE POLICY "Users can view workspace documents" ON v3.workspace_documents
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Editors can manage documents" ON v3.workspace_documents
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'editor'))
  );

-- Value Profiles: users can view profiles of their workspaces
CREATE POLICY "Users can view value profiles" ON v3.workspace_value_profiles
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Editors can manage value profiles" ON v3.workspace_value_profiles
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'editor'))
  );

-- Campaigns: users can view campaigns in their workspaces
CREATE POLICY "Users can view campaigns" ON v3.campaigns
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Editors can manage campaigns" ON v3.campaigns
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'editor'))
  );

-- Campaign Accounts: users can view accounts in their campaigns
CREATE POLICY "Users can view campaign accounts" ON v3.campaign_accounts
  FOR SELECT USING (
    campaign_id IN (
      SELECT id FROM v3.campaigns WHERE workspace_id IN (
        SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Editors can manage campaign accounts" ON v3.campaign_accounts
  FOR ALL USING (
    campaign_id IN (
      SELECT id FROM v3.campaigns WHERE workspace_id IN (
        SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'editor')
      )
    )
  );

-- Campaign Imports
CREATE POLICY "Users can view imports" ON v3.campaign_imports
  FOR SELECT USING (
    campaign_id IN (
      SELECT id FROM v3.campaigns WHERE workspace_id IN (
        SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Editors can manage imports" ON v3.campaign_imports
  FOR ALL USING (
    campaign_id IN (
      SELECT id FROM v3.campaigns WHERE workspace_id IN (
        SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid() AND role IN ('admin', 'editor')
      )
    )
  );

-- MCP API Keys
CREATE POLICY "Users can view api keys" ON v3.mcp_api_keys
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can manage api keys" ON v3.mcp_api_keys
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid() AND role = 'admin')
  );

-- MCP Request Logs: admins can view logs
CREATE POLICY "Admins can view request logs" ON v3.mcp_request_logs
  FOR SELECT USING (
    api_key_id IN (
      SELECT id FROM v3.mcp_api_keys WHERE workspace_id IN (
        SELECT workspace_id FROM v3.workspace_members WHERE user_id = auth.uid() AND role = 'admin'
      )
    )
  );

-- Service role bypass for all tables
CREATE POLICY "Service role full access workspaces" ON v3.workspaces FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access members" ON v3.workspace_members FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access documents" ON v3.workspace_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access profiles" ON v3.workspace_value_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access campaigns" ON v3.campaigns FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access accounts" ON v3.campaign_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access imports" ON v3.campaign_imports FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access api_keys" ON v3.mcp_api_keys FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access logs" ON v3.mcp_request_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
