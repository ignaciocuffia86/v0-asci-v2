-- =============================================
-- Fase 1 - Resolucion de organization_id de Apollo
-- =============================================
-- Persiste el apollo_organization_id resuelto via /organizations/enrich
-- para no repetir el lookup en cada busqueda de prospectos.
-- Ademas guarda metadatos utiles (empleados, industria) como subproducto.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS apollo_organization_id TEXT,
  ADD COLUMN IF NOT EXISTS apollo_org_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS apollo_employees_count INT,
  ADD COLUMN IF NOT EXISTS apollo_industry TEXT,
  ADD COLUMN IF NOT EXISTS apollo_org_status TEXT DEFAULT 'unknown';
  -- apollo_org_status: 'unknown' | 'resolved' | 'not_found' | 'error'
  -- 'not_found' evita reintentar resolver empresas que Apollo no indexa.

CREATE INDEX IF NOT EXISTS idx_companies_apollo_org_id
  ON public.companies (apollo_organization_id)
  WHERE apollo_organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_companies_apollo_org_status
  ON public.companies (apollo_org_status, apollo_org_synced_at)
  WHERE apollo_org_status IN ('not_found', 'error');

COMMENT ON COLUMN public.companies.apollo_organization_id IS
  'ID interno de Apollo para la organizacion. Se usa como filtro primario (organization_ids) en busquedas de personas - paridad 1:1 con la UI de Apollo.';

COMMENT ON COLUMN public.companies.apollo_org_status IS
  'Estado de la resolucion: unknown (nunca se intento), resolved (tiene apollo_organization_id), not_found (Apollo no encontro - TTL 7d), error (fallo transitorio).';
