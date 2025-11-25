-- Verificar específicamente el campo publishedAt en source_data
SELECT 
  id,
  title,
  posted_at as fecha_actual,
  source_data->>'publishedAt' as publishedAt_value,
  source_data->>'PublishedAt' as PublishedAt_value,
  source_data->>'published_at' as published_at_value
FROM job_postings
LIMIT 10;
