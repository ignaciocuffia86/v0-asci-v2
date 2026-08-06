-- ============================================================================
-- 441 · Contabilidad unificada: features de investigación en v3.ai_usage_log
-- ============================================================================
--
-- CONTEXTO
-- El objetivo es que TODO el gasto de IA quede en una sola tabla, incluidos los
-- caminos de v2 (`structureWithLLM` en lib/ai-structurer.ts) que hoy gastan sin
-- registrar nada. Sin esto, la tabla solo ve v3 y cualquier comparación contra
-- la factura de Vercel queda descalzada.
--
-- El CHECK de `feature` es un enum cerrado de 9 valores y `feature` es NOT NULL,
-- así que instrumentar v2 sin tocar la restricción haría fallar el insert.
-- Podríamos usar 'other', pero entonces el gasto de estructuración quedaría
-- mezclado con todo lo demás y no se podría separar por etapa — que es
-- justamente lo que queremos medir para el rediseño del motor.
--
-- QUÉ AGREGA
--   · 'research-collect'   → recolección de fuentes (búsqueda barata)
--   · 'research-structure' → estructuración del texto crudo a JSON
--   · 'research-synthesis' → síntesis premium sobre lo ya recolectado
--
-- SEGURIDAD PARA v2
-- Solo AMPLÍA el conjunto de valores permitidos: nada de lo que hoy entra deja
-- de entrar, así que ninguna escritura existente puede empezar a fallar.
-- La tabla vive en el schema `v3` y v2 no la usa.
--
-- Idempotente: se puede correr varias veces.
-- Recordá que scripts/run-sql.mjs es DRY RUN salvo que pases --commit.
-- ============================================================================

ALTER TABLE v3.ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_feature_check;

ALTER TABLE v3.ai_usage_log
  ADD CONSTRAINT ai_usage_log_feature_check CHECK (
    feature = ANY (ARRAY[
      'chat'::text,
      'radar-tech'::text,
      'radar-news'::text,
      'jobs-interpretation'::text,
      'scoring'::text,
      'icebreaker'::text,
      'doc-analysis'::text,
      'dedupe'::text,
      -- nuevas: separan las 3 etapas del motor de investigación
      'research-collect'::text,
      'research-structure'::text,
      'research-synthesis'::text,
      'other'::text
    ])
  );

-- ── Verificación: los valores nuevos entran y los viejos siguen entrando ──
-- Se prueba con un INSERT real dentro de un bloque que siempre falla, así se
-- valida la restricción sin dejar filas de prueba en la tabla.
DO $$
DECLARE
  v_feature text;
BEGIN
  FOREACH v_feature IN ARRAY ARRAY[
    'research-collect', 'research-structure', 'research-synthesis',
    'radar-tech', 'chat', 'other'
  ]
  LOOP
    BEGIN
      INSERT INTO v3.ai_usage_log (feature, model, input_tokens, output_tokens, cost_usd)
      VALUES (v_feature, '__probe__', 0, 0, 0);
      RAISE NOTICE 'feature OK: %', v_feature;
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'feature RECHAZADA por el CHECK: %', v_feature;
    END;
  END LOOP;

  -- Y que un valor inventado siga siendo rechazado (el CHECK no quedó abierto).
  BEGIN
    INSERT INTO v3.ai_usage_log (feature, model, input_tokens, output_tokens, cost_usd)
    VALUES ('__no_deberia_entrar__', '__probe__', 0, 0, 0);
    RAISE EXCEPTION 'PROBLEMA: el CHECK acepta cualquier valor';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK: los valores no declarados siguen rechazados';
  END;

  -- Deshace las filas de prueba.
  RAISE EXCEPTION 'ROLLBACK_INTENCIONAL_DE_LA_VERIFICACION';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'ROLLBACK_INTENCIONAL_DE_LA_VERIFICACION' THEN
    RAISE;
  END IF;
  RAISE NOTICE 'Verificación completa, filas de prueba descartadas.';
END $$;

SELECT
  'features permitidas' AS chequeo,
  pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'v3.ai_usage_log'::regclass
  AND conname = 'ai_usage_log_feature_check';

SELECT
  '__probe__ no dejo filas' AS chequeo,
  count(*)::int AS filas_probe
FROM v3.ai_usage_log
WHERE model = '__probe__';
