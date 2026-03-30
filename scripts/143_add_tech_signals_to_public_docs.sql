-- Migration: Add tech_signals and content_extracted columns to company_public_docs
-- Purpose: Store detected technology signals (vendors, investments, initiatives) from document analysis

-- Add tech_signals column to store detected technology signals from documents
ALTER TABLE company_public_docs 
ADD COLUMN IF NOT EXISTS tech_signals JSONB DEFAULT '[]'::jsonb;

-- Structure for tech_signals:
-- [
--   {
--     "signal_type": "vendor_used" | "vendor_planned" | "tech_initiative" | "investment_planned",
--     "name": "SAP S/4HANA",
--     "confidence": "confirmed" | "likely" | "inferred",
--     "context": "Brief context of how it's mentioned",
--     "source_quote": "Exact quote from document"
--   }
-- ]

-- Add content_extracted flag to track which documents had their content successfully extracted
ALTER TABLE company_public_docs 
ADD COLUMN IF NOT EXISTS content_extracted BOOLEAN DEFAULT FALSE;

-- Add index for tech_signals to enable searching by vendor/technology
CREATE INDEX IF NOT EXISTS idx_public_docs_tech_signals 
ON company_public_docs USING GIN (tech_signals);

-- Comments
COMMENT ON COLUMN company_public_docs.tech_signals IS 'JSON array of detected technology signals (vendors, investments, initiatives) with confidence levels and source quotes';
COMMENT ON COLUMN company_public_docs.content_extracted IS 'Whether document content was successfully extracted for analysis';
