-- =============================================================================
-- SCRIPT 107: Normalización de Países
-- =============================================================================
-- Este script:
-- 1. Crea una tabla de mapeo de países
-- 2. Agrega columna country_normalized a companies
-- 3. Normaliza todos los países existentes
-- 4. Crea trigger para normalizar automáticamente nuevos registros
-- =============================================================================

-- 1. Crear tabla de mapeo de países
CREATE TABLE IF NOT EXISTS country_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_value TEXT NOT NULL UNIQUE,
  normalized_country TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Agregar columna country_normalized si no existe
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country_normalized TEXT;

-- 3. Crear índice para búsquedas
CREATE INDEX IF NOT EXISTS idx_companies_country_normalized ON companies(country_normalized);
CREATE INDEX IF NOT EXISTS idx_country_mappings_raw_value ON country_mappings(raw_value);

-- 4. Insertar mapeos conocidos
INSERT INTO country_mappings (raw_value, normalized_country) VALUES
-- Argentina
('Argentina', 'Argentina'),
('Greater Buenos Aires', 'Argentina'),
('Buenos Aires, Buenos Aires Province, Argentina', 'Argentina'),
('Buenos Aires Province, Argentina', 'Argentina'),
('Cordoba, Córdoba, Argentina', 'Argentina'),
('Vicente López, Buenos Aires Province, Argentina', 'Argentina'),
('Rosario, Santa Fe, Argentina', 'Argentina'),
('Pilar, Buenos Aires Province, Argentina', 'Argentina'),
('Mar del Plata, Buenos Aires Province, Argentina', 'Argentina'),
('Mendoza, Mendoza, Argentina', 'Argentina'),
('San Juan, San Juan, Argentina', 'Argentina'),
('Posadas, Misiones, Argentina', 'Argentina'),
('Salta, Salta, Argentina', 'Argentina'),
('Santa Fe, Santa Fe, Argentina', 'Argentina'),
('Martínez, Buenos Aires Province, Argentina', 'Argentina'),
('Neuquén, Neuquén Province, Argentina', 'Argentina'),
('Greater Rosario', 'Argentina'),
('Corrientes, Corrientes, Argentina', 'Argentina'),
('San Luis, San Luis, Argentina', 'Argentina'),
('Cipolletti, Río Negro Province, Argentina', 'Argentina'),
('Bahía Blanca, Buenos Aires Province, Argentina', 'Argentina'),
('Rincón de los Sauces, Neuquén Province, Argentina', 'Argentina'),
('San Isidro, Buenos Aires Province, Argentina', 'Argentina'),
('Tandil, Buenos Aires Province, Argentina', 'Argentina'),
('Comuna 8, Buenos Aires Province, Argentina', 'Argentina'),
('Concordia, Entre Ríos Province, Argentina', 'Argentina'),
('Mendoza, Argentina', 'Argentina'),
('Jujuy, Argentina', 'Argentina'),
('Neuquén Province, Argentina', 'Argentina'),
('Greater Salta', 'Argentina'),
('Cordoba, Argentina Metropolitan Area', 'Argentina'),
('Chubut Province, Argentina', 'Argentina'),
('Salta, Argentina', 'Argentina'),

-- Chile
('Chile', 'Chile'),
('Santiago, Santiago Metropolitan Region, Chile', 'Chile'),
('Antofagasta, Antofagasta Region, Chile', 'Chile'),
('Valparaíso, Valparaiso Region, Chile', 'Chile'),
('Copiapó, Atacama Region, Chile', 'Chile'),
('Calama, Antofagasta Region, Chile', 'Chile'),
('Iquique, Tarapacá Region, Chile', 'Chile'),
('Concepcion, Biobío Region, Chile', 'Chile'),
('Santiago Metropolitan Area', 'Chile'),
('Santiago Metropolitan Region, Chile', 'Chile'),
('La Serena, Coquimbo Region, Chile', 'Chile'),
('Osorno, Los Lagos Region, Chile', 'Chile'),
('Punta Arenas, Region of Magallanes and Chilean Antarctica, Chile', 'Chile'),
('Viña del Mar, Valparaiso Region, Chile', 'Chile'),
('Puerto Montt, Los Lagos Region, Chile', 'Chile'),
('Arica, Arica and Parinacota Region, Chile', 'Chile'),
('Providencia, Santiago Metropolitan Region, Chile', 'Chile'),
('Las Condes, Santiago Metropolitan Region, Chile', 'Chile'),
('Talca, Maule Region, Chile', 'Chile'),
('Temuco, Araucanía Region, Chile', 'Chile'),
('Lampa, Santiago Metropolitan Region, Chile', 'Chile'),
('Chañaral, Atacama Region, Chile', 'Chile'),
('Hijuelas, Valparaiso Region, Chile', 'Chile'),
('Rancagua Metropolitan Area', 'Chile'),

-- United States
('United States', 'United States'),
('San Francisco, CA', 'United States'),
('New York, NY', 'United States'),
('New York, United States', 'United States'),
('Atlanta, GA', 'United States'),
('McLean, VA', 'United States'),
('Boston, MA', 'United States'),
('Seattle, WA', 'United States'),
('Mountain View, CA', 'United States'),
('Ashburn, VA', 'United States'),
('California, United States', 'United States'),
('Dallas, TX', 'United States'),
('New York City Metropolitan Area', 'United States'),
('Charlotte, NC', 'United States'),
('Arlington, VA', 'United States'),
('San Diego, CA', 'United States'),
('Herndon, VA', 'United States'),
('Radford, VA', 'United States'),
('Alpharetta, GA', 'United States'),
('Albany, NY', 'United States'),
('Raleigh, NC', 'United States'),
('San Mateo, CA', 'United States'),
('Chantilly, VA', 'United States'),
('Miami, FL', 'United States'),
('St Louis, MO', 'United States'),
('Huntsville, AL', 'United States'),
('Richmond, VA', 'United States'),
('Quantico, VA', 'United States'),
('Columbia, MD', 'United States'),
('Jersey City, NJ', 'United States'),
('Reston, VA', 'United States'),
('Philadelphia, PA', 'United States'),
('Houston, TX', 'United States'),
('Denver, CO', 'United States'),
('Menlo Park, CA', 'United States'),
('Boca Raton, FL', 'United States'),
('Dayton, OH', 'United States'),
('Norfolk, VA', 'United States'),
('Oakland, CA', 'United States'),
('Los Angeles Metropolitan Area', 'United States'),
('Chattanooga, TN', 'United States'),
('Plano, TX', 'United States'),
('Cincinnati, OH', 'United States'),
('St. Petersburg, FL', 'United States'),
('Annapolis Junction, MD', 'United States'),
('Austin, TX', 'United States'),
('Los Angeles, CA', 'United States'),
('San Francisco Bay Area', 'United States'),
('Chicago, IL', 'United States'),
('Washington, DC', 'United States'),
('Palo Alto, CA', 'United States'),
('Delaware, United States', 'United States'),
('North Carolina, United States', 'United States'),
('Texas, United States', 'United States'),
('Colorado, United States', 'United States'),
('Massachusetts, United States', 'United States'),
('New Jersey, United States', 'United States'),
('Maryland, United States', 'United States'),
('Georgia, United States', 'United States'),
('Indiana, United States', 'United States'),
('Michigan, United States', 'United States'),
('Ohio, United States', 'United States'),
('Utah, United States', 'United States'),
('Wisconsin, United States', 'United States'),
('Washington, United States', 'United States'),
('Mississippi, United States', 'United States'),

-- Peru
('Peru', 'Peru'),
('Lima, Peru', 'Peru'),
('San Isidro, Peru', 'Peru'),
('Ate, Peru', 'Peru'),
('Arequipa, Arequipa, Peru', 'Peru'),
('Santiago de Surco, Peru', 'Peru'),
('Lurín, Peru', 'Peru'),
('Lurigancho, Peru', 'Peru'),
('Callao, Constitutional Province of Callao, Peru', 'Peru'),
('Lima Metropolitan Area', 'Peru'),
('Villa El Salvador, Peru', 'Peru'),
('La Victoria, Peru', 'Peru'),
('Chorrillos, Peru', 'Peru'),
('Trujillo, La Libertad, Peru', 'Peru'),
('Santa Anita, Peru', 'Peru'),
('Bellavista, Constitutional Province of Callao, Peru', 'Peru'),
('Magdalena del Mar, Peru', 'Peru'),
('San Miguel, Peru', 'Peru'),
('Los Olivos, Peru', 'Peru'),
('Miraflores, Peru', 'Peru'),
('San Borja, Peru', 'Peru'),
('San Juan de Lurigancho, Peru', 'Peru'),
('Comas, Peru', 'Peru'),
('La Molina, Peru', 'Peru'),
('Ica, Ica, Peru', 'Peru'),
('Cusco, Cusco, Peru', 'Peru'),
('Chiclayo, Lambayeque, Peru', 'Peru'),
('Lince, Peru', 'Peru'),

-- Ecuador
('Ecuador', 'Ecuador'),
('Quito, Pichincha, Ecuador', 'Ecuador'),
('Guayaquil, Guayas, Ecuador', 'Ecuador'),
('Cuenca, Azuay, Ecuador', 'Ecuador'),
('Manta, Manabí, Ecuador', 'Ecuador'),
('Duran, Guayas, Ecuador', 'Ecuador'),
('Durán, Guayas, Ecuador', 'Ecuador'),
('Ecuador, El Oro, Ecuador', 'Ecuador'),
('Pichincha, Ecuador', 'Ecuador'),
('Latacunga, Cotopaxi, Ecuador', 'Ecuador'),
('Sangolqui, Pichincha, Ecuador', 'Ecuador'),
('Manche, Loja, Ecuador', 'Ecuador'),
('Loja, Loja, Ecuador', 'Ecuador'),
('Guayaquil Metropolitan Area', 'Ecuador'),
('Quito Canton, Pichincha, Ecuador', 'Ecuador'),
('Riobamba, Chimborazo, Ecuador', 'Ecuador'),

-- Colombia
('Colombia', 'Colombia'),
('Bello, Antioquia, Colombia', 'Colombia'),

-- Mexico
('Mexico', 'Mexico'),
('Mexico City, Mexico', 'Mexico'),

-- Spain
('Spain', 'Spain'),

-- Others - Direct mappings
('United Kingdom', 'United Kingdom'),
('Canada', 'Canada'),
('Brazil', 'Brazil'),
('France', 'France'),
('Germany', 'Germany'),
('Switzerland', 'Switzerland'),
('Panama', 'Panama'),
('Uruguay', 'Uruguay'),
('Paraguay', 'Paraguay'),
('Netherlands', 'Netherlands'),
('Venezuela', 'Venezuela'),
('Italy', 'Italy'),
('El Salvador', 'El Salvador'),
('Dominican Republic', 'Dominican Republic'),
('Guatemala', 'Guatemala'),
('Sweden', 'Sweden'),
('Australia', 'Australia'),
('India', 'India'),
('Belgium', 'Belgium'),
('Ireland', 'Ireland'),
('China', 'China'),
('Denmark', 'Denmark'),
('Honduras', 'Honduras'),
('Bolivia', 'Bolivia'),
('Japan', 'Japan'),
('Austria', 'Austria'),
('Singapore', 'Singapore'),
('Norway', 'Norway'),
('United Arab Emirates', 'United Arab Emirates'),
('Portugal', 'Portugal'),
('Luxembourg', 'Luxembourg'),
('Bermuda', 'Bermuda'),
('Finland', 'Finland'),
('South Africa', 'South Africa'),
('South Korea', 'South Korea'),
('Puerto Rico', 'Puerto Rico'),
('Poland', 'Poland'),
('Nicaragua', 'Nicaragua'),
('Philippines', 'Philippines'),
('Saudi Arabia', 'Saudi Arabia'),
('Russian Federation', 'Russia'),
('Hong Kong', 'Hong Kong'),
('Israel', 'Israel'),
('Turkey', 'Turkey'),
('Cayman Islands', 'Cayman Islands'),
('Taiwan', 'Taiwan'),
('Egypt', 'Egypt'),
('Greece', 'Greece'),
('Czech Republic', 'Czech Republic'),
('Jamaica', 'Jamaica'),
('New Zealand', 'New Zealand'),
('Lithuania', 'Lithuania'),
('Cyprus', 'Cyprus'),
('Estonia', 'Estonia'),
('Malaysia', 'Malaysia'),
('Gibraltar', 'Gibraltar'),
('Suriname', 'Suriname'),
('Jordan', 'Jordan'),
('Croatia', 'Croatia'),
('Thailand', 'Thailand'),
('Barbados', 'Barbados'),
('Trinidad and Tobago', 'Trinidad and Tobago'),
('Bahamas', 'Bahamas'),
('Afghanistan', 'Afghanistan'),
('Latin America', 'Latin America')
ON CONFLICT (raw_value) DO NOTHING;

-- 5. Función para normalizar país
CREATE OR REPLACE FUNCTION normalize_country(p_country TEXT)
RETURNS TEXT AS $$
DECLARE
  v_normalized TEXT;
BEGIN
  IF p_country IS NULL OR p_country = '' THEN
    RETURN NULL;
  END IF;

  -- Buscar en mappings existentes
  SELECT normalized_country INTO v_normalized
  FROM country_mappings
  WHERE raw_value = p_country;

  IF v_normalized IS NOT NULL THEN
    RETURN v_normalized;
  END IF;

  -- Intentar detectar país por patrones
  -- Argentina
  IF p_country ILIKE '%Argentina%' OR p_country ILIKE '%Buenos Aires%' THEN
    RETURN 'Argentina';
  END IF;

  -- Chile
  IF p_country ILIKE '%Chile%' OR p_country ILIKE '%Santiago%' THEN
    RETURN 'Chile';
  END IF;

  -- Peru
  IF p_country ILIKE '%Peru%' OR p_country ILIKE '%Lima%' THEN
    RETURN 'Peru';
  END IF;

  -- Ecuador
  IF p_country ILIKE '%Ecuador%' OR p_country ILIKE '%Quito%' OR p_country ILIKE '%Guayaquil%' THEN
    RETURN 'Ecuador';
  END IF;

  -- Colombia
  IF p_country ILIKE '%Colombia%' OR p_country ILIKE '%Bogot%' OR p_country ILIKE '%Medell%' THEN
    RETURN 'Colombia';
  END IF;

  -- Mexico
  IF p_country ILIKE '%Mexico%' OR p_country ILIKE '%México%' THEN
    RETURN 'Mexico';
  END IF;

  -- United States - Detectar por estados
  IF p_country ~ ', (AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)$' THEN
    RETURN 'United States';
  END IF;
  IF p_country ILIKE '%United States%' OR p_country ILIKE '%USA%' THEN
    RETURN 'United States';
  END IF;

  -- Uruguay
  IF p_country ILIKE '%Uruguay%' OR p_country ILIKE '%Montevideo%' THEN
    RETURN 'Uruguay';
  END IF;

  -- Paraguay
  IF p_country ILIKE '%Paraguay%' OR p_country ILIKE '%Asuncion%' THEN
    RETURN 'Paraguay';
  END IF;

  -- Venezuela
  IF p_country ILIKE '%Venezuela%' OR p_country ILIKE '%Caracas%' THEN
    RETURN 'Venezuela';
  END IF;

  -- Bolivia
  IF p_country ILIKE '%Bolivia%' OR p_country ILIKE '%La Paz%' THEN
    RETURN 'Bolivia';
  END IF;

  -- Si no encontramos nada, devolver el valor original
  RETURN p_country;
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. Actualizar todos los países existentes
UPDATE companies
SET country_normalized = normalize_country(country)
WHERE country IS NOT NULL AND country != '';

-- 7. Crear trigger para normalizar automáticamente
CREATE OR REPLACE FUNCTION trigger_normalize_country()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.country IS NOT NULL AND NEW.country != '' THEN
    NEW.country_normalized := normalize_country(NEW.country);
  ELSE
    NEW.country_normalized := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_country ON companies;
CREATE TRIGGER trg_normalize_country
  BEFORE INSERT OR UPDATE OF country ON companies
  FOR EACH ROW
  EXECUTE FUNCTION trigger_normalize_country();

-- 8. Verificar resultado
SELECT 
  country_normalized, 
  COUNT(*) as count
FROM companies
WHERE country_normalized IS NOT NULL
GROUP BY country_normalized
ORDER BY count DESC;
