-- =============================================================================
-- 448 - upsert_company canoniza la URL de LinkedIn antes de buscar
-- =============================================================================
--
-- EL PROBLEMA
--
-- `normalize_linkedin_url()` existe desde el script 045, pero hasta ahora solo
-- la usaba el matcheo de vacantes. `upsert_company()`, que es por donde entra
-- el ETL de contactos, guardaba la URL exactamente como venia:
--
--     https://www.linkedin.com/company/brubank
--     https://ar.linkedin.com/company/brubank
--     http://www.linkedin.com/company/brubank/
--     https://www.linkedin.com/company/brubank?trk=public_jobs_topcard-org-name
--
-- Para Postgres son cuatro cadenas distintas, asi que el UNIQUE de linkedin_url
-- no frenaba nada y cada forma entraba como una empresa nueva. Peor: el paso 1
-- de upsert_company busca por `linkedin_url = <lo que vino>`, o sea que la
-- señal MAS FUERTE que tiene la funcion para no duplicar fallaba justamente
-- cuando el ETL traia la URL con otro formato.
--
-- Medido antes de este cambio: 2.258 filas con URL no canonica, de las cuales
-- 110 eran la misma pagina que otra fila ya existente.
--
-- EL ARREGLO
--
-- Una linea: canonizar `p_linkedin_url` al entrar. A partir de ahi todo lo
-- demas de la funcion (el lookup, el INSERT y el ON CONFLICT (linkedin_url))
-- trabaja sobre la forma canonica, sin tocar nada mas de la logica.
--
-- Efecto lateral bienvenido: el nombre que se inventa cuando no viene ninguno
-- (INITCAP del quinto segmento de la URL) ahora se calcula siempre sobre
-- https://www.linkedin.com/company/<slug>, asi que el slug cae siempre en el
-- mismo segmento. Antes, con una URL de subdominio de pais o con parametros,
-- podia salir cualquier cosa.
--
-- El resto del cuerpo queda idéntico al que estaba en produccion.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.upsert_company(
  p_name        text,
  p_linkedin_url text DEFAULT NULL::text,
  p_website     text DEFAULT NULL::text,
  p_industry    text DEFAULT NULL::text,
  p_country     text DEFAULT NULL::text,
  p_logo_url    text DEFAULT NULL::text,
  p_description text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_normalized_name TEXT;
  v_clean_linkedin_url TEXT;
BEGIN
  v_normalized_name := CASE WHEN p_name IS NULL OR p_name = '' THEN NULL ELSE LOWER(TRIM(p_name)) END;

  -- [448] Se canoniza la URL ANTES de buscar y de insertar. Sin esto, la misma
  -- pagina entraba tantas veces como formas de escribirla trajera el ETL
  -- (http/https, ar.linkedin.com, ?trk=..., barra final) y el lookup por
  -- linkedin_url no las reconocia como la misma empresa.
  v_clean_linkedin_url := public.normalize_linkedin_url(
                            NULLIF(TRIM(COALESCE(p_linkedin_url, '')), ''));

  -- 1. Por URL de LinkedIn (la señal mas fuerte)
  IF v_clean_linkedin_url IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies WHERE linkedin_url = v_clean_linkedin_url;
    IF v_company_id IS NOT NULL THEN
      UPDATE public.companies SET
        updated_at = NOW(),
        name     = COALESCE(NULLIF(TRIM(name), ''), p_name),
        website  = COALESCE(website, p_website),
        industry = COALESCE(industry, p_industry),
        country  = COALESCE(country, p_country),
        logo_url = COALESCE(logo_url, p_logo_url),
        description = CASE
          WHEN (description IS NULL OR TRIM(description) = '')
               AND p_description IS NOT NULL AND TRIM(p_description) != ''
          THEN TRIM(p_description) ELSE description END
      WHERE id = v_company_id;
      RETURN v_company_id;
    END IF;
  END IF;

  -- 2. Por nombre
  IF v_normalized_name IS NOT NULL THEN
    SELECT id INTO v_company_id FROM public.companies
    WHERE LOWER(COALESCE(name, '')) = v_normalized_name
       OR LOWER(COALESCE(normalized_name, '')) = v_normalized_name
    LIMIT 1;
    IF v_company_id IS NOT NULL THEN
      UPDATE public.companies SET
        updated_at   = NOW(),
        linkedin_url = COALESCE(linkedin_url, v_clean_linkedin_url),
        website      = COALESCE(website, p_website),
        industry     = COALESCE(industry, p_industry),
        country      = COALESCE(country, p_country),
        logo_url     = COALESCE(logo_url, p_logo_url),
        description  = CASE
          WHEN (description IS NULL OR TRIM(description) = '')
               AND p_description IS NOT NULL AND TRIM(p_description) != ''
          THEN TRIM(p_description) ELSE description END
      WHERE id = v_company_id;
      RETURN v_company_id;
    END IF;
  END IF;

  -- 3. Alta
  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    IF v_clean_linkedin_url IS NOT NULL THEN
       p_name := INITCAP(SPLIT_PART(v_clean_linkedin_url, '/', 5));
       IF p_name IS NULL OR p_name = '' THEN p_name := 'Unknown - ' || v_clean_linkedin_url; END IF;
    ELSE
       p_name := 'Unknown Company ' || gen_random_uuid();
    END IF;
  END IF;

  INSERT INTO public.companies (name, linkedin_url, website, industry, country, logo_url, description)
  VALUES (TRIM(p_name), v_clean_linkedin_url, p_website, p_industry, p_country, p_logo_url,
          NULLIF(TRIM(COALESCE(p_description, '')), ''))
  ON CONFLICT (linkedin_url) DO UPDATE SET
    updated_at  = NOW(),
    description = CASE
      WHEN (companies.description IS NULL OR TRIM(companies.description) = '')
           AND EXCLUDED.description IS NOT NULL
      THEN EXCLUDED.description ELSE companies.description END
  RETURNING id INTO v_company_id;

  IF v_company_id IS NULL THEN
     SELECT id INTO v_company_id FROM public.companies WHERE LOWER(name) = v_normalized_name LIMIT 1;
  END IF;
  RETURN COALESCE(v_company_id, gen_random_uuid());

EXCEPTION WHEN OTHERS THEN
  SELECT id INTO v_company_id FROM public.companies
  WHERE LOWER(TRIM(name)) = LOWER(TRIM(p_name)) LIMIT 1;
  IF v_company_id IS NOT NULL THEN RETURN v_company_id; END IF;

  INSERT INTO public.companies (name, linkedin_url, description)
  VALUES (TRIM(p_name), v_clean_linkedin_url, NULLIF(TRIM(COALESCE(p_description, '')), ''))
  RETURNING id INTO v_company_id;
  RETURN v_company_id;
END;
$function$;
