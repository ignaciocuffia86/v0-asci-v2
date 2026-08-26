-- ============================================================================
-- Apollo Fase 1.2 — Los campos que Apollo trae y estabamos tirando
--
-- Medicion sobre los 134 payloads reales guardados en v3.apollo_company_enrichment
-- (26-ago-2026). Cobertura de lo que NO estabamos promoviendo a columnas:
--
--   departmental_head_count  100%   headcount por area (IT, ingenieria, data science)
--   organization_revenue     100%   vs annual_revenue que solo cubre 53%
--   linkedin_uid            99.3%   y a 60 de esas 134 les falta linkedin_company_id
--   industries[]            98.5%   varias industrias, no una sola
--   primary_phone           97.8%   telefono de la empresa
--   sic/naics codes         ~88%    clasificacion estandar
--   city / state            91/97%  ubicacion
--
-- `departmental_head_count` es el de mayor valor para el caso de uso: de las 134
-- empresas medidas, 127 tienen equipo de IT dimensionado, 60 con 20+ personas y
-- 79 con 20+ en ingenieria. Es la diferencia entre "esta empresa existe" y "esta
-- empresa tiene a quien venderle".
--
-- Todo entra al namespace apollo_* (las señales propias mandan, igual que antes).
-- La unica columna generica que se toca es linkedin_company_id, y solo si esta
-- vacia.
-- ============================================================================

ALTER TABLE public.companies
  -- {"information_technology": 700, "engineering": 472, "data_science": 214, ...}
  ADD COLUMN IF NOT EXISTS apollo_departmental_head_count jsonb,
  -- sanitized_number de primary_phone (Apollo lo manda como objeto anidado)
  ADD COLUMN IF NOT EXISTS apollo_phone text,
  -- industries[] completo; apollo_industry sigue teniendo la principal
  ADD COLUMN IF NOT EXISTS apollo_industries text[],
  ADD COLUMN IF NOT EXISTS apollo_naics_codes text[],
  ADD COLUMN IF NOT EXISTS apollo_sic_codes text[],
  ADD COLUMN IF NOT EXISTS apollo_city text,
  ADD COLUMN IF NOT EXISTS apollo_state text;

COMMENT ON COLUMN public.companies.apollo_departmental_head_count IS
  'Headcount por area segun Apollo (information_technology, engineering, data_science, ...). 100% de cobertura medida.';
COMMENT ON COLUMN public.companies.apollo_industries IS
  'industries[] de Apollo. apollo_industry guarda la principal; esta las tiene todas.';

-- Filtrar por tamaño de equipo de IT sin escanear la tabla entera.
CREATE INDEX IF NOT EXISTS idx_companies_apollo_dept_headcount
  ON public.companies USING gin (apollo_departmental_head_count);
CREATE INDEX IF NOT EXISTS idx_companies_apollo_industries
  ON public.companies USING gin (apollo_industries);
