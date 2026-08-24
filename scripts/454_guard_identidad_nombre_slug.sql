-- =============================================================================
-- 454 - El guard de identidad no puede juzgar una fila bautizada con el slug
-- =============================================================================
--
-- QUE PASO EN LA PRIMERA CORRIDA REAL
--
-- El guard del script 453 se desplego y el drenaje arranco: dos corridas de 50,
-- 75 empresas enriquecidas y 8 marcadas como identity_mismatch. El guard hacia
-- exactamente lo que tenia que hacer -- no escribio ninguna columna en esas 8 --
-- pero al revisarlas una por una casi todas eran FALSOS POSITIVOS:
--
--     Epe_2                                <- EPE
--     Nfqgroup                             <- NFQ
--     Unvimeoficial                        <- Universidad Nacional de Villa Mercedes
--     Asu-Graduates                        <- Applied Science University
--     Financial-Software-&-Systems-P-Ltd   <- FSS
--     Grupomat                             <- MAT - Equipamentos para gases
--     Megustapuntocom                      <- megusta.com
--
-- Todas son la misma empresa. Y el dato que lo explica: de las 11 filas
-- marcadas, las 11 tenian el nombre igual al slug de su propia URL.
--
-- LA CAUSA
--
-- upsert_company, cuando el ETL no trae nombre, lo inventa con
-- INITCAP(SPLIT_PART(url,'/',5)). "Unvimeoficial" no es un nombre: es el slug.
--
-- El guard compara dos nombres para decidir si son la misma empresa, pero en
-- estas filas no hay dos nombres, hay uno solo y su eco. Contrastar el nombre
-- de LinkedIn contra el slug del que ese mismo nombre deriva no prueba nada, y
-- el resultado es que bloquea enriquecimientos correctos.
--
-- Es el lado seguro del error (no escribio nada, no contamino), pero es un
-- error igual: esas empresas se quedan sin industry, sin website y sin logo.
--
-- LOS DOS ARREGLOS
--
-- 1. Si el nombre de la fila ES el slug de su propia URL, el guard no aplica.
--    Ademas se adopta el nombre que devolvio LinkedIn, recalculando
--    normalized_name. Es el mismo arreglo del script 452 pero contra el payload
--    en vez del import, o sea que cubre justamente las filas que el import no
--    alcanzaba.
--
-- 2. MIN_CONTAINMENT baja de 4 a 3, para que las siglas de tres letras pasen
--    ("Epe_2" contra "EPE"). El caso que habia motivado el minimo era "EY"
--    dentro de "ripl-EY-customerspa", y con 2 caracteres sigue bloqueado.
--
-- POR QUE SE FRENO EL DRENAJE
--
-- De las 825 filas que quedaban en la cola, 635 (el 77%) estan bautizadas con
-- el slug. Dejar correr el cron con el guard viejo significaba pagarle a Apify
-- por 635 empresas que despues habria que volver a consultar. Se movieron a
-- 'on_hold', que el cron no mira.
--
-- PARA REANUDAR, DESPUES DE DESPLEGAR EL FIX:
--
--     UPDATE v3.linkedin_company_enrichment
--     SET status = 'pending_verify', error_message = NULL
--     WHERE status = 'on_hold';
--
-- Son 836: las 825 que quedaban mas las 11 marcadas de mas.
-- =============================================================================

ALTER TABLE v3.linkedin_company_enrichment
  DROP CONSTRAINT linkedin_company_enrichment_status_check;

ALTER TABLE v3.linkedin_company_enrichment
  ADD CONSTRAINT linkedin_company_enrichment_status_check
  CHECK (status = ANY (ARRAY[
    'ok', 'no_result', 'no_hq', 'error',
    'identity_mismatch',  -- [453] la URL es de otra empresa
    'pending_verify',     -- [453] cola explicita de verificacion
    'on_hold'             -- [454] frenada a proposito, el cron no la mira
  ]::text[]));

-- Freno: el guard viejo no puede juzgar estas filas.
UPDATE v3.linkedin_company_enrichment
SET status = 'on_hold',
    error_message = 'En espera del deploy del guard corregido (script 454): el 77% de esta cola '
                    || 'son filas bautizadas con el slug y el guard viejo las marca mal.'
WHERE status IN ('pending_verify', 'identity_mismatch');
