-- Migration: Add status column to bookmarks for prospection tracking
-- This enables tracking the sales pipeline status for each bookmarked company

-- Add status column with enum-like constraint
ALTER TABLE bookmarks 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'nuevo';

-- Add check constraint for valid status values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookmarks_status_check'
  ) THEN
    ALTER TABLE bookmarks 
    ADD CONSTRAINT bookmarks_status_check 
    CHECK (status IN ('nuevo', 'investigando', 'contactado', 'respondio', 'reunion', 'descartado'));
  END IF;
END $$;

-- Create index for faster filtering by status
CREATE INDEX IF NOT EXISTS idx_bookmarks_status ON bookmarks(status);

-- Create index for filtering by user + status (common query pattern)
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_status ON bookmarks(user_id, status);

-- Update existing bookmarks to have 'nuevo' status if null
UPDATE bookmarks SET status = 'nuevo' WHERE status IS NULL;

-- Verify the migration
SELECT 
  'Migration complete' as message,
  COUNT(*) as total_bookmarks,
  COUNT(*) FILTER (WHERE status = 'nuevo') as nuevo_count
FROM bookmarks;
