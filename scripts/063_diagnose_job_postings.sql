-- Diagnóstico de job postings vs signals

-- 1. Total de job postings y cuántos tienen señales
SELECT 
  'job_postings total' as metric,
  COUNT(*) as count
FROM job_postings
UNION ALL
SELECT 
  'job_postings con señales' as metric,
  COUNT(DISTINCT jp.id) as count
FROM job_postings jp
JOIN signals s ON s.job_posting_id = jp.id
UNION ALL
SELECT 
  'signals de job_postings' as metric,
  COUNT(*) as count
FROM signals 
WHERE job_posting_id IS NOT NULL;

-- 2. Para Banco Hipotecario específicamente
SELECT 
  c.name as company_name,
  c.id as company_id,
  (SELECT COUNT(*) FROM job_postings jp WHERE jp.company_id = c.id) as total_job_postings,
  (SELECT COUNT(*) FROM job_postings jp WHERE jp.company_id = c.id AND jp.is_active = true) as active_job_postings,
  (SELECT COUNT(*) FROM signals s WHERE s.company_id = c.id AND s.job_posting_id IS NOT NULL) as signals_from_job_postings,
  (SELECT COUNT(*) FROM signals s WHERE s.company_id = c.id AND s.contact_id IS NOT NULL) as signals_from_contacts
FROM companies c
WHERE c.name ILIKE '%banco hipotecario%';

-- 3. Verificar si job_posted_at está poblado en signals
SELECT 
  'signals con job_posting_id pero job_posted_at NULL' as metric,
  COUNT(*) as count
FROM signals
WHERE job_posting_id IS NOT NULL AND job_posted_at IS NULL;

-- 4. Job postings de Banco Hipotecario con sus señales
SELECT 
  jp.id as job_posting_id,
  jp.title,
  jp.posted_at,
  jp.is_active,
  s.id as signal_id,
  s.keyword_matched,
  s.signal_type,
  s.job_posted_at as signal_job_posted_at
FROM job_postings jp
LEFT JOIN signals s ON s.job_posting_id = jp.id
JOIN companies c ON jp.company_id = c.id
WHERE c.name ILIKE '%banco hipotecario%'
LIMIT 20;
