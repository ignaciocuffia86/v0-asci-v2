-- ═══════════════════════════════════════════════════════════════════════════
-- 425: Borrar dos indices muertos de public.contacts (191 MB)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO: investigando por que un merge de empresas tardaba 18s (y moria
-- contra el limite de 8s de PostgREST), EXPLAIN (ANALYZE, BUFFERS) mostro que
-- mover 982 filas de contacts ensuciaba 416 MB:
--
--   Buffers: shared hit=190011 read=52098 dirtied=53321 written=8797
--   Execution Time: 8997 ms
--
-- La causa: el merge cambia current_company_id, que esta indexado, asi que el
-- UPDATE no puede ser HOT. Postgres versiona cada fila y reinserta en LOS 11
-- indices de la tabla (1.226 MB, de los cuales 1.067 MB son GIN de trigramas),
-- aunque el texto que esos GIN indexan no cambio.
--
-- OJO / EXPECTATIVA REALISTA: esto NO arregla el timeout por si solo. Los 5 GIN
-- de trigramas que quedan (928 MB) se usan de verdad para busqueda (311-441
-- escaneos) y no se pueden tocar. Borrar estos dos es higiene: abarata TODO
-- write sobre contacts (ingesta, enriquecimiento de Apollo, normalizaciones),
-- no solo los merges. El timeout se resuelve aparte, sacando el merge del
-- camino de PostgREST.
--
-- ── Evidencia para cada uno (48 dias de stats, pg_postmaster_start_time
--    2026-06-11, stats_reset NULL) ─────────────────────────────────────────
--
-- 1) idx_contacts_linkedin_url (52 MB, btree, 0 escaneos)
--    REDUNDANTE AL 100%: existe contacts_linkedin_url_key, un indice UNIQUE
--    btree sobre exactamente la misma columna (linkedin_url) con 115.789
--    escaneos. Un unique btree sirve toda consulta que serviria el no-unique
--    (igualdad, rango, ordenamiento, IS NULL), asi que el planner nunca elige
--    el duplicado. Riesgo de borrarlo: ninguno.
--
-- 2) idx_contacts_previous_positions_gin (139 MB, GIN jsonb_path_ops, 0 escaneos)
--    jsonb_path_ops solo acelera operadores de containment (@>, @?). Se
--    verifico que NO hay ninguno sobre previous_positions:
--      - en el codigo TS: la unica mencion del indice esta en el script que lo
--        creo (095_create_drawer_rpc.sql), ninguna query lo usa;
--      - en la BD: 0 funciones de public/v3 cuyo cuerpo matchee
--        'previous_positions[[:space:]]*(@>|@\?)'.
--    La busqueda de texto sobre esa columna la sirve idx_contacts_prevpos_trgm
--    (386 MB, 311 escaneos), que indexa contacts_prevpos_text(previous_positions)
--    con gin_trgm_ops y ES un indice distinto. Ese NO se toca.
--
-- ── Lo que decidi NO borrar ────────────────────────────────────────────────
--
-- idx_contacts_country_normalized (17 MB, btree, 0 escaneos): tiene 0 escaneos,
-- pero a diferencia de los dos de arriba SI existe un patron de consulta activo
-- que podria usarlo -- export_contacts filtra por
-- `c.country_normalized = ANY(p_countries)`. Que hoy no se escanee se explica
-- porque los exports barren cientos de miles de filas y el planner prefiere seq
-- scan. Son 17 MB, el beneficio es marginal y el riesgo no es cero. Se queda.
--
-- REVERSIBILIDAD: al final del archivo estan los CREATE INDEX exactos,
-- comentados, para recrearlos si hiciera falta.
-- ═══════════════════════════════════════════════════════════════════════════

-- Se usa IF EXISTS para que el script sea idempotente.
-- DROP INDEX toma ACCESS EXCLUSIVE, pero solo hace catalogo + unlink del
-- archivo: son milisegundos, no un rebuild.
DROP INDEX IF EXISTS public.idx_contacts_linkedin_url;
DROP INDEX IF EXISTS public.idx_contacts_previous_positions_gin;

-- ── Verificacion ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_quedan   INT;
  v_unique   INT;
  v_trgm     INT;
  v_tamano   TEXT;
BEGIN
  -- Los dos borrados ya no existen
  SELECT count(*) INTO v_quedan
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('idx_contacts_linkedin_url', 'idx_contacts_previous_positions_gin');

  -- El unique de linkedin_url (el que si se usa) sigue en pie
  SELECT count(*) INTO v_unique
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'contacts_linkedin_url_key';

  -- Y el trgm de previous_positions, que es OTRO indice, tambien
  SELECT count(*) INTO v_trgm
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'idx_contacts_prevpos_trgm';

  IF v_quedan <> 0 THEN
    RAISE EXCEPTION 'FALLO: quedaron % indices que debian borrarse', v_quedan;
  END IF;
  IF v_unique <> 1 THEN
    RAISE EXCEPTION 'FALLO: se perdio contacts_linkedin_url_key (el unique que SI se usa)';
  END IF;
  IF v_trgm <> 1 THEN
    RAISE EXCEPTION 'FALLO: se perdio idx_contacts_prevpos_trgm (la busqueda de texto)';
  END IF;

  SELECT pg_size_pretty(sum(pg_relation_size(i.indexrelid))) INTO v_tamano
  FROM pg_index i WHERE i.indrelid = 'public.contacts'::regclass;

  RAISE NOTICE 'OK: 2 indices muertos borrados (191 MB liberados)';
  RAISE NOTICE 'OK: contacts_linkedin_url_key y idx_contacts_prevpos_trgm intactos';
  RAISE NOTICE 'Indices de contacts ahora: %', v_tamano;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (si alguna vez hicieran falta, recrear CONCURRENTLY fuera de
-- transaccion para no bloquear la tabla):
--
--   CREATE INDEX CONCURRENTLY idx_contacts_linkedin_url
--     ON public.contacts USING btree (linkedin_url);
--
--   CREATE INDEX CONCURRENTLY idx_contacts_previous_positions_gin
--     ON public.contacts USING gin (previous_positions jsonb_path_ops);
-- ═══════════════════════════════════════════════════════════════════════════
