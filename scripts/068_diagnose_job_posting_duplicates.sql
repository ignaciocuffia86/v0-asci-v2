-- Diagnóstico de duplicados para Banco Hipotecario y Azure DNS
-- signal_id de Azure DNS (aproximado, buscar el correcto)

-- 1. Ver las señales de job_postings para Banco Hipotecario con Azure DNS
SELECT 
  s.id as signal_id,
  s.signal_id as dictionary_id,
  s.job_posting_id,
  s.keyword_matched,
  s.created_at,
  jp.title as job_title,
  dp.name as technology_name
FROM signals s
JOIN job_postings jp ON jp.id = s.job_posting_id
LEFT JOIN dictionary_products dp ON dp.id = s.signal_id
WHERE s.company_id = '459591a3-5d00-408e-97a1-2faf9a12acfc'  -- Banco Hipotecario
  AND s.job_posting_id IS NOT NULL
ORDER BY s.job_posting_id, s.signal_id;

-- 2. Contar duplicados exactos (mismo signal_id + job_posting_id)
SELECT 
  signal_id,
  job_posting_id,
  COUNT(*) as duplicates
FROM signals
WHERE company_id = '459591a3-5d00-408e-97a1-2faf9a12acfc'
  AND job_posting_id IS NOT NULL
GROUP BY signal_id, job_posting_id
HAVING COUNT(*) > 1;

-- 3. Ver el constraint que aplicamos
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'signals' 
  AND indexname LIKE '%unique%';
