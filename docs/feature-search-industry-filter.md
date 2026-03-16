# Feature: Sistema Unificado de Industrias

## Resumen

Sistema centralizado de industrias maestras que unifica:
1. **Filtro de búsqueda** - Filtrar resultados por industria después de seleccionar país
2. **Matching de documentos** - Mejorar el matching entre documentos y empresas por industria

Las 358+ industrias de companies y los tags de documentos se unifican en 25 categorías maestras.

## Estado: Diseño Aprobado
## Fecha: Marzo 2026

---

## 1. Problema Actual

### Dos Sistemas Fragmentados

| Sistema | Fuente | Problema |
|---------|--------|----------|
| **Companies** | `companies.industry` (358 valores únicos) | "IT Services", "Information Technology & Services" no matchean |
| **Documentos** | `document_tags.tag_value` donde `tag_type='industry'` | "Financial Services", "Banking" son distintos |

### Impacto en Matching de Documentos

**Flujo actual (roto):**
```
company.industry === document_tag.tag_value  →  Comparación de strings exactos
```

**Ejemplo de fallo:**
- Empresa: `industry = "Banking"`
- Documento: tiene tag `industry = "Financial Services"`
- Resultado: **NO MATCHEAN** (pero deberían)

### Métricas Actuales
- 358 industrias únicas en `companies`
- 82% de companies sin industria (46,004 de 56,319)
- ~15 variantes distintas de "Tecnología" que no se agrupan

---

## 2. Solución: Diccionario Central de Industrias

### Concepto

`master_industries` se convierte en el **diccionario central** para toda la plataforma:

```
┌─────────────────────────────────────────────────────────────────┐
│                     MASTER_INDUSTRIES                           │
│                    (25 categorías)                              │
├─────────────────────────────────────────────────────────────────┤
│                           │                                     │
│    ┌──────────────────────┼──────────────────────┐              │
│    │                      │                      │              │
│    ▼                      ▼                      ▼              │
│ ┌──────────┐        ┌──────────┐          ┌──────────┐         │
│ │COMPANIES │        │DOCUMENTS │          │ BÚSQUEDA │         │
│ │.master_  │        │.master_  │          │ filtros  │         │
│ │industry  │        │industry  │          │          │         │
│ │_id       │        │_id       │          │          │         │
│ └──────────┘        └──────────┘          └──────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

### Beneficios

| Antes | Después |
|-------|---------|
| `"Banking" !== "Financial Services"` | Ambos → `banking` → **MATCHEAN** |
| 358 industrias fragmentadas | 25 categorías limpias |
| Matching por string exacto | Matching por ID normalizado |
| Sin filtro en búsqueda | Filtro por industria disponible |

---

## 3. 25 Industrias Maestras

| ID | Nombre | Icono |
|----|--------|-------|
| technology | Tecnología y Software | Monitor |
| financial_services | Servicios Financieros | Landmark |
| banking | Banca | Building2 |
| insurance | Seguros | Shield |
| healthcare | Salud y Farmacéutica | Heart |
| education | Educación | GraduationCap |
| retail | Retail y Comercio | ShoppingCart |
| manufacturing | Manufactura e Industria | Factory |
| energy | Energía y Utilities | Zap |
| telecommunications | Telecomunicaciones | Radio |
| construction | Construcción e Inmobiliario | Building |
| transportation | Transporte y Logística | Truck |
| consulting | Consultoría y Servicios Profesionales | Briefcase |
| media | Medios y Entretenimiento | Tv |
| hospitality | Hotelería y Turismo | Hotel |
| food_beverage | Alimentos y Bebidas | UtensilsCrossed |
| agriculture | Agricultura y Ganadería | Wheat |
| mining | Minería y Recursos Naturales | Mountain |
| automotive | Automotriz | Car |
| aerospace | Aeroespacial y Defensa | Plane |
| government | Gobierno y Sector Público | Landmark |
| nonprofit | ONGs y Organizaciones Civiles | Heart |
| legal | Legal y Jurídico | Scale |
| hr_staffing | Recursos Humanos y Staffing | Users |
| other | Otras Industrias | MoreHorizontal |

---

## 4. Modelo de Datos

### 4.1 Nueva Tabla: `master_industries`

```sql
CREATE TABLE master_industries (
  id TEXT PRIMARY KEY,                    -- 'technology', 'banking', etc.
  name TEXT NOT NULL,                     -- 'Tecnología y Software'
  name_en TEXT NOT NULL,                  -- 'Technology & Software' (para matching)
  icon TEXT NOT NULL,                     -- 'Monitor' (Lucide icon name)
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_master_industries_order ON master_industries(display_order);
```

### 4.2 Nueva Tabla: `industry_mappings`

```sql
CREATE TABLE industry_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_value TEXT NOT NULL,             -- Valor original (industria o tag)
  source_type TEXT NOT NULL DEFAULT 'company', -- 'company' o 'document'
  master_industry_id TEXT REFERENCES master_industries(id),
  is_auto_mapped BOOLEAN DEFAULT FALSE,
  mapped_at TIMESTAMPTZ DEFAULT NOW(),
  mapped_by UUID REFERENCES auth.users(id),
  
  -- Un valor original solo puede mapearse una vez por tipo de fuente
  UNIQUE(original_value, source_type)
);

CREATE INDEX idx_industry_mappings_lookup 
  ON industry_mappings(LOWER(original_value), source_type);
CREATE INDEX idx_industry_mappings_master 
  ON industry_mappings(master_industry_id);
```

### 4.3 Modificar Tabla: `companies`

```sql
-- Agregar columna para industria normalizada
ALTER TABLE companies 
  ADD COLUMN master_industry_id TEXT REFERENCES master_industries(id);

CREATE INDEX idx_companies_master_industry ON companies(master_industry_id);
```

### 4.4 Modificar Tabla: `document_tags`

```sql
-- Agregar columna para industria normalizada en tags de industria
ALTER TABLE document_tags 
  ADD COLUMN master_industry_id TEXT REFERENCES master_industries(id);

CREATE INDEX idx_document_tags_master_industry 
  ON document_tags(master_industry_id) 
  WHERE tag_type = 'industry';
```

### 4.5 Triggers de Auto-Normalización

```sql
-- Trigger para companies
CREATE OR REPLACE FUNCTION normalize_company_industry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.industry IS NOT NULL AND NEW.industry != '' THEN
    SELECT master_industry_id INTO NEW.master_industry_id
    FROM industry_mappings
    WHERE LOWER(original_value) = LOWER(NEW.industry)
      AND source_type = 'company';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_normalize_company_industry
BEFORE INSERT OR UPDATE OF industry ON companies
FOR EACH ROW
EXECUTE FUNCTION normalize_company_industry();

-- Trigger para document_tags
CREATE OR REPLACE FUNCTION normalize_document_tag_industry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tag_type = 'industry' AND NEW.tag_value IS NOT NULL THEN
    SELECT master_industry_id INTO NEW.master_industry_id
    FROM industry_mappings
    WHERE LOWER(original_value) = LOWER(NEW.tag_value)
      AND source_type = 'document';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_normalize_document_industry
BEFORE INSERT OR UPDATE ON document_tags
FOR EACH ROW
WHEN (NEW.tag_type = 'industry')
EXECUTE FUNCTION normalize_document_tag_industry();
```

### 4.6 Trigger de Propagación al Mapear

```sql
-- Cuando se agrega/modifica un mapeo, actualizar registros existentes
CREATE OR REPLACE FUNCTION on_industry_mapping_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    -- Actualizar companies si es mapeo de company
    IF NEW.source_type = 'company' THEN
      UPDATE companies
      SET master_industry_id = NEW.master_industry_id
      WHERE LOWER(industry) = LOWER(NEW.original_value);
    END IF;
    
    -- Actualizar document_tags si es mapeo de document
    IF NEW.source_type = 'document' THEN
      UPDATE document_tags
      SET master_industry_id = NEW.master_industry_id
      WHERE tag_type = 'industry'
        AND LOWER(tag_value) = LOWER(NEW.original_value);
    END IF;
  END IF;
  
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
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_industry_mapping_propagate
AFTER INSERT OR UPDATE OR DELETE ON industry_mappings
FOR EACH ROW
EXECUTE FUNCTION on_industry_mapping_change();
```

---

## 5. Nuevo Matching de Documentos

### 5.1 Lógica Actual (a reemplazar)

```typescript
// lib/documents/rank-documents-for-bookmark.ts (actual)
const industryMatch = docTags.some(
  tag => tag.tag_type === 'industry' && 
         tag.tag_value.toLowerCase() === company.industry?.toLowerCase()
);
```

### 5.2 Nueva Lógica (con master_industry_id)

```typescript
// lib/documents/rank-documents-for-bookmark.ts (nuevo)
const industryMatch = docTags.some(
  tag => tag.tag_type === 'industry' && 
         tag.master_industry_id != null &&
         tag.master_industry_id === company.master_industry_id
);
```

### 5.3 Scoring Actualizado

```typescript
export function calculateDocumentScore(
  doc: DocumentWithTags,
  bookmark: BookmarkContext
): number {
  let score = 0;
  
  // Match por industria maestra (ya no por string)
  const industryMatch = doc.tags.some(
    t => t.tag_type === 'industry' && 
         t.master_industry_id === bookmark.company.master_industry_id
  );
  if (industryMatch) score += 30;  // Era 20, ahora vale más porque es confiable
  
  // Match por tecnología (sin cambios)
  const techMatch = doc.tags.some(
    t => t.tag_type === 'technology' && 
         bookmark.signals.some(s => s.keyword_matched === t.tag_value)
  );
  if (techMatch) score += 25;
  
  // Match por proceso (sin cambios)
  const processMatch = doc.tags.some(
    t => t.tag_type === 'process' && 
         bookmark.signals.some(s => s.keyword_matched === t.tag_value)
  );
  if (processMatch) score += 25;
  
  return score;
}
```

---

## 6. Panel de Administración

### 6.1 Ubicación y Acceso

- **Ruta**: `/admin/industries`
- **Acceso**: Solo `superadmin`
- **Menú**: En sidebar de admin, debajo de "Usuarios"

### 6.2 Vista Principal: Dashboard

```
┌─────────────────────────────────────────────────────────────────────┐
│  Gestión de Industrias                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  COMPANIES                              DOCUMENTOS                  │
│  ┌─────────────┐  ┌─────────────┐      ┌─────────────┐  ┌─────────┐│
│  │   358       │  │     46      │      │    42       │  │   8     ││
│  │ Industrias  │  │ Sin Mapear  │      │ Tags únicos │  │Sin Map. ││
│  └─────────────┘  └─────────────┘      └─────────────┘  └─────────┘│
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Tabs: [Companies] [Documentos] [Industrias Maestras]            ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Sin Mapear (46 companies, 8 documentos)          [Mapear todo] ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │ Valor Original          │ Fuente  │ Cantidad │ Asignar a       ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │ Civic Organizations     │ Company │    23    │ [Seleccionar ▼] ││
│  │ Sports Management       │ Company │    18    │ [Seleccionar ▼] ││
│  │ Fintech                 │ Doc     │     5    │ [Seleccionar ▼] ││
│  │ ...                                                             ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 6.3 API del Panel Admin

```typescript
// GET /api/admin/industries/stats
interface IndustryStats {
  masterIndustries: number;           // 25
  companyMappings: {
    total: number;                    // 358
    mapped: number;                   // 312
    unmapped: number;                 // 46
  };
  documentMappings: {
    total: number;                    // 42
    mapped: number;                   // 34
    unmapped: number;                 // 8
  };
}

// GET /api/admin/industries/unmapped?source=company|document|all
interface UnmappedIndustry {
  originalValue: string;
  sourceType: 'company' | 'document';
  count: number;                      // Empresas o docs afectados
  suggestedMasterId?: string;         // Sugerencia por similitud
}

// POST /api/admin/industries/map
interface MapIndustryRequest {
  mappings: Array<{
    originalValue: string;
    sourceType: 'company' | 'document';
    masterIndustryId: string;
  }>;
}

// GET /api/admin/industries/master
// Lista industrias maestras con conteos

// PUT /api/admin/industries/master/:id
// Actualizar industria maestra
```

### 6.4 Vistas para Documentos

```
┌─────────────────────────────────────────────────────────────────────┐
│  Tab: Documentos                                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Tags de Industria en Documentos                                    │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Tag Original                    │ Docs │ Mapeado a              ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │ Information Technology & Serv.  │  12  │ ✓ Tecnología y Software││
│  │ Financial Services              │   8  │ ✓ Servicios Financieros││
│  │ Banking                         │   6  │ ✓ Banca                ││
│  │ Fintech                         │   5  │ ⚠️ Sin mapear [Asignar]││
│  │ Healthcare                      │   4  │ ✓ Salud y Farmacéutica ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Filtro de Búsqueda por Industria

### 7.1 Flujo de Usuario

```
[Buscar por Tecnología/Proceso] 
    → [Seleccionar País] 
    → [Filtrar por Industria (opcional)]  ← NUEVO
    → [Ver Resultados]
```

### 7.2 Nueva RPC: `get_search_industry_counts`

```sql
CREATE FUNCTION get_search_industry_counts(
  p_filter_type TEXT,           -- 'process' o 'technology'
  p_signal_id UUID,             -- ID del proceso o tecnología
  p_country TEXT DEFAULT NULL
)
RETURNS TABLE (
  master_industry_id TEXT,
  name TEXT,
  icon TEXT,
  company_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mi.id as master_industry_id,
    mi.name,
    mi.icon,
    COUNT(DISTINCT c.id) as company_count
  FROM companies c
  JOIN signals s ON s.company_id = c.id
  JOIN master_industries mi ON mi.id = c.master_industry_id
  WHERE s.signal_id = p_signal_id
    AND (p_country IS NULL OR c.country = p_country)
    AND c.master_industry_id IS NOT NULL
  GROUP BY mi.id, mi.name, mi.icon
  HAVING COUNT(DISTINCT c.id) > 0
  ORDER BY company_count DESC;
END;
$$ LANGUAGE plpgsql;
```

### 7.3 Modificar RPCs de Búsqueda

```sql
-- Agregar parámetro a search_companies_by_process_v2 y search_companies_by_technology_v2
p_master_industry_ids TEXT[] DEFAULT NULL

-- Agregar filtro en WHERE
AND (
  p_master_industry_ids IS NULL 
  OR array_length(p_master_industry_ids, 1) = 0
  OR c.master_industry_id = ANY(p_master_industry_ids)
)
```

### 7.4 Componente UI

```tsx
// components/search/industry-filter.tsx
interface IndustryFilterProps {
  availableIndustries: Array<{
    id: string;
    name: string;
    icon: string;
    count: number;
  }>;
  selectedIndustries: string[];
  onSelectionChange: (ids: string[]) => void;
}

// - Multi-select con checkboxes
// - Solo muestra industrias con count > 0
// - Ordenadas por count descendente
// - Chips de filtros activos
```

---

## 8. Migración de Datos

### 8.1 Script de Migración Completo

```sql
-- 001_create_master_industries.sql

-- 1. Crear tabla de industrias maestras
CREATE TABLE IF NOT EXISTS master_industries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT NOT NULL,
  icon TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Crear tabla de mapeos
CREATE TABLE IF NOT EXISTS industry_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_value TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'company',
  master_industry_id TEXT REFERENCES master_industries(id),
  is_auto_mapped BOOLEAN DEFAULT FALSE,
  mapped_at TIMESTAMPTZ DEFAULT NOW(),
  mapped_by UUID REFERENCES auth.users(id),
  UNIQUE(original_value, source_type)
);

-- 3. Agregar columnas de normalización
ALTER TABLE companies 
  ADD COLUMN IF NOT EXISTS master_industry_id TEXT REFERENCES master_industries(id);

ALTER TABLE document_tags 
  ADD COLUMN IF NOT EXISTS master_industry_id TEXT REFERENCES master_industries(id);

-- 4. Crear índices
CREATE INDEX IF NOT EXISTS idx_companies_master_industry 
  ON companies(master_industry_id);
CREATE INDEX IF NOT EXISTS idx_document_tags_master_industry 
  ON document_tags(master_industry_id) WHERE tag_type = 'industry';
CREATE INDEX IF NOT EXISTS idx_industry_mappings_lookup 
  ON industry_mappings(LOWER(original_value), source_type);

-- 5. Insertar industrias maestras (25)
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
('consulting', 'Consultoría y Servicios Prof.', 'Consulting & Professional Services', 'Briefcase', 13),
('media', 'Medios y Entretenimiento', 'Media & Entertainment', 'Tv', 14),
('hospitality', 'Hotelería y Turismo', 'Hospitality & Tourism', 'Hotel', 15),
('food_beverage', 'Alimentos y Bebidas', 'Food & Beverage', 'UtensilsCrossed', 16),
('agriculture', 'Agricultura y Ganadería', 'Agriculture', 'Wheat', 17),
('mining', 'Minería y Recursos Naturales', 'Mining & Natural Resources', 'Mountain', 18),
('automotive', 'Automotriz', 'Automotive', 'Car', 19),
('aerospace', 'Aeroespacial y Defensa', 'Aerospace & Defense', 'Plane', 20),
('government', 'Gobierno y Sector Público', 'Government & Public Sector', 'Landmark', 21),
('nonprofit', 'ONGs y Organizaciones Civiles', 'Non-Profit Organizations', 'Heart', 22),
('legal', 'Legal y Jurídico', 'Legal', 'Scale', 23),
('hr_staffing', 'Recursos Humanos y Staffing', 'Human Resources & Staffing', 'Users', 24),
('other', 'Otras Industrias', 'Other Industries', 'MoreHorizontal', 25)
ON CONFLICT (id) DO NOTHING;

-- 6. Insertar mapeos para companies (extracto - ver documento completo)
INSERT INTO industry_mappings (original_value, source_type, master_industry_id) VALUES
-- Tecnología
('Information Technology & Services', 'company', 'technology'),
('IT Services and IT Consulting', 'company', 'technology'),
('Software Development', 'company', 'technology'),
('Computer Software', 'company', 'technology'),
('Technology, Information and Internet', 'company', 'technology'),
('Internet', 'company', 'technology'),
('Computer & Network Security', 'company', 'technology'),
('Computer Networking', 'company', 'technology'),
-- Servicios Financieros
('Financial Services', 'company', 'financial_services'),
('Investment Management', 'company', 'financial_services'),
('Investment Banking', 'company', 'financial_services'),
('Venture Capital & Private Equity', 'company', 'financial_services'),
-- Banca
('Banking', 'company', 'banking'),
-- ... (continúa con todos los mapeos)
ON CONFLICT (original_value, source_type) DO NOTHING;

-- 7. Insertar mapeos para documentos
INSERT INTO industry_mappings (original_value, source_type, master_industry_id) VALUES
('Information Technology & Services', 'document', 'technology'),
('Financial Services', 'document', 'financial_services'),
('Banking', 'document', 'banking'),
('Healthcare', 'document', 'healthcare'),
-- ... (mapeos de tags de documentos)
ON CONFLICT (original_value, source_type) DO NOTHING;

-- 8. Backfill companies
UPDATE companies c
SET master_industry_id = im.master_industry_id
FROM industry_mappings im
WHERE LOWER(c.industry) = LOWER(im.original_value)
  AND im.source_type = 'company'
  AND c.master_industry_id IS NULL;

-- 9. Backfill document_tags
UPDATE document_tags dt
SET master_industry_id = im.master_industry_id
FROM industry_mappings im
WHERE dt.tag_type = 'industry'
  AND LOWER(dt.tag_value) = LOWER(im.original_value)
  AND im.source_type = 'document'
  AND dt.master_industry_id IS NULL;

-- 10. Crear triggers (ver sección 4.5 y 4.6)
```

---

## 9. Plan de Implementación

### Fase 1: Base de Datos (3-4 horas)
- [ ] Crear script de migración SQL
- [ ] Crear tablas `master_industries` e `industry_mappings`
- [ ] Agregar columnas `master_industry_id` a `companies` y `document_tags`
- [ ] Crear triggers de normalización y propagación
- [ ] Ejecutar seed con mapeos iniciales
- [ ] Verificar backfill de datos existentes

### Fase 2: Actualizar Matching de Documentos (2-3 horas)
- [ ] Modificar `rank-documents-for-bookmark.ts` para usar `master_industry_id`
- [ ] Actualizar API `/api/documents/context-for-bookmark`
- [ ] Actualizar tipos TypeScript
- [ ] Tests de matching mejorado

### Fase 3: Panel Admin (4-5 horas)
- [ ] Crear página `/admin/industries`
- [ ] Implementar tabs: Companies / Documentos / Maestras
- [ ] Vista de industrias sin mapear (ambas fuentes)
- [ ] Funcionalidad de mapeo individual y masivo
- [ ] Métricas y estadísticas

### Fase 4: Filtro de Búsqueda (3-4 horas)
- [ ] Crear RPC `get_search_industry_counts`
- [ ] Modificar RPCs de búsqueda existentes
- [ ] Crear componente `IndustryFilter`
- [ ] Integrar en página de resultados
- [ ] Persistir filtros en URL

### Fase 5: Testing y QA (2-3 horas)
- [ ] Verificar matching de documentos mejorado
- [ ] Probar filtro de búsqueda
- [ ] Validar panel admin
- [ ] Tests de regresión

**Tiempo total estimado: 14-19 horas**

---

## 10. Queries de Verificación

```sql
-- Cobertura de companies
SELECT 
  COUNT(*) FILTER (WHERE master_industry_id IS NOT NULL) as mapeadas,
  COUNT(*) FILTER (WHERE master_industry_id IS NULL AND industry IS NOT NULL) as sin_mapear,
  COUNT(*) FILTER (WHERE industry IS NULL) as sin_industria,
  COUNT(*) as total
FROM companies;

-- Cobertura de document_tags
SELECT 
  COUNT(*) FILTER (WHERE master_industry_id IS NOT NULL) as mapeados,
  COUNT(*) FILTER (WHERE master_industry_id IS NULL) as sin_mapear,
  COUNT(*) as total
FROM document_tags
WHERE tag_type = 'industry';

-- Industrias sin mapear (ambas fuentes)
SELECT 
  original_value,
  source_type,
  CASE 
    WHEN source_type = 'company' THEN (SELECT COUNT(*) FROM companies WHERE LOWER(industry) = LOWER(original_value))
    ELSE (SELECT COUNT(*) FROM document_tags WHERE tag_type = 'industry' AND LOWER(tag_value) = LOWER(original_value))
  END as affected_count
FROM (
  SELECT DISTINCT industry as original_value, 'company' as source_type
  FROM companies c
  WHERE industry IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM industry_mappings im 
      WHERE LOWER(im.original_value) = LOWER(c.industry) 
        AND im.source_type = 'company'
    )
  UNION
  SELECT DISTINCT tag_value as original_value, 'document' as source_type
  FROM document_tags dt
  WHERE tag_type = 'industry'
    AND NOT EXISTS (
      SELECT 1 FROM industry_mappings im 
      WHERE LOWER(im.original_value) = LOWER(dt.tag_value) 
        AND im.source_type = 'document'
    )
) unmapped
ORDER BY affected_count DESC;

-- Distribución por industria maestra
SELECT 
  mi.name,
  COUNT(DISTINCT c.id) as companies,
  COUNT(DISTINCT dt.id) as doc_tags
FROM master_industries mi
LEFT JOIN companies c ON c.master_industry_id = mi.id
LEFT JOIN document_tags dt ON dt.master_industry_id = mi.id AND dt.tag_type = 'industry'
GROUP BY mi.id, mi.name, mi.display_order
ORDER BY mi.display_order;
```

---

## 11. Métricas de Éxito

| Métrica | Objetivo |
|---------|----------|
| Cobertura mapeo companies | >95% |
| Cobertura mapeo documents | >95% |
| Mejora en matching docs | +30% más matches correctos |
| Adopción filtro búsqueda | >20% de búsquedas usan filtro |
| Industrias en "other" | <5% del total |
