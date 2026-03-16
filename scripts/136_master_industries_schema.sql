-- ============================================================================
-- FASE 1: Sistema Unificado de Industrias - Schema
-- ============================================================================
-- Este script crea las tablas, columnas, índices y triggers necesarios para
-- el sistema de industrias maestras.
-- ============================================================================

-- 1. TABLA: master_industries (25 categorías maestras)
-- ============================================================================
CREATE TABLE IF NOT EXISTS master_industries (
  id TEXT PRIMARY KEY,                      -- 'technology', 'banking', etc.
  name TEXT NOT NULL,                       -- 'Tecnología y Software' (español)
  name_en TEXT NOT NULL,                    -- 'Technology & Software' (inglés)
  icon TEXT NOT NULL,                       -- Nombre del ícono Lucide
  display_order INT NOT NULL DEFAULT 0,     -- Orden de visualización
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para ordenar por display_order
CREATE INDEX IF NOT EXISTS idx_master_industries_order 
  ON master_industries(display_order);

-- 2. TABLA: industry_mappings (mapeos de valores originales a maestras)
-- ============================================================================
CREATE TABLE IF NOT EXISTS industry_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_value TEXT NOT NULL,             -- Valor original ('Banking', 'IT Services', etc.)
  source_type TEXT NOT NULL DEFAULT 'company', -- 'company' o 'document'
  master_industry_id TEXT REFERENCES master_industries(id) ON DELETE SET NULL,
  is_auto_mapped BOOLEAN DEFAULT FALSE,     -- Si fue mapeado automáticamente
  mapped_at TIMESTAMPTZ DEFAULT NOW(),
  mapped_by UUID REFERENCES auth.users(id), -- Admin que hizo el mapeo
  
  -- Un valor original solo puede mapearse una vez por tipo de fuente
  CONSTRAINT unique_mapping_per_source UNIQUE(original_value, source_type),
  -- Validar source_type
  CONSTRAINT valid_source_type CHECK (source_type IN ('company', 'document'))
);

-- Índices para búsqueda y agrupación
CREATE INDEX IF NOT EXISTS idx_industry_mappings_lookup 
  ON industry_mappings(LOWER(original_value), source_type);
CREATE INDEX IF NOT EXISTS idx_industry_mappings_master 
  ON industry_mappings(master_industry_id);
CREATE INDEX IF NOT EXISTS idx_industry_mappings_unmapped 
  ON industry_mappings(source_type) WHERE master_industry_id IS NULL;

-- 3. MODIFICAR TABLA: companies (agregar columna master_industry_id)
-- ============================================================================
ALTER TABLE companies 
  ADD COLUMN IF NOT EXISTS master_industry_id TEXT REFERENCES master_industries(id);

-- Índice para filtrar por industria maestra
CREATE INDEX IF NOT EXISTS idx_companies_master_industry 
  ON companies(master_industry_id) 
  WHERE master_industry_id IS NOT NULL;

-- 4. MODIFICAR TABLA: document_tags (agregar columna master_industry_id)
-- ============================================================================
ALTER TABLE document_tags 
  ADD COLUMN IF NOT EXISTS master_industry_id TEXT REFERENCES master_industries(id);

-- Índice parcial solo para tags de tipo 'industry'
CREATE INDEX IF NOT EXISTS idx_document_tags_master_industry 
  ON document_tags(master_industry_id) 
  WHERE tag_type = 'industry' AND master_industry_id IS NOT NULL;

-- 5. TRIGGER: normalize_company_industry
-- ============================================================================
-- Se ejecuta al insertar/actualizar una company y auto-asigna master_industry_id
-- basándose en la tabla de mapeos
CREATE OR REPLACE FUNCTION normalize_company_industry()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo procesar si hay industria
  IF NEW.industry IS NOT NULL AND NEW.industry != '' THEN
    -- Buscar mapeo existente (case insensitive)
    SELECT master_industry_id INTO NEW.master_industry_id
    FROM industry_mappings
    WHERE LOWER(original_value) = LOWER(NEW.industry)
      AND source_type = 'company';
  ELSE
    NEW.master_industry_id := NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Eliminar trigger si existe y recrear
DROP TRIGGER IF EXISTS trg_normalize_company_industry ON companies;
CREATE TRIGGER trg_normalize_company_industry
BEFORE INSERT OR UPDATE OF industry ON companies
FOR EACH ROW
EXECUTE FUNCTION normalize_company_industry();

-- 6. TRIGGER: normalize_document_tag_industry
-- ============================================================================
-- Se ejecuta al insertar/actualizar un document_tag de tipo 'industry'
CREATE OR REPLACE FUNCTION normalize_document_tag_industry()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo procesar si es tag de industria
  IF NEW.tag_type = 'industry' AND NEW.tag_value IS NOT NULL AND NEW.tag_value != '' THEN
    -- Buscar mapeo existente (case insensitive)
    SELECT master_industry_id INTO NEW.master_industry_id
    FROM industry_mappings
    WHERE LOWER(original_value) = LOWER(NEW.tag_value)
      AND source_type = 'document';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Eliminar trigger si existe y recrear
DROP TRIGGER IF EXISTS trg_normalize_document_industry ON document_tags;
CREATE TRIGGER trg_normalize_document_industry
BEFORE INSERT OR UPDATE ON document_tags
FOR EACH ROW
WHEN (NEW.tag_type = 'industry')
EXECUTE FUNCTION normalize_document_tag_industry();

-- 7. TRIGGER: on_industry_mapping_change (propagación)
-- ============================================================================
-- Cuando se agrega/modifica/elimina un mapeo, actualizar registros existentes
CREATE OR REPLACE FUNCTION on_industry_mapping_change()
RETURNS TRIGGER AS $$
BEGIN
  -- INSERT o UPDATE: propagar nuevo mapeo
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    -- Actualizar companies si es mapeo de company
    IF NEW.source_type = 'company' THEN
      UPDATE companies
      SET master_industry_id = NEW.master_industry_id
      WHERE LOWER(industry) = LOWER(NEW.original_value)
        AND (master_industry_id IS DISTINCT FROM NEW.master_industry_id);
    END IF;
    
    -- Actualizar document_tags si es mapeo de document
    IF NEW.source_type = 'document' THEN
      UPDATE document_tags
      SET master_industry_id = NEW.master_industry_id
      WHERE tag_type = 'industry'
        AND LOWER(tag_value) = LOWER(NEW.original_value)
        AND (master_industry_id IS DISTINCT FROM NEW.master_industry_id);
    END IF;
    
    RETURN NEW;
  END IF;
  
  -- DELETE: limpiar master_industry_id de registros afectados
  IF TG_OP = 'DELETE' THEN
    IF OLD.source_type = 'company' THEN
      UPDATE companies
      SET master_industry_id = NULL
      WHERE LOWER(industry) = LOWER(OLD.original_value);
    END IF;
    
    IF OLD.source_type = 'document' THEN
      UPDATE document_tags
      SET master_industry_id = NULL
      WHERE tag_type = 'industry'
        AND LOWER(tag_value) = LOWER(OLD.original_value);
    END IF;
    
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Eliminar trigger si existe y recrear
DROP TRIGGER IF EXISTS trg_industry_mapping_propagate ON industry_mappings;
CREATE TRIGGER trg_industry_mapping_propagate
AFTER INSERT OR UPDATE OR DELETE ON industry_mappings
FOR EACH ROW
EXECUTE FUNCTION on_industry_mapping_change();

-- 8. INSERTAR 25 INDUSTRIAS MAESTRAS
-- ============================================================================
INSERT INTO master_industries (id, name, name_en, icon, display_order) VALUES
  ('technology', 'Tecnología y Software', 'Technology & Software', 'Monitor', 1),
  ('financial_services', 'Servicios Financieros', 'Financial Services', 'Landmark', 2),
  ('banking', 'Banca', 'Banking', 'Building2', 3),
  ('insurance', 'Seguros', 'Insurance', 'Shield', 4),
  ('healthcare', 'Salud y Farmacéutica', 'Healthcare & Pharmaceuticals', 'Heart', 5),
  ('education', 'Educación', 'Education', 'GraduationCap', 6),
  ('retail', 'Retail y Comercio', 'Retail & Commerce', 'ShoppingCart', 7),
  ('manufacturing', 'Manufactura e Industria', 'Manufacturing & Industry', 'Factory', 8),
  ('energy', 'Energía y Utilities', 'Energy & Utilities', 'Zap', 9),
  ('telecommunications', 'Telecomunicaciones', 'Telecommunications', 'Radio', 10),
  ('construction', 'Construcción e Inmobiliario', 'Construction & Real Estate', 'Building', 11),
  ('transportation', 'Transporte y Logística', 'Transportation & Logistics', 'Truck', 12),
  ('consulting', 'Consultoría y Servicios Profesionales', 'Consulting & Professional Services', 'Briefcase', 13),
  ('media', 'Medios y Entretenimiento', 'Media & Entertainment', 'Tv', 14),
  ('hospitality', 'Hotelería y Turismo', 'Hospitality & Tourism', 'Hotel', 15),
  ('food_beverage', 'Alimentos y Bebidas', 'Food & Beverage', 'UtensilsCrossed', 16),
  ('agriculture', 'Agricultura y Ganadería', 'Agriculture', 'Wheat', 17),
  ('mining', 'Minería y Recursos Naturales', 'Mining & Natural Resources', 'Mountain', 18),
  ('automotive', 'Automotriz', 'Automotive', 'Car', 19),
  ('aerospace', 'Aeroespacial y Defensa', 'Aerospace & Defense', 'Plane', 20),
  ('government', 'Gobierno y Sector Público', 'Government & Public Sector', 'Landmark', 21),
  ('nonprofit', 'ONGs y Organizaciones Civiles', 'Non-Profit Organizations', 'HeartHandshake', 22),
  ('legal', 'Legal y Jurídico', 'Legal', 'Scale', 23),
  ('hr_staffing', 'Recursos Humanos y Staffing', 'Human Resources & Staffing', 'Users', 24),
  ('other', 'Otras Industrias', 'Other Industries', 'MoreHorizontal', 25)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  name_en = EXCLUDED.name_en,
  icon = EXCLUDED.icon,
  display_order = EXCLUDED.display_order;

-- 9. HABILITAR RLS (Row Level Security)
-- ============================================================================
-- master_industries: lectura pública, escritura solo admin
ALTER TABLE master_industries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "master_industries_select" ON master_industries;
CREATE POLICY "master_industries_select" ON master_industries
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "master_industries_admin" ON master_industries;
CREATE POLICY "master_industries_admin" ON master_industries
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'superadmin'
    )
  );

-- industry_mappings: lectura pública, escritura solo admin
ALTER TABLE industry_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "industry_mappings_select" ON industry_mappings;
CREATE POLICY "industry_mappings_select" ON industry_mappings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "industry_mappings_admin" ON industry_mappings;
CREATE POLICY "industry_mappings_admin" ON industry_mappings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role = 'superadmin'
    )
  );

-- 10. VISTA: industrias sin mapear (para panel admin)
-- ============================================================================
CREATE OR REPLACE VIEW v_unmapped_industries AS
SELECT 
  'company' as source_type,
  industry as original_value,
  COUNT(*) as affected_count
FROM companies
WHERE industry IS NOT NULL 
  AND industry != ''
  AND master_industry_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM industry_mappings im 
    WHERE LOWER(im.original_value) = LOWER(companies.industry)
    AND im.source_type = 'company'
  )
GROUP BY industry

UNION ALL

SELECT 
  'document' as source_type,
  tag_value as original_value,
  COUNT(*) as affected_count
FROM document_tags
WHERE tag_type = 'industry'
  AND tag_value IS NOT NULL 
  AND tag_value != ''
  AND master_industry_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM industry_mappings im 
    WHERE LOWER(im.original_value) = LOWER(document_tags.tag_value)
    AND im.source_type = 'document'
  )
GROUP BY tag_value

ORDER BY affected_count DESC;

-- ============================================================================
-- FIN FASE 1
-- ============================================================================
