-- ═══════════════════════════════════════════════════════════════════════════════
-- LINKEDIN COMPANY ID NUMÉRICO (Fase 3 del diseño)
-- Ver docs/feature-carga-masiva-cuentas-y-cron-jobpostings.md (Parte 2).
--
-- `companyId` es el filtro EXACTO del actor de LinkedIn Jobs (sin homónimos),
-- verificado en apify-client.ts. Hasta ahora no se guardaba; esta migración
-- agrega la columna y la puebla desde las vacantes ya cargadas: tanto los CSV
-- históricos (source_data->'_original'->>'companyId') como los scrapings de
-- Apify (source_data->>'companyId', el item se spreadea al tope) conservan el
-- ID en cada fila.
--
-- Criterio del backfill (verificado contra producción, ago 2026: ~4.050
-- compañías con ID único consistente, 7 con IDs mezclados, 22 en colisión):
--   - Solo se toma el ID DOMINANTE de una compañía si cubre >= 80% de sus
--     vacantes (atribución imperfecta de ingestas viejas).
--   - Un ID que apunta a MÁS de una compañía nuestra (duplicados del catálogo)
--     solo se asigna si una de ellas concentra >= 90% de las vacantes de ese ID
--     (caso real: "YPF" con 135 vacantes vs dos duplicados con 1 cada uno).
--     Sin dueña clara, no se asigna a ninguna: fijarlo en la fila equivocada es
--     peor que dejarlo NULL. El resto se resuelve unificando duplicados.
--   - Write-once: nunca pisa un linkedin_company_id ya seteado.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS linkedin_company_id bigint;

CREATE UNIQUE INDEX IF NOT EXISTS companies_linkedin_company_id_key
  ON public.companies (linkedin_company_id)
  WHERE linkedin_company_id IS NOT NULL;

WITH candidates AS (
  SELECT company_id,
         COALESCE(source_data->'_original'->>'companyId', source_data->>'companyId')::bigint AS lid,
         count(*) AS jobs
  FROM public.job_postings
  WHERE COALESCE(source_data->'_original'->>'companyId', source_data->>'companyId') ~ '^[0-9]{1,15}$'
  GROUP BY 1, 2
), dominante AS (
  -- Una fila por compañía: su ID más frecuente y qué fracción de las vacantes
  -- cubre. La window function se evalúa antes del DISTINCT ON, así que `total`
  -- suma TODOS los IDs de la compañía.
  SELECT DISTINCT ON (company_id) company_id, lid, jobs,
         sum(jobs) OVER (PARTITION BY company_id) AS total
  FROM candidates
  ORDER BY company_id, jobs DESC
), por_lid AS (
  -- Reparte cada ID entre las compañías que lo reclaman: cuántas vacantes con
  -- ese ID tiene cada una, sobre el total de vacantes de ese ID.
  SELECT company_id, lid, jobs, total,
         sum(jobs) OVER (PARTITION BY lid) AS lid_total,
         count(*)  OVER (PARTITION BY lid) AS empresas_con_ese_lid
  FROM dominante
), elegibles AS (
  SELECT company_id, lid
  FROM por_lid
  WHERE jobs::numeric / total >= 0.8
    AND (empresas_con_ese_lid = 1 OR jobs::numeric / lid_total >= 0.9)
)
UPDATE public.companies c
SET linkedin_company_id = e.lid
FROM elegibles e
WHERE c.id = e.company_id
  AND c.linkedin_company_id IS NULL;
