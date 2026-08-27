-- COLA Y CHECKPOINT DEL LOOKUP DE DOMINIO POR NOMBRE (Apollo, gratis)
-- ===================================================================
-- 455.747 de 517.790 companies (88%) no tienen `website`, y sin dominio no
-- entran a ningun flujo de Apollo: enrich y bulk_enrich reciben dominios, no
-- nombres. El lookup de organizaciones resuelve nombre -> dominio sin consumir
-- creditos, asi que se puede correr sobre las ~420.750 candidatas con nombre
-- buscable (las ~34.700 "Unknown Company <uuid>" quedan afuera solas, porque
-- public.company_core_name() ya devuelve NULL para ellas).
--
-- POR QUE UNA COLA SEMBRADA Y NO UN ANTI-JOIN
-- El runner podria buscar "companies sin website que no esten todavia en esta
-- tabla". Medido contra el catalogo real: hoy esa query tarda 7ms porque el 88%
-- de las filas son candidatas y el seq scan encuentra 60 enseguida. El problema
-- es el final: con 420.000 ya procesadas, el mismo scan tiene que recorrer casi
-- toda la tabla para encontrar las ultimas 60. Sembrar la cola una vez y pedir
-- `status = 'pending'` por indice cuesta lo mismo en la primera corrida que en
-- la numero diez mil.
--
-- OJO, ES DISTINTO DE v3.apollo_company_enrichment: aquella cola se siembra a
-- mano PORQUE SEMBRAR AUTORIZA GASTO (1 credito por cuenta resuelta). Esta es
-- gratuita, asi que sembrarla entera de una no compromete plata. Lo que si
-- consume es cuota: 400 llamadas/hora del plan, de las que el proceso de fondo
-- usa 350 y deja 50 libres para trabajo manual.
--
-- POR QUE EL DOMINIO NO VA DERECHO A companies.website
-- El match por nombre es difuso: "Joyeria Vasari" (nuestra) matcheo con
-- "JOYERIA VASARI MADRID SL" en una prueba real, que puede ser otra empresa.
-- Escribir eso en `website` propaga un dato equivocado a todo lo que despues
-- lee la columna, y no avisa. Aca queda el candidato con su score y su clase;
-- solo `auto_ok` se promueve (ver lib/apollo/domain-lookup-runner.ts).

CREATE TABLE IF NOT EXISTS v3.apollo_domain_lookup (
  company_id             uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Nombre efectivamente enviado a Apollo: el nucleo que devuelve
  -- public.company_core_name(), no `companies.name` crudo. Guardarlo permite
  -- saber si un no-match fue culpa de la normalizacion.
  queried_name           text NOT NULL,
  -- ISO conocido al momento de consultar. El pais se usa para PUNTUAR el match,
  -- no para filtrar la query (filtrar recorta candidatos antes de verlos), pero
  -- queda registrado para poder medir esa decision con datos.
  queried_country_iso    text,
  apollo_organization_id text,
  matched_name           text,
  -- Dominio CANDIDATO. Solo se copia a companies.website si status = 'auto_ok'.
  candidate_domain       text,
  -- Jaccard sobre tokens de los nombres normalizados.
  similarity             numeric,
  -- Cuanto del nombre mas corto esta contenido en el otro. Separa
  -- "Cencosud" vs "Cencosud Retail S.A." de "Support Chile" vs "Support Argentina".
  containment            numeric,
  -- Tokens geograficos presentes de un solo lado. Un valor no vacio bloquea el
  -- match automatico por alto que sea el score.
  geo_mismatch           text[],
  -- 'pending' | 'auto_ok' | 'revisar' | 'descartado' | 'match_sin_dominio'
  -- | 'sin_match' | 'error' | 'failed' | 'promoted'
  status                 text NOT NULL DEFAULT 'pending',
  payload                jsonb,
  error_message          text,
  attempts               integer NOT NULL DEFAULT 0,
  next_attempt_at        timestamptz,
  checked_at             timestamptz
);

-- El acceso caliente del runner: "dame las proximas N pendientes que ya se
-- pueden reintentar". Sin este indice el cron degrada a medida que la cola se
-- vacia, que es justo lo que la cola vino a evitar.
CREATE INDEX IF NOT EXISTS idx_apollo_domain_lookup_cola
  ON v3.apollo_domain_lookup (status, next_attempt_at NULLS FIRST)
  WHERE status IN ('pending', 'error');

-- Un mismo dominio candidato repetido en muchas companies es la señal de un
-- match difuso demasiado laxo (ej. todos los "Ministerio de X" cayendo en el
-- mismo org). Este indice hace barato detectarlo antes de promover nada.
CREATE INDEX IF NOT EXISTS idx_apollo_domain_lookup_candidate_domain
  ON v3.apollo_domain_lookup (candidate_domain)
  WHERE candidate_domain IS NOT NULL;

COMMENT ON TABLE v3.apollo_domain_lookup IS
  'Cola y checkpoint del lookup gratuito nombre -> dominio de Apollo. candidate_domain es un CANDIDATO: solo status=auto_ok se promueve a companies.website.';

-- ── Siembra inicial ────────────────────────────────────────────────────────
-- Idempotente: ON CONFLICT DO NOTHING permite volver a correrla para dar de
-- alta companies nuevas sin tocar las ya procesadas. No consume creditos ni
-- cuota: solo deja el trabajo anotado para que el cron lo drene de a 350/hora.
INSERT INTO v3.apollo_domain_lookup (company_id, queried_name, queried_country_iso, status)
SELECT c.id, public.company_core_name(c.name), c.hq_country_iso, 'pending'
  FROM public.companies c
 WHERE (c.website IS NULL OR btrim(c.website) = '')
   AND public.company_core_name(c.name) IS NOT NULL
ON CONFLICT (company_id) DO NOTHING;
