-- =============================================================================
-- 453 - Guard de identidad en el enrichment + cola de verificacion
-- =============================================================================
--
-- LAS DOS COSAS QUE RESUELVE
--
-- 1. Que el enrichment deje de contaminar filas. Hoy escribe lo que devuelve
--    LinkedIn sin comprobar que sea la empresa correcta. Cuando la fila trae la
--    URL de OTRA empresa, le escribe encima los datos ajenos: "Maxam North
--    America" quedo como Insurance en Bermuda (que es AXA XL) y "Ceiba
--    Software" se llevo el linkedin_company_id de SoftwareOne. Fueron 50 filas
--    limpiadas a mano en el script 447, y la unica razon por la que se pudieron
--    limpiar bien es que el 437 guardaba `filled_columns`. Sale mas barato no
--    escribirlas.
--
-- 2. Cerrar el ultimo hueco de auditoria. El 447 verifico contra el payload de
--    LinkedIn y el 452 contra el import del proveedor. Quedaban las empresas
--    que no cruzan con ningun import y nunca pasaron por el enrichment: para
--    esas no hay absolutamente nada contra que contrastar.
--
-- EL ALCANCE REAL ERA MENOR AL ESTIMADO
--
-- El cierre del 452 hablaba de 2.687 empresas sin cruce con el import. Medido
-- de nuevo antes de gastar cuota, la mayoria ya estaba cubierta por otra via:
--
--     2.685  sin cruce con ningun import
--     1.499  ya tienen nombre de LinkedIn (status ok + no_hq)  -> ya auditadas por el 447
--       100  status no_result: LinkedIn no devolvio nada, reintentar no aporta
--     1.086  sin registro de enrichment                        -> estas si hacen falta
--
-- De esas 1.086, 975 tienen una URL /company/ valida y son las que se encolan.
-- Las otras apuntan a /school/ u otras formas que el actor no resuelve.
--
-- POR QUE HIZO FALTA UNA COLA EXPLICITA
--
-- El cron solo toma empresas a las que les FALTA alguna columna que v2 consume.
-- Estas 975 ya tienen todo lleno: lo que se quiere confirmar no es un dato que
-- falte sino que la URL sea de esta empresa. Con la condicion vieja nunca
-- entrarian.
--
-- Se agrego el estado 'pending_verify', que entra a la cola aunque no falte
-- ninguna columna. Es una cola EXPLICITA y no una condicion abierta a
-- proposito: "toda empresa con linkedin_url y sin registro" son ~51.900 filas y
-- encolarlas todas seria un gasto de Apify que nadie pidio. Va con prioridad 5,
-- la ultima, porque completar un hueco que v2 consume rinde mas que confirmar
-- una URL que probablemente ya este bien.
--
-- La cola se drena sola: cuando el enrichment procesa una fila, el ON CONFLICT
-- la deja en ok / no_hq / no_result / identity_mismatch, y en cualquiera de esos
-- casos sale de la seleccion. A 50 por corrida y 6 corridas por hora son ~3,3
-- horas.
--
-- EL GUARD, Y EL BUG QUE APARECIO AL PROBARLO
--
-- El guard vive en lib/v3/services/linkedin-company-enrichment.ts
-- (`esLaMismaEmpresa`) y aplica los tres tests que se validaron en el 447 sobre
-- 11.833 empresas con payload: nombres identicos, uno contiene al otro, o
-- comparten una palabra de 4+ letras. El tercero es el que salva rebrands y
-- traducciones ("Techint Ingenieria y Construccion" contra "Techint Engineering
-- & Construction", "Barrick Gold" contra "Barrick Mining"): de 132
-- discrepancias, 70 eran eso.
--
-- Probandolo contra los casos reales de la auditoria aparecio un falso negativo
-- que el 447 no habia visto: "EY" esta contenido en "Ripley Customer SpA"
-- (ripl-EY-customerspa), asi que esa fila -- que en realidad tenia la URL de
-- Ernst & Young -- pasaba como si fuera la misma empresa. El containment ahora
-- exige que el nombre mas corto tenga al menos 4 caracteres. Con eso, los 21
-- casos conocidos dan lo esperado.
--
-- El guard se queda corto a proposito con acronimos y nombres en otro idioma
-- sin palabras en comun (Air Space Intelligence / ASI, Banque Scotia /
-- Scotiabank): quedan marcados como 'identity_mismatch' para revision en vez de
-- escribirse. Es el lado seguro: no escribir un dato bueno se corrige en la
-- proxima corrida, escribir el dato de otra empresa contamina la fila y hay que
-- rastrearlo despues.
--
-- 'identity_mismatch' NO se reintenta: no es un fallo transitorio, es una
-- respuesta valida que dice que la URL esta mal. Guarda el payload, que es la
-- evidencia para revisarlo.
-- =============================================================================

-- ── Estados nuevos ──────────────────────────────────────────────────────────

ALTER TABLE v3.linkedin_company_enrichment
  DROP CONSTRAINT IF EXISTS linkedin_company_enrichment_status_check;

ALTER TABLE v3.linkedin_company_enrichment
  ADD CONSTRAINT linkedin_company_enrichment_status_check
  CHECK (status = ANY (ARRAY[
    'ok', 'no_result', 'no_hq', 'error',
    -- La URL resulto ser de otra empresa: no se escribio ninguna columna.
    -- No se reintenta.
    'identity_mismatch',
    -- Encolada para confirmar que la URL es de esta empresa, aunque no le
    -- falte ninguna columna.
    'pending_verify'
  ]));

-- ── Encolar lo que no se puede auditar de ninguna otra forma ────────────────

INSERT INTO v3.linkedin_company_enrichment
  (company_id, requested_url, status, attempts, next_attempt_at, error_message)
SELECT c.id, c.linkedin_url, 'pending_verify', 0, NULL,
       'Encolada por el script 453: su URL no cruza con ningun import del proveedor, '
       || 'asi que no hay con que confirmar que sea de esta empresa.'
FROM public.companies c
WHERE c.linkedin_url ~ 'linkedin\.com/company/'
  AND NOT EXISTS (SELECT 1 FROM v3.import_url_names i WHERE i.url_norm = c.linkedin_url)
  AND NOT EXISTS (SELECT 1 FROM v3.linkedin_company_enrichment e WHERE e.company_id = c.id)
ON CONFLICT (company_id) DO NOTHING;

-- ── Que mirar mientras se drena ─────────────────────────────────────────────
--
--   SELECT status, count(*) FROM v3.linkedin_company_enrichment GROUP BY 1;
--
-- Y cuando aparezcan, las que hay que revisar a mano:
--
--   SELECT c.name, e.payload->>'name' AS segun_linkedin, e.requested_url
--   FROM v3.linkedin_company_enrichment e
--   JOIN public.companies c ON c.id = e.company_id
--   WHERE e.status = 'identity_mismatch';
--
-- Para las que se confirmen mal, el remedio es el del script 447: revertir las
-- columnas que figuren en filled_columns y anular linkedin_url. Con el guard
-- puesto eso ya no deberia hacer falta, porque no se escriben.
