-- Migration: Create company_public_docs table
-- Purpose: Store public documents research (SEC filings, annual reports, earnings calls, sustainability reports)

CREATE TABLE IF NOT EXISTS company_public_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Relationships
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bookmark_id UUID REFERENCES bookmarks(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Who requested and when
  requested_by UUID REFERENCES auth.users(id),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Document metadata
  document_type TEXT NOT NULL, -- '10-K', '10-Q', '8-K', 'annual_report', 'earnings_call', 'sustainability', 'financial'
  document_title TEXT NOT NULL,
  document_date DATE, -- Fiscal year end, quarter end, or publication date
  fiscal_year INTEGER,
  fiscal_quarter INTEGER, -- NULL for annual reports
  
  -- Source information
  source_url TEXT NOT NULL, -- Verified URL to original document
  source_name TEXT, -- 'SEC EDGAR', 'Company IR', 'SeekingAlpha', etc.
  document_language TEXT, -- 'en', 'es', 'pt'
  
  -- Company ticker for re-searches
  ticker VARCHAR(10),
  
  -- AI-extracted findings (anti-hallucination: always include quotes and sources)
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Structure: [{ category, finding, quote, source_page, relevance }]
  
  -- Digest for Home/Feed
  digest TEXT, -- 1-paragraph summary in Spanish
  digest_generated_at TIMESTAMPTZ,
  
  -- Processing metadata
  ai_provider TEXT, -- 'gemini-2.0-flash', etc.
  extraction_method TEXT, -- 'parallel_extract', 'sec_html', 'fallback'
  processing_error TEXT, -- Error message if extraction failed
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_public_docs_company ON company_public_docs(company_id);
CREATE INDEX IF NOT EXISTS idx_public_docs_bookmark ON company_public_docs(bookmark_id);
CREATE INDEX IF NOT EXISTS idx_public_docs_user ON company_public_docs(user_id);
CREATE INDEX IF NOT EXISTS idx_public_docs_type ON company_public_docs(document_type);
CREATE INDEX IF NOT EXISTS idx_public_docs_requested_at ON company_public_docs(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_docs_ticker ON company_public_docs(ticker);

-- Unique constraint to prevent duplicate documents for same company
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_docs_unique 
  ON company_public_docs(company_id, document_type, source_url);

-- Enable RLS
ALTER TABLE company_public_docs ENABLE ROW LEVEL SECURITY;

-- RLS Policies (same pattern as company_news and company_implementations)

-- Anyone can view public docs for companies they have bookmarked
CREATE POLICY "Anyone can view public docs for bookmarked companies" ON company_public_docs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bookmarks b 
      WHERE b.company_id = company_public_docs.company_id 
      AND b.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'superadmin'
    )
  );

-- Authenticated users can insert public docs
CREATE POLICY "Authenticated users can insert public docs" ON company_public_docs
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Authenticated users can update public docs
CREATE POLICY "Authenticated users can update public docs" ON company_public_docs
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Superadmins can delete public docs
CREATE POLICY "Superadmins can delete public docs" ON company_public_docs
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'superadmin'
    )
  );

-- Create interactions table for tracking user views
CREATE TABLE IF NOT EXISTS user_public_doc_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  public_doc_id UUID NOT NULL REFERENCES company_public_docs(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  
  viewed_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ,
  source TEXT, -- 'bookmark_tab', 'home_feed', 'digest_email'
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, public_doc_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_public_doc_interactions_user ON user_public_doc_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_public_doc_interactions_doc ON user_public_doc_interactions(public_doc_id);
CREATE INDEX IF NOT EXISTS idx_public_doc_interactions_company ON user_public_doc_interactions(company_id);

-- Enable RLS
ALTER TABLE user_public_doc_interactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own public doc interactions" ON user_public_doc_interactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own public doc interactions" ON user_public_doc_interactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own public doc interactions" ON user_public_doc_interactions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all public doc interactions" ON user_public_doc_interactions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Comments
COMMENT ON TABLE company_public_docs IS 'Stores AI-analyzed public documents (SEC filings, annual reports, earnings calls, sustainability reports)';
COMMENT ON COLUMN company_public_docs.findings IS 'JSON array of findings with quotes and sources for anti-hallucination';
COMMENT ON COLUMN company_public_docs.digest IS 'AI-generated 1-paragraph summary in Spanish for Home/Feed';
