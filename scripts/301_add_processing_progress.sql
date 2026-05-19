-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRACION: Agregar processing_progress a workspace_documents
-- Ejecutar en Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- Agregar columna processing_progress si no existe
ALTER TABLE v3.workspace_documents 
ADD COLUMN IF NOT EXISTS processing_progress INTEGER DEFAULT 0 
CHECK (processing_progress >= 0 AND processing_progress <= 100);

-- Actualizar documentos existentes en estado "processing" a 0%
UPDATE v3.workspace_documents 
SET processing_progress = 0 
WHERE status = 'processing' AND processing_progress IS NULL;

-- Actualizar documentos existentes en estado "ready" a 100%
UPDATE v3.workspace_documents 
SET processing_progress = 100 
WHERE status = 'ready' AND (processing_progress IS NULL OR processing_progress < 100);
