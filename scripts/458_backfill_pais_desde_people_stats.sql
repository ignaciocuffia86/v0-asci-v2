-- =============================================================================
-- 458 - Recuperar el pais que ya pagamos y tiramos: peopleStats -> country
-- =============================================================================
--
-- QUE ENCONTRAMOS
--
-- Revisando los runs de Apify del cron v3-enrich-companies-linkedin salio que
-- el enrichment estaba dejando sin `country` a casi un tercio de todo lo que
-- procesaba. Los numeros, medidos contra produccion el 2026-08-25:
--
--     status         filas
--     ok             8.491
--     no_hq          4.050   <- 30% de lo enriquecido se queda sin pais
--     no_result      1.094
--     error             50
--     identity_...       3
--
-- LA CAUSA
--
-- `pickHq()` decide el pais mirando UNICAMENTE `payload.locations`. Y en las
-- filas que quedaron en `no_hq`, ese array viene VACIO en 3.994 de 4.050
-- (98,6%). No es que la empresa tenga sedes ambiguas: el actor directamente no
-- devolvio ubicaciones.
--
-- Pero el pais SI estaba en el payload, en otro lado. harvestapi devuelve
-- `peopleStats`, un corte de la pestaña de gente, y una de sus entradas es
-- `statTitle: "Locations"` con los valores ordenados de mayor a menor. El
-- primero es, casi siempre, el pais limpio. Distribucion real sobre las filas
-- recuperables:
--
--     Argentina  1.025    United States  158    Brazil     73
--     Chile        425    Paraguay        94    Spain      55
--     Peru         233    ...                   Panama     55
--     Mexico       208
--     Colombia     201
--
-- O sea: pagamos el scrape, guardamos el payload entero en la tabla, y
-- descartamos el pais porque lo buscabamos en un solo campo.
--
-- EL ALCANCE DE ESTE SCRIPT
--
--     3.575  filas en `no_hq` con companies.country vacio
--     3.459  de esas traen la stat "Locations" en el payload
--     3.309  resuelven a un pais que la tabla YA conoce  <- lo que recupera
--       150  quedan afuera: su valor tope es una ciudad suelta ("Lima")
--
-- No gasta un dolar de Apify: trabaja sobre `payload`, que ya esta guardado.
--
-- QUE COLUMNA SE ESCRIBE, Y CUAL NO
--
-- Solo `country`. `peopleStats` dice donde estan los EMPLEADOS, que es el pais
-- de OPERACION -- justo lo que filtran los exports de admin de v2 via
-- country_normalized, que el trigger deriva solo. NO se toca `hq_country_iso`:
-- esa columna guarda la casa matriz confirmada por LinkedIn y meterle esta
-- evidencia, que es mas debil, la ensuciaria en silencio. Por eso las filas
-- siguen en status `no_hq`: el HQ sigue sin saberse, y esa sigue siendo la
-- verdad.
--
-- Se acepta el valor SOLO si ya existe en `country_normalized` (79 nombres
-- limpios, contra los 1.287 valores sucios de `country`). Asi nunca entra un
-- nombre de pais que los filtros de v2 no conozcan.
--
-- Se mira UNICAMENTE el valor mas alto de la lista. Bajar por ella recuperaria
-- las 150 restantes, pero permitiria que una minoria de empleados en otro pais
-- le gane al pais real: escribir el pais equivocado es peor que no escribirlo.
--
-- COMO CORRERLO
--
-- Arranca en DRY RUN. Deja la auditoria completa en `tmp_backfill_458` y NO
-- escribe nada hasta que se descomente el COMMIT del final. Revisar primero
-- los reportes que imprime, sobre todo el de la muestra.
--
-- El cambio equivalente para las corridas FUTURAS ya esta en el codigo
-- (pickCountryFromPeopleStats en lib/v3/services/linkedin-company-enrichment.ts).
-- Este script solo cubre lo historico, que el cron no vuelve a mirar porque una
-- fila con checkpoint no reingresa a la cola de candidatas.
--
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------- auditoria
DROP TABLE IF EXISTS tmp_backfill_458;

CREATE TEMP TABLE tmp_backfill_458 AS
WITH vocabulario AS (
  -- La misma fuente que usa el codigo: los nombres que la tabla ya reconoce.
  SELECT DISTINCT
         lower(btrim(country_normalized)) AS clave,
         btrim(country_normalized)        AS canonico
    FROM public.companies
   WHERE country_normalized IS NOT NULL
     AND btrim(country_normalized) <> ''
),
candidatas AS (
  SELECT e.company_id,
         c.name,
         -- El valor mas alto de la stat "Locations", y nada mas.
         (SELECT s->'values'->0->>'title'
            FROM jsonb_array_elements(coalesce(e.payload->'peopleStats', '[]'::jsonb)) s
           WHERE s->>'statTitle' = 'Locations'
           LIMIT 1) AS top_location
    FROM v3.linkedin_company_enrichment e
    JOIN public.companies c ON c.id = e.company_id
   WHERE e.status = 'no_hq'                       -- exactamente donde pickHq dio null
     AND e.payload IS NOT NULL
     AND (c.country IS NULL OR btrim(c.country) = '')   -- nunca sobrescribe
)
SELECT k.company_id,
       k.name,
       k.top_location,
       -- Exacto ("Argentina"), o el ultimo segmento ("... , Chile").
       coalesce(
         (SELECT canonico FROM vocabulario WHERE clave = lower(btrim(k.top_location))),
         (SELECT canonico FROM vocabulario
           WHERE clave = lower(btrim(split_part(
                   k.top_location, ',',
                   array_length(string_to_array(k.top_location, ','), 1))))
             AND strpos(k.top_location, ',') > 0)
       ) AS pais
  FROM candidatas k
 WHERE k.top_location IS NOT NULL;

-- ------------------------------------------------------------------ reportes
DO $$
DECLARE
  v_total    integer;
  v_resuelve integer;
  v_afuera   integer;
BEGIN
  SELECT count(*), count(pais), count(*) - count(pais)
    INTO v_total, v_resuelve, v_afuera
    FROM tmp_backfill_458;

  RAISE NOTICE '=== 458: backfill de country desde peopleStats ===';
  RAISE NOTICE 'Filas no_hq sin country y con la stat Locations: %', v_total;
  RAISE NOTICE 'Resuelven a un pais conocido (se escriben):      %', v_resuelve;
  RAISE NOTICE 'No resuelven (se dejan como estan):              %', v_afuera;
END $$;

-- Reparto por pais, para ver si la distribucion tiene sentido.
SELECT pais, count(*) AS filas
  FROM tmp_backfill_458
 WHERE pais IS NOT NULL
 GROUP BY pais
 ORDER BY filas DESC;

-- Muestra para revisar el criterio a ojo antes de aplicar.
SELECT name, top_location, pais
  FROM tmp_backfill_458
 WHERE pais IS NOT NULL
 ORDER BY random()
 LIMIT 40;

-- Lo que queda afuera: sirve para decidir si vale la pena un segundo pase.
SELECT top_location, count(*) AS filas
  FROM tmp_backfill_458
 WHERE pais IS NULL
 GROUP BY top_location
 ORDER BY filas DESC
 LIMIT 25;

-- ----------------------------------------------------------------- escritura
-- El trigger trg_normalize_country deriva country_normalized solo. Se repite
-- la condicion de vacio en el WHERE por si algo escribio entremedio.
UPDATE public.companies c
   SET country = b.pais,
       updated_at = now()
  FROM tmp_backfill_458 b
 WHERE c.id = b.company_id
   AND b.pais IS NOT NULL
   AND (c.country IS NULL OR btrim(c.country) = '');

-- Rastro en el checkpoint. La primera version de esto escribia
-- hq_source='people_stats_country' y el DRY RUN la mato con un 23514: hay un
-- CHECK que solo admite los tres valores de HqPick (headquarter_flag,
-- single_location, unanimous_country). El esquema tiene razon -- las hq_* son
-- la CASA MATRIZ, y esto no lo es -- asi que las tres quedan NULL y el rastro
-- va donde corresponde: `filled_columns`, que es literalmente "que columnas
-- lleno este enrichment".
--
-- La firma no es ambigua: de las 4.050 filas no_hq, CERO tenian 'country' en
-- filled_columns antes de esto (verificado contra produccion).
UPDATE v3.linkedin_company_enrichment e
   SET filled_columns = array_append(coalesce(e.filled_columns, '{}'), 'country')
  FROM tmp_backfill_458 b
 WHERE e.company_id = b.company_id
   AND b.pais IS NOT NULL
   AND e.status = 'no_hq'
   AND NOT ('country' = ANY(coalesce(e.filled_columns, '{}')));

-- Verificacion posterior: cuantas quedaron efectivamente con pais.
DO $$
DECLARE v_ok integer;
BEGIN
  SELECT count(*) INTO v_ok
    FROM tmp_backfill_458 b
    JOIN public.companies c ON c.id = b.company_id
   WHERE b.pais IS NOT NULL AND c.country = b.pais;
  RAISE NOTICE 'Filas con country escrito tras el UPDATE: %', v_ok;
END $$;

-- DRY RUN: el ROLLBACK deshace todo. Para aplicar de verdad, comentar el
-- ROLLBACK y descomentar el COMMIT.
ROLLBACK;
-- COMMIT;

-- -----------------------------------------------------------------------------
-- REVERTIR (si hiciera falta despues de aplicar): las filas que escribio este
-- backfill son las no_hq con 'country' en filled_columns.
--
--   UPDATE public.companies c
--      SET country = NULL
--     FROM v3.linkedin_company_enrichment e
--    WHERE e.company_id = c.id
--      AND e.status = 'no_hq'
--      AND 'country' = ANY(coalesce(e.filled_columns, '{}'));
--
--   UPDATE v3.linkedin_company_enrichment
--      SET filled_columns = array_remove(filled_columns, 'country')
--    WHERE status = 'no_hq' AND 'country' = ANY(coalesce(filled_columns, '{}'));
-- -----------------------------------------------------------------------------
