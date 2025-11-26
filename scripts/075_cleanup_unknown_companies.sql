-- =====================================================
-- Script 075: Diagnóstico y limpieza de Unknown Companies
-- =====================================================

-- PARTE 1: DIAGNÓSTICO
-- =====================================================

-- 1.1 Resumen general
SELECT 
  'Total Unknown Companies' as metric,
  COUNT(*)::text as value
FROM companies WHERE normalized_name = 'unknown company'
UNION ALL
SELECT 
  'Unknown con contactos',
  COUNT(DISTINCT c.id)::text
FROM companies c
WHERE c.normalized_name = 'unknown company'
  AND EXISTS (SELECT 1 FROM contacts WHERE current_company_id = c.id)
UNION ALL
SELECT 
  'Unknown sin contactos (huérfanas)',
  COUNT(*)::text
FROM companies c
WHERE c.normalized_name = 'unknown company'
  AND NOT EXISTS (SELECT 1 FROM contacts WHERE current_company_id = c.id)
UNION ALL
SELECT 
  'Contactos en Unknown con headline útil',
  COUNT(*)::text
FROM contacts co
JOIN companies c ON co.current_company_id = c.id
WHERE c.normalized_name = 'unknown company'
  AND co.headline IS NOT NULL 
  AND co.headline != ''
  AND (co.headline ILIKE '% en %' OR co.headline ILIKE '% at %');

-- 1.2 Mostrar contactos con empresa extraíble del headline
SELECT 
  co.id as contact_id,
  co.first_name || ' ' || co.last_name as contact_name,
  co.headline,
  -- Extraer empresa después de " en " o " at "
  CASE 
    WHEN co.headline ILIKE '% en %' THEN 
      TRIM(SUBSTRING(co.headline FROM POSITION(' en ' IN LOWER(co.headline)) + 4))
    WHEN co.headline ILIKE '% at %' THEN 
      TRIM(SUBSTRING(co.headline FROM POSITION(' at ' IN LOWER(co.headline)) + 4))
    ELSE NULL
  END as empresa_extraida,
  c.id as unknown_company_id
FROM contacts co
JOIN companies c ON co.current_company_id = c.id
WHERE c.normalized_name = 'unknown company'
  AND co.headline IS NOT NULL 
  AND co.headline != ''
  AND (co.headline ILIKE '% en %' OR co.headline ILIKE '% at %')
ORDER BY co.headline
LIMIT 50;

-- PARTE 2: LIMPIEZA (ejecutar con cuidado)
-- =====================================================

-- 2.1 Eliminar compañías Unknown huérfanas (sin contactos)
-- Primero eliminar señales asociadas
DELETE FROM signals s
WHERE s.company_id IN (
  SELECT c.id 
  FROM companies c
  WHERE c.normalized_name = 'unknown company'
    AND NOT EXISTS (SELECT 1 FROM contacts WHERE current_company_id = c.id)
);

-- Luego eliminar las compañías huérfanas
DELETE FROM companies c
WHERE c.normalized_name = 'unknown company'
  AND NOT EXISTS (SELECT 1 FROM contacts WHERE current_company_id = c.id);

-- Mostrar resultado
SELECT 'Compañías Unknown huérfanas eliminadas' as status;

-- 2.2 Crear función para extraer y reasignar empresa del headline
CREATE OR REPLACE FUNCTION extract_company_from_headline(p_headline TEXT)
RETURNS TEXT AS $$
DECLARE
  v_empresa TEXT;
  v_pos_en INTEGER;
  v_pos_at INTEGER;
BEGIN
  IF p_headline IS NULL OR p_headline = '' THEN
    RETURN NULL;
  END IF;
  
  -- Buscar " en " (case insensitive)
  v_pos_en := POSITION(' en ' IN LOWER(p_headline));
  -- Buscar " at " (case insensitive)
  v_pos_at := POSITION(' at ' IN LOWER(p_headline));
  
  -- Usar el que esté más cerca del final (más probable que sea la empresa)
  IF v_pos_en > 0 AND (v_pos_at = 0 OR v_pos_en > v_pos_at) THEN
    v_empresa := TRIM(SUBSTRING(p_headline FROM v_pos_en + 4));
  ELSIF v_pos_at > 0 THEN
    v_empresa := TRIM(SUBSTRING(p_headline FROM v_pos_at + 4));
  ELSE
    RETURN NULL;
  END IF;
  
  -- Limpiar caracteres especiales al final
  v_empresa := RTRIM(v_empresa, ' .-,;:');
  
  -- Si es muy corto, probablemente no es válido
  IF LENGTH(v_empresa) < 3 THEN
    RETURN NULL;
  END IF;
  
  RETURN v_empresa;
END;
$$ LANGUAGE plpgsql;

-- 2.3 Ver qué empresas se extraerían y si ya existen
SELECT 
  co.id as contact_id,
  co.first_name || ' ' || co.last_name as contact_name,
  extract_company_from_headline(co.headline) as empresa_extraida,
  EXISTS (
    SELECT 1 FROM companies 
    WHERE LOWER(name) = LOWER(extract_company_from_headline(co.headline))
  ) as empresa_existe
FROM contacts co
JOIN companies c ON co.current_company_id = c.id
WHERE c.normalized_name = 'unknown company'
  AND extract_company_from_headline(co.headline) IS NOT NULL
ORDER BY empresa_extraida
LIMIT 50;

-- 2.4 Contar cuántos se podrían reasignar automáticamente
SELECT 
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM companies 
    WHERE LOWER(name) = LOWER(extract_company_from_headline(co.headline))
  )) as reasignar_a_existente,
  COUNT(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM companies 
    WHERE LOWER(name) = LOWER(extract_company_from_headline(co.headline))
  )) as crear_nueva_empresa,
  COUNT(*) as total_con_empresa_extraible
FROM contacts co
JOIN companies c ON co.current_company_id = c.id
WHERE c.normalized_name = 'unknown company'
  AND extract_company_from_headline(co.headline) IS NOT NULL;
