-- ═══════════════════════════════════════════════════════════════════════════════
-- CARGA MASIVA DE CUENTAS POR ARCHIVO (v3)
-- Ver docs/feature-carga-masiva-cuentas-y-cron-jobpostings.md (sección 4.5).
--
-- Dos tablas nuevas, solo en el schema v3. No se reutiliza la cola ETL de v2
-- (import_batches/import_rows) a propósito: agregar un batch_type nuevo exige
-- tocar el PL/pgSQL de process_import_batch, y este flujo es interactivo (el
-- usuario revisa los matches antes de confirmar), no de cola.
--
-- RLS: habilitado SIN políticas permisivas, como el resto de v3. Todo acceso va
-- por el service role (createAdminClient) con el filtro de workspace_id aplicado
-- en TypeScript detrás de los guards (requireSuperadmin / requireWorkspaceAdmin).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.account_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES auth.users(id),
  filename      text NOT NULL,
  blob_url      text,
  status        text NOT NULL DEFAULT 'parsing'
                CHECK (status IN ('parsing', 'reviewing', 'confirming', 'completed', 'failed', 'discarded')),
  total_rows    int  NOT NULL DEFAULT 0,
  followed_rows int  NOT NULL DEFAULT 0,
  created_companies int NOT NULL DEFAULT 0,
  skipped_rows  int  NOT NULL DEFAULT 0,
  -- Resultado del puente opcional a bookmarks v2 (por usuario destino), para
  -- que el resumen sobreviva a un refresh: [{userId, email, created, alreadyExisted}]
  v2_bookmarks  jsonb,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_v3_account_imports_workspace
  ON v3.account_imports (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS v3.account_import_rows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id     uuid NOT NULL REFERENCES v3.account_imports(id) ON DELETE CASCADE,
  row_number    int  NOT NULL,
  -- Fila cruda del archivo ya mapeada a campos canónicos
  -- ({company_name, linkedin_url, website, country, notes}).
  row_data      jsonb NOT NULL,
  match_status  text NOT NULL DEFAULT 'pending'
                CHECK (match_status IN ('pending', 'matched', 'candidate', 'ambiguous',
                                        'not_found', 'already_followed', 'error')),
  matched_company_id uuid REFERENCES public.companies(id),
  match_score   numeric,
  match_reason  text,
  -- Candidatos para la review: [{companyId, name, website, country, confidence}]
  candidates    jsonb,
  resolution    text CHECK (resolution IN ('confirmed', 'created', 'ignored')),
  resolved_by   uuid REFERENCES auth.users(id),
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v3_account_import_rows_import
  ON v3.account_import_rows (import_id, match_status);

ALTER TABLE v3.account_imports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.account_import_rows  ENABLE ROW LEVEL SECURITY;
