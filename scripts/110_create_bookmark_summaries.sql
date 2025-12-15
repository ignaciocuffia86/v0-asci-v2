-- Create table for bookmark summaries
CREATE TABLE IF NOT EXISTS bookmark_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bookmark_id UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Metadata about what was included in the summary
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Unique constraint: one summary per bookmark (can be regenerated)
  UNIQUE(bookmark_id)
);

-- Index for faster lookup
CREATE INDEX IF NOT EXISTS idx_bookmark_summaries_bookmark_id ON bookmark_summaries(bookmark_id);

-- Enable RLS
ALTER TABLE bookmark_summaries ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see summaries of their own bookmarks
CREATE POLICY "Users can view their own bookmark summaries"
  ON bookmark_summaries
  FOR SELECT
  USING (
    bookmark_id IN (
      SELECT id FROM bookmarks WHERE user_id = auth.uid()
    )
  );

-- RLS Policy: Users can insert summaries for their own bookmarks
CREATE POLICY "Users can create summaries for their own bookmarks"
  ON bookmark_summaries
  FOR INSERT
  WITH CHECK (
    bookmark_id IN (
      SELECT id FROM bookmarks WHERE user_id = auth.uid()
    )
  );

-- RLS Policy: Users can update their own bookmark summaries
CREATE POLICY "Users can update their own bookmark summaries"
  ON bookmark_summaries
  FOR UPDATE
  USING (
    bookmark_id IN (
      SELECT id FROM bookmarks WHERE user_id = auth.uid()
    )
  );

-- RLS Policy: Users can delete their own bookmark summaries
CREATE POLICY "Users can delete their own bookmark summaries"
  ON bookmark_summaries
  FOR DELETE
  USING (
    bookmark_id IN (
      SELECT id FROM bookmarks WHERE user_id = auth.uid()
    )
  );
