-- ============================================================================
-- 140 - Functional indexes for company name lookups in upsert_company
-- ============================================================================
-- Problem: upsert_company matches existing companies by name using:
--     WHERE LOWER(COALESCE(name, '')) = <norm>
--        OR LOWER(COALESCE(normalized_name, '')) = <norm>
--   The existing indexes are on the raw columns (name, normalized_name) WITHOUT
--   the LOWER()/COALESCE() wrapper, so the planner cannot use them and falls back
--   to a Seq Scan over the full companies table (~464k rows, cost ~30110) on every
--   name-only lookup. Each contact triggers several of these (current company +
--   up to 6 previous companies that are looked up by name only), which is the main
--   bottleneck behind the ~40 rows/min throughput and the upsert deadlocks.
--
-- Fix: create functional (expression) indexes whose expression EXACTLY matches the
--   predicate above, so the OR resolves to a BitmapOr of two index scans.
--
-- Safety:
--   - Purely additive. Does NOT change upsert_company logic, any data, or v2 behavior.
--   - CREATE INDEX CONCURRENTLY does not take a long write lock on the table.
--   - IF NOT EXISTS makes it idempotent / safe to re-run.
--   - NOTE: CONCURRENTLY cannot run inside a transaction block. If your migration
--     runner wraps statements in a transaction, run these two statements manually.
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_lower_name
  ON public.companies (LOWER(COALESCE(name, '')));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_lower_normalized_name
  ON public.companies (LOWER(COALESCE(normalized_name, '')));

-- Refresh planner statistics so the new indexes are considered immediately.
ANALYZE public.companies;
