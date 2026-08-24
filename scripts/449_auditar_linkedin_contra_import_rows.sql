-- =============================================================================
-- 449 - Auditoria de las URLs de LinkedIn contra los datos de importacion
-- =============================================================================
--
-- QUE FALTABA
--
-- El script 447 audito las URLs de LinkedIn comparando companies.name contra el
-- nombre que devolvio LinkedIn, guardado en v3.linkedin_company_enrichment.
-- Eso cubre 11.833 empresas: las que pasaron por el enriquecimiento. Quedaban
-- ~52.000 con linkedin_url y sin payload contra el cual contrastar.
--
-- La primera idea fue comparar el nombre contra el slug de la URL. Da 2.286
-- filas con discrepancia, pero casi todo es ruido: LinkedIn permite un slug de
-- vanidad distinto del nombre visible, asi que "Grupo Bimbo" con slug
-- "grupobimbo" y "Cueros Velez" con slug "talentosvelez" son igual de validas.
--
-- LA FUENTE QUE SI SIRVE
--
-- public.import_rows guarda el JSON crudo del proveedor, y ahi vienen
-- `company_name` y `company_linkedin_url` EN LA MISMA FILA. Son 897.548 filas
-- donde el proveedor ya emparejo nombre con URL. Eso es verdad de campo para
-- practicamente todo el universo, no solo para lo enriquecido.
--
-- La tabla es de 2,5 GB y agregarla en una sola consulta no entra en el limite
-- de tiempo de la API de gestion, asi que el cruce se materializa una vez en
-- v3.import_url_names, iterando por batch_id (que si tiene indice).
--
-- Lo que muestra el cruce: 63.305 URLs distintas, de las cuales 62.426 tienen
-- UN SOLO nombre asociado. El proveedor es muy consistente, asi que un nombre
-- que no coincide es señal fuerte y no ruido.
--
-- RESULTADO DE LA AUDITORIA
--
--   51.761  empresas auditables (con URL, sin payload de enrichment)
--   51.207  nombre identico al de la fuente          -> correcto
--      372  uno contiene al otro                     -> variante, correcto
--      182  discrepan                                -> a revisar
--
-- De las 182, 62 comparten alguna palabra de 4+ letras (rebrand o traduccion) y
-- se dejan. Las 115 restantes se separaron por una pregunta simple: ¿a quien
-- corresponde el slug de la URL?
--
--   72  el nombre de la fila ES el slug        -> la URL esta bien, el nombre es feo
--   14  el nombre es consistente con su slug   -> la URL esta bien
--   17  el slug corresponde a la FUENTE        -> la URL es de otra empresa
--   19  no coincide con nadie                  -> revisadas una por una
--
-- De esos dos ultimos grupos, 19 filas tenian efectivamente la URL de otra
-- empresa (Fraiya con la de IT Resources, Adecco Colombia con la de Fundacion
-- Santo Domingo, Concretos Cruz Azul con la de Arkema) y se les quito. Las
-- otras son acronimos que el test no puede ver: ENSI, CICESE, COMPAS,
-- FEN UCHILE.
--
-- Se restituyo una: "Cleaner Chile S.A." con la URL de liquidos.cl. La fuente
-- empareja los dos nombres con esa misma URL 3 y 3 veces, y liquidos.cl es un
-- negocio de limpieza; sin evidencia para quitarla, se deja.
--
-- Aca solo se borra linkedin_url y linkedin_slug, a diferencia del 447. Alla se
-- podia revertir columna por columna porque filled_columns decia exactamente
-- que habia escrito el enriquecimiento; estas filas no pasaron por ahi, asi que
-- no hay forma de saber que dato vino de donde y adivinar seria peor.
--
-- EFECTO LATERAL: DUPLICADOS QUE EL NOMBRE NO PODIA VER
--
-- El cruce destapo otra cosa. Cuando el ETL no trae nombre, upsert_company lo
-- inventa con INITCAP del slug, y quedan filas llamadas "Smuchile",
-- "Mastellonehnoslaserenisima" o "Clinica-Las-Condes-S.a". Esos nombres no se
-- parecen al nombre real, asi que la deduplicacion por nombre nucleo jamas
-- podia juntarlas con la fila buena.
--
-- Con la fuente se resuelven solas: 211 filas con nombre-de-slug tienen la URL
-- asociada a un unico nombre en la importacion. De esas, 159 ya existian como
-- otra fila con ese nombre (duplicados: se unificaron, method='manual') y 52 no
-- (se renombraron con el nombre real).
--
-- Quedan 35 pares mas donde la URL tiene VARIOS nombres en la fuente, o sea
-- evidencia mas debil. No se tocaron: entre ellos esta "Grupo-Irsa", cuyo
-- nombre principal en la fuente es "IRSA PROPIEDADES COMERCIALES", que es otra
-- entidad. Ese es justo el caso que el filtro de nombre unico evita.
-- =============================================================================

-- ── Cruce nombre <-> URL de los datos de importacion ────────────────────────
--
-- Se deja creada: es la unica forma barata de auditar la asignacion de URLs, y
-- sirve para las proximas tandas de importacion sin volver a escanear 2,5 GB.

CREATE TABLE IF NOT EXISTS v3.import_url_names (
  url_norm     TEXT    NOT NULL,
  company_name TEXT    NOT NULL,
  n            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (url_norm, company_name)
);

-- Control de avance: la tabla se llena por lotes y hay que poder reanudar.
CREATE TABLE IF NOT EXISTS v3.import_url_names_done (batch_id UUID PRIMARY KEY);

ALTER TABLE v3.import_url_names      ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.import_url_names_done ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE v3.import_url_names      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE v3.import_url_names_done FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE v3.import_url_names      TO service_role;
GRANT ALL ON TABLE v3.import_url_names_done TO service_role;

-- Se itera por batch_id porque es lo unico indexado en import_rows. Una sola
-- pasada sobre las 897.548 filas no entra en el limite de tiempo.
-- Reanudable: correr de nuevo continua donde quedo.
DO $$
DECLARE b RECORD; t0 TIMESTAMPTZ := clock_timestamp();
BEGIN
  FOR b IN SELECT id FROM public.import_batches
           WHERE id NOT IN (SELECT batch_id FROM v3.import_url_names_done) LOOP
    EXIT WHEN extract(epoch FROM clock_timestamp() - t0) > 45;

    INSERT INTO v3.import_url_names (url_norm, company_name, n)
    SELECT public.normalize_linkedin_url(r.row_data->>'company_linkedin_url'),
           btrim(r.row_data->>'company_name'),
           count(*)
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

-- ── Consulta de auditoria ───────────────────────────────────────────────────
--
-- Deja a la vista, para cualquier empresa con URL, si el nombre coincide con el
-- que el proveedor asocia a esa misma URL. `n` dice cuantas veces aparece el
-- par, para distinguir señal de un caso aislado.

CREATE OR REPLACE VIEW v3.linkedin_url_auditoria AS
SELECT c.id,
       c.name,
       c.linkedin_url,
       t.company_name                          AS nombre_en_la_fuente,
       t.n                                     AS veces_en_la_fuente,
       (SELECT count(*) FROM v3.import_url_names i WHERE i.url_norm = c.linkedin_url)
                                               AS nombres_distintos_para_la_url,
       regexp_replace(lower(unaccent(c.name)), '[^a-z0-9]', '', 'g')
         = regexp_replace(lower(unaccent(t.company_name)), '[^a-z0-9]', '', 'g')
                                               AS coincide
FROM public.companies c
JOIN LATERAL (
  SELECT i.company_name, i.n
  FROM v3.import_url_names i
  WHERE i.url_norm = c.linkedin_url
  ORDER BY i.n DESC
  LIMIT 1
) t ON true
WHERE c.linkedin_url IS NOT NULL;

REVOKE ALL ON v3.linkedin_url_auditoria FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v3.linkedin_url_auditoria TO service_role;
