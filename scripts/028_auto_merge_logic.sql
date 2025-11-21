-- Function to automatically merge safe duplicates
-- Returns the number of groups merged
CREATE OR REPLACE FUNCTION public.auto_merge_safe_duplicates()
RETURNS INTEGER AS $$
DECLARE
    group_record RECORD;
    company_record RECORD;
    master_id UUID;
    merged_count INTEGER := 0;
    companies_in_group JSONB;
    company_item JSONB;
    
    -- Variables for logic
    has_linkedin_count INTEGER;
    distinct_linkedin_urls TEXT[];
    candidate_master_id UUID;
    candidate_master_score INTEGER;
    current_score INTEGER;
BEGIN
    -- Iterate over all groups with duplicates
    FOR group_record IN 
        SELECT 
            normalized_name,
            jsonb_agg(
                jsonb_build_object(
                    'id', id,
                    'name', name,
                    'linkedin_url', linkedin_url,
                    'created_at', created_at
                )
            ) as companies
        FROM public.companies
        WHERE normalized_name IS NOT NULL
        GROUP BY normalized_name
        HAVING COUNT(*) > 1
    LOOP
        companies_in_group := group_record.companies;
        
        -- Analyze the group
        SELECT 
            COUNT(CASE WHEN (c->>'linkedin_url') IS NOT NULL AND (c->>'linkedin_url') <> '' THEN 1 END),
            ARRAY_AGG(DISTINCT (c->>'linkedin_url')) FILTER (WHERE (c->>'linkedin_url') IS NOT NULL AND (c->>'linkedin_url') <> '')
        INTO has_linkedin_count, distinct_linkedin_urls
        FROM jsonb_array_elements(companies_in_group) as c;

        -- SAFETY CHECK: If multiple DIFFERENT LinkedIn URLs exist, SKIP this group.
        IF array_length(distinct_linkedin_urls, 1) > 1 THEN
            CONTINUE; -- Unsafe to merge automatically
        END IF;

        -- Determine Master Company
        candidate_master_id := NULL;
        candidate_master_score := -1;

        FOR company_item IN SELECT * FROM jsonb_array_elements(companies_in_group)
        LOOP
            current_score := 0;
            
            -- Score 1: Has LinkedIn URL (Highest Priority)
            IF (company_item->>'linkedin_url') IS NOT NULL AND (company_item->>'linkedin_url') <> '' THEN
                current_score := current_score + 100;
            END IF;

            -- Score 2: Name Length (Longer is usually better/more formal, e.g. "S.A.")
            current_score := current_score + length(company_item->>'name');

            -- Update candidate if score is higher
            IF current_score > candidate_master_score THEN
                candidate_master_score := current_score;
                candidate_master_id := (company_item->>'id')::UUID;
            END IF;
        END LOOP;

        -- Execute Merge for all non-master companies in the group
        IF candidate_master_id IS NOT NULL THEN
            FOR company_item IN SELECT * FROM jsonb_array_elements(companies_in_group)
            LOOP
                IF (company_item->>'id')::UUID <> candidate_master_id THEN
                    PERFORM public.merge_companies(candidate_master_id, (company_item->>'id')::UUID);
                END IF;
            END LOOP;
            
            merged_count := merged_count + 1;
        END IF;

    END LOOP;

    RETURN merged_count;
END;
$$ LANGUAGE plpgsql;
