-- ═══════════════════════════════════════════════════════════════════════════
-- ASCI V3 - Row Level Security Policies
-- Script: 201_v3_rls.sql
-- 
-- IMPORTANTE: Este script habilita RLS en TODAS las tablas de v3.
-- Patron base:
--   - SELECT: usuario es miembro activo del workspace
--   - INSERT/UPDATE/DELETE: usuario es admin o editor del workspace
--
-- Referencia: docs/BOT-BIGUA-LAT-ARCHITECTURE.md seccion 2.3
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- HELPER FUNCTION: Verificar membresia de workspace
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION v3.is_workspace_member(p_workspace_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM v3.workspace_members
    WHERE workspace_id = p_workspace_id
    AND user_id = auth.uid()
    AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION v3.is_workspace_editor_or_admin(p_workspace_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM v3.workspace_members
    WHERE workspace_id = p_workspace_id
    AND user_id = auth.uid()
    AND status = 'active'
    AND role IN ('admin', 'editor')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION v3.is_workspace_admin(p_workspace_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM v3.workspace_members
    WHERE workspace_id = p_workspace_id
    AND user_id = auth.uid()
    AND status = 'active'
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════════════════
-- 1. v3.workspaces
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_select" ON v3.workspaces;
CREATE POLICY "workspace_select" ON v3.workspaces
  FOR SELECT USING (v3.is_workspace_member(id));

DROP POLICY IF EXISTS "workspace_insert" ON v3.workspaces;
CREATE POLICY "workspace_insert" ON v3.workspaces
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "workspace_update" ON v3.workspaces;
CREATE POLICY "workspace_update" ON v3.workspaces
  FOR UPDATE USING (v3.is_workspace_admin(id));

-- ═══════════════════════════════════════════════════════════
-- 2. v3.workspace_members
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.workspace_members ENABLE ROW LEVEL SECURITY;

-- Ver miembros del workspace
DROP POLICY IF EXISTS "members_select" ON v3.workspace_members;
CREATE POLICY "members_select" ON v3.workspace_members
  FOR SELECT USING (v3.is_workspace_member(workspace_id));

-- Solo admin puede invitar/modificar miembros
DROP POLICY IF EXISTS "members_insert" ON v3.workspace_members;
CREATE POLICY "members_insert" ON v3.workspace_members
  FOR INSERT WITH CHECK (
    -- El primer miembro (admin) puede insertarse a si mismo
    (user_id = auth.uid() AND role = 'admin' AND NOT EXISTS (
      SELECT 1 FROM v3.workspace_members WHERE workspace_id = workspace_members.workspace_id
    ))
    OR
    -- Un admin existente puede invitar otros
    v3.is_workspace_admin(workspace_id)
  );

DROP POLICY IF EXISTS "members_update" ON v3.workspace_members;
CREATE POLICY "members_update" ON v3.workspace_members
  FOR UPDATE USING (v3.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "members_delete" ON v3.workspace_members;
CREATE POLICY "members_delete" ON v3.workspace_members
  FOR DELETE USING (v3.is_workspace_admin(workspace_id));

-- ═══════════════════════════════════════════════════════════
-- 3. v3.workspace_documents
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.workspace_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documents_select" ON v3.workspace_documents;
CREATE POLICY "documents_select" ON v3.workspace_documents
  FOR SELECT USING (v3.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "documents_insert" ON v3.workspace_documents;
CREATE POLICY "documents_insert" ON v3.workspace_documents
  FOR INSERT WITH CHECK (v3.is_workspace_editor_or_admin(workspace_id));

DROP POLICY IF EXISTS "documents_update" ON v3.workspace_documents;
CREATE POLICY "documents_update" ON v3.workspace_documents
  FOR UPDATE USING (v3.is_workspace_editor_or_admin(workspace_id));

DROP POLICY IF EXISTS "documents_delete" ON v3.workspace_documents;
CREATE POLICY "documents_delete" ON v3.workspace_documents
  FOR DELETE USING (v3.is_workspace_admin(workspace_id));

-- ═══════════════════════════════════════════════════════════
-- 4. v3.workspace_document_tags
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.workspace_document_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_tags_select" ON v3.workspace_document_tags;
CREATE POLICY "document_tags_select" ON v3.workspace_document_tags
  FOR SELECT USING (v3.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "document_tags_insert" ON v3.workspace_document_tags;
CREATE POLICY "document_tags_insert" ON v3.workspace_document_tags
  FOR INSERT WITH CHECK (v3.is_workspace_editor_or_admin(workspace_id));

DROP POLICY IF EXISTS "document_tags_update" ON v3.workspace_document_tags;
CREATE POLICY "document_tags_update" ON v3.workspace_document_tags
  FOR UPDATE USING (v3.is_workspace_editor_or_admin(workspace_id));

DROP POLICY IF EXISTS "document_tags_delete" ON v3.workspace_document_tags;
CREATE POLICY "document_tags_delete" ON v3.workspace_document_tags
  FOR DELETE USING (v3.is_workspace_editor_or_admin(workspace_id));

-- ═══════════════════════════════════════════════════════════
-- 5. v3.workspace_value_profiles
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.workspace_value_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "value_profiles_select" ON v3.workspace_value_profiles;
CREATE POLICY "value_profiles_select" ON v3.workspace_value_profiles
  FOR SELECT USING (v3.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "value_profiles_insert" ON v3.workspace_value_profiles;
CREATE POLICY "value_profiles_insert" ON v3.workspace_value_profiles
  FOR INSERT WITH CHECK (v3.is_workspace_editor_or_admin(workspace_id));

DROP POLICY IF EXISTS "value_profiles_update" ON v3.workspace_value_profiles;
CREATE POLICY "value_profiles_update" ON v3.workspace_value_profiles
  FOR UPDATE USING (v3.is_workspace_editor_or_admin(workspace_id));

-- ═══════════════════════════════════════════════════════════
-- 6. v3.dictionary_job_titles
-- Tabla global, no tiene workspace_id. Todos pueden leer.
-- Solo admins del sistema pueden escribir (o via migration)
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.dictionary_job_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_titles_select" ON v3.dictionary_job_titles;
CREATE POLICY "job_titles_select" ON v3.dictionary_job_titles
  FOR SELECT USING (true);  -- Todos los usuarios autenticados pueden leer

-- INSERT/UPDATE/DELETE solo via service_role (migraciones)

-- ═══════════════════════════════════════════════════════════
-- 7. v3.buyer_personas
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.buyer_personas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personas_select" ON v3.buyer_personas;
CREATE POLICY "personas_select" ON v3.buyer_personas
  FOR SELECT USING (v3.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "personas_insert" ON v3.buyer_personas;
CREATE POLICY "personas_insert" ON v3.buyer_personas
  FOR INSERT WITH CHECK (v3.is_workspace_editor_or_admin(workspace_id));

DROP POLICY IF EXISTS "personas_update" ON v3.buyer_personas;
CREATE POLICY "personas_update" ON v3.buyer_personas
  FOR UPDATE USING (v3.is_workspace_editor_or_admin(workspace_id));

DROP POLICY IF EXISTS "personas_delete" ON v3.buyer_personas;
CREATE POLICY "personas_delete" ON v3.buyer_personas
  FOR DELETE USING (v3.is_workspace_editor_or_admin(workspace_id));

-- ═══════════════════════════════════════════════════════════
-- 8. v3.campaigns
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaigns_select" ON v3.campaigns;
CREATE POLICY "campaigns_select" ON v3.campaigns
  FOR SELECT USING (v3.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "campaigns_insert" ON v3.campaigns;
CREATE POLICY "campaigns_insert" ON v3.campaigns
  FOR INSERT WITH CHECK (v3.is_workspace_editor_or_admin(workspace_id));

DROP POLICY IF EXISTS "campaigns_update" ON v3.campaigns;
CREATE POLICY "campaigns_update" ON v3.campaigns
  FOR UPDATE USING (v3.is_workspace_editor_or_admin(workspace_id));

DROP POLICY IF EXISTS "campaigns_delete" ON v3.campaigns;
CREATE POLICY "campaigns_delete" ON v3.campaigns
  FOR DELETE USING (v3.is_workspace_admin(workspace_id));

-- ═══════════════════════════════════════════════════════════
-- 9. v3.campaign_accounts
-- Hereda permisos de la campana
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.campaign_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_accounts_select" ON v3.campaign_accounts;
CREATE POLICY "campaign_accounts_select" ON v3.campaign_accounts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM v3.campaigns c
      WHERE c.id = campaign_accounts.campaign_id
      AND v3.is_workspace_member(c.workspace_id)
    )
  );

DROP POLICY IF EXISTS "campaign_accounts_insert" ON v3.campaign_accounts;
CREATE POLICY "campaign_accounts_insert" ON v3.campaign_accounts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM v3.campaigns c
      WHERE c.id = campaign_accounts.campaign_id
      AND v3.is_workspace_editor_or_admin(c.workspace_id)
    )
  );

DROP POLICY IF EXISTS "campaign_accounts_update" ON v3.campaign_accounts;
CREATE POLICY "campaign_accounts_update" ON v3.campaign_accounts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM v3.campaigns c
      WHERE c.id = campaign_accounts.campaign_id
      AND v3.is_workspace_editor_or_admin(c.workspace_id)
    )
  );

DROP POLICY IF EXISTS "campaign_accounts_delete" ON v3.campaign_accounts;
CREATE POLICY "campaign_accounts_delete" ON v3.campaign_accounts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM v3.campaigns c
      WHERE c.id = campaign_accounts.campaign_id
      AND v3.is_workspace_editor_or_admin(c.workspace_id)
    )
  );

-- ═══════════════════════════════════════════════════════════
-- 10. v3.campaign_account_digest
-- Hereda permisos del campaign_account
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.campaign_account_digest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "digest_select" ON v3.campaign_account_digest;
CREATE POLICY "digest_select" ON v3.campaign_account_digest
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM v3.campaign_accounts ca
      JOIN v3.campaigns c ON c.id = ca.campaign_id
      WHERE ca.id = campaign_account_digest.campaign_account_id
      AND v3.is_workspace_member(c.workspace_id)
    )
  );

-- INSERT/UPDATE/DELETE manejado por server-side (service_role)

-- ═══════════════════════════════════════════════════════════
-- 11. v3.csv_imports
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.csv_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "csv_imports_select" ON v3.csv_imports;
CREATE POLICY "csv_imports_select" ON v3.csv_imports
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM v3.campaigns c
      WHERE c.id = csv_imports.campaign_id
      AND v3.is_workspace_member(c.workspace_id)
    )
  );

DROP POLICY IF EXISTS "csv_imports_insert" ON v3.csv_imports;
CREATE POLICY "csv_imports_insert" ON v3.csv_imports
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM v3.campaigns c
      WHERE c.id = csv_imports.campaign_id
      AND v3.is_workspace_editor_or_admin(c.workspace_id)
    )
  );

DROP POLICY IF EXISTS "csv_imports_update" ON v3.csv_imports;
CREATE POLICY "csv_imports_update" ON v3.csv_imports
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM v3.campaigns c
      WHERE c.id = csv_imports.campaign_id
      AND v3.is_workspace_editor_or_admin(c.workspace_id)
    )
  );

-- ═══════════════════════════════════════════════════════════
-- 12. v3.csv_import_rows
-- Hereda de csv_imports
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.csv_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "csv_rows_select" ON v3.csv_import_rows;
CREATE POLICY "csv_rows_select" ON v3.csv_import_rows
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM v3.csv_imports ci
      JOIN v3.campaigns c ON c.id = ci.campaign_id
      WHERE ci.id = csv_import_rows.import_id
      AND v3.is_workspace_member(c.workspace_id)
    )
  );

DROP POLICY IF EXISTS "csv_rows_insert" ON v3.csv_import_rows;
CREATE POLICY "csv_rows_insert" ON v3.csv_import_rows
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM v3.csv_imports ci
      JOIN v3.campaigns c ON c.id = ci.campaign_id
      WHERE ci.id = csv_import_rows.import_id
      AND v3.is_workspace_editor_or_admin(c.workspace_id)
    )
  );

DROP POLICY IF EXISTS "csv_rows_update" ON v3.csv_import_rows;
CREATE POLICY "csv_rows_update" ON v3.csv_import_rows
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM v3.csv_imports ci
      JOIN v3.campaigns c ON c.id = ci.campaign_id
      WHERE ci.id = csv_import_rows.import_id
      AND v3.is_workspace_editor_or_admin(c.workspace_id)
    )
  );

-- ═══════════════════════════════════════════════════════════
-- 13. v3.prospection_jobs
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.prospection_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jobs_select" ON v3.prospection_jobs;
CREATE POLICY "jobs_select" ON v3.prospection_jobs
  FOR SELECT USING (v3.is_workspace_member(workspace_id));

-- INSERT/UPDATE manejado por server-side (Trigger.dev)

-- ═══════════════════════════════════════════════════════════
-- 14. v3.mcp_api_keys
-- Usuario solo ve sus propias keys
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.mcp_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_keys_select" ON v3.mcp_api_keys;
CREATE POLICY "api_keys_select" ON v3.mcp_api_keys
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "api_keys_insert" ON v3.mcp_api_keys;
CREATE POLICY "api_keys_insert" ON v3.mcp_api_keys
  FOR INSERT WITH CHECK (
    user_id = auth.uid() 
    AND v3.is_workspace_member(workspace_id)
  );

DROP POLICY IF EXISTS "api_keys_update" ON v3.mcp_api_keys;
CREATE POLICY "api_keys_update" ON v3.mcp_api_keys
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "api_keys_delete" ON v3.mcp_api_keys;
CREATE POLICY "api_keys_delete" ON v3.mcp_api_keys
  FOR DELETE USING (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════
-- 15. v3.mcp_request_logs
-- Usuario ve logs de sus propias keys
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.mcp_request_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "logs_select" ON v3.mcp_request_logs;
CREATE POLICY "logs_select" ON v3.mcp_request_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM v3.mcp_api_keys k
      WHERE k.id = mcp_request_logs.api_key_id
      AND k.user_id = auth.uid()
    )
  );

-- INSERT solo via server-side

-- ═══════════════════════════════════════════════════════════
-- 16. v3.email_drafts
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.email_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drafts_select" ON v3.email_drafts;
CREATE POLICY "drafts_select" ON v3.email_drafts
  FOR SELECT USING (v3.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "drafts_insert" ON v3.email_drafts;
CREATE POLICY "drafts_insert" ON v3.email_drafts
  FOR INSERT WITH CHECK (v3.is_workspace_editor_or_admin(workspace_id));

DROP POLICY IF EXISTS "drafts_update" ON v3.email_drafts;
CREATE POLICY "drafts_update" ON v3.email_drafts
  FOR UPDATE USING (v3.is_workspace_editor_or_admin(workspace_id));

-- ═══════════════════════════════════════════════════════════
-- 17. v3.email_sequences
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.email_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sequences_select" ON v3.email_sequences;
CREATE POLICY "sequences_select" ON v3.email_sequences
  FOR SELECT USING (v3.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "sequences_insert" ON v3.email_sequences;
CREATE POLICY "sequences_insert" ON v3.email_sequences
  FOR INSERT WITH CHECK (v3.is_workspace_editor_or_admin(workspace_id));

DROP POLICY IF EXISTS "sequences_update" ON v3.email_sequences;
CREATE POLICY "sequences_update" ON v3.email_sequences
  FOR UPDATE USING (v3.is_workspace_editor_or_admin(workspace_id));

-- ═══════════════════════════════════════════════════════════
-- 18. v3.webhook_endpoints
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.webhook_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhooks_select" ON v3.webhook_endpoints;
CREATE POLICY "webhooks_select" ON v3.webhook_endpoints
  FOR SELECT USING (v3.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "webhooks_insert" ON v3.webhook_endpoints;
CREATE POLICY "webhooks_insert" ON v3.webhook_endpoints
  FOR INSERT WITH CHECK (v3.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "webhooks_update" ON v3.webhook_endpoints;
CREATE POLICY "webhooks_update" ON v3.webhook_endpoints
  FOR UPDATE USING (v3.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "webhooks_delete" ON v3.webhook_endpoints;
CREATE POLICY "webhooks_delete" ON v3.webhook_endpoints
  FOR DELETE USING (v3.is_workspace_admin(workspace_id));

-- ═══════════════════════════════════════════════════════════
-- 19. v3.email_domain_config
-- ═══════════════════════════════════════════════════════════

ALTER TABLE v3.email_domain_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_config_select" ON v3.email_domain_config;
CREATE POLICY "email_config_select" ON v3.email_domain_config
  FOR SELECT USING (v3.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "email_config_insert" ON v3.email_domain_config;
CREATE POLICY "email_config_insert" ON v3.email_domain_config
  FOR INSERT WITH CHECK (v3.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "email_config_update" ON v3.email_domain_config;
CREATE POLICY "email_config_update" ON v3.email_domain_config
  FOR UPDATE USING (v3.is_workspace_admin(workspace_id));

-- ═══════════════════════════════════════════════════════════
-- FIN DE RLS
-- ═══════════════════════════════════════════════════════════
