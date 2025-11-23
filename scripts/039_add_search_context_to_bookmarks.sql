-- Add search_context column to bookmarks table to store filter state
ALTER TABLE bookmarks
ADD COLUMN search_context JSONB DEFAULT '{}'::jsonb;
