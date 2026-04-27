-- ============================================================================
-- 161_tech_radar_micro_agents.sql
-- Fase 2 del rediseno de Implementaciones (Tech Radar): migracion ADITIVA
-- para soportar el prompt de Claude con 17 micro-agentes y niveles de evidencia
-- alineados (directa / convergente / inferencia).
--
-- Backward compatibility:
--   - Registros existentes mantienen su data y se taggean prompt_version='v1'
--   - Valores viejos de evidence_level (strong/medium/weak) se migran a
--     directa/convergente/inferencia. Mapeo:
--        strong  -> directa
--        medium  -> convergente
--        weak    -> inferencia
--   - Items v1 NO tendran micro_agent (NULL) y van a la seccion "Historico"
--     en el UI nuevo.
-- ============================================================================

-- 1. Nuevas columnas (idempotente)
ALTER TABLE public.company_implementations
  ADD COLUMN IF NOT EXISTS micro_agent text,
  ADD COLUMN IF NOT EXISTS evidence_detail text,
  ADD COLUMN IF NOT EXISTS convergent_sources integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supporting_source_urls jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS prompt_version text DEFAULT 'v1';

COMMENT ON COLUMN public.company_implementations.micro_agent IS
  '17 micro-agentes del Tech Radar: bi_analytics, cloud_hosting, data_warehouse, devops_platform, ai_rpa, erp, crm, ipaas_integrations, customer_service, cybersec_iam, communications, workplace_productivity, mdm, success_cases, public_contracts, partners, jobs_skills. NULL para registros legacy v1.';
COMMENT ON COLUMN public.company_implementations.evidence_detail IS
  'Snippet textual o cita corta extraida del documento fuente que justifica el hallazgo. Equivalente a la columna "Evidencia" del prompt de Claude.';
COMMENT ON COLUMN public.company_implementations.convergent_sources IS
  'Cantidad de fuentes distintas que confirman el mismo hallazgo. >=1 (la fuente primaria). >=2 implica nivel "convergente".';
COMMENT ON COLUMN public.company_implementations.supporting_source_urls IS
  'Array JSON de URLs adicionales que tambien confirman este hallazgo (la fuente primaria sigue en source_url).';
COMMENT ON COLUMN public.company_implementations.prompt_version IS
  'Version del prompt/orquestador que genero el item. v1=Implementaciones legacy, v2=Tech Radar (17 micro-agentes con prompt de Claude).';

-- 2. Backfill prompt_version='v1' para los registros existentes
UPDATE public.company_implementations
SET prompt_version = 'v1'
WHERE prompt_version IS NULL;

-- 3. Migrar evidence_level de strong/medium/weak -> directa/convergente/inferencia
--    Mantenemos compat: si en el futuro el LLM devuelve "strong/medium/weak" tambien
--    los aceptamos, pero la nomenclatura canonica pasa a ser la del prompt de Claude.
UPDATE public.company_implementations
SET evidence_level = CASE LOWER(evidence_level)
  WHEN 'strong' THEN 'directa'
  WHEN 'medium' THEN 'convergente'
  WHEN 'weak'   THEN 'inferencia'
  ELSE evidence_level -- ya esta migrado o tiene un valor custom; lo dejamos
END
WHERE LOWER(evidence_level) IN ('strong', 'medium', 'weak');

-- 4. Indices para queries del tab Tech Radar (filtros por micro_agent + nivel)
CREATE INDEX IF NOT EXISTS idx_impl_company_micro_agent
  ON public.company_implementations (company_id, micro_agent);

CREATE INDEX IF NOT EXISTS idx_impl_company_prompt_version
  ON public.company_implementations (company_id, prompt_version);

CREATE INDEX IF NOT EXISTS idx_impl_company_evidence
  ON public.company_implementations (company_id, evidence_level);

-- 5. Validacion final: contar registros migrados (informativo)
DO $$
DECLARE
  v1_count integer;
  v2_count integer;
  unmigrated_evidence integer;
BEGIN
  SELECT COUNT(*) INTO v1_count
    FROM public.company_implementations
    WHERE prompt_version = 'v1';
  SELECT COUNT(*) INTO v2_count
    FROM public.company_implementations
    WHERE prompt_version = 'v2';
  SELECT COUNT(*) INTO unmigrated_evidence
    FROM public.company_implementations
    WHERE LOWER(evidence_level) IN ('strong', 'medium', 'weak');

  RAISE NOTICE '[v0][migration 161] v1 records: %', v1_count;
  RAISE NOTICE '[v0][migration 161] v2 records: %', v2_count;
  RAISE NOTICE '[v0][migration 161] unmigrated evidence_level (deberia ser 0): %', unmigrated_evidence;
END $$;
