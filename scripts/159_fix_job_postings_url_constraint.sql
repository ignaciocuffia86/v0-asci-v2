-- Script 159: Fix job_postings.job_url ON CONFLICT failure
--
-- PROBLEMA
-- process_job_batch_internal ejecuta:
--   INSERT INTO job_postings (..., job_url, ...) VALUES (...)
--   ON CONFLICT (job_url) DO UPDATE ...
-- 
-- Pero el unico indice unico sobre job_url es PARCIAL:
--   CREATE UNIQUE INDEX idx_job_postings_job_url
--     ON job_postings (job_url) WHERE job_url IS NOT NULL;
--
-- PostgreSQL no puede usar un indice parcial como arbitro de ON CONFLICT
-- a menos que pueda probar que el predicado siempre es verdadero en el
-- INSERT (lo cual no puede porque job_url viene de un JSON extract y
-- podria ser NULL). Resultado: error "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification" en cada fila.
--
-- VERIFICACION PREVIA (ya ejecutada)
--   urls_duplicados: 0  -> no hay duplicados, el constraint se puede crear
--   urls_distintos_no_null: 29307
--   filas con job_url NULL: 17 (siguen siendo validas: NULL != NULL en UNIQUE)
--
-- SOLUCION
-- Crear un UNIQUE CONSTRAINT real (no parcial) sobre job_url.
-- En PostgreSQL NULL nunca viola un UNIQUE, asi que las 17 filas con
-- job_url NULL existentes siguen siendo validas. Ningun dato cambia.
--
-- Luego eliminamos el indice parcial porque el CONSTRAINT ya crea su
-- propio indice unico y tener ambos seria redundante y podria volver
-- a generar el mismo problema de ambiguedad que tuvimos con signals
-- (ver scripts 156/157).

BEGIN;

-- 1. Crear el UNIQUE CONSTRAINT (esto crea automaticamente un indice unico
--    llamado job_postings_job_url_key que PostgreSQL si puede usar como
--    arbitro de ON CONFLICT).
ALTER TABLE public.job_postings
  ADD CONSTRAINT job_postings_job_url_key UNIQUE (job_url);

-- 2. Eliminar el indice parcial redundante. El nuevo constraint ya cubre
--    todos los casos de busqueda por job_url.
DROP INDEX IF EXISTS public.idx_job_postings_job_url;

COMMIT;

-- Verificacion final: ahora debe existir el constraint unico.
SELECT
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'public.job_postings'::regclass
  AND contype = 'u';
