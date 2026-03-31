-- Add tech_snippets column to company_public_docs
-- Stores detailed snippets from documents where specific technologies/vendors are mentioned

ALTER TABLE company_public_docs
ADD COLUMN tech_snippets jsonb DEFAULT '[]'::jsonb;

-- Create index for faster querying
CREATE INDEX idx_company_public_docs_tech_snippets 
ON company_public_docs USING GIN (tech_snippets);

-- Add comment to document the structure
COMMENT ON COLUMN company_public_docs.tech_snippets IS 
'Array of tech snippets with technology mentions, quotes, and context from documents. 
Each snippet includes: technology name, dictionary match, snippet type, full snippet text, source document, investment signal flag, and monetary amounts if mentioned.';
