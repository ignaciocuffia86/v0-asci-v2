-- Script simple para actualizar posted_at desde source_data._original.publishedAt

UPDATE job_postings
SET posted_at = (source_data->'_original'->>'publishedAt')::DATE
WHERE source_data->'_original'->>'publishedAt' IS NOT NULL
  AND source_data->'_original'->>'publishedAt' != '';

-- Verificar resultado
SELECT 
  title,
  posted_at,
  source_data->'_original'->>'publishedAt' as original_date
FROM job_postings
LIMIT 5;
