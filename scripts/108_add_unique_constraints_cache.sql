-- Add unique constraints for cache tables to support upsert operations
-- This allows us to avoid duplicates when the same news/implementation is found multiple times

-- Create unique index on company_news (company_id, title)
-- This ensures we don't store duplicate news for the same company
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_news_unique 
ON company_news (company_id, title);

-- Create unique index on company_implementations (company_id, title)
-- This ensures we don't store duplicate implementations for the same company
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_implementations_unique 
ON company_implementations (company_id, title);

-- Note: These indexes enable the on_conflict clause in upserts
-- Example: .upsert(data, { onConflict: 'company_id,title' })
