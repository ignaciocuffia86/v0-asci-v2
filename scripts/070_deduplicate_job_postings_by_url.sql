-- Diagnóstico: ver duplicados por apply_url
SELECT 
  'Duplicados por apply_url' as tipo,
  COUNT(*) as total_job_postings,
  COUNT(DISTINCT apply_url) as urls_unicas,
  COUNT(*) - COUNT(DISTINCT apply_url) as duplicados_estimados
FROM job_postings
WHERE apply_url IS NOT NULL;

-- Ver los duplicados específicos de "Jefe de Telecomunicaciones" en Banco Hipotecario
SELECT 
  jp.id,
  jp.title,
  jp.apply_url,
  jp.posted_at,
  c.name as company_name,
  (SELECT COUNT(*) FROM signals s WHERE s.job_posting_id = jp.id) as signals_count
FROM job_postings jp
JOIN companies c ON c.id = jp.company_id
WHERE c.name ILIKE '%banco hipotecario%'
  AND jp.title ILIKE '%telecomunicaciones%'
ORDER BY jp.title, jp.created_at;

-- Paso 1: Identificar duplicados por apply_url (mantener el más antiguo por created_at)
WITH duplicates AS (
  SELECT 
    id,
    apply_url,
    ROW_NUMBER() OVER (PARTITION BY apply_url ORDER BY created_at ASC) as rn
  FROM job_postings
  WHERE apply_url IS NOT NULL
)
SELECT 
  'Job postings a eliminar (duplicados por URL)' as tipo,
  COUNT(*) as cantidad
FROM duplicates 
WHERE rn > 1;

-- Paso 2: Eliminar señales de duplicados que ya existen en el original
-- (para evitar violación de constraint único idx_signals_job_posting_unique)
WITH duplicates AS (
  SELECT 
    id,
    apply_url,
    ROW_NUMBER() OVER (PARTITION BY apply_url ORDER BY created_at ASC) as rn,
    FIRST_VALUE(id) OVER (PARTITION BY apply_url ORDER BY created_at ASC) as original_id
  FROM job_postings
  WHERE apply_url IS NOT NULL
)
DELETE FROM signals s
USING duplicates d
WHERE s.job_posting_id = d.id
  AND d.rn > 1
  -- Solo eliminar si ya existe señal equivalente en el original
  AND EXISTS (
    SELECT 1 FROM signals s2 
    WHERE s2.job_posting_id = d.original_id 
      AND s2.signal_id = s.signal_id
  );

-- Paso 3: Reasignar señales restantes de job_postings duplicados al original
WITH duplicates AS (
  SELECT 
    id,
    apply_url,
    ROW_NUMBER() OVER (PARTITION BY apply_url ORDER BY created_at ASC) as rn,
    FIRST_VALUE(id) OVER (PARTITION BY apply_url ORDER BY created_at ASC) as original_id
  FROM job_postings
  WHERE apply_url IS NOT NULL
)
UPDATE signals s
SET job_posting_id = d.original_id
FROM duplicates d
WHERE s.job_posting_id = d.id
  AND d.rn > 1
  AND d.original_id != d.id;

-- Paso 4: Eliminar job_postings duplicados
WITH duplicates AS (
  SELECT 
    id,
    apply_url,
    ROW_NUMBER() OVER (PARTITION BY apply_url ORDER BY created_at ASC) as rn
  FROM job_postings
  WHERE apply_url IS NOT NULL
)
DELETE FROM job_postings
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Paso 5: Verificar resultado
SELECT 
  'Después de deduplicación' as estado,
  COUNT(*) as total_job_postings,
  COUNT(DISTINCT apply_url) as urls_unicas
FROM job_postings
WHERE apply_url IS NOT NULL;

-- Paso 6: Agregar constraint único en apply_url para prevenir futuros duplicados
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_postings_unique_apply_url 
ON job_postings(apply_url) 
WHERE apply_url IS NOT NULL;
