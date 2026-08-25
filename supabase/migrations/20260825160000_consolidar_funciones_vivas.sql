-- ============================================================================
-- Fase 0.4 — Consolidar en migraciones las funciones que solo vivían en scripts/
--
-- Contexto (docs/analisis-inputs-companias-contactos-senales.md §4.6): las
-- versiones vivas de company_core_name (scripts/443), company_legal_form
-- (scripts/443), upsert_company (scripts/448 + 450) y el borrado de
-- normalize_company_name (scripts/455) se aplicaron a producción con
-- run-sql.mjs y nunca volvieron a supabase/migrations/. Un rebuild desde
-- migraciones restauraba la ingesta anterior al dedup (la que generó los
-- duplicados por nombre). Esta migración deja el árbol de migraciones
-- igual al estado real de producción; el texto de cada función es copia
-- literal de pg_get_functiondef() en producción (2026-08-25).
--
-- merge_companies y process_job/contact_batch_internal se consolidan en las
-- tres migraciones siguientes porque además cambian de comportamiento.
-- ============================================================================

-- ── company_core_name (versión viva: scripts/443) ──────────────────────────
-- NULL para basura estructural (URLs, "unknown company"); sufijos societarios
-- solo al final y con separador real (el \s* anterior truncaba Cisco→cis).
CREATE OR REPLACE FUNCTION public.company_core_name(p_name text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN btrim(coalesce(p_name, '')) ~* '^(https?://|www\.)' THEN NULL
    WHEN p_name ~* 'linkedin\.com'                           THEN NULL
    WHEN p_name ~* '^unknown company'                        THEN NULL
    ELSE nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
              split_part(regexp_replace(unaccent(lower(btrim(p_name))), '["''`]', '', 'g'), '/', 1),
              '^(grupo|group|holding|the)\s+', ''),
            '[[:space:],\.]+\s*(s\.?a\.?i\.?c\.?f?\.?|s\.?a\.?c\.?i\.?|s\.?a\.?s\.?|s\.?a\.?u\.?|s\.?a\.?|s\.?r\.?l\.?|s\.?c\.?a\.?|inc|llc|ltda?|corp|co|plc|gmbh|ag|nv|bv|spa|srl|pty|limited)\.?\s*$', ''),
          '\s+', ' ', 'g')), '')
  END;
$function$;

-- ── company_legal_form (versión viva: scripts/443) ─────────────────────────
-- Bloquea auto-merges cuando conviven formas societarias distintas (S.A. vs
-- S.R.L.) dentro del mismo núcleo.
CREATE OR REPLACE FUNCTION public.company_legal_form(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN p_name ~* '[[:space:],\.]s\.?a\.?[[:space:]\.]*(i|c)\.?(c|i)?\.?f?\.?$' THEN 'saci'
    WHEN p_name ~* '[[:space:],\.]s\.?a\.?s\.?$'  THEN 'sas'
    WHEN p_name ~* '[[:space:],\.]s\.?r\.?l\.?$'  THEN 'srl'
    WHEN p_name ~* '[[:space:],\.]s\.?p\.?a\.?$'  THEN 'spa'
    WHEN p_name ~* '[[:space:],\.]s\.?a\.?u\.?$'  THEN 'sau'
    WHEN p_name ~* '[[:space:],\.]s\.?a\.?$'      THEN 'sa'
    WHEN p_name ~* '[[:space:],\.]ltda?\.?$'      THEN 'ltda'
    WHEN p_name ~* '[[:space:],\.]inc\.?$'        THEN 'inc'
    WHEN p_name ~* '[[:space:],\.]llc\.?$'        THEN 'llc'
    WHEN p_name ~* '[[:space:],\.]corp\.?$'       THEN 'corp'
    WHEN p_name ~* '[[:space:],\.](plc|gmbh|ag|nv|bv|pty|limited)\.?$' THEN 'otra'
    ELSE NULL END;
$function$;

-- ── upsert_company (versión viva: scripts/448 + 450) ───────────────────────
-- Cascada: linkedin_url canonizada → nombre exacto → núcleo con guarda de
-- identidad externa. Todos los caminos rellenan huecos con COALESCE, nunca
-- pisan. Escribe normalized_name siempre (el bug que dejaba 84% en NULL está
-- documentado en scripts/450:22-41).
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
        website = COALESCE(website, p_website), industry = COALESCE(industry, p_industry),
        country = COALESCE(country, p_country), logo_url = COALESCE(logo_url, p_logo_url),
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
      website = COALESCE(website, p_website), industry = COALESCE(industry, p_industry),
      country = COALESCE(country, p_country), logo_url = COALESCE(logo_url, p_logo_url),
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

-- ── normalize_company_name: borrada en producción (scripts/455) ────────────
-- Quedó sin llamadores cuando createCompany de v3 pasó a usar upsert_company;
-- se elimina también del árbol de migraciones para que un rebuild no la
-- resucite.
DROP FUNCTION IF EXISTS public.normalize_company_name(text);
