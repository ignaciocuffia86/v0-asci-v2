-- =====================================================
-- SCRIPT DE VERIFICACIÓN DE NORMALIZACIÓN DE PAÍSES
-- Ejecutar en Supabase SQL Editor para verificar integridad
-- =====================================================

-- 1. Verificar que existe el campo country_normalized en contacts
SELECT 
  column_name, 
  data_type 
FROM information_schema.columns 
WHERE table_name = 'contacts' 
AND column_name = 'country_normalized';

-- 2. Estadísticas de contacts.country_normalized
SELECT 
  'contacts' as tabla,
  COUNT(*) as total,
  COUNT(country) as con_country_raw,
  COUNT(country_normalized) as con_country_normalized,
  ROUND(COUNT(country_normalized)::numeric / NULLIF(COUNT(country), 0) * 100, 2) as pct_normalizados
FROM contacts;

-- 3. Estadísticas de companies.country_normalized
SELECT 
  'companies' as tabla,
  COUNT(*) as total,
  COUNT(country) as con_country_raw,
  COUNT(country_normalized) as con_country_normalized,
  ROUND(COUNT(country_normalized)::numeric / NULLIF(COUNT(country), 0) * 100, 2) as pct_normalizados
FROM companies;

-- 4. Top 20 países normalizados en contacts (con cantidad)
SELECT 
  country_normalized, 
  COUNT(*) as cantidad
FROM contacts 
WHERE country_normalized IS NOT NULL
GROUP BY country_normalized
ORDER BY cantidad DESC
LIMIT 20;

-- 5. Top 20 países normalizados en companies (con cantidad)
SELECT 
  country_normalized, 
  COUNT(*) as cantidad
FROM companies 
WHERE country_normalized IS NOT NULL
GROUP BY country_normalized
ORDER BY cantidad DESC
LIMIT 20;

-- 6. Ejemplos de normalización exitosa (country raw vs normalized)
SELECT 
  country as country_raw,
  country_normalized,
  COUNT(*) as cantidad
FROM contacts
WHERE country_normalized IS NOT NULL
AND country IS NOT NULL
AND country != country_normalized
GROUP BY country, country_normalized
ORDER BY cantidad DESC
LIMIT 15;

-- 7. Ejemplos de country que NO se pudieron normalizar (para debug)
SELECT 
  country as country_raw,
  COUNT(*) as cantidad
FROM contacts
WHERE country IS NOT NULL
AND country != ''
AND country_normalized IS NULL
GROUP BY country
ORDER BY cantidad DESC
LIMIT 20;

-- 8. Verificar que el RPC export_contacts existe y tiene los campos correctos
SELECT 
  p.proname as function_name,
  pg_get_function_result(p.oid) as return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'export_contacts'
AND n.nspname = 'public';

-- 9. Contactos con signals que tienen país normalizado (para el export)
SELECT 
  c.country_normalized,
  COUNT(DISTINCT c.id) as contactos_unicos,
  COUNT(s.id) as total_signals
FROM contacts c
JOIN signals s ON s.contact_id = c.id
WHERE c.country_normalized IS NOT NULL
GROUP BY c.country_normalized
ORDER BY contactos_unicos DESC
LIMIT 20;

-- 10. Verificar trigger existe
SELECT 
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE trigger_name = 'trigger_normalize_contact_country';
