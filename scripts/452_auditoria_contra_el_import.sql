-- =============================================================================
-- 452 - Segunda pasada: auditar contra el import del proveedor
-- =============================================================================
--
-- POR QUE HACIA FALTA
--
-- El script 447 audito las URLs de LinkedIn comparando companies.name contra el
-- nombre que LinkedIn devolvio en v3.linkedin_company_enrichment.payload. Es
-- verdad de campo, pero solo cubre las 11.833 empresas que pasaron por el
-- enrichment. Quedaban ~52.000 con linkedin_url sin nada contra que
-- contrastar.
--
-- LA FUENTE DE VERDAD QUE FALTABA
--
-- public.import_rows.row_data trae `company_name` y `company_linkedin_url`
-- EMPAREJADOS en 897.548 filas: es el dato tal como lo entrego el proveedor.
-- Agregado por (url canonizada, nombre) queda en v3.import_url_names: 64.345
-- pares sobre 63.305 URLs distintas, que cruzan con 61.912 de las 64.599
-- empresas con LinkedIn. Cobertura 5x mejor que la del payload.
--
-- Se construyo iterando por batch_id (hay indice) porque import_rows pesa
-- 2,5 GB y una sola pasada con extraccion jsonb no entra en el timeout.
--
-- RESULTADO DE LA AUDITORIA DE URLs
--
--     61.912  con cruce contra el proveedor
--     61.331  el nombre coincide EXACTO con alguno del proveedor
--        581  no coincide  ->  se revisan
--
-- De esos 581: 482 son variantes (uno contiene al otro), 52 comparten palabra
-- y solo 47 no tienen ninguna relacion. Y de esas 47, revisadas una por una,
-- casi ninguna era corrupcion nuestra:
--
--   - la mayoria eran filas con la URL BIEN y el NOMBRE mal (ver abajo);
--   - 8 son casos donde el slug corresponde a NUESTRO nombre y el que se
--     equivoco fue el proveedor: majorkey-technology es MajorKey,
--     placoargentina es PLACO Argentina, edesecuador es EDES,
--     america-digital-congress es nuestro congreso. No se toca nada.
--   - 1 sola quedo genuinamente dudosa ("Human Lab Transformacion Cultural"
--     con slug evolve-training, 1 contacto): sin evidencia para decidir, se
--     deja como esta.
--
-- O sea: las ~52k empresas que no habian pasado por el enrichment estaban
-- sanas en cuanto a URL. La segunda pasada no encontro corrupcion nueva.
--
-- LO QUE SI ENCONTRO: 137 FILAS MAL BAUTIZADAS
--
-- El hallazgo real es otro. upsert_company, cuando el ETL no trae nombre, lo
-- inventa con INITCAP(SPLIT_PART(url,'/',5)), o sea el slug de LinkedIn. Eso
-- deja filas llamadas "Smuchile", "Ucvperu", "Ministeriopublicopy" o
-- "Compa-Ia-Minera-Poderosa-S-A-" (donde los acentos ya venian destrozados en
-- el slug).
--
-- Son 137 filas con 4.676 contactos, y el proveedor tiene el nombre real para
-- todas. La URL esta bien; lo que estaba mal era el nombre visible, que es el
-- que se ve en la busqueda, en los reportes y en los icebreakers.
--
--     Clinica-Las-Condes-S.a              -> Clinica Las Condes
--     Compa-Ia-Minera-Poderosa-S-A-       -> Compania Minera Poderosa S.A.
--     Universidad-Tecnol-Gica-De-Panam-   -> Universidad Tecnologica de Panama
--     Ministeriopublicopy                 -> Ministerio Publico - Fiscalia General...
--
-- UN NUMERO QUE ESTUVO MAL EN EL CAMINO
--
-- El primer intento de medir esto dio 3.382 filas y era un error de la
-- consulta, no del dato. Buscaba "el nombre del proveedor distinto del actual"
-- con `<> n1`, que justamente EXCLUYE el nombre correcto y deja el ruido: para
-- la URL de Mercado Libre el proveedor tiene mayormente "Mercado Libre" (que se
-- excluia) y unos pocos registros con "Atos". Los renombres propuestos eran
-- "Mercado Libre -> Atos", "Meta -> Amazon", "Oracle -> Beta Gamma Sigma".
--
-- El criterio correcto es al reves: la fila esta mal bautizada solo si NINGUN
-- nombre del proveedor para esa URL coincide con el actual. Con eso el numero
-- real es 137. Se vio a tiempo porque se miro la muestra antes de aplicar; vale
-- la pena dejarlo escrito para no repetir el error.
--
-- QUE SE HIZO
--
--   5   pares unificados: la fila con nombre-slug y la fila con el nombre real
--       eran la misma empresa y el UNIQUE de companies.name las delataba
--       (Smuchile + SMU S.A., Mibanco-Peru + Mibanco, Bonafidesau + Bonafide
--       Argentina, Aspen-Pharmacare-Group + Aspen Pharma Group,
--       ManpowerGroup Espana + ManpowerGroup Spain).
--   130 filas renombradas con el nombre del proveedor, recalculando
--       normalized_name (si no, el nucleo queda apuntando al slug viejo y la
--       busqueda del script 450 sigue sin encontrarlas).
--   3   se dejaron como estaban: dos porque el proveedor manda basura
--       ("Libertyseguroschile" -> "."), y "Ubimia" porque el nombre destino ya
--       existe y ademas seria incorrecto (el slug ubimia es de Ubimia).
--
-- El renombre va fila por fila con manejo de unique_violation en vez de un
-- UPDATE masivo: companies.name es UNIQUE y un solo choque aborta el lote
-- entero.
--
-- LIMITE QUE QUEDA
--
-- 2.687 empresas con linkedin_url no cruzan con ningun import (su URL entro por
-- otra via, tipica del scraper de vacantes). Para esas no hay fuente de verdad
-- disponible y no se auditaron.
-- =============================================================================

-- ── Fuente de verdad: pares (URL canonizada, nombre) del proveedor ──────────

CREATE TABLE IF NOT EXISTS v3.import_url_names (
  url_norm     TEXT NOT NULL,
  company_name TEXT NOT NULL,
  n            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (url_norm, company_name)
);
CREATE TABLE IF NOT EXISTS v3.import_url_names_done (batch_id UUID PRIMARY KEY);

ALTER TABLE v3.import_url_names      ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.import_url_names_done ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE v3.import_url_names      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE v3.import_url_names_done FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE v3.import_url_names      TO service_role;
GRANT ALL ON TABLE v3.import_url_names_done TO service_role;

-- Por tanda, con presupuesto de tiempo: import_rows pesa 2,5 GB y una sola
-- pasada no entra en el timeout. Repetir hasta que done = import_batches.
DO $$
DECLARE b RECORD; t0 TIMESTAMPTZ := clock_timestamp();
BEGIN
  FOR b IN SELECT id FROM public.import_batches
           WHERE id NOT IN (SELECT batch_id FROM v3.import_url_names_done)
  LOOP
    EXIT WHEN extract(epoch FROM clock_timestamp() - t0) > 45;

    INSERT INTO v3.import_url_names (url_norm, company_name, n)
    SELECT public.normalize_linkedin_url(r.row_data->>'company_linkedin_url'),
           btrim(r.row_data->>'company_name'), count(*)
    FROM public.import_rows r
    WHERE r.batch_id = b.id
      AND r.row_data->>'company_linkedin_url' ILIKE '%linkedin.com/company/%'
      AND nullif(btrim(r.row_data->>'company_name'), '') IS NOT NULL
    GROUP BY 1, 2
    ON CONFLICT (url_norm, company_name)
      DO UPDATE SET n = v3.import_url_names.n + excluded.n;

    INSERT INTO v3.import_url_names_done VALUES (b.id) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ── Renombre de las filas bautizadas con el slug ────────────────────────────
--
-- Fila por fila y no en bloque: companies.name es UNIQUE y un choque aborta el
-- lote entero. Los pares que chocan son duplicados reales y se unifican antes,
-- a mano, con merge_companies.

DO $$
DECLARE r RECORD; n INT := 0; s INT := 0;
BEGIN
  FOR r IN
    WITH slugname AS (
      -- filas cuyo nombre ES el slug de su propia URL
      SELECT c.id, c.name, c.linkedin_url,
             regexp_replace(lower(unaccent(c.name)), '[^a-z0-9]', '', 'g') AS n1
      FROM public.companies c
      WHERE c.linkedin_url IS NOT NULL
        AND regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g')
            = regexp_replace(lower(regexp_replace(
                c.linkedin_url, '^https://www\.linkedin\.com/company/', '')), '[^a-z0-9]', '', 'g')
    ),
    malas AS (
      -- ... y para las que NINGUN nombre del proveedor coincide con el actual.
      -- Este "ninguno coincide" es el criterio correcto; ver la nota de arriba
      -- sobre el 3.382 que dio la version equivocada.
      SELECT s2.* FROM slugname s2
      WHERE EXISTS (SELECT 1 FROM v3.import_url_names i WHERE i.url_norm = s2.linkedin_url)
        AND NOT EXISTS (
          SELECT 1 FROM v3.import_url_names i
          WHERE i.url_norm = s2.linkedin_url
            AND regexp_replace(lower(unaccent(i.company_name)), '[^a-z0-9]', '', 'g') = s2.n1)
    )
    SELECT m.id,
           btrim((SELECT i.company_name FROM v3.import_url_names i
                   WHERE i.url_norm = m.linkedin_url ORDER BY i.n DESC LIMIT 1)) AS nuevo
    FROM malas m
  LOOP
    -- El proveedor a veces manda basura ("." o cadenas sin letras).
    CONTINUE WHEN r.nuevo IS NULL OR length(r.nuevo) < 3 OR r.nuevo !~ '[A-Za-zÀ-ÿ]';
    BEGIN
      -- normalized_name se recalcula si o si: sin eso el nucleo sigue apuntando
      -- al slug viejo y la busqueda del script 450 no encuentra la empresa.
      UPDATE public.companies
      SET name = r.nuevo,
          normalized_name = public.company_core_name(r.nuevo),
          updated_at = now()
      WHERE id = r.id;
      n := n + 1;
    EXCEPTION WHEN unique_violation THEN
      s := s + 1;   -- ya hay una empresa con ese nombre: se deja para revision
    END;
  END LOOP;
  RAISE NOTICE 'renombradas % / salteadas %', n, s;
END $$;
