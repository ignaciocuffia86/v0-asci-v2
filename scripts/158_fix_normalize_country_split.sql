-- =====================================================
-- Script 158: Fix normalize_country SPLIT_PART bug
-- =====================================================
-- PostgreSQL SPLIT_PART no acepta índices negativos
-- Necesitamos extraer el último elemento de otra forma

CREATE OR REPLACE FUNCTION normalize_country(p_country TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  clean_country TEXT;
  result TEXT;
  parts TEXT[];
  last_part TEXT;
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
    WHEN 'holanda' THEN 'Netherlands'
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
    WHEN 'república checa' THEN 'Czech Republic'
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
    WHEN 'russia' THEN 'Russia'
    WHEN 'rusia' THEN 'Russia'
    WHEN 'ru' THEN 'Russia'
    WHEN 'ukraine' THEN 'Ukraine'
    WHEN 'ucrania' THEN 'Ukraine'
    WHEN 'ua' THEN 'Ukraine'
    -- North America
    WHEN 'united states' THEN 'United States'
    WHEN 'usa' THEN 'United States'
    WHEN 'us' THEN 'United States'
    WHEN 'estados unidos' THEN 'United States'
    WHEN 'eeuu' THEN 'United States'
    WHEN 'canada' THEN 'Canada'
    WHEN 'canadá' THEN 'Canada'
    WHEN 'ca' THEN 'Canada'
    -- Oceania
    WHEN 'australia' THEN 'Australia'
    WHEN 'au' THEN 'Australia'
    WHEN 'new zealand' THEN 'New Zealand'
    WHEN 'nueva zelanda' THEN 'New Zealand'
    WHEN 'nz' THEN 'New Zealand'
    -- Asia
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
    WHEN 'corea' THEN 'South Korea'
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
  IF result IS NULL AND clean_country LIKE '%,%' THEN
    -- Extraer el último componente después de la última coma
    -- Ejemplo: "Buenos Aires, Argentina" -> "Argentina"
    parts := STRING_TO_ARRAY(clean_country, ',');
    last_part := TRIM(parts[ARRAY_LENGTH(parts, 1)]);
    
    -- Recursivamente intentar normalizar el último componente
    IF last_part IS NOT NULL AND last_part != clean_country THEN
      result := normalize_country(last_part);
    END IF;
  END IF;

  RETURN result;
END;
$$;

-- =====================================================
-- Re-normalizar contacts.country_normalized con la función corregida
-- =====================================================
UPDATE contacts
SET country_normalized = normalize_country(country)
WHERE country IS NOT NULL;

-- =====================================================
-- Re-normalizar companies.country_normalized con la función corregida
-- =====================================================
UPDATE companies
SET country_normalized = normalize_country(country)
WHERE country IS NOT NULL;

-- =====================================================
-- Verificación: mostrar ejemplos de normalización
-- =====================================================
DO $$
DECLARE
  contact_with_country INT;
  contact_normalized INT;
  sample_record RECORD;
BEGIN
  SELECT COUNT(*) INTO contact_with_country FROM contacts WHERE country IS NOT NULL;
  SELECT COUNT(*) INTO contact_normalized FROM contacts WHERE country_normalized IS NOT NULL;
  
  RAISE NOTICE 'Contacts con country: %', contact_with_country;
  RAISE NOTICE 'Contacts con country_normalized: %', contact_normalized;
  RAISE NOTICE 'Porcentaje normalizado: %', ROUND(100.0 * contact_normalized / NULLIF(contact_with_country, 0), 2);
  
  -- Mostrar algunos ejemplos
  RAISE NOTICE '--- Ejemplos de normalización ---';
  FOR sample_record IN 
    SELECT country, country_normalized 
    FROM contacts 
    WHERE country IS NOT NULL 
    LIMIT 10
  LOOP
    RAISE NOTICE 'Original: % -> Normalizado: %', sample_record.country, sample_record.country_normalized;
  END LOOP;
END $$;

-- =====================================================
-- Verificar que el RPC funciona correctamente
-- =====================================================
-- Test: obtener países disponibles
DO $$
DECLARE
  country_record RECORD;
BEGIN
  RAISE NOTICE '--- Países disponibles para filtro ---';
  FOR country_record IN 
    SELECT DISTINCT c.country_normalized, COUNT(*) as count
    FROM contacts c
    INNER JOIN signals s ON s.contact_id = c.id
    WHERE c.country_normalized IS NOT NULL
    GROUP BY c.country_normalized
    ORDER BY count DESC
    LIMIT 20
  LOOP
    RAISE NOTICE '%: % contactos', country_record.country_normalized, country_record.count;
  END LOOP;
END $$;
