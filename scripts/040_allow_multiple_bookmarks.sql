-- Remove unique constraint on (user_id, company_id) in bookmarks table if it exists
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Find any unique constraint or index on user_id and company_id
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.bookmarks'::regclass
    AND contype = 'u'
    AND array_to_string(conkey, ',') IN (
      array_to_string(ARRAY(
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'public.bookmarks'::regclass
        AND attname IN ('user_id', 'company_id')
        ORDER BY attnum
      ), ','),
       array_to_string(ARRAY(
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'public.bookmarks'::regclass
        AND attname IN ('company_id', 'user_id')
        ORDER BY attnum
      ), ',')
    )
  ) LOOP
    EXECUTE 'ALTER TABLE public.bookmarks DROP CONSTRAINT ' || r.conname;
  END LOOP;
  
  -- Also drop any unique index that might not be a constraint
  FOR r IN (
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = 'bookmarks'
    AND indexdef LIKE '%UNIQUE%'
    AND indexdef LIKE '%user_id%'
    AND indexdef LIKE '%company_id%'
  ) LOOP
    EXECUTE 'DROP INDEX IF EXISTS ' || r.indexname;
  END LOOP;
END $$;
