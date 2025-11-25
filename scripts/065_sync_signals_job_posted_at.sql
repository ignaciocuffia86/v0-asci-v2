-- Sincronizar signals.job_posted_at con job_postings.posted_at
-- El script 060 actualizó job_postings.posted_at pero signals.job_posted_at quedó desactualizado

-- 1. Ver cuántas señales necesitan actualización
SELECT 
  COUNT(*) as total_signals_job_posting,
  COUNT(*) FILTER (WHERE s.job_posted_at != jp.posted_at) as need_sync,
  COUNT(*) FILTER (WHERE s.job_posted_at = jp.posted_at) as already_synced
FROM signals s
JOIN job_postings jp ON s.job_posting_id = jp.id
WHERE s.job_posting_id IS NOT NULL;

-- 2. Actualizar signals.job_posted_at con la fecha correcta de job_postings.posted_at
UPDATE signals s
SET job_posted_at = jp.posted_at
FROM job_postings jp
WHERE s.job_posting_id = jp.id
  AND s.job_posting_id IS NOT NULL
  AND (s.job_posted_at IS NULL OR s.job_posted_at != jp.posted_at);

-- 3. Verificar resultado
SELECT 
  'Sincronización completada' as status,
  COUNT(*) as total_signals_actualizadas
FROM signals s
JOIN job_postings jp ON s.job_posting_id = jp.id
WHERE s.job_posting_id IS NOT NULL
  AND s.job_posted_at = jp.posted_at;
