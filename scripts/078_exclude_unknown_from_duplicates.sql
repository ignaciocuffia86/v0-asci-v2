-- Exclude "Unknown Company" from duplicate detection process
-- These are placeholder companies for contacts without company data

-- DROP existing functions first to allow return type change
DROP FUNCTION IF EXISTS public.get_duplicate_candidates();
DROP FUNCTION IF EXISTS public.get_duplicate_candidates(integer);

CREATE OR REPLACE FUNCTION public.get_duplicate_candidates(
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  normalized_name TEXT,
  count BIGINT,
  companies JSONB
) AS $$
BEGIN
  -- Set statement timeout to 10 seconds to avoid blocking
  SET LOCAL statement_timeout = '10s';
  
  RETURN QUERY
  SELECT 
    c.normalized_name,
    COUNT(*) as cnt,
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'linkedin_url', c.linkedin_url,
        'created_at', c.created_at
      ) ORDER BY c.created_at ASC
    ) as companies
  FROM public.companies c
  WHERE c.normalized_name IS NOT NULL
    -- Exclude Unknown Company from duplicates - they are placeholders
    AND c.normalized_name != 'unknown company'
  GROUP BY c.normalized_name
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Also update auto_merge to skip Unknown Company
CREATE OR REPLACE FUNCTION public.auto_merge_safe_duplicates(
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  merged_name TEXT,
  kept_id UUID,
  merged_ids UUID[]
) AS $$
DECLARE
  v_dup RECORD;
  v_primary_id UUID;
  v_merge_ids UUID[];
  v_merged_count INTEGER := 0;
BEGIN
  -- Process duplicates that are safe to auto-merge
  FOR v_dup IN (
    SELECT 
      c.normalized_name,
      array_agg(c.id ORDER BY 
        CASE WHEN c.linkedin_url IS NOT NULL THEN 0 ELSE 1 END,
        c.created_at ASC
      ) as company_ids
    FROM public.companies c
    WHERE c.normalized_name IS NOT NULL
      -- Exclude Unknown Company from auto-merge
      AND c.normalized_name != 'unknown company'
    GROUP BY c.normalized_name
    HAVING COUNT(*) > 1
      -- Only merge if all have same linkedin_url or all are null
      AND (
        COUNT(DISTINCT c.linkedin_url) <= 1 
        OR COUNT(c.linkedin_url) = 0
      )
    ORDER BY COUNT(*) DESC
    LIMIT p_limit
  ) LOOP
    -- Keep first (oldest with linkedin_url preferred)
    v_primary_id := v_dup.company_ids[1];
    v_merge_ids := v_dup.company_ids[2:];
    
    -- Merge each duplicate into primary
    FOR i IN 1..array_length(v_merge_ids, 1) LOOP
      PERFORM public.merge_companies(v_primary_id, v_merge_ids[i]);
    END LOOP;
    
    merged_name := v_dup.normalized_name;
    kept_id := v_primary_id;
    merged_ids := v_merge_ids;
    v_merged_count := v_merged_count + 1;
    
    RETURN NEXT;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Verify the change
SELECT 
  'Unknown Company excluido de duplicados' as status,
  (SELECT COUNT(*) FROM companies WHERE normalized_name = 'unknown company') as unknown_companies_count;
