-- ═══════════════════════════════════════════════════════════════════════════════
-- V3 MULTITENANT - Migración a modelo de invitación + 2 roles (admin/member)
-- Ejecutar en Supabase SQL Editor DESPUÉS de 300_v3_schema_setup.sql
--
-- IMPORTANTE:
--   - Idempotente: se puede correr varias veces sin romper nada.
--   - Solo toca el schema `v3`. NO afecta a v2 (public).
--   - Cambios:
--       1. Roles: editor/viewer -> member  (modelo de 2 roles)
--       2. Status: rejected -> revoked      (ya no hay flujo de rechazo de request)
--       3. Nueva tabla v3.workspace_invitations (invitación por email + token)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────
-- PASO 1: MIGRAR ROLES EXISTENTES (editor/viewer -> member)
-- ───────────────────────────────────────────────────────────────────────────────

-- Quitar el CHECK viejo antes de migrar datos (el nombre puede variar; lo buscamos)
DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'v3.workspace_members'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE v3.workspace_members DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

-- Colapsar editor + viewer en member
UPDATE v3.workspace_members
SET role = 'member'
WHERE role IN ('editor', 'viewer');

-- Nuevo default y nuevo CHECK de 2 roles
ALTER TABLE v3.workspace_members ALTER COLUMN role SET DEFAULT 'member';
ALTER TABLE v3.workspace_members
  ADD CONSTRAINT workspace_members_role_check CHECK (role IN ('admin', 'member'));

-- ───────────────────────────────────────────────────────────────────────────────
-- PASO 2: NORMALIZAR STATUS (pending/rejected -> active/revoked)
-- Ya no existe el flujo de "solicitar acceso"; todos los miembros existentes
-- que estaban activos siguen activos. Los pending/rejected quedan revocados.
-- ───────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'v3.workspace_members'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE v3.workspace_members DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

UPDATE v3.workspace_members
SET status = 'revoked'
WHERE status IN ('pending', 'rejected');

ALTER TABLE v3.workspace_members ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE v3.workspace_members
  ADD CONSTRAINT workspace_members_status_check CHECK (status IN ('active', 'revoked'));

-- ───────────────────────────────────────────────────────────────────────────────
-- PASO 3: TABLA DE INVITACIONES
-- Una invitación se crea por email (puede ser de un dominio externo).
-- Al registrarse/loguear con ese email, se reclama y se crea el member.
-- ───────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v3.workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by UUID NOT NULL REFERENCES auth.users(id),
  accepted_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ
);

-- Email normalizado en minúsculas para evitar duplicados por casing
CREATE INDEX IF NOT EXISTS idx_v3_workspace_invitations_email
  ON v3.workspace_invitations (lower(email));
CREATE INDEX IF NOT EXISTS idx_v3_workspace_invitations_workspace
  ON v3.workspace_invitations (workspace_id);
CREATE INDEX IF NOT EXISTS idx_v3_workspace_invitations_token
  ON v3.workspace_invitations (token);

-- Una sola invitación PENDIENTE por (workspace, email)
CREATE UNIQUE INDEX IF NOT EXISTS uq_v3_invitation_pending
  ON v3.workspace_invitations (workspace_id, lower(email))
  WHERE status = 'pending';

-- ───────────────────────────────────────────────────────────────────────────────
-- PASO 4: RLS — el acceso real se maneja vía service_role (admin client) en el
-- backend. Habilitamos RLS sin policies permisivas para denegar acceso directo
-- desde el cliente anon/authenticated (defense-in-depth, igual que el resto de v3).
-- ───────────────────────────────────────────────────────────────────────────────

ALTER TABLE v3.workspace_invitations ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN
-- ═══════════════════════════════════════════════════════════════════════════════
