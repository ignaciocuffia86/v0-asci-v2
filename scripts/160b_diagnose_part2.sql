-- =====================================================
-- DIAGNÓSTICO PARTE 2: Verificar RPC
-- Ejecutar después de parte 1
-- =====================================================

-- 1. Ver parámetros del RPC export_contacts
SELECT 
  p.parameter_name,
  p.data_type
FROM information_schema.routines r
JOIN information_schema.parameters p ON r.specific_name = p.specific_name
WHERE r.routine_name = 'export_contacts'
AND p.parameter_mode = 'IN'
ORDER BY p.ordinal_position;
