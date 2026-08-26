-- ============================================================================
-- Apollo Fase 1 (previo) — El string vacio bloquea TODO el enrichment
--
-- Hallazgo (26-ago-2026, sobre el catalogo real):
--
--     website  = ''  -> 66.163 filas
--     industry = ''  -> 63.701 filas
--     country  = ''  -> 60.610 filas
--     logo_url = ''  ->    303 filas
--
-- Todas las rutas de enrichment (upsert_company, scripts/437 de LinkedIn, el
-- writer de Apollo) rellenan con `COALESCE(columna, valor_nuevo)`. Y '' NO es
-- NULL: COALESCE lo considera un valor presente y no escribe nunca. Esas
-- ~66k empresas quedaron congeladas — no las llena LinkedIn, no las va a
-- llenar Apollo, y no aparecen en los conteos de "falta website" porque la
-- columna no es NULL.
--
-- Los triggers vivos ya tratan '' como ausencia:
--   trigger_normalize_country     -> IF NEW.country  IS NOT NULL AND != ''
--   normalize_company_industry    -> IF NEW.industry IS NOT NULL AND != ''
-- asi que pasar '' a NULL no cambia ningun valor derivado: solo desbloquea.
--
-- Esta migracion hace las dos mitades del arreglo:
--   1. Normaliza los '' historicos a NULL.
--   2. Endurece upsert_company para que no vuelva a generarlos, y para que
--      sus COALESCE traten '' como hueco a llenar.
-- ============================================================================

-- ── 1. Normalizacion de los valores historicos ─────────────────────────────
-- Se escribe columna por columna para que cada UPDATE toque solo las filas
-- afectadas (los triggers de country/industry se disparan por columna).

UPDATE public.companies SET website = NULL      WHERE btrim(coalesce(website, ''))  = '' AND website  IS NOT NULL;
UPDATE public.companies SET industry = NULL     WHERE btrim(coalesce(industry, '')) = '' AND industry IS NOT NULL;
UPDATE public.companies SET country = NULL      WHERE btrim(coalesce(country, ''))  = '' AND country  IS NOT NULL;
UPDATE public.companies SET logo_url = NULL     WHERE btrim(coalesce(logo_url, '')) = '' AND logo_url IS NOT NULL;
UPDATE public.companies SET description = NULL  WHERE btrim(coalesce(description,'')) = '' AND description IS NOT NULL;
UPDATE public.companies SET linkedin_url = NULL WHERE btrim(coalesce(linkedin_url,'')) = '' AND linkedin_url IS NOT NULL;

-- ── 2. upsert_company: no generar '' y tratarlo como hueco ─────────────────
-- Copia literal de la version viva (migracion 20260825160000) con dos cambios,
-- ambos marcados [826]:
--   a) los parametros de texto se normalizan a NULL al entrar;
--   b) los COALESCE de relleno usan nullif(btrim(col),'') para que una columna
--      con '' se pueda completar.
CREATE OR REPLACE FUNCTION public.upsert_company(p_name text, p_linkedin_url text DEFAULT NULL::text, p_website text DEFAULT NULL::text, p_industry text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_logo_url text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_normalized_name TEXT;
  v_core TEXT;
  v_clean_linkedin_url TEXT;
BEGIN
  -- [826] Un '' que entra es un '' que se persiste y congela la fila para
  -- siempre. Se normaliza en la puerta.
  p_name        := nullif(btrim(coalesce(p_name, '')), '');
  p_website     := nullif(btrim(coalesce(p_website, '')), '');
  p_industry    := nullif(btrim(coalesce(p_industry, '')), '');
  p_country     := nullif(btrim(coalesce(p_country, '')), '');
  p_logo_url    := nullif(btrim(coalesce(p_logo_url, '')), '');
  p_description := nullif(btrim(coalesce(p_description, '')), '');

  v_normalized_name := CASE WHEN p_name IS NULL OR p_name = '' THEN NULL ELSE LOWER(TRIM(p_name)) END;
  v_core := public.company_core_name(p_name);
  v_clean_linkedin_url := public.normalize_linkedin_url(NULLIF(TRIM(COALESCE(p_linkedin_url,'')),''));

  IF v_clean_linkedin_url IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE linkedin_url = v_clean_linkedin_url;
    IF v_company_id IS NOT NULL THEN
      UPDATE public.companies SET updated_at = NOW(),
        name = COALESCE(NULLIF(TRIM(name), ''), p_name),
        normalized_name = CASE WHEN NULLIF(TRIM(name),'') IS NULL AND p_name IS NOT NULL
                               THEN v_core ELSE COALESCE(normalized_name, v_core) END,
        -- [826] nullif(btrim(...)) para que '' cuente como hueco
        website  = COALESCE(NULLIF(BTRIM(website), ''),  p_website),
        industry = COALESCE(NULLIF(BTRIM(industry), ''), p_industry),
        country  = COALESCE(NULLIF(BTRIM(country), ''),  p_country),
        logo_url = COALESCE(NULLIF(BTRIM(logo_url), ''), p_logo_url),
        description = CASE WHEN (description IS NULL OR TRIM(description)='')
                             AND p_description IS NOT NULL AND TRIM(p_description)!=''
                           THEN TRIM(p_description) ELSE description END
      WHERE id = v_company_id;
      RETURN v_company_id;
    END IF;
  END IF;

  IF v_normalized_name IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies
    WHERE LOWER(COALESCE(name,'')) = v_normalized_name
       OR LOWER(COALESCE(normalized_name,'')) = v_normalized_name
    LIMIT 1;
  END IF;

  -- [450] Match por nucleo. El discriminador NO es cuantas filas comparten el
  -- nucleo (eso fallaba justo en Nestle, YPF y Mercado Libre, que todavia
  -- arrastran duplicados sin resolver) sino cual de ellas tiene identidad
  -- externa. Si hay exactamente UNA con LinkedIn o website, esa es la empresa
  -- real y el resto son variantes tipeadas.
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
    -- ademas hay una sola fila y el nucleo es largo. Con nucleos cortos
    -- ("delta", "aca") se deja entrar la fila nueva y decide la deteccion
    -- nocturna, que si deja registro y se puede revertir.
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
      -- [826] idem: '' es hueco
      website  = COALESCE(NULLIF(BTRIM(website), ''),  p_website),
      industry = COALESCE(NULLIF(BTRIM(industry), ''), p_industry),
      country  = COALESCE(NULLIF(BTRIM(country), ''),  p_country),
      logo_url = COALESCE(NULLIF(BTRIM(logo_url), ''), p_logo_url),
      description = CASE WHEN (description IS NULL OR TRIM(description)='')
                           AND p_description IS NOT NULL AND TRIM(p_description)!=''
                         THEN TRIM(p_description) ELSE description END
    WHERE id = v_company_id;
    RETURN v_company_id;
  END IF;

  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    IF v_clean_linkedin_url IS NOT NULL THEN
       p_name := INITCAP(SPLIT_PART(v_clean_linkedin_url, '/', 5));
       IF p_name IS NULL OR p_name = '' THEN p_name := 'Unknown - ' || v_clean_linkedin_url; END IF;
    ELSE
       p_name := 'Unknown Company ' || gen_random_uuid();
    END IF;
    v_core := public.company_core_name(p_name);
  END IF;

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
