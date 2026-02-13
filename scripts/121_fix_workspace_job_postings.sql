-- Fix: Job postings not showing in workspace after bookmarking from process search
--
-- Root cause: get_company_job_postings filters on jp.company_id (job_postings table),
-- but many job_postings have company_id = NULL. The drawer RPC (get_company_drawer_data)
-- works because it starts FROM signals and filters on s.company_id (always populated).
--
-- Fix: Rewrite get_company_job_postings to start FROM signals (like the drawer),
-- joining to job_postings, and filtering on s.company_id instead of jp.company_id.

CREATE OR REPLACE FUNCTION get_company_job_postings(
  p_company_id UUID,
  p_signal_ids UUID[] DEFAULT NULL,
  p_limit INT DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  posted_at TIMESTAMPTZ,
  apply_url TEXT,
  detected_keywords JSONB,
  is_recent BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    jp.id,
    jp.title,
    jp.posted_at,
    COALESCE(jp.apply_url, max_source_url.url) as apply_url,
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'keyword', s.keyword_matched,
        'signal_type', s.signal_type,
        'signal_name', COALESCE(dp.name, dpr.name, s.keyword_matched)
      )
    ) FILTER (WHERE s.id IS NOT NULL) AS detected_keywords,
    (jp.posted_at >= NOW() - INTERVAL '1 month') AS is_recent
  FROM signals s
  JOIN job_postings jp ON jp.id = s.job_posting_id
  LEFT JOIN dictionary_processes dp ON s.signal_id = dp.id AND s.signal_type = 'process'
  LEFT JOIN dictionary_products dpr ON s.signal_id = dpr.id AND s.signal_type = 'technology'
  LEFT JOIN LATERAL (
    SELECT s2.source_url as url 
    FROM signals s2 
    WHERE s2.job_posting_id = jp.id AND s2.source_url IS NOT NULL 
    LIMIT 1
  ) max_source_url ON true
  WHERE s.company_id = p_company_id
    AND s.job_posting_id IS NOT NULL
    AND (p_signal_ids IS NULL OR s.signal_id = ANY(p_signal_ids))
    AND jp.posted_at >= NOW() - INTERVAL '6 months'
  GROUP BY jp.id, jp.title, jp.posted_at, jp.apply_url, max_source_url.url
  ORDER BY jp.posted_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
