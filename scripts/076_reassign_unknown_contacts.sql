-- Script 076: Reasignar contactos de Unknown Company a empresas existentes
-- Este script reasigna contactos cuya empresa se puede extraer del headline

-- 1. Preview de reasignaciones (ejecutar primero para verificar)
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM contacts co
  JOIN companies c_actual ON co.current_company_id = c_actual.id
  JOIN companies c_destino ON c_destino.normalized_name = public.normalize_company_name(public.extract_company_from_headline(co.headline))
  WHERE c_actual.normalized_name = 'unknown company'
    AND public.extract_company_from_headline(co.headline) IS NOT NULL
    AND c_actual.id != c_destino.id;
  
  RAISE NOTICE 'Contactos a reasignar a empresas existentes: %', v_count;
END $$;

-- 2. Ejecutar la reasignación
WITH reasignaciones AS (
  SELECT 
    co.id as contact_id,
    co.first_name || ' ' || co.last_name as contact_name,
    c_actual.id as old_company_id,
    c_actual.name as old_company_name,
    c_destino.id as new_company_id,
    c_destino.name as new_company_name
  FROM contacts co
  JOIN companies c_actual ON co.current_company_id = c_actual.id
  JOIN companies c_destino ON c_destino.normalized_name = public.normalize_company_name(public.extract_company_from_headline(co.headline))
  WHERE c_actual.normalized_name = 'unknown company'
    AND public.extract_company_from_headline(co.headline) IS NOT NULL
    AND c_actual.id != c_destino.id
)
UPDATE contacts c
SET current_company_id = r.new_company_id
FROM reasignaciones r
WHERE c.id = r.contact_id;

-- 3. Limpiar compañías Unknown que quedaron sin contactos
DELETE FROM companies 
WHERE normalized_name = 'unknown company'
  AND NOT EXISTS (SELECT 1 FROM contacts WHERE current_company_id = companies.id);

-- 4. Reporte final
SELECT 
  'Contactos en Unknown Company' as metrica,
  COUNT(*)::text as valor
FROM contacts co
JOIN companies c ON co.current_company_id = c.id
WHERE c.normalized_name = 'unknown company'
UNION ALL
SELECT 
  'Compañías Unknown restantes',
  COUNT(*)::text
FROM companies
WHERE normalized_name = 'unknown company';
