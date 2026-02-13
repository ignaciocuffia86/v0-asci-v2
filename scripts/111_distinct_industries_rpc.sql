-- RPC function to get distinct industries from companies table
-- Used by document analysis to match against known industries

CREATE OR REPLACE FUNCTION get_distinct_industries()
RETURNS TABLE(industry text) 
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT DISTINCT c.industry 
  FROM companies c 
  WHERE c.industry IS NOT NULL AND c.industry != ''
  ORDER BY c.industry
  LIMIT 200;
$$;
