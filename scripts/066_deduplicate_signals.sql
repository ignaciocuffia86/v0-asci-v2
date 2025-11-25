-- Diagnóstico de señales duplicadas

-- 1. Señales de job_postings duplicadas (mismo signal_id + job_posting_id)
SELECT 
  'job_postings' as tipo,
  COUNT(*) as total_duplicados,
  COUNT(DISTINCT (signal_id, job_posting_id)) as combinaciones_unicas
FROM signals
WHERE job_posting_id IS NOT NULL;

-- 2. Señales de contactos duplicadas (mismo signal_id + contact_id)
SELECT 
  'contactos' as tipo,
  COUNT(*) as total_duplicados,
  COUNT(DISTINCT (signal_id, contact_id)) as combinaciones_unicas
FROM signals
WHERE contact_id IS NOT NULL;

-- 3. Ejemplos de duplicados en job_postings
SELECT 
  signal_id,
  job_posting_id,
  COUNT(*) as cantidad,
  array_agg(id) as signal_ids
FROM signals
WHERE job_posting_id IS NOT NULL
GROUP BY signal_id, job_posting_id
HAVING COUNT(*) > 1
LIMIT 10;

-- 4. Eliminar duplicados de job_postings (mantener el más antiguo por created_at)
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY signal_id, job_posting_id 
      ORDER BY created_at ASC
    ) as rn
  FROM signals
  WHERE job_posting_id IS NOT NULL
)
DELETE FROM signals
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- 5. Eliminar duplicados de contactos (mantener el más antiguo por created_at)
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY signal_id, contact_id 
      ORDER BY created_at ASC
    ) as rn
  FROM signals
  WHERE contact_id IS NOT NULL
)
DELETE FROM signals
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- 6. Verificar resultado final
SELECT 
  'Después de deduplicación' as estado,
  COUNT(*) as total_signals,
  COUNT(CASE WHEN job_posting_id IS NOT NULL THEN 1 END) as signals_job_postings,
  COUNT(CASE WHEN contact_id IS NOT NULL THEN 1 END) as signals_contactos
FROM signals;
