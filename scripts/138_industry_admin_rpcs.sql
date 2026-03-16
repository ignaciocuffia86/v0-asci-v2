-- RPCs para panel de administración de industrias

-- RPC: Obtener industrias de companies sin mapear
CREATE OR REPLACE FUNCTION get_unmapped_company_industries()
RETURNS TABLE (
  industry TEXT,
  count BIGINT
) 
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    c.industry,
    COUNT(*) as count
  FROM companies c
  LEFT JOIN industry_mappings im 
    ON LOWER(TRIM(c.industry)) = LOWER(TRIM(im.original_value)) 
    AND im.source_type = 'company'
  WHERE c.industry IS NOT NULL 
    AND c.industry != ''
    AND c.master_industry_id IS NULL
    AND im.id IS NULL
  GROUP BY c.industry
  ORDER BY count DESC
  LIMIT 100;
$$;

-- RPC: Obtener tags de documentos sin mapear
CREATE OR REPLACE FUNCTION get_unmapped_document_industries()
RETURNS TABLE (
  tag_value TEXT,
  count BIGINT
) 
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    dt.tag_value,
    COUNT(*) as count
  FROM document_tags dt
  LEFT JOIN industry_mappings im 
    ON LOWER(TRIM(dt.tag_value)) = LOWER(TRIM(im.original_value)) 
    AND im.source_type = 'document'
  WHERE dt.tag_type = 'industry'
    AND dt.master_industry_id IS NULL
    AND im.id IS NULL
  GROUP BY dt.tag_value
  ORDER BY count DESC
  LIMIT 100;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION get_unmapped_company_industries() TO service_role;
GRANT EXECUTE ON FUNCTION get_unmapped_document_industries() TO service_role;
