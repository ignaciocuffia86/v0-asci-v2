-- Indices para las FKs a public.companies que no tenian ninguno.
--
-- POR QUE: Postgres NO crea un indice automatico en el lado hijo de una FK (solo
-- en la PK del padre). Sin el, cada `DELETE FROM companies` tiene que hacer un
-- seq scan por cada tabla hija para chequear la FK. El merge de duplicados borra
-- una fila de companies por empresa absorbida, asi que paga ese costo 13 veces
-- por merge, y ademas toma locks mas amplios de lo necesario.
--
-- ALCANCE MEDIDO: son 13 tablas, la mas grande de 6 MB / 5.058 filas. Hoy NO son
-- la causa del outlier de ~5s del merge (eso se midio aparte: los UPDATE de las
-- 25 hijas suman 325ms para 60 candidatos). Esto es preventivo: el costo del seq
-- scan crece con la tabla, y estas van a crecer.
--
-- CONCURRENTLY porque 5 de estas tablas son de v2 en PRODUCCION
-- (user_company_contacts, user_icebreakers, bookmarks, user_company_strategies,
-- user_company_signals) y un CREATE INDEX normal toma un lock que bloquea las
-- escrituras mientras construye. Con CONCURRENTLY los usuarios no se enteran.
--
-- COMO CORRERLO: CONCURRENTLY no puede ir dentro de una transaccion, asi que
-- necesita el modo sin transaccion del runner:
--
--   node scripts/run-sql.mjs scripts/413_fk_company_id_indexes.sql --sin-transaccion --commit
--
-- Es idempotente (IF NOT EXISTS), asi que se puede reintentar sin problema.
--
-- OJO: si un CONCURRENTLY se interrumpe a mitad deja el indice INVALIDO (existe
-- pero no se usa) y el IF NOT EXISTS del reintento lo da por hecho. La query de
-- verificacion del final chequea `indisvalid` justamente por eso.

-- v2 / public (produccion)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_company_contacts_company_id
  ON public.user_company_contacts (company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_icebreakers_company_id
  ON public.user_icebreakers (company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookmarks_company_id
  ON public.bookmarks (company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_company_strategies_company_id
  ON public.user_company_strategies (company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_company_signals_company_id
  ON public.user_company_signals (company_id);

-- v3
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_usage_log_company_id
  ON v3.ai_usage_log (company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_briefs_company_id
  ON v3.account_briefs (company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_scorecards_company_id
  ON v3.account_scorecards (company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_internal_snapshots_company_id
  ON v3.account_internal_snapshots (company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_research_jobs_company_id
  ON v3.research_jobs (company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_icebreakers_company_id
  ON v3.icebreakers (company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_contacts_company_id
  ON v3.account_contacts (company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contact_enrichment_runs_company_id
  ON v3.contact_enrichment_runs (company_id);
