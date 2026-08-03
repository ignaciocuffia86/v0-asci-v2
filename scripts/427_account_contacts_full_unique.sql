-- 427: arregla `run_contact_enrichment`, que estaba roto por completo.
--
-- SINTOMA (reproducido en runtime, tenant Bigua):
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--   → el enrichment fallaba SIEMPRE, y `v3.account_contacts` estaba en 0 filas.
--
-- CAUSA: el unique de la tabla era PARCIAL:
--   CREATE UNIQUE INDEX account_contacts_ws_company_person_key
--     ON v3.account_contacts (workspace_id, company_id, apollo_person_id)
--     WHERE apollo_person_id IS NOT NULL;
--
-- Postgres solo infiere un indice parcial si el ON CONFLICT repite su predicado, y
-- `.upsert({ onConflict })` de supabase-js NO tiene forma de expresarlo: manda la lista de
-- columnas pelada. O sea que todo upsert de supabase-js contra un unique parcial esta roto
-- por construccion, no es un typo del onConflict.
--
-- ARREGLO: indice unico COMPLETO. La semantica NO cambia, porque por el NULLS DISTINCT que
-- Postgres aplica por defecto varias filas con `apollo_person_id` NULL siguen sin colisionar
-- entre si — que es exactamente lo que el predicado buscaba preservar.
--
-- Seguro de aplicar: verificado 0 grupos duplicados y 0 filas en la tabla, asi que la
-- creacion no puede fallar por datos existentes. Es tabla de v3 unicamente: no toca v2.

-- SIN `BEGIN`/`COMMIT` a proposito: `run-sql.mjs` ya envuelve el archivo en su propia
-- transaccion y decide si commitear segun el flag `--commit`. Un `COMMIT` explicito acá
-- cierra esa transaccion antes de tiempo y ANULA el dry run: verificado que el script
-- imprime "DRY RUN: nada quedo guardado" mientras los cambios YA quedaron persistidos.

-- El nombre nuevo evita el caso en que el CREATE corra pero el DROP no y quede el parcial.
CREATE UNIQUE INDEX IF NOT EXISTS account_contacts_ws_company_person_uniq
  ON v3.account_contacts (workspace_id, company_id, apollo_person_id);

DROP INDEX IF EXISTS v3.account_contacts_ws_company_person_key;
