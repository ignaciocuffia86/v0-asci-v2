-- Script de reconciliación de señales huérfanas
-- Actualiza signal_id de señales que apuntan a IDs de diccionario que ya no existen
-- Debe ejecutarse después de recrear/actualizar el diccionario de productos o vendors

-- 1. Ver cuántas señales huérfanas hay (solo lectura, para diagnóstico)
DO $$
DECLARE
  orphan_tech_count INTEGER;
  orphan_vendor_count INTEGER;
BEGIN
  -- Contar señales de tecnología huérfanas
  SELECT COUNT(*) INTO orphan_tech_count
  FROM signals s
  LEFT JOIN dictionary_products dp ON s.signal_id = dp.id
  WHERE s.signal_type = 'technology'
    AND s.signal_id IS NOT NULL
    AND dp.id IS NULL;
  
  -- Contar señales de vendor huérfanas  
  SELECT COUNT(*) INTO orphan_vendor_count
  FROM signals s
  LEFT JOIN dictionary_vendors dv ON s.signal_id = dv.id
  WHERE s.signal_type = 'vendor'
    AND s.signal_id IS NOT NULL
    AND dv.id IS NULL;
    
  RAISE NOTICE 'Señales de tecnología huérfanas: %', orphan_tech_count;
  RAISE NOTICE 'Señales de vendor huérfanas: %', orphan_vendor_count;
END $$;

-- 2. Eliminar señales huérfanas duplicadas (donde ya existe una señal con el nuevo signal_id)
-- Primero para tecnologías
DELETE FROM signals s
USING dictionary_products dp
WHERE s.signal_type = 'technology'
  AND s.signal_id IS NOT NULL
  AND s.keyword_matched IS NOT NULL
  -- El signal_id actual no existe en el diccionario
  AND NOT EXISTS (
    SELECT 1 FROM dictionary_products dp2 WHERE dp2.id = s.signal_id
  )
  -- El keyword matchea con un producto existente
  AND (
    LOWER(dp.name) = LOWER(s.keyword_matched)
    OR LOWER(s.keyword_matched) = ANY(SELECT LOWER(unnest(dp.keywords)))
  )
  -- Ya existe una señal con el nuevo ID (duplicado)
  AND EXISTS (
    SELECT 1 FROM signals s2 
    WHERE s2.signal_id = dp.id 
      AND s2.company_id = s.company_id
      AND s2.signal_type = s.signal_type
      AND COALESCE(s2.job_posting_id, '00000000-0000-0000-0000-000000000000') = COALESCE(s.job_posting_id, '00000000-0000-0000-0000-000000000000')
  );

-- Luego para vendors
DELETE FROM signals s
USING dictionary_vendors dv
WHERE s.signal_type = 'vendor'
  AND s.signal_id IS NOT NULL
  AND s.keyword_matched IS NOT NULL
  -- El signal_id actual no existe en el diccionario
  AND NOT EXISTS (
    SELECT 1 FROM dictionary_vendors dv2 WHERE dv2.id = s.signal_id
  )
  -- El keyword matchea con un vendor existente
  AND LOWER(dv.name) = LOWER(s.keyword_matched)
  -- Ya existe una señal con el nuevo ID (duplicado)
  AND EXISTS (
    SELECT 1 FROM signals s2 
    WHERE s2.signal_id = dv.id 
      AND s2.company_id = s.company_id
      AND s2.signal_type = s.signal_type
      AND COALESCE(s2.job_posting_id, '00000000-0000-0000-0000-000000000000') = COALESCE(s.job_posting_id, '00000000-0000-0000-0000-000000000000')
  );

-- 3. Actualizar señales de tecnología huérfanas (las que no son duplicadas)
-- Busca el nuevo ID en dictionary_products basándose en keyword_matched
UPDATE signals s
SET signal_id = dp.id
FROM dictionary_products dp
WHERE s.signal_type = 'technology'
  AND s.signal_id IS NOT NULL
  AND s.keyword_matched IS NOT NULL
  -- El signal_id actual no existe en el diccionario
  AND NOT EXISTS (
    SELECT 1 FROM dictionary_products dp2 WHERE dp2.id = s.signal_id
  )
  -- Buscar match por keyword (case insensitive)
  AND (
    LOWER(dp.name) = LOWER(s.keyword_matched)
    OR LOWER(s.keyword_matched) = ANY(SELECT LOWER(unnest(dp.keywords)))
  );

-- 4. Actualizar señales de vendor huérfanas
UPDATE signals s
SET signal_id = dv.id
FROM dictionary_vendors dv
WHERE s.signal_type = 'vendor'
  AND s.signal_id IS NOT NULL
  AND s.keyword_matched IS NOT NULL
  -- El signal_id actual no existe en el diccionario
  AND NOT EXISTS (
    SELECT 1 FROM dictionary_vendors dv2 WHERE dv2.id = s.signal_id
  )
  -- Buscar match por nombre (case insensitive)
  AND LOWER(dv.name) = LOWER(s.keyword_matched);

-- 5. Reporte final
DO $$
DECLARE
  remaining_tech INTEGER;
  remaining_vendor INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_tech
  FROM signals s
  LEFT JOIN dictionary_products dp ON s.signal_id = dp.id
  WHERE s.signal_type = 'technology'
    AND s.signal_id IS NOT NULL
    AND dp.id IS NULL;
  
  SELECT COUNT(*) INTO remaining_vendor
  FROM signals s
  LEFT JOIN dictionary_vendors dv ON s.signal_id = dv.id
  WHERE s.signal_type = 'vendor'
    AND s.signal_id IS NOT NULL
    AND dv.id IS NULL;
    
  RAISE NOTICE 'Señales de tecnología huérfanas restantes: %', remaining_tech;
  RAISE NOTICE 'Señales de vendor huérfanas restantes: %', remaining_vendor;
  
  IF remaining_tech > 0 OR remaining_vendor > 0 THEN
    RAISE NOTICE 'NOTA: Las señales restantes tienen keywords que no coinciden con ningún producto/vendor actual en el diccionario. Revisar manualmente o agregar al diccionario.';
  END IF;
END $$;
