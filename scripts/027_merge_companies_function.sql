CREATE OR REPLACE FUNCTION public.merge_companies(
  p_master_company_id UUID,
  p_duplicate_company_id UUID
) RETURNS VOID AS $$
BEGIN
  -- 1. Move Contacts
  UPDATE public.contacts 
  SET current_company_id = p_master_company_id 
  WHERE current_company_id = p_duplicate_company_id;

  -- 2. Move Signals
  -- We need to be careful about duplicates here. 
  -- If moving a signal creates a conflict (same contact, same signal, same master company), we should delete the duplicate signal.
  
  -- First, delete signals from duplicate company that would cause conflict in master
  DELETE FROM public.signals s_dup
  WHERE company_id = p_duplicate_company_id
  AND EXISTS (
    SELECT 1 FROM public.signals s_master
    WHERE s_master.company_id = p_master_company_id
    AND s_master.contact_id = s_dup.contact_id
    AND s_master.signal_id = s_dup.signal_id
  );
  
  -- Then move the rest
  UPDATE public.signals 
  SET company_id = p_master_company_id 
  WHERE company_id = p_duplicate_company_id;

  -- 3. Move Bookmarks
  -- Similar logic: delete conflicting bookmarks first
  DELETE FROM public.bookmarks b_dup
  WHERE company_id = p_duplicate_company_id
  AND EXISTS (
    SELECT 1 FROM public.bookmarks b_master
    WHERE b_master.company_id = p_master_company_id
    AND b_master.user_id = b_dup.user_id
  );
  
  -- Move the rest
  UPDATE public.bookmarks 
  SET company_id = p_master_company_id 
  WHERE company_id = p_duplicate_company_id;

  -- 4. Delete the duplicate company
  DELETE FROM public.companies WHERE id = p_duplicate_company_id;
  
END;
$$ LANGUAGE plpgsql;

-- Function to find duplicate candidates
CREATE OR REPLACE FUNCTION public.get_duplicate_candidates()
RETURNS TABLE (
  normalized_name TEXT,
  count BIGINT,
  companies JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.normalized_name,
    COUNT(*) as count,
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
  HAVING COUNT(*) > 1;
END;
$$ LANGUAGE plpgsql;
