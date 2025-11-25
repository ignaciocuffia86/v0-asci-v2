-- Script simple para verificar y corregir fechas de job postings
-- Paso 1: Ver qué hay realmente en source_data para UN job posting
SELECT 
  id,
  title,
  posted_at,
  source_data->>'publishedAt' as published_at_direct,
  source_data->'_original'->>'publishedAt' as published_at_original,
  jsonb_pretty(source_data) as full_source_data
FROM job_postings
LIMIT 1;
