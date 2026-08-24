-- =============================================================================
-- 450 - Cerrar la ingesta: normalized_name y match por nucleo en upsert_company
-- =============================================================================
--
-- EL AGUJERO
--
-- Los scripts 447/448 cerraron los duplicados por URL de LinkedIn, pero la
-- ingesta seguia generandolos por NOMBRE. `upsert_company()` matchea asi:
--
--     WHERE LOWER(name) = lower(p_name) OR LOWER(normalized_name) = lower(p_name)
--
-- o sea, igualdad exacta. Verificado contra la base antes de tocar nada:
--
--     'Alicorp S.R.L.'    -> no matchea -> fila nueva  (existe "Alicorp")
--     'Grupo Nestle'      -> no matchea -> fila nueva  (existe "Nestle")
--     'Mercado Libre SA'  -> no matchea -> fila nueva  (existe "Mercado Libre")
--     'Farmacity SAS'     -> no matchea -> fila nueva  (existe "Farmacity S.A.")
--
-- Con ~720 empresas nuevas por dia, el backlog que se acaba de limpiar se
-- reacumula solo.
--
-- EL BUG COLATERAL, QUE ERA PEOR
--
-- `upsert_company` NUNCA escribio `normalized_name`. Las 57.161 empresas
-- creadas en los ultimos 30 dias entraron con esa columna en NULL, y en total
-- estaban en NULL 429.798 de 514.182 filas (84%).
--
-- Eso no es cosmetico: `search_companies_by_name_filtered()` (la usa
-- app/actions/search-v2.ts) filtra UNICAMENTE por esa columna:
--
--     WHERE c.normalized_name ILIKE '%' || v_normalized_query || '%'
--
-- Resultado medido: de las 54.613 empresas que cumplian el resto de las
-- condiciones de esa busqueda (tienen LinkedIn y tienen señales), 31.936
-- (58,5%) eran INVISIBLES. La busqueda devolvia menos de la mitad de lo que
-- tenia que devolver, en silencio.
--
-- Backfill: normalized_name = company_core_name(name) donde estaba NULL.
-- Quedan 32.508 en NULL a proposito: son nombres basura (URLs pegadas,
-- "Unknown Company <uuid>") para los que company_core_name devuelve NULL.
-- Despues del backfill la cobertura de esa busqueda es 100%.
--
-- EL MATCH POR NUCLEO Y SU GUARDA
--
-- El paso 3 nuevo busca por nucleo del nombre. La guarda NO es "que haya una
-- sola empresa con ese nucleo": se probo y fallaba justo donde mas importa,
-- porque las empresas grandes todavia arrastran duplicados sin resolver.
--
--     nucleo 'nestle'         -> 5 filas
--     nucleo 'ypf'            -> 7 filas
--     nucleo 'mercado libre'  -> 3 filas
--
-- El discriminador que si funciona es el mismo que se valido para el
-- auto-merge: la IDENTIDAD EXTERNA. Si exactamente UNA de las filas con ese
-- nucleo tiene LinkedIn o website, esa es la empresa real y el resto son
-- variantes tipeadas por contactos. Medido sobre los mismos casos:
--
--     nucleo            filas   con identidad   elige
--     alicorp             1           1         Alicorp          OK
--     nestle              5           1         Nestle           OK
--     ypf                 7           1         YPF              OK
--     mercado libre       3           1         Mercado Libre    OK
--     techint             9           1         Techint Group    OK
--     delta               3           0         (no matchea)     OK
--     aca                 3           0         (no matchea)     OK
--     union               9           3         (no matchea)     OK
--
-- Los tres ultimos son el caso que la guarda existe para bloquear: nombres
-- cortos o genericos donde dos empresas distintas coinciden por casualidad.
-- "union" es el mejor ejemplo: 3 filas con identidad propia, o sea tres
-- empresas de verdad que se llaman parecido. Ahi no se matchea y entra la fila
-- nueva, que la deteccion nocturna resuelve dejando registro y con revert
-- disponible. Es la asimetria que guia todo esto: un merge se deshace, una
-- atribucion equivocada de contactos en la ingesta no.
--
-- Si NINGUNA tiene identidad externa solo se acepta cuando hay una sola fila y
-- el nucleo tiene 8+ caracteres (distintivo).
--
-- Probado contra la base: 'Alicorp S.R.L.', 'Grupo Nestle' y 'Mercado Libre SA'
-- devuelven el id de la empresa existente en vez de crear una fila.
-- =============================================================================

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Por lotes. El filtro `company_core_name(name) IS NOT NULL` es lo que evita
-- que los nombres basura se re-seleccionen para siempre: para ellos la funcion
-- devuelve NULL, asi que un UPDATE que solo mire `normalized_name IS NULL`
-- nunca termina.

UPDATE public.companies c
SET normalized_name = public.company_core_name(c.name)
WHERE c.id IN (
  SELECT id FROM public.companies
  WHERE normalized_name IS NULL
    AND public.company_core_name(name) IS NOT NULL
  LIMIT 150000
);
-- (repetir hasta que no queden; fueron 3 pasadas)

-- ── upsert_company ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_company(
  p_name text, p_linkedin_url text DEFAULT NULL::text, p_website text DEFAULT NULL::text,
  p_industry text DEFAULT NULL::text, p_country text DEFAULT NULL::text,
  p_logo_url text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_normalized_name TEXT;
  v_core TEXT;
  v_clean_linkedin_url TEXT;
BEGIN
  v_normalized_name := CASE WHEN p_name IS NULL OR p_name = '' THEN NULL ELSE LOWER(TRIM(p_name)) END;
  -- [450] Nucleo del nombre: es lo que se guarda en normalized_name y lo que
  -- permite reconocer "Alicorp S.R.L." como la Alicorp que ya existe.
  v_core := public.company_core_name(p_name);
  -- [448] Canonizar la URL antes de buscar y de insertar.
  v_clean_linkedin_url := public.normalize_linkedin_url(NULLIF(TRIM(COALESCE(p_linkedin_url,'')),''));

  -- 1. Por URL de LinkedIn (la senal mas fuerte)
  IF v_clean_linkedin_url IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE linkedin_url = v_clean_linkedin_url;
    IF v_company_id IS NOT NULL THEN
      UPDATE public.companies SET updated_at = NOW(),
        name = COALESCE(NULLIF(TRIM(name), ''), p_name),
        -- si se completa el nombre, el nucleo tiene que acompanarlo
        normalized_name = CASE WHEN NULLIF(TRIM(name),'') IS NULL AND p_name IS NOT NULL
                               THEN v_core ELSE COALESCE(normalized_name, v_core) END,
        website = COALESCE(website, p_website), industry = COALESCE(industry, p_industry),
        country = COALESCE(country, p_country), logo_url = COALESCE(logo_url, p_logo_url),
        description = CASE WHEN (description IS NULL OR TRIM(description)='')
                             AND p_description IS NOT NULL AND TRIM(p_description)!=''
                           THEN TRIM(p_description) ELSE description END
      WHERE id = v_company_id;
      RETURN v_company_id;
    END IF;
  END IF;

  -- 2. Por nombre exacto (o por nucleo ya guardado que coincida con el entrante)
  IF v_normalized_name IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies
    WHERE LOWER(COALESCE(name,'')) = v_normalized_name
       OR LOWER(COALESCE(normalized_name,'')) = v_normalized_name
    LIMIT 1;
  END IF;

  -- 3. [450] Por nucleo del nombre, con guardas.
  --
  -- El discriminador NO es cuantas filas comparten el nucleo (eso fallaba justo
  -- en Nestle, YPF y Mercado Libre, que todavia arrastran duplicados sin
  -- resolver) sino cual de ellas tiene identidad externa. Si hay exactamente
  -- UNA con LinkedIn o website, esa es la empresa real y el resto son variantes
  -- tipeadas por contactos.
  IF v_company_id IS NULL AND v_core IS NOT NULL AND length(v_core) >= 3 THEN
    SELECT c.id INTO v_company_id
    FROM public.companies c
    WHERE c.normalized_name = v_core
      AND (c.linkedin_url IS NOT NULL OR NULLIF(BTRIM(c.website),'') IS NOT NULL)
      AND (SELECT count(*) FROM public.companies c2
            WHERE c2.normalized_name = v_core
              AND (c2.linkedin_url IS NOT NULL OR NULLIF(BTRIM(c2.website),'') IS NOT NULL)) = 1
    LIMIT 1;

    -- Sin ninguna identidad externa no hay con que confirmar: solo se acepta si
    -- ademas hay una sola fila y el nucleo es distintivo. Con nucleos cortos
    -- ("delta", "aca") entra la fila nueva y decide la deteccion nocturna, que
    -- si deja registro y se puede revertir.
    IF v_company_id IS NULL AND length(v_core) >= 8 THEN
      SELECT c.id INTO v_company_id FROM public.companies c
      WHERE c.normalized_name = v_core
        AND (SELECT count(*) FROM public.companies c2 WHERE c2.normalized_name = v_core) = 1
      LIMIT 1;
    END IF;
  END IF;

  IF v_company_id IS NOT NULL THEN
    UPDATE public.companies SET updated_at = NOW(),
      linkedin_url = COALESCE(linkedin_url, v_clean_linkedin_url),
      normalized_name = COALESCE(normalized_name, v_core),
      website = COALESCE(website, p_website), industry = COALESCE(industry, p_industry),
      country = COALESCE(country, p_country), logo_url = COALESCE(logo_url, p_logo_url),
      description = CASE WHEN (description IS NULL OR TRIM(description)='')
                           AND p_description IS NOT NULL AND TRIM(p_description)!=''
                         THEN TRIM(p_description) ELSE description END
    WHERE id = v_company_id;
    RETURN v_company_id;
  END IF;

  -- 4. Alta
  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    IF v_clean_linkedin_url IS NOT NULL THEN
       p_name := INITCAP(SPLIT_PART(v_clean_linkedin_url, '/', 5));
       IF p_name IS NULL OR p_name = '' THEN p_name := 'Unknown - ' || v_clean_linkedin_url; END IF;
    ELSE
       p_name := 'Unknown Company ' || gen_random_uuid();
    END IF;
    v_core := public.company_core_name(p_name);
  END IF;

  -- [450] normalized_name se escribe SIEMPRE en el alta. Que no se escribiera
  -- es lo que dejaba invisible al 58,5% de las empresas en la busqueda.
  INSERT INTO public.companies (name, normalized_name, linkedin_url, website, industry, country, logo_url, description)
  VALUES (TRIM(p_name), v_core, v_clean_linkedin_url, p_website, p_industry, p_country, p_logo_url,
          NULLIF(TRIM(COALESCE(p_description,'')),''))
  ON CONFLICT (linkedin_url) DO UPDATE SET updated_at = NOW(),
    description = CASE WHEN (companies.description IS NULL OR TRIM(companies.description)='')
                         AND EXCLUDED.description IS NOT NULL
                       THEN EXCLUDED.description ELSE companies.description END
  RETURNING id INTO v_company_id;

  IF v_company_id IS NULL THEN
     SELECT id INTO v_company_id FROM public.companies WHERE LOWER(name) = v_normalized_name LIMIT 1;
  END IF;
  RETURN COALESCE(v_company_id, gen_random_uuid());

EXCEPTION WHEN OTHERS THEN
  SELECT id INTO v_company_id FROM public.companies WHERE LOWER(TRIM(name)) = LOWER(TRIM(p_name)) LIMIT 1;
  IF v_company_id IS NOT NULL THEN RETURN v_company_id; END IF;
  INSERT INTO public.companies (name, normalized_name, linkedin_url, description)
  VALUES (TRIM(p_name), v_core, v_clean_linkedin_url, NULLIF(TRIM(COALESCE(p_description,'')),''))
  RETURNING id INTO v_company_id;
  RETURN v_company_id;
END;
$function$;
