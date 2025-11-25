-- Script corregido para poblar full_name
-- Usando columnas correctas según el schema real de contacts

-- 1. Diagnóstico: ¿Cuántos contactos tienen full_name vacío?
SELECT 
  COUNT(*) AS total_contacts,
  COUNT(*) FILTER (WHERE full_name IS NULL OR TRIM(full_name) = '') AS sin_nombre,
  COUNT(*) FILTER (WHERE full_name IS NOT NULL AND TRIM(full_name) != '') AS con_nombre,
  COUNT(*) FILTER (WHERE first_name IS NOT NULL OR last_name IS NOT NULL) AS tiene_first_o_last
FROM contacts;

-- 2. Ver ejemplos de contactos sin nombre pero con datos parciales
SELECT 
  id,
  full_name,
  first_name,
  last_name,
  headline,
  email1,
  TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS nombre_propuesto
FROM contacts
WHERE (full_name IS NULL OR TRIM(full_name) = '')
  AND (first_name IS NOT NULL OR last_name IS NOT NULL)
LIMIT 10;
