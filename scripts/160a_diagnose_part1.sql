-- =====================================================
-- DIAGNÓSTICO PARTE 1: Verificar estructura
-- Ejecutar primero este bloque
-- =====================================================

-- 1. Verificar si contacts.country_normalized existe
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'contacts' 
AND column_name = 'country_normalized';

-- 2. Contar contactos con country_normalized
SELECT 
  COUNT(*) as total_contacts,
  COUNT(country_normalized) as con_pais_normalizado
FROM contacts
LIMIT 1;
