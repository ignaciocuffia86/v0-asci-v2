ALTER TABLE user_documents
ADD COLUMN IF NOT EXISTS key_results TEXT[] DEFAULT '{}';

COMMENT ON COLUMN user_documents.key_results IS
  'Up to 5 concrete, quantifiable results extracted by AI from the document (e.g. "60% reduction in processing time"). Empty array if no concrete metrics found.';
