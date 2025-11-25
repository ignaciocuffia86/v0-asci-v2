-- Diagnóstico de señales de job_postings filtradas por tecnología
-- Para entender por qué el drawer no muestra las posiciones

-- 1. Ver las señales de Banco Hipotecario que vienen de job_postings
SELECT 
  s.id as signal_id,
  s.signal_id as dictionary_id,
  s.signal_type,
  s.keyword_matched,
  s.job_posting_id,
  s.job_posted_at as signal_job_posted_at,
  jp.posted_at as job_posting_posted_at,
  jp.title as job_title,
  dp.name as product_name,
  dpr.name as process_name
FROM signals s
LEFT JOIN job_postings jp ON s.job_posting_id = jp.id
LEFT JOIN dictionary_products dp ON s.signal_type = 'technology' AND s.signal_id = dp.id
LEFT JOIN dictionary_processes dpr ON s.signal_type = 'process' AND s.signal_id = dpr.id
WHERE s.company_id = '459591a3-5d00-408e-97a1-2faf9a12acfc'
  AND s.job_posting_id IS NOT NULL
ORDER BY jp.posted_at DESC
LIMIT 20;

-- 2. Ver las tecnologías/procesos que tienen señales de job_postings para Banco Hipotecario
SELECT 
  s.signal_type,
  COALESCE(dp.name, dpr.name) as dictionary_name,
  s.signal_id as dictionary_id,
  COUNT(*) as signal_count,
  COUNT(DISTINCT s.job_posting_id) as job_posting_count
FROM signals s
LEFT JOIN dictionary_products dp ON s.signal_type = 'technology' AND s.signal_id = dp.id
LEFT JOIN dictionary_processes dpr ON s.signal_type = 'process' AND s.signal_id = dpr.id
WHERE s.company_id = '459591a3-5d00-408e-97a1-2faf9a12acfc'
  AND s.job_posting_id IS NOT NULL
GROUP BY s.signal_type, s.signal_id, dp.name, dpr.name
ORDER BY signal_count DESC;

-- 3. Verificar las fechas - ¿cuántas tienen fecha correcta vs fecha de ETL (24/11)?
SELECT 
  DATE(jp.posted_at) as posted_date,
  COUNT(*) as count,
  CASE 
    WHEN DATE(jp.posted_at) = '2025-11-24' THEN 'FECHA ETL (incorrecta)'
    ELSE 'FECHA REAL (correcta)'
  END as status
FROM job_postings jp
WHERE jp.company_id = '459591a3-5d00-408e-97a1-2faf9a12acfc'
GROUP BY DATE(jp.posted_at)
ORDER BY posted_date DESC;

-- 4. Verificar si publishedAt existe en source_data para job_postings de Banco Hipotecario
SELECT 
  jp.id,
  jp.title,
  jp.posted_at,
  jp.source_data->'_original'->>'publishedAt' as original_published_at,
  jp.source_data->>'publishedAt' as root_published_at
FROM job_postings jp
WHERE jp.company_id = '459591a3-5d00-408e-97a1-2faf9a12acfc'
LIMIT 10;
