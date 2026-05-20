-- =====================================================
-- Script 157: Fix Country Filtering for Contact Export
-- =====================================================
-- Este script:
-- 1. Modifica normalize_country() para devolver NULL si no reconoce el país
-- 2. Agrega country_normalized a la tabla contacts
-- 3. Crea trigger para normalizar contacts.country automáticamente
-- 4. Re-normaliza companies.country_normalized existentes
-- 5. Backfill contacts.country_normalized
-- 6. Actualiza el RPC export_contacts para usar contacts.country

-- =====================================================
-- PASO 1: Modificar normalize_country() para devolver NULL si no reconoce
-- =====================================================
CREATE OR REPLACE FUNCTION normalize_country(p_country TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  clean_country TEXT;
  result TEXT;
BEGIN
  IF p_country IS NULL OR TRIM(p_country) = '' THEN
    RETURN NULL;
  END IF;

  clean_country := TRIM(p_country);

  -- Mapeo directo de nombres comunes/variantes a nombres normalizados
  result := CASE LOWER(clean_country)
    -- LATAM
    WHEN 'argentina' THEN 'Argentina'
    WHEN 'argentine' THEN 'Argentina'
    WHEN 'ar' THEN 'Argentina'
    WHEN 'chile' THEN 'Chile'
    WHEN 'cl' THEN 'Chile'
    WHEN 'mexico' THEN 'Mexico'
    WHEN 'méxico' THEN 'Mexico'
    WHEN 'mx' THEN 'Mexico'
    WHEN 'colombia' THEN 'Colombia'
    WHEN 'co' THEN 'Colombia'
    WHEN 'peru' THEN 'Peru'
    WHEN 'perú' THEN 'Peru'
    WHEN 'pe' THEN 'Peru'
    WHEN 'brazil' THEN 'Brazil'
    WHEN 'brasil' THEN 'Brazil'
    WHEN 'br' THEN 'Brazil'
    WHEN 'ecuador' THEN 'Ecuador'
    WHEN 'ec' THEN 'Ecuador'
    WHEN 'uruguay' THEN 'Uruguay'
    WHEN 'uy' THEN 'Uruguay'
    WHEN 'paraguay' THEN 'Paraguay'
    WHEN 'py' THEN 'Paraguay'
    WHEN 'bolivia' THEN 'Bolivia'
    WHEN 'bo' THEN 'Bolivia'
    WHEN 'venezuela' THEN 'Venezuela'
    WHEN 've' THEN 'Venezuela'
    WHEN 'costa rica' THEN 'Costa Rica'
    WHEN 'cr' THEN 'Costa Rica'
    WHEN 'panama' THEN 'Panama'
    WHEN 'panamá' THEN 'Panama'
    WHEN 'pa' THEN 'Panama'
    WHEN 'guatemala' THEN 'Guatemala'
    WHEN 'gt' THEN 'Guatemala'
    WHEN 'honduras' THEN 'Honduras'
    WHEN 'hn' THEN 'Honduras'
    WHEN 'el salvador' THEN 'El Salvador'
    WHEN 'sv' THEN 'El Salvador'
    WHEN 'nicaragua' THEN 'Nicaragua'
    WHEN 'ni' THEN 'Nicaragua'
    WHEN 'puerto rico' THEN 'Puerto Rico'
    WHEN 'pr' THEN 'Puerto Rico'
    WHEN 'dominican republic' THEN 'Dominican Republic'
    WHEN 'república dominicana' THEN 'Dominican Republic'
    WHEN 'do' THEN 'Dominican Republic'
    WHEN 'cuba' THEN 'Cuba'
    WHEN 'cu' THEN 'Cuba'
    -- Europe
    WHEN 'spain' THEN 'Spain'
    WHEN 'españa' THEN 'Spain'
    WHEN 'es' THEN 'Spain'
    WHEN 'united kingdom' THEN 'United Kingdom'
    WHEN 'uk' THEN 'United Kingdom'
    WHEN 'gb' THEN 'United Kingdom'
    WHEN 'great britain' THEN 'United Kingdom'
    WHEN 'england' THEN 'United Kingdom'
    WHEN 'germany' THEN 'Germany'
    WHEN 'deutschland' THEN 'Germany'
    WHEN 'de' THEN 'Germany'
    WHEN 'france' THEN 'France'
    WHEN 'francia' THEN 'France'
    WHEN 'fr' THEN 'France'
    WHEN 'italy' THEN 'Italy'
    WHEN 'italia' THEN 'Italy'
    WHEN 'it' THEN 'Italy'
    WHEN 'portugal' THEN 'Portugal'
    WHEN 'pt' THEN 'Portugal'
    WHEN 'netherlands' THEN 'Netherlands'
    WHEN 'holland' THEN 'Netherlands'
    WHEN 'nl' THEN 'Netherlands'
    WHEN 'belgium' THEN 'Belgium'
    WHEN 'bélgica' THEN 'Belgium'
    WHEN 'be' THEN 'Belgium'
    WHEN 'switzerland' THEN 'Switzerland'
    WHEN 'suiza' THEN 'Switzerland'
    WHEN 'ch' THEN 'Switzerland'
    WHEN 'austria' THEN 'Austria'
    WHEN 'at' THEN 'Austria'
    WHEN 'sweden' THEN 'Sweden'
    WHEN 'suecia' THEN 'Sweden'
    WHEN 'se' THEN 'Sweden'
    WHEN 'norway' THEN 'Norway'
    WHEN 'noruega' THEN 'Norway'
    WHEN 'no' THEN 'Norway'
    WHEN 'denmark' THEN 'Denmark'
    WHEN 'dinamarca' THEN 'Denmark'
    WHEN 'dk' THEN 'Denmark'
    WHEN 'finland' THEN 'Finland'
    WHEN 'finlandia' THEN 'Finland'
    WHEN 'fi' THEN 'Finland'
    WHEN 'ireland' THEN 'Ireland'
    WHEN 'irlanda' THEN 'Ireland'
    WHEN 'ie' THEN 'Ireland'
    WHEN 'poland' THEN 'Poland'
    WHEN 'polonia' THEN 'Poland'
    WHEN 'pl' THEN 'Poland'
    WHEN 'czech republic' THEN 'Czech Republic'
    WHEN 'czechia' THEN 'Czech Republic'
    WHEN 'cz' THEN 'Czech Republic'
    WHEN 'romania' THEN 'Romania'
    WHEN 'rumania' THEN 'Romania'
    WHEN 'ro' THEN 'Romania'
    WHEN 'hungary' THEN 'Hungary'
    WHEN 'hungría' THEN 'Hungary'
    WHEN 'hu' THEN 'Hungary'
    WHEN 'greece' THEN 'Greece'
    WHEN 'grecia' THEN 'Greece'
    WHEN 'gr' THEN 'Greece'
    WHEN 'croatia' THEN 'Croatia'
    WHEN 'croacia' THEN 'Croatia'
    WHEN 'hr' THEN 'Croatia'
    WHEN 'serbia' THEN 'Serbia'
    WHEN 'rs' THEN 'Serbia'
    WHEN 'bulgaria' THEN 'Bulgaria'
    WHEN 'bg' THEN 'Bulgaria'
    WHEN 'ukraine' THEN 'Ukraine'
    WHEN 'ucrania' THEN 'Ukraine'
    WHEN 'ua' THEN 'Ukraine'
    WHEN 'russia' THEN 'Russia'
    WHEN 'rusia' THEN 'Russia'
    WHEN 'ru' THEN 'Russia'
    -- North America
    WHEN 'united states' THEN 'United States'
    WHEN 'united states of america' THEN 'United States'
    WHEN 'usa' THEN 'United States'
    WHEN 'us' THEN 'United States'
    WHEN 'america' THEN 'United States'
    WHEN 'estados unidos' THEN 'United States'
    WHEN 'canada' THEN 'Canada'
    WHEN 'canadá' THEN 'Canada'
    WHEN 'ca' THEN 'Canada'
    -- Asia Pacific
    WHEN 'australia' THEN 'Australia'
    WHEN 'au' THEN 'Australia'
    WHEN 'new zealand' THEN 'New Zealand'
    WHEN 'nueva zelanda' THEN 'New Zealand'
    WHEN 'nz' THEN 'New Zealand'
    WHEN 'japan' THEN 'Japan'
    WHEN 'japón' THEN 'Japan'
    WHEN 'jp' THEN 'Japan'
    WHEN 'china' THEN 'China'
    WHEN 'cn' THEN 'China'
    WHEN 'india' THEN 'India'
    WHEN 'in' THEN 'India'
    WHEN 'south korea' THEN 'South Korea'
    WHEN 'korea' THEN 'South Korea'
    WHEN 'corea del sur' THEN 'South Korea'
    WHEN 'kr' THEN 'South Korea'
    WHEN 'singapore' THEN 'Singapore'
    WHEN 'singapur' THEN 'Singapore'
    WHEN 'sg' THEN 'Singapore'
    WHEN 'philippines' THEN 'Philippines'
    WHEN 'filipinas' THEN 'Philippines'
    WHEN 'ph' THEN 'Philippines'
    WHEN 'thailand' THEN 'Thailand'
    WHEN 'tailandia' THEN 'Thailand'
    WHEN 'th' THEN 'Thailand'
    WHEN 'vietnam' THEN 'Vietnam'
    WHEN 'vn' THEN 'Vietnam'
    WHEN 'indonesia' THEN 'Indonesia'
    WHEN 'id' THEN 'Indonesia'
    WHEN 'malaysia' THEN 'Malaysia'
    WHEN 'malasia' THEN 'Malaysia'
    WHEN 'my' THEN 'Malaysia'
    WHEN 'taiwan' THEN 'Taiwan'
    WHEN 'tw' THEN 'Taiwan'
    WHEN 'hong kong' THEN 'Hong Kong'
    WHEN 'hk' THEN 'Hong Kong'
    WHEN 'pakistan' THEN 'Pakistan'
    WHEN 'pk' THEN 'Pakistan'
    WHEN 'bangladesh' THEN 'Bangladesh'
    WHEN 'bd' THEN 'Bangladesh'
    -- Middle East
    WHEN 'israel' THEN 'Israel'
    WHEN 'il' THEN 'Israel'
    WHEN 'turkey' THEN 'Turkey'
    WHEN 'turquía' THEN 'Turkey'
    WHEN 'tr' THEN 'Turkey'
    WHEN 'uae' THEN 'United Arab Emirates'
    WHEN 'united arab emirates' THEN 'United Arab Emirates'
    WHEN 'emiratos árabes unidos' THEN 'United Arab Emirates'
    WHEN 'ae' THEN 'United Arab Emirates'
    WHEN 'saudi arabia' THEN 'Saudi Arabia'
    WHEN 'arabia saudita' THEN 'Saudi Arabia'
    WHEN 'sa' THEN 'Saudi Arabia'
    WHEN 'qatar' THEN 'Qatar'
    WHEN 'qa' THEN 'Qatar'
    WHEN 'kuwait' THEN 'Kuwait'
    WHEN 'kw' THEN 'Kuwait'
    WHEN 'jordan' THEN 'Jordan'
    WHEN 'jordania' THEN 'Jordan'
    WHEN 'jo' THEN 'Jordan'
    WHEN 'lebanon' THEN 'Lebanon'
    WHEN 'líbano' THEN 'Lebanon'
    WHEN 'lb' THEN 'Lebanon'
    -- Africa
    WHEN 'south africa' THEN 'South Africa'
    WHEN 'sudáfrica' THEN 'South Africa'
    WHEN 'za' THEN 'South Africa'
    WHEN 'nigeria' THEN 'Nigeria'
    WHEN 'ng' THEN 'Nigeria'
    WHEN 'kenya' THEN 'Kenya'
    WHEN 'ke' THEN 'Kenya'
    WHEN 'egypt' THEN 'Egypt'
    WHEN 'egipto' THEN 'Egypt'
    WHEN 'eg' THEN 'Egypt'
    WHEN 'morocco' THEN 'Morocco'
    WHEN 'marruecos' THEN 'Morocco'
    WHEN 'ma' THEN 'Morocco'
    WHEN 'ghana' THEN 'Ghana'
    WHEN 'gh' THEN 'Ghana'
    WHEN 'ethiopia' THEN 'Ethiopia'
    WHEN 'etiopía' THEN 'Ethiopia'
    WHEN 'et' THEN 'Ethiopia'
    WHEN 'tanzania' THEN 'Tanzania'
    WHEN 'tz' THEN 'Tanzania'
    WHEN 'uganda' THEN 'Uganda'
    WHEN 'ug' THEN 'Uganda'
    -- Others
    WHEN 'andorra' THEN 'Andorra'
    WHEN 'ad' THEN 'Andorra'
    WHEN 'albania' THEN 'Albania'
    WHEN 'al' THEN 'Albania'
    WHEN 'algeria' THEN 'Algeria'
    WHEN 'argelia' THEN 'Algeria'
    WHEN 'dz' THEN 'Algeria'
    WHEN 'angola' THEN 'Angola'
    WHEN 'ao' THEN 'Angola'
    WHEN 'afghanistan' THEN 'Afghanistan'
    WHEN 'afganistán' THEN 'Afghanistan'
    WHEN 'af' THEN 'Afghanistan'
    ELSE NULL  -- IMPORTANTE: Devolver NULL si no reconoce el país
  END;

  -- Si no se encontró mapeo directo, intentar extraer país de ubicación completa
  IF result IS NULL THEN
    -- Intentar extraer el último componente si tiene comas (ej: "Buenos Aires, Argentina" -> "Argentina")
    IF clean_country LIKE '%,%' THEN
      result := normalize_country(TRIM(SPLIT_PART(clean_country, ',', -1)));
    END IF;
  END IF;

  RETURN result;
END;
$$;

-- =====================================================
-- PASO 2: Agregar country_normalized a contacts
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contacts' AND column_name = 'country_normalized'
  ) THEN
    ALTER TABLE contacts ADD COLUMN country_normalized TEXT;
    CREATE INDEX IF NOT EXISTS idx_contacts_country_normalized ON contacts(country_normalized);
  END IF;
END $$;

-- =====================================================
-- PASO 3: Trigger para normalizar contacts.country
-- =====================================================
CREATE OR REPLACE FUNCTION normalize_contact_country_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.country IS DISTINCT FROM OLD.country OR TG_OP = 'INSERT' THEN
    NEW.country_normalized := normalize_country(NEW.country);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_contact_country ON contacts;
CREATE TRIGGER trg_normalize_contact_country
  BEFORE INSERT OR UPDATE OF country ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION normalize_contact_country_trigger();

-- =====================================================
-- PASO 4: Re-normalizar companies.country_normalized existentes
-- =====================================================
UPDATE companies
SET country_normalized = normalize_country(country)
WHERE country IS NOT NULL;

-- =====================================================
-- PASO 5: Backfill contacts.country_normalized
-- =====================================================
UPDATE contacts
SET country_normalized = normalize_country(country)
WHERE country IS NOT NULL AND country_normalized IS NULL;

-- =====================================================
-- PASO 6: Actualizar RPC export_contacts para usar contacts.country_normalized
-- =====================================================
CREATE OR REPLACE FUNCTION export_contacts(
  p_signal_type TEXT DEFAULT NULL,
  p_signal_names TEXT[] DEFAULT NULL,
  p_countries TEXT[] DEFAULT NULL,
  p_industries TEXT[] DEFAULT NULL,
  p_only_corporate_email BOOLEAN DEFAULT FALSE,
  p_limit INT DEFAULT 10000
)
RETURNS TABLE (
  contact_id UUID,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  job_title TEXT,
  company_name TEXT,
  company_country TEXT,
  contact_country TEXT,
  linkedin_url TEXT,
  email TEXT,
  signal_type TEXT,
  signal_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (c.id)
    c.id AS contact_id,
    c.first_name,
    c.last_name,
    c.full_name,
    c.job_title,
    comp.name AS company_name,
    comp.country_normalized AS company_country,
    c.country_normalized AS contact_country,
    c.linkedin_url,
    c.email,
    CASE 
      WHEN s.process_id IS NOT NULL THEN 'process'::TEXT
      WHEN s.product_id IS NOT NULL THEN 'technology'::TEXT
      ELSE NULL
    END AS signal_type,
    COALESCE(dp.name, dprod.name) AS signal_name
  FROM contacts c
  INNER JOIN signals s ON s.contact_id = c.id
  INNER JOIN companies comp ON s.company_id = comp.id
  LEFT JOIN dictionary_processes dp ON s.process_id = dp.id
  LEFT JOIN dictionary_products dprod ON s.product_id = dprod.id
  WHERE 
    -- Filtro por tipo de señal
    (p_signal_type IS NULL OR 
      (p_signal_type = 'process' AND s.process_id IS NOT NULL) OR
      (p_signal_type = 'technology' AND s.product_id IS NOT NULL))
    -- Filtro por nombres de señal (multi-select)
    AND (p_signal_names IS NULL OR 
      COALESCE(dp.name, dprod.name) = ANY(p_signal_names))
    -- Filtro por país del CONTACTO (usando country_normalized)
    AND (p_countries IS NULL OR c.country_normalized = ANY(p_countries))
    -- Filtro por industria de la empresa
    AND (p_industries IS NULL OR comp.industry = ANY(p_industries))
    -- Filtro por email corporativo
    AND (NOT p_only_corporate_email OR (
      c.email IS NOT NULL 
      AND c.email NOT LIKE '%gmail.com'
      AND c.email NOT LIKE '%yahoo.com'
      AND c.email NOT LIKE '%hotmail.com'
      AND c.email NOT LIKE '%outlook.com'
      AND c.email NOT LIKE '%live.com'
      AND c.email NOT LIKE '%icloud.com'
      AND c.email NOT LIKE '%aol.com'
    ))
  ORDER BY c.id, s.created_at DESC
  LIMIT p_limit;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION export_contacts TO authenticated;
GRANT EXECUTE ON FUNCTION export_contacts TO service_role;

-- =====================================================
-- Verificación
-- =====================================================
DO $$
DECLARE
  company_count INT;
  contact_count INT;
  null_company_count INT;
  null_contact_count INT;
BEGIN
  SELECT COUNT(*) INTO company_count FROM companies WHERE country_normalized IS NOT NULL;
  SELECT COUNT(*) INTO contact_count FROM contacts WHERE country_normalized IS NOT NULL;
  SELECT COUNT(*) INTO null_company_count FROM companies WHERE country IS NOT NULL AND country_normalized IS NULL;
  SELECT COUNT(*) INTO null_contact_count FROM contacts WHERE country IS NOT NULL AND country_normalized IS NULL;
  
  RAISE NOTICE 'Companies con country_normalized: %', company_count;
  RAISE NOTICE 'Contacts con country_normalized: %', contact_count;
  RAISE NOTICE 'Companies con country pero sin normalizar (basura): %', null_company_count;
  RAISE NOTICE 'Contacts con country pero sin normalizar (basura): %', null_contact_count;
END $$;
