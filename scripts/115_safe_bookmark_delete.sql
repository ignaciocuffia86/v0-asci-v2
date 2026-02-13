-- ============================================================
-- Migration: Safe bookmark deletion
-- Change CASCADE DELETE to SET NULL for shared/reusable data
-- so that deleting a bookmark preserves news, implementations
-- and contacts for other users.
-- ============================================================

-- 1. company_news: bookmark_id FK → SET NULL
-- (news are shared resources, not per-bookmark)
DO $$
BEGIN
  -- Drop the existing CASCADE constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'company_news_bookmark_id_fkey'
    AND table_name = 'company_news'
  ) THEN
    ALTER TABLE company_news DROP CONSTRAINT company_news_bookmark_id_fkey;
  END IF;

  -- Re-add with SET NULL
  ALTER TABLE company_news 
    ADD CONSTRAINT company_news_bookmark_id_fkey 
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE SET NULL;
END $$;

-- 2. company_implementations: bookmark_id FK → SET NULL
-- (implementations are shared resources)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'company_implementations_bookmark_id_fkey'
    AND table_name = 'company_implementations'
  ) THEN
    ALTER TABLE company_implementations DROP CONSTRAINT company_implementations_bookmark_id_fkey;
  END IF;

  ALTER TABLE company_implementations 
    ADD CONSTRAINT company_implementations_bookmark_id_fkey 
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE SET NULL;
END $$;

-- 3. user_company_contacts: bookmark_id FK → SET NULL
-- (contacts from Apollo are reusable across bookmarks)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'user_company_contacts_bookmark_id_fkey'
    AND table_name = 'user_company_contacts'
  ) THEN
    ALTER TABLE user_company_contacts DROP CONSTRAINT user_company_contacts_bookmark_id_fkey;
  END IF;

  ALTER TABLE user_company_contacts 
    ADD CONSTRAINT user_company_contacts_bookmark_id_fkey 
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE SET NULL;
END $$;

-- Note: These tables KEEP CASCADE DELETE (correct behavior - per-user data):
-- - bookmark_summaries (brief content, per bookmark)
-- - user_company_signals (signals selected by user for this bookmark)
-- - user_company_strategies (strategy text, per bookmark)
-- - user_icebreakers (icebreaker messages, per bookmark)
