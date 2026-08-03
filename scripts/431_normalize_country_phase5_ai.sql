-- =========================================================================
-- FASE 5: NORMALIZACIÓN CON IA + HEURÍSTICA
-- =========================================================================
-- Procesa los ~500 valores aún sin mapeo ISO (ciudades, regiones, estados)
-- usando una combinación de:
--   1. Heurística pura: regex de US states, regiones LATAM, diccionario
--   2. Gemini: batch de 20 valores ambiguos para resolución final
--
-- NOTA: Este script es generalmente INFORMATIVO. Los valores ya
-- normalizados por Fases 1-4 son ~50k. Esta Fase 5 suma ~500 más.
--
-- La lógica está implementada en lib/v3/services/country-normalizer.ts
-- que puede ser invocada desde:
--   - Una función PostgreSQL (requiere plv8 o lenguaje externo)
--   - Un job de Vercel Cron
--   - Una API route que llama normalizeCountries() y persiste en bulk
--
-- Por ahora, este script es un DRY-RUN que muestra qué valores quedarían.
-- =========================================================================

DO $$
DECLARE
  v_unmapped_count integer;
  v_phase5_candidates text[];
BEGIN

  RAISE NOTICE '';
  RAISE NOTICE '=== FASE 5: INTELIGENCIA ARTIFICIAL ===';
  RAISE NOTICE 'Candidatos para normalización con Gemini:';
  RAISE NOTICE '';

  -- Obtén todos los valores aún sin mapeo (después de Fases 1-4)
  SELECT array_agg(DISTINCT c.country)
    INTO v_phase5_candidates
  FROM public.companies c
  WHERE c.country_normalized IS NULL
    AND c.country IS NOT NULL
    AND btrim(c.country) != ''
  LIMIT 100;

  v_unmapped_count := coalesce(array_length(v_phase5_candidates, 1), 0);

  RAISE NOTICE 'Total de valores únicos sin normalizar: %', v_unmapped_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Valores candidatos:';

  IF v_phase5_candidates IS NOT NULL THEN
    FOR i IN 1 .. array_length(v_phase5_candidates, 1)
    LOOP
      RAISE NOTICE '  - %', v_phase5_candidates[i];
    END LOOP;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'INSTRUCCIONES PARA APLICAR FASE 5:';
  RAISE NOTICE '';
  RAISE NOTICE '1. Llamá la función TypeScript lib/v3/services/country-normalizer.ts';
  RAISE NOTICE '   desde un job/API:';
  RAISE NOTICE '';
  RAISE NOTICE '   import { normalizeCountries } from "@/lib/v3/services/country-normalizer"';
  RAISE NOTICE '   const results = await normalizeCountries(locations)';
  RAISE NOTICE '   // Persiste: UPDATE public.companies SET country_normalized = ...';
  RAISE NOTICE '';
  RAISE NOTICE '2. Alternativa: crear una función PL/Python o PL/R en la BD que';
  RAISE NOTICE '   llame a Gemini directamente (requiere librería externa).';
  RAISE NOTICE '';
  RAISE NOTICE '3. El threshold esperado es 85-95% hit rate con Gemini para';
  RAISE NOTICE '   estos ~%d valores.', v_unmapped_count;
  RAISE NOTICE '';

  RAISE NOTICE '=== DRY RUN COMPLETADO (Fase 5) ===';

END $$;
