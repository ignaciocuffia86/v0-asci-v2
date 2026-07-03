-- =============================================================================
-- ASCI v3 - Rediseño cuenta-céntrico
-- Tablas nuevas en schema v3 (chat, research jobs, follows, scorecards,
-- icebreakers, digest, sugerencias de diccionario) + cache global aditivo
-- en public (radar_research_runs, radar_findings).
--
-- REGLAS:
--  - Cero cambios destructivos: solo CREATE TABLE IF NOT EXISTS.
--  - No se modifica ninguna tabla existente de public (v2) ni de v3.
--  - RLS: misma convención que el resto de v3 (service_role full access +
--    usuarios scoped por v3.user_workspace_id(auth.uid())).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Chat
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_chat_conversations_workspace_user
  ON v3.chat_conversations (workspace_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS v3.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES v3.chat_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_chat_messages_conversation
  ON v3.chat_messages (conversation_id, created_at);

-- -----------------------------------------------------------------------------
-- 2. Research jobs (pipeline asíncrono por cuenta; batch_id agrupa el lote)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3.research_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES v3.chat_conversations(id) ON DELETE SET NULL,
  batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id),
  company_input text NOT NULL,            -- lo que escribió el usuario / fila del CSV
  resolved_domain text,
  resolved_country text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','cancelled')),
  current_step text,                       -- ej: 'news-radar', 'tech-radar', 'jobs', 'contacts', 'scoring', 'icebreakers'
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  force_refresh boolean NOT NULL DEFAULT false,
  error text,
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_v3_research_jobs_workspace
  ON v3.research_jobs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v3_research_jobs_status
  ON v3.research_jobs (status) WHERE status IN ('pending','running');
CREATE INDEX IF NOT EXISTS idx_v3_research_jobs_batch
  ON v3.research_jobs (batch_id);

-- -----------------------------------------------------------------------------
-- 3. Cuentas seguidas (follow a nivel workspace) + suscriptores de digest
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3.followed_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  followed_by uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  refresh_day smallint NOT NULL DEFAULT 1 CHECK (refresh_day BETWEEN 1 AND 28),
  last_refreshed_at timestamptz,
  unfollowed_at timestamptz,
  unfollowed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_v3_followed_accounts_workspace
  ON v3.followed_accounts (workspace_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_v3_followed_accounts_refresh
  ON v3.followed_accounts (refresh_day) WHERE is_active;

CREATE TABLE IF NOT EXISTS v3.followed_account_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  followed_account_id uuid NOT NULL REFERENCES v3.followed_accounts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  subscribed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (followed_account_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_v3_fa_subscribers_account
  ON v3.followed_account_subscribers (followed_account_id) WHERE subscribed;

-- -----------------------------------------------------------------------------
-- 4. Scorecards (versionados por ejecución)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3.account_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  research_job_id uuid REFERENCES v3.research_jobs(id) ON DELETE SET NULL,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  fit_score smallint NOT NULL CHECK (fit_score BETWEEN 0 AND 100),
  buying_signals_score smallint NOT NULL CHECK (buying_signals_score BETWEEN 0 AND 100),
  accessibility_score smallint NOT NULL CHECK (accessibility_score BETWEEN 0 AND 100),
  timing_score smallint NOT NULL CHECK (timing_score BETWEEN 0 AND 100),
  rationale text,                          -- explicación generada (por tenant, atada a la PV)
  dictionary_matches jsonb,                -- intersección PV<->cuenta por IDs de diccionario (auditable)
  signals_snapshot jsonb,                  -- señales consideradas al momento del cálculo
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_scorecards_workspace_company
  ON v3.account_scorecards (workspace_id, company_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Icebreakers (generativo por tenant, regionalizado por país del contacto)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3.icebreakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  research_job_id uuid REFERENCES v3.research_jobs(id) ON DELETE SET NULL,
  contact_apollo_id text,
  contact_name text NOT NULL,
  contact_title text,
  contact_country text,                    -- país del decision maker (Apollo)
  language_register text NOT NULL DEFAULT 'es-neutral',  -- ej: es-AR (voseo), es-CL, es-CO, es-neutral
  content text NOT NULL,
  evidence jsonb,                          -- señales/snippets citados en el mensaje
  version integer NOT NULL DEFAULT 1,
  regenerated_from uuid REFERENCES v3.icebreakers(id) ON DELETE SET NULL,
  regeneration_instruction text,           -- instrucción del usuario al regenerar
  feedback smallint CHECK (feedback IN (-1, 1)),
  feedback_note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_icebreakers_workspace_company
  ON v3.icebreakers (workspace_id, company_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 6. Log de digests enviados (para calcular novedades desde el último envío)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3.digest_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  followed_account_id uuid NOT NULL REFERENCES v3.followed_accounts(id) ON DELETE CASCADE,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,     -- emails a los que se envió
  novelty_summary jsonb,                             -- señales/noticias incluidas
  score_before smallint,
  score_after smallint,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_digest_log_account
  ON v3.digest_log (followed_account_id, sent_at DESC);

-- -----------------------------------------------------------------------------
-- 7. Sugerencias de términos para el diccionario (aprobables por super-admin)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3.dictionary_term_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL,
  normalized_term text NOT NULL,
  suggested_type text NOT NULL CHECK (suggested_type IN ('technology','process','vendor','product')),
  vendor_hint text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{company_id, source, snippet}]
  occurrences integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  suggested_by_agent text,                           -- ej: 'jobs-interpreter', 'radar-structurer'
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_term, suggested_type)
);

CREATE INDEX IF NOT EXISTS idx_v3_dict_suggestions_status
  ON v3.dictionary_term_suggestions (status, occurrences DESC);

-- -----------------------------------------------------------------------------
-- RLS para las tablas nuevas de v3 (misma convención que el resto del schema)
-- -----------------------------------------------------------------------------
ALTER TABLE v3.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.research_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.followed_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.followed_account_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.account_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.icebreakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.digest_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.dictionary_term_suggestions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- service_role full access
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='chat_conversations' AND policyname='Service role full access chat_conversations') THEN
    CREATE POLICY "Service role full access chat_conversations" ON v3.chat_conversations FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='chat_messages' AND policyname='Service role full access chat_messages') THEN
    CREATE POLICY "Service role full access chat_messages" ON v3.chat_messages FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='research_jobs' AND policyname='Service role full access research_jobs') THEN
    CREATE POLICY "Service role full access research_jobs" ON v3.research_jobs FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='followed_accounts' AND policyname='Service role full access followed_accounts') THEN
    CREATE POLICY "Service role full access followed_accounts" ON v3.followed_accounts FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='followed_account_subscribers' AND policyname='Service role full access followed_account_subscribers') THEN
    CREATE POLICY "Service role full access followed_account_subscribers" ON v3.followed_account_subscribers FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='account_scorecards' AND policyname='Service role full access account_scorecards') THEN
    CREATE POLICY "Service role full access account_scorecards" ON v3.account_scorecards FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='icebreakers' AND policyname='Service role full access icebreakers') THEN
    CREATE POLICY "Service role full access icebreakers" ON v3.icebreakers FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='digest_log' AND policyname='Service role full access digest_log') THEN
    CREATE POLICY "Service role full access digest_log" ON v3.digest_log FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='dictionary_term_suggestions' AND policyname='Service role full access dictionary_term_suggestions') THEN
    CREATE POLICY "Service role full access dictionary_term_suggestions" ON v3.dictionary_term_suggestions FOR ALL TO service_role USING (true);
  END IF;

  -- usuarios scoped por workspace (misma convención que campaigns/documents)
  -- chat: historial por usuario (no compartido con el resto del workspace)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='chat_conversations' AND policyname='Users can access chat_conversations') THEN
    CREATE POLICY "Users can access chat_conversations" ON v3.chat_conversations FOR ALL
      USING (user_id = auth.uid() AND workspace_id = v3.user_workspace_id(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='chat_messages' AND policyname='Users can access chat_messages') THEN
    CREATE POLICY "Users can access chat_messages" ON v3.chat_messages FOR ALL
      USING (conversation_id IN (
        SELECT id FROM v3.chat_conversations
        WHERE user_id = auth.uid() AND workspace_id = v3.user_workspace_id(auth.uid())
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='research_jobs' AND policyname='Users can access research_jobs') THEN
    CREATE POLICY "Users can access research_jobs" ON v3.research_jobs FOR ALL
      USING (workspace_id = v3.user_workspace_id(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='followed_accounts' AND policyname='Users can access followed_accounts') THEN
    CREATE POLICY "Users can access followed_accounts" ON v3.followed_accounts FOR ALL
      USING (workspace_id = v3.user_workspace_id(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='followed_account_subscribers' AND policyname='Users can access followed_account_subscribers') THEN
    CREATE POLICY "Users can access followed_account_subscribers" ON v3.followed_account_subscribers FOR ALL
      USING (workspace_id = v3.user_workspace_id(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='account_scorecards' AND policyname='Users can access account_scorecards') THEN
    CREATE POLICY "Users can access account_scorecards" ON v3.account_scorecards FOR ALL
      USING (workspace_id = v3.user_workspace_id(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='icebreakers' AND policyname='Users can access icebreakers') THEN
    CREATE POLICY "Users can access icebreakers" ON v3.icebreakers FOR ALL
      USING (workspace_id = v3.user_workspace_id(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='digest_log' AND policyname='Users can access digest_log') THEN
    CREATE POLICY "Users can access digest_log" ON v3.digest_log FOR ALL
      USING (workspace_id = v3.user_workspace_id(auth.uid()));
  END IF;
  -- sugerencias de diccionario: solo service_role (el super-admin opera vía server actions)
END $$;

-- =============================================================================
-- Cache global compartido (public) - SOLO ADITIVO, tablas nuevas
-- =============================================================================

-- Corridas crudas de investigación (Opus) por cuenta y bundle.
-- raw_research permite re-estructurar sin re-pagar la investigación.
CREATE TABLE IF NOT EXISTS public.radar_research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  radar_type text NOT NULL CHECK (radar_type IN ('tech','news','jobs-interpretation')),
  bundle text NOT NULL,                    -- ej: 'tech-stack', 'business-news', 'expansion-timing', 'pain-points'
  model text NOT NULL,
  prompt_version text NOT NULL DEFAULT 'v1',
  raw_research text,
  structured jsonb,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_radar_runs_company
  ON public.radar_research_runs (company_id, radar_type, created_at DESC);

-- Hallazgos estructurados y canonizados contra el diccionario (compartidos entre tenants)
CREATE TABLE IF NOT EXISTS public.radar_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  run_id uuid REFERENCES public.radar_research_runs(id) ON DELETE SET NULL,
  radar_type text NOT NULL CHECK (radar_type IN ('tech','news','jobs-interpretation')),
  category text NOT NULL,                  -- micro-agente / tipo de señal (ej: 'migration', 'expansion', 'hiring-pattern')
  title text NOT NULL,
  summary text,
  url text,
  source_name text,
  source_date date,
  evidence_level text NOT NULL DEFAULT 'inferred' CHECK (evidence_level IN ('explicit','inferred')),
  confidence numeric(3,2) CHECK (confidence BETWEEN 0 AND 1),
  dictionary_product_ids uuid[] DEFAULT '{}',
  dictionary_process_ids uuid[] DEFAULT '{}',
  supporting_job_posting_ids uuid[] DEFAULT '{}',   -- evidencia trazable a postings
  payload jsonb,
  dedupe_hash text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, dedupe_hash)
);

CREATE INDEX IF NOT EXISTS idx_radar_findings_company
  ON public.radar_findings (company_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_radar_findings_products
  ON public.radar_findings USING gin (dictionary_product_ids);

-- RLS: cache global operado solo vía service_role (server actions / pipeline)
ALTER TABLE public.radar_research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.radar_findings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='radar_research_runs' AND policyname='Service role full access radar_research_runs') THEN
    CREATE POLICY "Service role full access radar_research_runs" ON public.radar_research_runs FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='radar_findings' AND policyname='Service role full access radar_findings') THEN
    CREATE POLICY "Service role full access radar_findings" ON public.radar_findings FOR ALL TO service_role USING (true);
  END IF;
END $$;
