-- Migration: Add public company fields to companies table
-- Purpose: Support detection of public vs private companies for SEC filings

-- Add columns for public company detection
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_public BOOLEAN;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ticker VARCHAR(10);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cik VARCHAR(10);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stock_exchange VARCHAR(50); -- 'NYSE', 'NASDAQ', 'BMV', etc.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS public_status_checked_at TIMESTAMPTZ;

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_companies_is_public ON companies(is_public);
CREATE INDEX IF NOT EXISTS idx_companies_ticker ON companies(ticker);
CREATE INDEX IF NOT EXISTS idx_companies_cik ON companies(cik);

-- Add comment for documentation
COMMENT ON COLUMN companies.is_public IS 'Whether the company is publicly traded (has SEC filings)';
COMMENT ON COLUMN companies.ticker IS 'Stock ticker symbol (e.g., AAPL, MSFT, WALMEX)';
COMMENT ON COLUMN companies.cik IS 'SEC Central Index Key for EDGAR filings';
COMMENT ON COLUMN companies.stock_exchange IS 'Stock exchange where company is listed (NYSE, NASDAQ, BMV, etc.)';
COMMENT ON COLUMN companies.public_status_checked_at IS 'Last time we verified the public/private status';
