-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRACION 302: Buyer/User Personas + Cargos recomendados en DOCS v3
-- ═══════════════════════════════════════════════════════════════════════════════
-- Aditiva e idempotente. NO altera tablas del schema public (v2).
-- Todo vive en el schema v3.
--
-- Objetivo:
--   1. Guardar la persona/cargos inferidos POR DOCUMENTO (columnas en workspace_documents)
--   2. Permitir UNA persona consolidada AUTO-GESTIONADA por workspace en buyer_personas,
--      sin pisar las personas creadas manualmente por el usuario (campañas).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────
-- 1) Columnas por documento en v3.workspace_documents
-- ───────────────────────────────────────────────────────────────────────────────
-- inferred_persona: { name, type: 'buyer'|'user', description, pains[], goals[] }
ALTER TABLE v3.workspace_documents
  ADD COLUMN IF NOT EXISTS inferred_persona JSONB;

-- recommended_job_titles: cargos inferidos por la IA para este documento
ALTER TABLE v3.workspace_documents
  ADD COLUMN IF NOT EXISTS recommended_job_titles TEXT[] NOT NULL DEFAULT '{}';

-- ───────────────────────────────────────────────────────────────────────────────
-- 2) Marcar persona consolidada como auto-gestionada en v3.buyer_personas
-- ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE v3.buyer_personas
  ADD COLUMN IF NOT EXISTS is_auto BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE v3.buyer_personas
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'auto_docs'));

-- Garantiza UNA sola persona auto por workspace (upsert target).
-- Las personas manuales (is_auto = false) no se ven afectadas por este índice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_v3_buyer_personas_auto_per_workspace
  ON v3.buyer_personas (workspace_id)
  WHERE is_auto = true;
