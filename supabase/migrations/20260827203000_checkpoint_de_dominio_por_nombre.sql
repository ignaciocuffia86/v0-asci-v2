-- CHECKPOINT DEL LOOKUP DE DOMINIO POR NOMBRE (Apollo, gratis)
-- ============================================================
-- 455.747 de 517.790 companies (88%) no tienen `website`, y sin dominio no
-- entran a ningun flujo de Apollo: enrich y bulk_enrich reciben dominios, no
-- nombres. El lookup de organizaciones resuelve nombre -> dominio sin consumir
-- creditos, asi que se puede correr sobre las 421.075 candidatas con nombre
-- buscable (las 34.672 "Unknown Company <uuid>" quedan afuera).
--
-- POR QUE UNA TABLA APARTE Y NO `companies.website` DIRECTO
-- El match por nombre es difuso: "Joyeria Vasari" (nuestra) matcheo con
-- "JOYERIA VASARI MADRID SL" en una prueba real, que puede ser otra empresa.
-- Escribir eso en `website` seria propagar un dato equivocado a todo lo que
-- despues consume la columna. El codigo ya trata las resoluciones por nombre
-- como sospechosas (lib/v3/services/mcp-contact-enrichment.ts marca
-- `method: "name_lookup"` y pide confirmacion humana): esta tabla es el mismo
-- criterio, persistido. Promover un candidato a `companies.website` es un paso
-- posterior y deliberado, no un efecto de haber corrido el lookup.
--
-- Mismo patron que v3.apollo_company_enrichment y v3.linkedin_company_enrichment.

CREATE TABLE IF NOT EXISTS v3.apollo_domain_lookup (
  company_id             uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Nombre efectivamente enviado a Apollo: el nucleo que devuelve
  -- public.company_core_name(), no `companies.name` crudo. Guardarlo permite
  -- saber si un no-match fue culpa de la normalizacion.
  queried_name           text NOT NULL,
  -- ISO del filtro de pais aplicado (NULL = se busco sin filtro). Es la
  -- variable que mas mueve la precision, asi que tiene que quedar registrada
  -- junto al resultado para poder medirla.
  queried_country_iso    text,
  apollo_organization_id text,
  matched_name           text,
  -- Dominio CANDIDATO. Nunca se copia a companies.website desde aca.
  candidate_domain       text,
  -- Jaccard sobre tokens de los nombres normalizados.
  similarity             numeric,
  -- Cuanto del nombre mas corto esta contenido en el otro. Separa
  -- "Cencosud" vs "Cencosud Retail S.A." de "Support Chile" vs "Support Argentina".
  containment            numeric,
  -- 'auto_ok' | 'revisar' | 'descartado' | 'match_sin_dominio' | 'sin_match' | 'error'
  status                 text NOT NULL,
  payload                jsonb,
  error_message          text,
  attempts               integer NOT NULL DEFAULT 1,
  checked_at             timestamptz NOT NULL DEFAULT now()
);

-- El barrido reanuda por status y promueve por status: los dos accesos van por
-- el mismo indice.
CREATE INDEX IF NOT EXISTS idx_apollo_domain_lookup_status
  ON v3.apollo_domain_lookup (status, checked_at DESC);

-- Un mismo dominio candidato apareciendo para muchas companies distintas es la
-- senal de un match difuso demasiado laxo (ej. todas las "Ministerio de X"
-- cayendo en el mismo org). Este indice hace barato detectarlo.
CREATE INDEX IF NOT EXISTS idx_apollo_domain_lookup_candidate_domain
  ON v3.apollo_domain_lookup (candidate_domain)
  WHERE candidate_domain IS NOT NULL;

COMMENT ON TABLE v3.apollo_domain_lookup IS
  'Checkpoint del lookup gratuito nombre -> dominio de Apollo. candidate_domain es un CANDIDATO: no se promueve a companies.website sin validacion.';
