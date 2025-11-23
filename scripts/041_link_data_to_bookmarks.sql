-- Add bookmark_id to user_company_strategies
ALTER TABLE user_company_strategies ADD COLUMN IF NOT EXISTS bookmark_id uuid REFERENCES bookmarks(id) ON DELETE CASCADE;

-- Backfill bookmark_id for strategies
UPDATE user_company_strategies s
SET bookmark_id = (
  SELECT id FROM bookmarks b 
  WHERE b.company_id = s.company_id AND b.user_id = s.user_id 
  LIMIT 1
)
WHERE bookmark_id IS NULL;

-- Drop unique constraint on (user_id, company_id) if it exists and add unique on bookmark_id
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.user_company_strategies'::regclass
    AND contype = 'u'
    AND array_to_string(conkey, ',') IN (
      array_to_string(ARRAY(
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'public.user_company_strategies'::regclass
        AND attname IN ('user_id', 'company_id')
        ORDER BY attnum
      ), ','),
      array_to_string(ARRAY(
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'public.user_company_strategies'::regclass
        AND attname IN ('company_id', 'user_id')
        ORDER BY attnum
      ), ',')
    )
  ) LOOP
    EXECUTE 'ALTER TABLE public.user_company_strategies DROP CONSTRAINT ' || r.conname;
  END LOOP;
END $$;

-- Add bookmark_id to user_company_signals
ALTER TABLE user_company_signals ADD COLUMN IF NOT EXISTS bookmark_id uuid REFERENCES bookmarks(id) ON DELETE CASCADE;

-- Backfill bookmark_id for signals
UPDATE user_company_signals s
SET bookmark_id = (
  SELECT id FROM bookmarks b 
  WHERE b.company_id = s.company_id AND b.user_id = s.user_id 
  LIMIT 1
)
WHERE bookmark_id IS NULL;

-- Add bookmark_id to user_icebreakers
ALTER TABLE user_icebreakers ADD COLUMN IF NOT EXISTS bookmark_id uuid REFERENCES bookmarks(id) ON DELETE CASCADE;

-- Backfill bookmark_id for icebreakers
UPDATE user_icebreakers i
SET bookmark_id = (
  SELECT id FROM bookmarks b 
  WHERE b.company_id = i.company_id AND b.user_id = i.user_id 
  LIMIT 1
)
WHERE bookmark_id IS NULL;
