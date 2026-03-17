-- Add selected_doc_ids to user_company_strategies so the icebreaker can use
-- the exact documents the user selected in the Strategy tab.
ALTER TABLE user_company_strategies
  ADD COLUMN IF NOT EXISTS selected_doc_ids UUID[] DEFAULT NULL;

COMMENT ON COLUMN user_company_strategies.selected_doc_ids IS
  'IDs of user_documents selected by the user in the Strategy tab to use for icebreaker generation';
