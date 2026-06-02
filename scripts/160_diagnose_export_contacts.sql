-- =====================================================
-- Script de diagnóstico para export_contacts
-- =====================================================

-- 1. Verificar que la función existe y sus parámetros
SELECT 
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'export_contacts'
AND n.nspname = 'public';

-- 2. Verificar que contacts tiene country_normalized
SELECT 
  column_name, 
  data_type 
FROM information_schema.columns 
WHERE table_name = 'contacts' 
AND column_name = 'country_normalized';

-- 3. Contar contactos con country_normalized
SELECT 
  'contacts con country_normalized' AS metric,
  COUNT(*) AS count
FROM contacts 
WHERE country_normalized IS NOT NULL;

-- 4. Contar contactos con signals y country_normalized
SELECT 
  'contactos con signals y country_normalized' AS metric,
  COUNT(DISTINCT c.id) AS count
FROM contacts c
INNER JOIN signals s ON s.contact_id = c.id
WHERE c.country_normalized IS NOT NULL;

-- 5. Test directo del RPC con Argentina (debería traer resultados)
SELECT COUNT(*) AS argentina_count
FROM contacts c
INNER JOIN signals s ON s.contact_id = c.id
WHERE c.country_normalized = 'Argentina';

-- 6. Test del RPC real
SELECT COUNT(*) AS rpc_result_count
FROM export_contacts(
  NULL,           -- p_signal_type
  NULL,           -- p_signal_names
  ARRAY['Argentina'],  -- p_countries
  NULL,           -- p_industries
  FALSE,          -- p_only_corporate_email
  100             -- p_limit
);

-- 7. Si el anterior falla, probar sin filtro de país
SELECT COUNT(*) AS rpc_no_filter_count
FROM export_contacts(
  NULL,           -- p_signal_type
  NULL,           -- p_signal_names
  NULL,           -- p_countries (sin filtro)
  NULL,           -- p_industries
  FALSE,          -- p_only_corporate_email
  100             -- p_limit
);

-- 8. Verificar ejemplos de country_normalized en contacts
SELECT country, country_normalized, COUNT(*) as count
FROM contacts
WHERE country IS NOT NULL
GROUP BY country, country_normalized
ORDER BY count DESC
LIMIT 20;
