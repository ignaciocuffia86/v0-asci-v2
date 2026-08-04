-- =========================================================================
-- 438. REINTENTOS CON BACKOFF + LIMPIEZA DE ERRORES DE CUOTA
-- =========================================================================
-- Contexto: la tanda del 437 murio a mitad porque la cuenta de Apify llego al
-- tope mensual (403 actor-disabled / platform-feature-disabled). El script
-- registro 450 filas con status='error', pero ESAS EMPRESAS NO FALLARON: fallo
-- la cuenta. Con la PK en company_id esas filas bloquean el reintento.
--
-- Este script:
--   1. Agrega attempts + next_attempt_at para reintento con backoff y techo.
--   2. Borra las filas de error causadas por cuota (no tienen informacion).
--   3. Indexa la busqueda de reintentos pendientes.
--
-- Solo toca el schema v3. No modifica nada de v2.
--
-- OJO: sin BEGIN/COMMIT a proposito. run-sql.mjs envuelve todo en una
-- transaccion y hace ROLLBACK si no se le pasa --commit; un COMMIT explicito
-- aca adentro anularia el dry run.
-- =========================================================================

-- 1. Campos de reintento -------------------------------------------------
ALTER TABLE v3.linkedin_company_enrichment
  ADD COLUMN IF NOT EXISTS attempts        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

COMMENT ON COLUMN v3.linkedin_company_enrichment.attempts IS
  'Intentos acumulados. Con techo (MAX_ATTEMPTS en el servicio) para que una '
  'empresa irrecuperable no se reintente para siempre y queme cuota.';

COMMENT ON COLUMN v3.linkedin_company_enrichment.next_attempt_at IS
  'No reintentar antes de esta fecha (backoff exponencial). NULL = elegible ya.';

-- 2. Limpieza de los errores de cuota ------------------------------------
-- Se borran en vez de marcarse: la fila no aporta nada (no hay payload) y
-- borrarla devuelve la empresa a la cola como candidata fresca.
-- El filtro es deliberadamente estrecho: SOLO los 403 de plataforma. Un error
-- real de una empresa puntual se conserva para no perder el rastro.
DELETE FROM v3.linkedin_company_enrichment
WHERE status = 'error'
  AND (
    error_message LIKE '%actor-disabled%'
    OR error_message LIKE '%platform-feature-disabled%'
    OR error_message LIKE '%usage hard limit%'
    OR error_message LIKE '%Monthly usage%'
  );

-- 3. Indice para buscar reintentos elegibles -----------------------------
CREATE INDEX IF NOT EXISTS idx_lce_retry
  ON v3.linkedin_company_enrichment (status, next_attempt_at)
  WHERE status = 'error';

-- Verificacion ------------------------------------------------------------
DO $$
DECLARE
  v_error   integer;
  v_ok      integer;
  v_no_hq   integer;
  v_no_res  integer;
  v_total   integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE status = 'error'),
    count(*) FILTER (WHERE status = 'ok'),
    count(*) FILTER (WHERE status = 'no_hq'),
    count(*) FILTER (WHERE status = 'no_result'),
    count(*)
  INTO v_error, v_ok, v_no_hq, v_no_res, v_total
  FROM v3.linkedin_company_enrichment;

  RAISE NOTICE 'checkpoint -> ok=% no_hq=% no_result=% error=% total=%',
    v_ok, v_no_hq, v_no_res, v_error, v_total;
  RAISE NOTICE 'los error de cuota se borraron: vuelven a la cola solos';
END $$;
