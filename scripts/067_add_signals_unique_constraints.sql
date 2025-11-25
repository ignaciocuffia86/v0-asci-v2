-- Script para agregar constraints UNIQUE y prevenir duplicados futuros en signals
-- CORREGIDO: La combinación única para contactos debe incluir company_id
-- porque una persona puede tener la misma tecnología en diferentes empresas

-- 1. Eliminar constraints incorrectos si existen
DROP INDEX IF EXISTS idx_signals_unique_contact;
DROP INDEX IF EXISTS idx_signals_unique_job_posting;

-- 2. Agregar índice único CORRECTO para señales de contactos (signal_id + contact_id + company_id)
-- Agregado company_id al constraint porque un contacto puede tener la misma tech en diferentes empresas
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_unique_contact 
ON signals (signal_id, contact_id, company_id) 
WHERE contact_id IS NOT NULL;

-- 3. Agregar índice único para señales de job_postings (signal_id + job_posting_id)
-- job_posting_id ya es único por empresa, no necesita company_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_unique_job_posting 
ON signals (signal_id, job_posting_id) 
WHERE job_posting_id IS NOT NULL;

-- 4. Verificar que los índices se crearon correctamente
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'signals' 
AND indexname LIKE 'idx_signals_unique%';
