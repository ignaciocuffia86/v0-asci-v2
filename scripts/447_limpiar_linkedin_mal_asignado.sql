-- =============================================================================
-- 447 - URLs de LinkedIn asignadas a la empresa equivocada
-- =============================================================================
--
-- DE DONDE SALIO ESTO
--
-- Revisando los duplicados por variante de URL (script 445) aparecieron filas
-- como "Bank of Saint Lucia" apuntando a ar.linkedin.com/company/brubank. La
-- lectura inicial fue que el problema estaba en las 1.412 filas con subdominio
-- de pais (ar., ec., bm.). Medido, esa lectura era equivocada:
--
--   subdominio de pais : 78,4% de coincidencia nombre-vs-slug (1.388 filas)
--   www (control)      : 82,8% de coincidencia            (63.317 filas)
--
-- La tasa es practicamente la misma. El subdominio es cosmetico y no predice
-- nada; los tres casos rotos que se habian visto estaban ahi por casualidad.
-- De hecho, de las 19 filas malas que se revisaron primero a mano, 3 eran www.
--
-- LA FUENTE DE VERDAD
--
-- v3.linkedin_company_enrichment guarda en `payload` la respuesta de LinkedIn,
-- incluido el NOMBRE que devolvio la pagina. Comparar ese nombre contra
-- companies.name dice, sin ambiguedad, si la URL era la correcta. Sobre las
-- 11.833 empresas con payload:
--
--     11.409  nombre identico                      -> correcto
--        292  uno contiene al otro                 -> variante, correcto
--        132  sin relacion                         -> a revisar
--
-- O sea 1,1% de corrupcion, no las 1.412 que se temian.
--
-- De las 132, las que COMPARTEN AL MENOS UNA PALABRA de 4+ letras con el
-- nombre de LinkedIn son la misma empresa escrita distinto (rebrand,
-- traduccion, forma legal): "Techint Ingenieria y Construccion" contra
-- "Techint Engineering & Construction", "Barrick Gold Corporation" contra
-- "Barrick Mining Corporation" (renombro en 2025), "BBVA Provincial" contra
-- "BBVA Banco Provincial". Son 70 y no se tocan.
--
-- Quedan 62 sin ninguna palabra en comun. Revisadas una por una, 12 son
-- igualmente la misma empresa y el test no las pudo ver porque la relacion es
-- un acronimo o un nombre en otro idioma:
--
--     Air Space Intelligence / ASI          Banque Scotia / Scotiabank
--     CENCUCADEHU / Centro Cultural y de Capacitacion para el Desarrollo Humano
--     Controlview / CTRLVIEW S.A.           NetworkBlu / Grupo Netblu
--     Nans-Chile / Natural NanoSystems      Million Dollar Sellers / MDS.co
--     Cawxel & Centsker / Cawcent           Letsping / Ping (YC S22)
--     ParadaisDDB / Paradais TBWA           ScaleIT Recruiting / Scale IT Consulting
--     Toloka Annotators / Mindrift Data Annotation Projects
--
-- Las otras 50 son empresas sin ninguna relacion y son las que limpia este
-- script. Afectan a 156 contactos.
--
-- QUE SE LIMPIA Y POR QUE ASI
--
-- No alcanza con borrar linkedin_url: el enriquecimiento (script 437) escribio
-- en la fila los datos de la OTRA empresa. "Maxam North America" quedo con
-- industria Insurance y pais Bermuda, que son de AXA XL; "Ceiba Software" se
-- llevo el linkedin_company_id de SoftwareOne.
--
-- Por suerte 437 registra en `filled_columns` exactamente que columnas
-- escribio en cada fila, asi que se revierte con precision en lugar de vaciar
-- campos a ciegas: si el pais ya estaba antes del enriquecimiento, no figura en
-- filled_columns y se conserva.
--
-- country_normalized y master_industry_id NO se tocan a mano: los derivan
-- trg_normalize_country y trg_normalize_company_industry cuando se anula la
-- columna de origen. Es el contrato que fija el script 437.
--
-- El registro de enrichment queda en 'error' con el detalle en error_message.
-- No se agrega un estado nuevo a proposito: el CHECK de la tabla admite
-- ok/no_result/no_hq/error y ampliarlo obligaria a tocar el contrato que ya
-- leen el script 437 y la UI. 'error' es ademas semanticamente correcto: la
-- corrida produjo un resultado que no sirve.
-- =============================================================================

BEGIN;

CREATE TEMP TABLE tmp_mal_asignadas ON COMMIT DROP AS
WITH a AS (
  SELECT e.company_id, c.name, e.payload->>'name' AS li_name, e.filled_columns,
         regexp_replace(lower(unaccent(c.name)), '[^a-z0-9]', '', 'g') AS n1,
         regexp_replace(lower(unaccent(e.payload->>'name')), '[^a-z0-9]', '', 'g') AS n2
  FROM v3.linkedin_company_enrichment e
  JOIN public.companies c ON c.id = e.company_id
  WHERE e.payload->>'name' IS NOT NULL
),
sospechosas AS (
  SELECT * FROM a
  WHERE n1 <> n2 AND NOT (n1 LIKE '%'||n2||'%' OR n2 LIKE '%'||n1||'%')
),
sin_palabra_comun AS (
  SELECT s.* FROM sospechosas s
  WHERE NOT EXISTS (
    SELECT 1
    FROM unnest(string_to_array(regexp_replace(lower(unaccent(s.name)),    '[^a-z0-9 ]', ' ', 'g'), ' ')) t1
    JOIN unnest(string_to_array(regexp_replace(lower(unaccent(s.li_name)), '[^a-z0-9 ]', ' ', 'g'), ' ')) t2
      ON t1 = t2
    WHERE length(t1) >= 4
  )
)
SELECT company_id, name, li_name, filled_columns
FROM sin_palabra_comun
-- Las 12 que el test no puede ver: acronimos y nombres en otro idioma.
WHERE name NOT IN (
  'Air Space Intelligence', 'Banque Scotia', 'Cawxel & Centsker E.A.S.',
  'CENCUCADEHU', 'Controlview', 'Letsping', 'Million Dollar Sellers',
  'Nans-Chile', 'NetworkBlu', 'ParadaisDDB Agencia Integrada',
  'ScaleIT Recruiting', 'Toloka Annotators'
);

-- Se revierte columna por columna, solo las que el enriquecimiento escribio.
DO $$
DECLARE r RECORD; col TEXT;
BEGIN
  FOR r IN SELECT * FROM tmp_mal_asignadas LOOP
    FOREACH col IN ARRAY coalesce(r.filled_columns, ARRAY[]::text[]) LOOP
      -- Lista blanca: solo columnas que 437/439 pueden escribir. Evita que un
      -- valor raro en filled_columns arme un UPDATE arbitrario.
      IF col IN ('country','hq_country_iso','website','industry','description',
                 'linkedin_slug','logo_url') THEN
        EXECUTE format('UPDATE public.companies SET %I = NULL WHERE id = $1', col)
          USING r.company_id;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- La URL que disparo todo, y el id de LinkedIn que quedo apuntando a la otra
-- empresa (companies_linkedin_company_id_key es UNIQUE: dejarlo bloquearia a
-- la empresa legitima si alguna vez se la quiere enriquecer).
UPDATE public.companies c
SET linkedin_url        = NULL,
    linkedin_slug       = NULL,
    linkedin_company_id = NULL,
    updated_at          = now()
FROM tmp_mal_asignadas m
WHERE c.id = m.company_id;

-- Para que la proxima corrida de enrichment no la tome por resuelta.
UPDATE v3.linkedin_company_enrichment e
SET status        = 'error',
    error_message = 'LinkedIn devolvio "' || m.li_name || '" para una fila llamada "'
                    || m.name || '": la URL era de otra empresa (script 447).'
FROM tmp_mal_asignadas m
WHERE e.company_id = m.company_id;

COMMIT;

-- =============================================================================
-- SEGUNDA PARTE - Canonizacion de las URLs y la causa de fondo
-- =============================================================================
--
-- Con las URLs equivocadas fuera, quedaba el problema cosmetico: la misma
-- pagina de LinkedIn escrita de formas distintas. Eran 2.258 filas entre
-- protocolo http, subdominio de pais, barra final y el ?trk=... que agrega el
-- scraper de vacantes.
--
-- 110 de esas colisionaban al canonizarse, o sea que la misma pagina ya existia
-- escrita de otra forma: duplicados que el indice UNIQUE de linkedin_url nunca
-- pudo frenar porque las dos cadenas eran distintas. 106 se unificaron
-- (method='manual' en v3.company_merges, revertibles como cualquier otro) y 4
-- resultaron ser mas URLs mal asignadas, que se limpiaron igual que las 50 de
-- arriba: Fundacion Igualar tenia la de Ualá, RESGASA la de Allata, pfsTECH la
-- de Ubimia y Netsoft la de Tsoft. MAPER tenia la de Predicore, que el payload
-- de LinkedIn identifica como dueña del slug mapertech.
--
-- Resultado: 0 filas sin canonizar, 0 con subdominio de pais, 0 con parametros
-- de query, y 0 grupos de duplicados por variante de URL.
-- =============================================================================

UPDATE public.companies
SET linkedin_url = public.normalize_linkedin_url(linkedin_url),
    updated_at   = now()
WHERE linkedin_url IS NOT NULL
  AND linkedin_url IS DISTINCT FROM public.normalize_linkedin_url(linkedin_url)
  AND NOT EXISTS (
    SELECT 1 FROM public.companies o
    WHERE o.linkedin_url = public.normalize_linkedin_url(companies.linkedin_url)
      AND o.id <> companies.id
  );

-- Los pares que colisionan se unifican de a uno, master = el que tiene mas
-- datos asociados. Se repite hasta que no quede ninguno: cada merge puede
-- liberar la colision de otro.
DO $$
DECLARE r RECORD; v_master UUID; v_dup UUID;
BEGIN
  LOOP
    SELECT a.id AS id_a, b.id AS id_b INTO r
    FROM public.companies a
    JOIN public.companies b
      ON b.linkedin_url = public.normalize_linkedin_url(a.linkedin_url) AND b.id <> a.id
    WHERE a.linkedin_url IS NOT NULL
      AND a.linkedin_url IS DISTINCT FROM public.normalize_linkedin_url(a.linkedin_url)
    LIMIT 1;
    EXIT WHEN NOT FOUND;

    SELECT CASE WHEN coalesce(ia.weight,0) >= coalesce(ib.weight,0) THEN r.id_a ELSE r.id_b END,
           CASE WHEN coalesce(ia.weight,0) >= coalesce(ib.weight,0) THEN r.id_b ELSE r.id_a END
      INTO v_master, v_dup
    FROM (SELECT 1) z
    LEFT JOIN v3.company_name_index ia ON ia.company_id = r.id_a
    LEFT JOIN v3.company_name_index ib ON ib.company_id = r.id_b;

    PERFORM public.merge_companies(v_master, v_dup, false, 'manual', 0.95,
      'Misma pagina de LinkedIn escrita de dos formas (protocolo, subdominio de pais o parametros); script 447.',
      NULL);
  END LOOP;
END $$;

-- Segunda pasada: los merges liberan colisiones y dejan mas filas canonizables.
UPDATE public.companies
SET linkedin_url = public.normalize_linkedin_url(linkedin_url),
    updated_at   = now()
WHERE linkedin_url IS NOT NULL
  AND linkedin_url IS DISTINCT FROM public.normalize_linkedin_url(linkedin_url)
  AND NOT EXISTS (
    SELECT 1 FROM public.companies o
    WHERE o.linkedin_url = public.normalize_linkedin_url(companies.linkedin_url)
      AND o.id <> companies.id
  );

-- ── La causa de fondo ───────────────────────────────────────────────────────
--
-- normalize_linkedin_url() existe desde el script 045, pero solo la usaba el
-- matcheo de vacantes. upsert_company(), que es por donde entra el ETL de
-- contactos, guardaba la URL tal cual venia. Por eso cada forma de escribir la
-- misma pagina entraba como una empresa nueva y el lookup por linkedin_url,
-- que deberia ser la señal mas fuerte para no duplicar, no las reconocia.
--
-- Es una sola linea, pero es la que evita que todo esto vuelva a acumularse.
-- Se aplica en el script 448 para no mezclar la limpieza de datos con el
-- cambio de comportamiento del ETL.
