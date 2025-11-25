-- Script de diagnóstico para verificar los campos de fecha en source_data
-- NO modifica datos, solo muestra información para entender el problema

-- 1. Ver una muestra de source_data para entender la estructura
SELECT 
  id,
  title,
  posted_at,
  jsonb_pretty(source_data) as source_data_formatted
FROM job_postings
LIMIT 3;

-- 2. Listar todas las keys únicas que existen en source_data
SELECT DISTINCT jsonb_object_keys(source_data) as field_name
FROM job_postings
WHERE source_data IS NOT NULL
ORDER BY field_name;

-- 3. Buscar específicamente campos que podrían contener la fecha
SELECT 
  id,
  title,
  posted_at as current_posted_at,
  source_data->>'publishedAt' as publishedAt,
  source_data->>'PublishedAt' as PublishedAt_cap,
  source_data->>'published_at' as published_at,
  source_data->>'postedTime' as postedTime,
  source_data->>'PostedTime' as PostedTime_cap,
  source_data->>'posted_time' as posted_time,
  source_data->>'post_date' as post_date,
  source_data->>'PostDate' as PostDate,
  source_data->>'date' as date_field,
  source_data->>'Date' as Date_cap,
  source_data->>'createdAt' as createdAt,
  source_data->>'created_at' as created_at
FROM job_postings
LIMIT 5;
