-- =========================================================================
-- 440: frena el sangrado del refresh mensual + corrige el costo historico.
--
-- Contexto (medido, no supuesto):
--   `v3-refresh-accounts` volvio a investigar la MISMA empresa + MISMO bundle
--   hasta 19 veces. 51 de 107 corridas pagas de Opus fueron desperdicio (48%).
--   La causa es que `last_refreshed_at` se escribe SOLO si el job termina
--   `completed`; la cuenta que falla por timeout queda con NULL y vuelve a
--   entrar en la seleccion en el proximo horario, pagando Opus de nuevo.
--
-- Esta migracion agrega el rastro del INTENTO (no solo del exito) para que una
-- cuenta que falla no se reintente para siempre dentro del mismo dia.
--
-- Solo toca el schema v3. No modifica nada de v2.
--
-- OJO: sin BEGIN/COMMIT a proposito. run-sql.mjs envuelve todo en una
-- transaccion y hace ROLLBACK si no se le pasa --commit; un COMMIT explicito
-- aca adentro anularia el dry run.
-- =========================================================================

-- 1. Rastro del intento en las cuentas seguidas ---------------------------
-- `last_refreshed_at` sigue significando "ultimo refresh EXITOSO" (no se toca
-- su semantica, la lee el digest para el "desde"). Estas dos columnas nuevas
-- registran el intento aunque falle.
ALTER TABLE v3.followed_accounts
  ADD COLUMN IF NOT EXISTS last_refresh_attempt_at timestamptz;

ALTER TABLE v3.followed_accounts
  ADD COLUMN IF NOT EXISTS refresh_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN v3.followed_accounts.last_refresh_attempt_at IS
  'Ultimo intento de refresh, exitoso o no. La seleccion del cron filtra por esta columna para no reintentar en loop la cuenta que falla.';

COMMENT ON COLUMN v3.followed_accounts.refresh_attempts IS
  'Intentos consecutivos fallidos. Se resetea a 0 cuando el refresh termina OK. Con >= 3 el cron deja de tomar la cuenta.';

-- Indice para la seleccion del cron (refresh_day + estado del intento).
CREATE INDEX IF NOT EXISTS idx_followed_accounts_refresh_due
  ON v3.followed_accounts (refresh_day, last_refresh_attempt_at)
  WHERE is_active;

-- 2. Recalculo del costo historico ---------------------------------------
-- `estimateCostUsd` ya tiene el fix de normalizacion (punto vs guion) desde el
-- 2026-08-05, pero las 101 filas anteriores quedaron valuadas con el fallback
-- de 3/15 en lugar de los 5/25 reales de Opus. Sin este recalculo, cualquier
-- comparacion "antes vs despues" de la optimizacion arranca sesgada 49%.
WITH precios(patron, in_per_m, out_per_m) AS (
  VALUES
    ('%opus-4%',        5.0,  25.0),
    ('%opus-4.5%',      5.0,  25.0),
    ('%sonnet-4%',      3.0,  15.0),
    ('%haiku-4%',       1.0,   5.0),
    ('%gemini-2.0-flash%', 0.15, 0.6),
    ('%gemini-2.5-flash-lite%', 0.075, 0.3),
    ('%gemini-2.5-flash%', 0.3,  2.5)
)
UPDATE v3.ai_usage_log AS l
   SET cost_usd = round(
         (l.input_tokens  / 1e6 * p.in_per_m)
       + (l.output_tokens / 1e6 * p.out_per_m)
       , 6)
  FROM precios p
 WHERE l.model ILIKE p.patron
   -- el patron mas especifico gana: no re-pisar una fila ya correcta
   AND abs(l.cost_usd - ((l.input_tokens/1e6*p.in_per_m) + (l.output_tokens/1e6*p.out_per_m))) > 0.000001
   -- lite y flash comparten prefijo; excluir el solapamiento
   AND NOT (p.patron = '%gemini-2.5-flash%' AND l.model ILIKE '%lite%');

-- 3. Verificacion --------------------------------------------------------
DO $$
DECLARE
  v_mal integer;
  v_total_opus numeric;
BEGIN
  SELECT count(*) INTO v_mal
    FROM v3.ai_usage_log
   WHERE model ILIKE '%opus%'
     AND abs(cost_usd - (input_tokens/1e6*5 + output_tokens/1e6*25)) > 0.001;

  SELECT round(sum(cost_usd)::numeric, 2) INTO v_total_opus
    FROM v3.ai_usage_log WHERE model ILIKE '%opus%';

  RAISE NOTICE 'filas de opus mal valuadas despues del recalculo: % (esperado 0)', v_mal;
  RAISE NOTICE 'costo total de opus ahora: $%', v_total_opus;
END $$;
