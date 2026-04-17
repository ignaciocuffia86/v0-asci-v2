-- Fix: Crear un UNIQUE CONSTRAINT para job_postings (no un índice parcial)
-- PostgreSQL NO puede usar índices parciales con ON CONFLICT
-- Necesitamos un CONSTRAINT real o un índice sin WHERE clause

-- Paso 1: Eliminar el índice parcial que no sirve para ON CONFLICT
DROP INDEX IF EXISTS idx_signals_unique_job_posting_v2;

-- Paso 2: Crear un UNIQUE CONSTRAINT para job_postings
-- Nota: En PostgreSQL, NULL != NULL, así que las filas de contactos 
-- (donde job_posting_id IS NULL) NO violan este constraint
-- Cada contacto puede tener su propia señal con job_posting_id=NULL
ALTER TABLE public.signals
ADD CONSTRAINT signals_job_posting_signal_unique 
UNIQUE (job_posting_id, signal_type, signal_id);

-- Verificar que el constraint se creó correctamente
SELECT 
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'public.signals'::regclass
AND conname LIKE '%job_posting%';
