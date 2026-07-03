-- ═══════════════════════════════════════════════════════════
-- v3: Prompts de IA editables desde el panel super-admin
--
-- v3.ai_prompts          → contenido vigente de cada prompt (por key)
-- v3.ai_prompt_versions  → historial de versiones (cada guardado inserta)
--
-- El contenido default vive en el código (lib/v3/prompt-defaults.ts);
-- si no hay fila en ai_prompts se usa el default. Guardar desde el
-- panel crea la fila (override) + una versión en el historial.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS v3.ai_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  content text NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS v3.ai_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key text NOT NULL,
  content text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_prompt_versions_key
  ON v3.ai_prompt_versions (prompt_key, created_at DESC);

-- RLS: solo service_role (server actions con guard de super-admin)
ALTER TABLE v3.ai_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.ai_prompt_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='ai_prompts' AND policyname='Service role full access ai_prompts') THEN
    CREATE POLICY "Service role full access ai_prompts" ON v3.ai_prompts FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='v3' AND tablename='ai_prompt_versions' AND policyname='Service role full access ai_prompt_versions') THEN
    CREATE POLICY "Service role full access ai_prompt_versions" ON v3.ai_prompt_versions FOR ALL TO service_role USING (true);
  END IF;
END $$;
