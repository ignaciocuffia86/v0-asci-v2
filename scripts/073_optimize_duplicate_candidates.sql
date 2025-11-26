-- Optimize get_duplicate_candidates with limit and better performance
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
  GROUP BY c.normalized_name
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Add index on normalized_name if not exists
CREATE INDEX IF NOT EXISTS idx_companies_normalized_name 
ON public.companies(normalized_name) 
WHERE normalized_name IS NOT NULL;
