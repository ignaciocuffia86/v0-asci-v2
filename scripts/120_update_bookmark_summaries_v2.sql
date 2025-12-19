-- Migración para mejorar bookmark_summaries con soporte para Brief Ejecutivo v2
-- Agrega campos para FIT score, riesgos, evidencia, HTML editable y hash de contexto

-- Agregar nuevas columnas a bookmark_summaries
ALTER TABLE bookmark_summaries 
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS fit_score INTEGER,
ADD COLUMN IF NOT EXISTS fit_reasons JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS risks JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS evidence JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS html_content TEXT,
ADD COLUMN IF NOT EXISTS context_hash TEXT,
ADD COLUMN IF NOT EXISTS user_email TEXT;

-- Índice para búsqueda por context_hash (para caching)
CREATE INDEX IF NOT EXISTS idx_bookmark_summaries_context_hash 
ON bookmark_summaries(context_hash);

-- Comentarios para documentación
COMMENT ON COLUMN bookmark_summaries.version IS 'Versión del brief (incrementa al regenerar)';
COMMENT ON COLUMN bookmark_summaries.fit_score IS 'Score de FIT/ICP match (0-100)';
COMMENT ON COLUMN bookmark_summaries.fit_reasons IS 'Top 3 razones del FIT score con evidencia';
COMMENT ON COLUMN bookmark_summaries.risks IS 'Riesgos y bloqueos detectados';
COMMENT ON COLUMN bookmark_summaries.evidence IS 'Evidencia estructurada con confidence levels';
COMMENT ON COLUMN bookmark_summaries.html_content IS 'Contenido HTML editable del brief';
COMMENT ON COLUMN bookmark_summaries.context_hash IS 'Hash SHA256 del contexto usado para detectar cambios';
COMMENT ON COLUMN bookmark_summaries.user_email IS 'Email del usuario que generó el brief';
