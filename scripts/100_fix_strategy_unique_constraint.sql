-- Add unique constraint on (bookmark_id, user_id) for user_company_strategies
-- This allows upsert operations using ON CONFLICT

-- First, remove any duplicates if they exist
DELETE FROM user_company_strategies a
USING user_company_strategies b
WHERE a.id > b.id 
  AND a.bookmark_id = b.bookmark_id 
  AND a.user_id = b.user_id
  AND a.bookmark_id IS NOT NULL;

-- Add the unique constraint
ALTER TABLE user_company_strategies 
DROP CONSTRAINT IF EXISTS user_company_strategies_bookmark_user_unique;

ALTER TABLE user_company_strategies 
ADD CONSTRAINT user_company_strategies_bookmark_user_unique 
UNIQUE (bookmark_id, user_id);
