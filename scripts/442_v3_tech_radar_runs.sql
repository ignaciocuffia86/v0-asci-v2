-- =========================================================================
-- 442. REGISTRO DE CORRIDAS DEL TECH RADAR (auditoria + costo + fuente MCP)
-- =========================================================================
-- Por que existe:
--   El Tech Radar dejaba EVIDENCIA (company_implementations) pero NO dejaba
--   rastro de la CORRIDA: ni quien la disparo, ni cuando, ni cuanto costo, ni
--   cuantos hallazgos produjo. El costo de IA ademas caia huerfano en
--   ai_usage_log (feature='research-structure', company_id NULL) porque el
--   camino que alimenta la UI no pasaba tracking. Esta tabla es el equivalente
--   a lo que las noticias ya dejan, pero por corrida.
--
-- Ademas es la base para que el MCP consuma el Tech Radar como una nueva fuente
-- de senales de tecnologia: una fila por corrida, con la empresa, el contexto
-- de senales (keywords) y las metricas. Los hallazgos siguen viviendo en
-- public.company_implementations; esta tabla es el indice de ejecuciones.
--
-- Vive en el schema v3 para no tocar nada de v2. El costo de IA se sigue
-- registrando en v3.ai_usage_log con feature='radar-tech' (ya permitido por el
-- CHECK, ver script 441); esta tabla agrega la vista POR CORRIDA.
--
-- run-sql.mjs es DRY RUN salvo --commit. No incluir COMMIT aca.
-- =========================================================================

CREATE TABLE IF NOT EXISTS v3.tech_radar_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A quien se investigo. company_id puede quedar NULL si se borra la empresa,
  -- pero company_name se conserva para que la corrida siga siendo auditable.
  company_id          uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  company_name        text NOT NULL,

  -- Atribucion. workspace_id es NULL en el drilldown de bookmarks (v2, sin
  -- workspace); presente en el flujo de campanas (v3).
  workspace_id        uuid,
  user_id             uuid,

  -- Desde donde se disparo, para separar los dos entrypoints.
  caller              text NOT NULL
                      CHECK (caller IN ('drilldown', 'campaign')),
  -- Referencias opcionales segun el caller (utiles para el MCP y el debugging).
  campaign_account_id uuid,
  bookmark_id         uuid,

  -- Contexto de senales que guio la busqueda (tecnologias/procesos del bookmark
  -- o del value profile del workspace). Es lo que hace util a esta tabla como
  -- fuente de senales: dice QUE se estaba buscando.
  keywords            text[] NOT NULL DEFAULT '{}',

  -- Estado del ciclo de vida. Se abre en 'running' y se cierra en
  -- 'completed'/'failed'. Una fila vieja atascada en 'running' delata un crash.
  status              text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'completed', 'failed')),

  -- Metricas de la corrida.
  model               text,          -- modelo de recoleccion (RESEARCH_MODEL)
  web_searches        int  NOT NULL DEFAULT 0,
  sources_count       int  NOT NULL DEFAULT 0,   -- fuentes citadas unicas
  findings_count      int  NOT NULL DEFAULT 0,   -- hallazgos finales (post-filtros)
  input_tokens        bigint NOT NULL DEFAULT 0,
  output_tokens       bigint NOT NULL DEFAULT 0,
  -- Costo estimado agregado (collect + structure + retry), mismo criterio que
  -- v3.ai_usage_log.cost_usd (lib/v3/usage.ts::estimateCostUsd).
  cost_usd            numeric(12,6) NOT NULL DEFAULT 0,

  digest              text,
  ai_provider         text,          -- etiqueta final del structurer
  error_message       text,

  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  duration_ms         int,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE v3.tech_radar_runs IS
  'Una fila por ejecucion del Tech Radar. Auditoria (quien/cuando/estado), costo de IA agregado por corrida, y fuente de senales de tecnologia para el MCP. Los hallazgos viven en public.company_implementations.';

CREATE INDEX IF NOT EXISTS idx_tech_radar_runs_company
  ON v3.tech_radar_runs (company_id);
CREATE INDEX IF NOT EXISTS idx_tech_radar_runs_workspace
  ON v3.tech_radar_runs (workspace_id);
CREATE INDEX IF NOT EXISTS idx_tech_radar_runs_started_at
  ON v3.tech_radar_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tech_radar_runs_status
  ON v3.tech_radar_runs (status);

-- ── Seguridad ────────────────────────────────────────────────────────────
-- Solo el service_role escribe/lee (via createAdminClient). RLS ON sin policies
-- = anon/authenticated no ven nada aunque tuvieran GRANT. El service_role
-- bypassa RLS. NO damos EXECUTE/SELECT a PUBLIC ni a anon a proposito (ver el
-- incidente de exports de v2 con GRANT a PUBLIC por defecto).
ALTER TABLE v3.tech_radar_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON v3.tech_radar_runs FROM PUBLIC;
GRANT ALL ON v3.tech_radar_runs TO service_role;

-- PostgREST cachea el esquema: sin esto, el admin client (supabase-js) tira
-- "Could not find the table 'v3.tech_radar_runs' in the schema cache" hasta el
-- proximo reload automatico.
NOTIFY pgrst, 'reload schema';

-- ── Verificacion ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  -- Insert de prueba del ciclo completo (running -> completed), revertido.
  INSERT INTO v3.tech_radar_runs (company_name, caller, status, model)
  VALUES ('__probe__', 'drilldown', 'running', '__probe__')
  RETURNING id INTO v_id;

  UPDATE v3.tech_radar_runs
  SET status = 'completed', findings_count = 3, cost_usd = 0.0123,
      completed_at = now(), duration_ms = 4200
  WHERE id = v_id;

  RAISE NOTICE 'ciclo running->completed OK (id=%)', v_id;

  -- Un caller invalido debe ser rechazado.
  BEGIN
    INSERT INTO v3.tech_radar_runs (company_name, caller)
    VALUES ('__probe__', '__no_existe__');
    RAISE EXCEPTION 'PROBLEMA: el CHECK de caller acepta cualquier valor';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: caller invalido rechazado';
  END;

  RAISE EXCEPTION 'ROLLBACK_INTENCIONAL_DE_LA_VERIFICACION';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'ROLLBACK_INTENCIONAL_DE_LA_VERIFICACION' THEN
    RAISE;
  END IF;
  RAISE NOTICE 'Verificacion completa, filas de prueba descartadas.';
END $$;

SELECT
  'tech_radar_runs lista' AS chequeo,
  count(*)::int AS filas
FROM v3.tech_radar_runs;
