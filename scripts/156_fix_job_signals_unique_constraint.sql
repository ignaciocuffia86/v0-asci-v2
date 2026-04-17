-- ============================================================
-- 156: Fix ON CONFLICT mismatch in process_job_signals
--
-- Problema: process_job_signals (script 133) usa:
--   ON CONFLICT (job_posting_id, signal_type, signal_id) DO NOTHING
--
-- Pero el índice existente (script 067) solo cubre:
--   (signal_id, job_posting_id) -- 2 columnas
--
-- PostgreSQL requiere que ON CONFLICT referencie EXACTAMENTE
-- un índice único existente (mismas columnas, mismo orden).
-- Sin ese índice, la inserción lanza:
--   "there is no unique or exclusion constraint matching the ON CONFLICT"
--
-- Solución (mínima, no disruptiva): agregar el índice de 3 columnas
-- que el código ya espera. El índice anterior (signal_id, job_posting_id)
-- se mantiene para no romper nada que pueda depender de él.
-- ============================================================

-- Índice requerido por process_job_signals en script 133
-- ON CONFLICT (job_posting_id, signal_type, signal_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_unique_job_posting_v2
ON public.signals (job_posting_id, signal_type, signal_id)
WHERE job_posting_id IS NOT NULL;

-- Verificación
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'signals'
AND indexname LIKE 'idx_signals_unique%'
ORDER BY indexname;
