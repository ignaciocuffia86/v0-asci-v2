-- Diagnóstico de job_postings duplicados
-- Un job_posting duplicado tiene el mismo company_id + title + apply_url

-- 1. Ver cuántos job_postings duplicados hay
SELECT 
  'Duplicados por company + title' as tipo,
  COUNT(*) as total_job_postings,
  COUNT(DISTINCT (company_id, title)) as combinaciones_unicas,
  COUNT(*) - COUNT(DISTINCT (company_id, title)) as duplicados_estimados
FROM job_postings;

-- 2. Ver ejemplos de duplicados para Banco Hipotecario
SELECT 
  jp.id,
  jp.title,
  jp.posted_at,
  jp.apply_url,
  jp.created_at,
  c.name as company_name
FROM job_postings jp
JOIN companies c ON c.id = jp.company_id
WHERE c.name ILIKE '%hipotecario%'
ORDER BY jp.title, jp.created_at;

-- 3. Contar señales que se verán afectadas
SELECT 
  'Signals que apuntan a job_postings duplicados' as descripcion,
  COUNT(*) as total
FROM signals s
WHERE s.job_posting_id IN (
  SELECT jp.id 
  FROM job_postings jp
  WHERE (jp.company_id, jp.title) IN (
    SELECT company_id, title 
    FROM job_postings 
    GROUP BY company_id, title 
    HAVING COUNT(*) > 1
  )
);
