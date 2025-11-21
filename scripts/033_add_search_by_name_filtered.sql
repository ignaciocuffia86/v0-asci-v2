CREATE OR REPLACE FUNCTION search_companies_by_name_filtered(
  p_query_text TEXT,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  logo_url TEXT,
  country TEXT,
  industry TEXT,
  linkedin_url TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.logo_url,
    c.country,
    c.industry,
    c.linkedin_url
  FROM
    companies c
  WHERE
    c.name ILIKE '%' || p_query_text || '%'
    AND c.linkedin_url IS NOT NULL
    AND c.linkedin_url != ''
    AND EXISTS (
      SELECT 1 FROM signals s WHERE s.company_id = c.id
    )
  LIMIT p_limit;
END;
$$;
