-- Migration: Add digest fields to news and implementations tables
-- Purpose: Store AI-generated digest summaries for future Home/Feed display

-- Add digest fields to company_news
ALTER TABLE company_news ADD COLUMN IF NOT EXISTS digest TEXT;
ALTER TABLE company_news ADD COLUMN IF NOT EXISTS digest_generated_at TIMESTAMPTZ;

-- Add digest fields to company_implementations
ALTER TABLE company_implementations ADD COLUMN IF NOT EXISTS digest TEXT;
ALTER TABLE company_implementations ADD COLUMN IF NOT EXISTS digest_generated_at TIMESTAMPTZ;

-- Add comments for documentation
COMMENT ON COLUMN company_news.digest IS 'AI-generated 1-paragraph summary in Spanish for Home/Feed display';
COMMENT ON COLUMN company_news.digest_generated_at IS 'Timestamp when the digest was generated';
COMMENT ON COLUMN company_implementations.digest IS 'AI-generated 1-paragraph summary in Spanish for Home/Feed display';
COMMENT ON COLUMN company_implementations.digest_generated_at IS 'Timestamp when the digest was generated';
