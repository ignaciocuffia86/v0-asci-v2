-- =============================================================================
-- 459 - El LinkedIn company ID que ya pagamos 12.541 veces y guardamos una
-- =============================================================================
--
-- QUE PASA
--
-- `v3.linkedin_company_enrichment.payload` guarda la respuesta ENTERA del actor,
-- y ahi viene `id`: el LinkedIn company ID numerico. Esta en los 12.541 payloads
-- utiles, sin excepcion. Nunca lo escribimos en `companies.linkedin_company_id`.
--
--     Empresas con linkedin_company_id hoy ............  3.955
--     Lo traen en el payload y les falta .............. 10.528
--     De esas, chocan contra otra fila ................      2
--
-- POR QUE NO ES UNA COLUMNA MAS
--
-- Es el decisor de MAXIMA PRIORIDAD de belongsToCompany() en la ingesta de
-- vacantes (lib/v3/services/apify-job-ingest.ts): cuando los dos lados tienen
-- el ID, la pertenencia se resuelve por identidad y ni se miran el slug ni el
-- nombre. Sin el, la atribucion cae al nombre, que es exactamente donde
-- "Grupo Arcor" -- que normaliza a "arcor" -- se llevaba puestas a "Arcort SRL"
-- y "Arcorp S.A.", dos empresas reales sin ninguna relacion.
--
-- Cada ID que falta es una cuenta cuyas vacantes se atribuyen por parecido de
-- nombre. Pasar la columna de 3.955 a ~14.480 (3,7x) no agrega un dato: cierra
-- un agujero de atribucion, y sale gratis porque el scrape ya se pago.
--
-- LAS 2 COLISIONES NO SON DUPLICADOS: SON FILAS CONTAMINADAS
--
-- Dos filas con el mismo LinkedIn company ID significa que UNA DE LAS DOS tiene
-- mal la URL. Puede ser un duplicado del catalogo, o puede ser que a una fila le
-- hayan escrito los datos de otra empresa. Las 2 que hay son lo segundo:
--
--   "Fundacion Igualar y Cooperativa flor de ceibo"  pidio /company/ual-
--        -> LinkedIn devolvio "Uala", y le escribieron website ua.la, industry
--           "Financial Services", descripcion y logo de Uala.
--
--   "Netsoft"                                        pidio /company/tsoft
--        -> LinkedIn devolvio "Tsoft", y le escribieron tsoftglobal.com,
--           descripcion, logo y hq_country_iso de Tsoft.
--
-- El guard de identidad del 453 las dejo pasar por CONTENCION: "ig-UALA-r" con-
-- tiene "uala", y "ne-TSOFT" contiene "tsoft". Es el mismo modo de falla que el
-- comentario del 454 da por cerrado con MIN_CONTAINMENT, y no lo esta.
--
-- Este script NO las arregla: solo NO les escribe el ID (el NOT EXISTS), que es
-- lo correcto en los dos casos posibles. Limpiar las columnas contaminadas es
-- otro trabajo, y `filled_columns` dice exactamente cuales son -- que es para
-- lo que el 453 lo guarda. Medido: de 293 filas que pasaron por contencion,
-- 32 lo hicieron sin compartir ninguna palabra de 4+ letras, y de esas la gran
-- mayoria son legitimas ("PAT S.A"/"PAT", "Nfqgroup"/"NFQ"). El dano real son
-- estas 2 mas "Empresas Armas"/"empresa".
--
-- -----------------------------------------------------------------------------
-- PARTE 2: LOS 5 IDs QUE SE CONTRADICEN
-- -----------------------------------------------------------------------------
--
-- Hay 5 filas donde el ID GUARDADO no es el del payload. No son al azar:
--
--     nombre              guardado     payload   vacantes
--     Confidencial       103850845    77098366         49
--     JM Martinez        100096471    10970596          5
--     Blend               15798900     3280260          5
--     MRO Holdings Inc.    1142739    16199325          1
--     Elevate               260972     2662595          1
--
-- Todos nombres genericos o ambiguos. La explicacion esta en como se puebla hoy
-- la columna: la ingesta APRENDE el ID de las vacantes que ya acepto
-- (extractConsistentLinkedinCompanyId). Pero si esa cuenta todavia no tenia ID,
-- las vacantes se aceptaron por slug o por NOMBRE -- y con un nombre como
-- "Confidencial" o "Elevate" ese filtro no discrimina nada. El ID aprendido
-- hereda el error del match que lo produjo.
--
-- El del payload no tiene ese problema: sale de scrapear la `linkedin_url` DE
-- ESA FILA, que es su ancla de identidad y ademas es UNIQUE en la tabla. Es
-- evidencia directa contra evidencia derivada, asi que gana el payload.
--
-- OJO CON LO QUE ESTE SCRIPT **NO** HACE
-- No re-atribuye las 61 vacantes que entraron bajo el ID viejo. Si el ID estaba
-- mal, esas vacantes son sospechosas -- sobre todo las 49 de "Confidencial" --
-- pero decidir a quien pertenecen es otro problema, con otra evidencia y otro
-- riesgo. Corregir el ID detiene la sangria hacia adelante; lo ya atribuido se
-- revisa aparte.
--
-- APLICADO EN asciv2-database EL 2026-08-25 20:50 UTC
--
-- Se corrio primero en DRY RUN y despues con COMMIT. Lo que dio, medido antes
-- y despues:
--
--     companies con linkedin_company_id ....  3.955  ->  14.481
--     IDs distintos ........................            14.481  (0 colisiones)
--     filas tocadas en la ventana ..........            10.531  (10.526 + 5)
--     candidatas que quedan sin escribir ...                 2  (las contaminadas)
--     contradicciones restantes ............                 0
--
-- Los numeros del COMMIT dieron identicos a los del DRY RUN.
--
-- PARA REVERTIR
-- Parte 1: las filas que escribio son las que tienen updated_at >= 2026-08-25
-- 20:50:00.225719+00 y linkedin_company_id igual al `id` de su payload.
-- Parte 2: los 5 IDs viejos estan en la tabla de aca abajo; volver a ponerlos.
--
-- Para las corridas futuras el cron ya lo escribe solo
-- (lib/v3/services/linkedin-company-enrichment.ts, marca [459]).
--
-- =============================================================================

BEGIN;

-- ---------------------------------------------------- PARTE 1: las que faltan
DROP TABLE IF EXISTS tmp_backfill_459;

CREATE TEMP TABLE tmp_backfill_459 AS
SELECT e.company_id,
       c.name,
       (e.payload->>'id')::bigint AS li_id,
       -- Otra fila ya tiene ese ID: o son duplicados, o a una le escribieron
       -- los datos de la otra. En los dos casos, aca no se escribe nada.
       EXISTS (SELECT 1 FROM public.companies o
                WHERE o.linkedin_company_id = (e.payload->>'id')::bigint
                  AND o.id <> e.company_id) AS choca
  FROM v3.linkedin_company_enrichment e
  JOIN public.companies c ON c.id = e.company_id
 WHERE e.payload IS NOT NULL
   AND e.status IN ('ok','no_hq')          -- nunca identity_mismatch: URL ajena
   AND e.payload->>'id' ~ '^[0-9]{1,15}$'  -- mismo formato que parseLinkedinCompanyId
   AND c.linkedin_company_id IS NULL;      -- write-once: no pisa lo que ya hay

DO $$
DECLARE v_total integer; v_choca integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE choca) INTO v_total, v_choca
    FROM tmp_backfill_459;
  RAISE NOTICE '=== 459 PARTE 1: linkedin_company_id que falta ===';
  RAISE NOTICE 'Candidatas ................ %', v_total;
  RAISE NOTICE 'Se escriben ............... %', v_total - v_choca;
  RAISE NOTICE 'Chocan (revisar abajo) .... %', v_choca;
END $$;

-- Las colisiones. NO asumir que son duplicados: revisar los dos nombres. Si no
-- tienen nada que ver, la fila de la izquierda tiene datos de la derecha.
SELECT b.name AS fila_sin_id, o.name AS fila_que_ya_tiene_el_id, b.li_id
  FROM tmp_backfill_459 b
  JOIN public.companies o ON o.linkedin_company_id = b.li_id AND o.id <> b.company_id
 WHERE b.choca;

UPDATE public.companies c
   SET linkedin_company_id = b.li_id,
       updated_at = now()
  FROM tmp_backfill_459 b
 WHERE c.id = b.company_id
   AND NOT b.choca
   AND c.linkedin_company_id IS NULL;

-- ------------------------------------------- PARTE 2: los 5 que se contradicen
DROP TABLE IF EXISTS tmp_conflictos_459;

CREATE TEMP TABLE tmp_conflictos_459 AS
SELECT c.id AS company_id,
       c.name,
       c.linkedin_url,
       c.linkedin_company_id AS id_viejo,
       (e.payload->>'id')::bigint AS id_nuevo,
       (SELECT count(*) FROM public.job_postings j WHERE j.company_id = c.id) AS vacantes_bajo_el_id_viejo
  FROM v3.linkedin_company_enrichment e
  JOIN public.companies c ON c.id = e.company_id
 WHERE e.payload IS NOT NULL
   AND e.status IN ('ok','no_hq')
   AND e.payload->>'id' ~ '^[0-9]{1,15}$'
   AND c.linkedin_company_id IS NOT NULL
   AND c.linkedin_company_id <> (e.payload->>'id')::bigint
   -- Si el ID del payload ya es de otra fila, no se toca: eso es un duplicado
   -- y se resuelve mergeando, no reescribiendo un ID.
   AND NOT EXISTS (SELECT 1 FROM public.companies o
                    WHERE o.linkedin_company_id = (e.payload->>'id')::bigint
                      AND o.id <> c.id);

-- El unico reporte que hay que leer entero: es la unica escritura del script
-- que PISA un valor existente.
SELECT name, linkedin_url, id_viejo, id_nuevo, vacantes_bajo_el_id_viejo
  FROM tmp_conflictos_459
 ORDER BY vacantes_bajo_el_id_viejo DESC;

UPDATE public.companies c
   SET linkedin_company_id = k.id_nuevo,
       updated_at = now()
  FROM tmp_conflictos_459 k
 WHERE c.id = k.company_id
   AND c.linkedin_company_id = k.id_viejo;   -- optimistic lock

-- --------------------------------------------------------------- verificacion
DO $$
DECLARE v_ahora integer;
BEGIN
  SELECT count(*) INTO v_ahora
    FROM public.companies WHERE linkedin_company_id IS NOT NULL;
  RAISE NOTICE '=== 459: companies con linkedin_company_id: % ===', v_ahora;
END $$;

-- Aplicado el 2026-08-25 (ver cabecera). Se deja en COMMIT porque es lo que se
-- corrio; el script es idempotente -- Parte 1 exige linkedin_company_id IS NULL
-- y Parte 2 exige que el ID siga siendo el viejo -- asi que volver a correrlo
-- no hace nada. Para ensayar un cambio, cambiar COMMIT por ROLLBACK.
COMMIT;
