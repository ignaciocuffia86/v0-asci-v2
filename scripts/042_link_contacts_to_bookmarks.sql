-- Add bookmark_id to user_company_contacts
ALTER TABLE user_company_contacts ADD COLUMN IF NOT EXISTS bookmark_id uuid REFERENCES bookmarks(id) ON DELETE CASCADE;

-- Backfill bookmark_id for contacts
UPDATE user_company_contacts c
SET bookmark_id = (
  SELECT id FROM bookmarks b 
  WHERE b.company_id = c.company_id AND b.user_id = c.user_id 
  LIMIT 1
)
WHERE bookmark_id IS NULL;
