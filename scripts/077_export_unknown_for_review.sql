-- Script 077: Exportar contactos Unknown sin empresa extraíble para revisión manual
-- Estos contactos necesitan enriquecimiento de datos (LinkedIn scraping o revisión manual)

-- Reporte completo de contactos Unknown sin empresa extraíble
SELECT 
  co.id,
  co.first_name,
  co.last_name,
  co.headline,
  co.current_position_title,
  co.linkedin_url,
  CASE 
    WHEN co.headline = '' OR co.headline IS NULL THEN 'SIN_HEADLINE'
    WHEN co.headline NOT LIKE '%en %' AND co.headline NOT LIKE '%at %' THEN 'HEADLINE_SIN_EMPRESA'
    ELSE 'OTRO'
  END as categoria,
  c.name as current_company
FROM contacts co
JOIN companies c ON co.current_company_id = c.id
WHERE c.normalized_name = 'unknown company'
  AND public.extract_company_from_headline(co.headline) IS NULL
ORDER BY 
  CASE 
    WHEN co.linkedin_url IS NOT NULL AND co.linkedin_url != '' THEN 0 
    ELSE 1 
  END,
  co.last_name;

-- Resumen por categoría
SELECT 
  CASE 
    WHEN co.headline = '' OR co.headline IS NULL THEN 'SIN_HEADLINE'
    WHEN co.headline NOT LIKE '%en %' AND co.headline NOT LIKE '%at %' THEN 'HEADLINE_SIN_EMPRESA'
    ELSE 'OTRO'
  END as categoria,
  COUNT(*) as cantidad,
  COUNT(*) FILTER (WHERE co.linkedin_url IS NOT NULL AND co.linkedin_url != '') as con_linkedin
FROM contacts co
JOIN companies c ON co.current_company_id = c.id
WHERE c.normalized_name = 'unknown company'
  AND public.extract_company_from_headline(co.headline) IS NULL
GROUP BY 1
ORDER BY cantidad DESC;
