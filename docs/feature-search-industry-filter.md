# Feature: Filtro por Industria en Resultados de Búsqueda

## Resumen

Permitir a los usuarios filtrar los resultados de búsqueda (por tecnología o proceso) por industria, después de haber seleccionado el país. Las 358+ industrias originales se unifican en 25 categorías maestras almacenadas en base de datos.

## Estado: Diseño Aprobado
## Fecha: Marzo 2026

---

## 1. Contexto Actual

### Problema
- La tabla `companies` tiene **358 industrias únicas** con alta fragmentación
- Muchas son variantes del mismo concepto (ej: "IT Services and IT Consulting" vs "Information Technology & Services")
- **82% de compañías no tienen industria** (46,004 de 56,319)
- No existe forma de filtrar resultados por industria después de buscar

### Top 20 Industrias Actuales (por volumen)
| Industria Original | Empresas |
|-------------------|----------|
| Information Technology & Services | 3,315 |
| IT Services and IT Consulting | 1,969 |
| Software Development | 1,550 |
| Financial Services | 1,532 |
| Higher Education | 981 |
| Business Consulting and Services | 909 |
| Computer Software | 758 |
| Retail | 693 |
| Construction | 682 |
| Government Administration | 664 |

---

## 2. 25 Industrias Maestras

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

## 3. Modelo de Datos (Opción B: Tabla en DB)

### 3.1 Nueva Tabla: `master_industries`

```sql
CREATE TABLE master_industries (
  id TEXT PRIMARY KEY,                    -- 'technology', 'banking', etc.
  name TEXT NOT NULL,                     -- 'Tecnología y Software'
  icon TEXT NOT NULL,                     -- 'Monitor' (Lucide icon name)
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para ordenamiento
CREATE INDEX idx_master_industries_order ON master_industries(display_order);
```

### 3.2 Nueva Tabla: `industry_mappings`

```sql
CREATE TABLE industry_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_industry TEXT NOT NULL UNIQUE,   -- Valor original de LinkedIn/Apollo
  master_industry_id TEXT REFERENCES master_industries(id),
  is_auto_mapped BOOLEAN DEFAULT FALSE,     -- TRUE si fue mapeado automáticamente
  mapped_at TIMESTAMPTZ DEFAULT NOW(),
  mapped_by UUID REFERENCES auth.users(id)  -- NULL si es seed inicial
);

-- Índices para búsquedas rápidas
CREATE INDEX idx_industry_mappings_original ON industry_mappings(LOWER(original_industry));
CREATE INDEX idx_industry_mappings_master ON industry_mappings(master_industry_id);
```

### 3.3 Modificar Tabla: `companies`

```sql
-- Agregar columna para industria normalizada (computed/cached)
ALTER TABLE companies ADD COLUMN master_industry_id TEXT REFERENCES master_industries(id);

-- Índice para filtrado
CREATE INDEX idx_companies_master_industry ON companies(master_industry_id);

-- Trigger para auto-mapear al insertar/actualizar
CREATE OR REPLACE FUNCTION normalize_company_industry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.industry IS NOT NULL AND NEW.industry != '' THEN
    SELECT master_industry_id INTO NEW.master_industry_id
    FROM industry_mappings
    WHERE LOWER(original_industry) = LOWER(NEW.industry);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_normalize_industry
BEFORE INSERT OR UPDATE OF industry ON companies
FOR EACH ROW
EXECUTE FUNCTION normalize_company_industry();
```

---

## 4. Panel de Administración de Industrias

### 4.1 Ubicación
- Ruta: `/admin/industries`
- Acceso: Solo `superadmin`
- Menú: Debajo de "Usuarios" en sidebar de admin

### 4.2 Vistas del Panel

#### Vista Principal: Dashboard de Industrias

```
┌─────────────────────────────────────────────────────────────────┐
│  Gestión de Industrias                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   358       │  │    312      │  │     46      │             │
│  │ Industrias  │  │  Mapeadas   │  │ Sin Mapear  │             │
│  │  Únicas     │  │   (87%)     │  │   (13%)     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ⚠️ 46 industrias sin mapear                    [Ver todas] ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Industrias Maestras (25)                         [+ Agregar]  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Industria              │ Mapeadas │ Empresas │ Acciones  │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ 🖥️ Tecnología y Software │    32   │  8,432  │ [Editar]  │  │
│  │ 🏦 Servicios Financieros │    12   │  2,121  │ [Editar]  │  │
│  │ 🏛️ Banca                 │     1   │    235  │ [Editar]  │  │
│  │ ...                      │   ...   │   ...   │   ...     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

#### Vista: Industrias Sin Mapear

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Volver    Industrias Sin Mapear (46)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Buscar industria...]                                          │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Industria Original        │ Empresas │ Asignar a         │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ Civic Organizations       │    23    │ [Seleccionar ▼]   │  │
│  │ Sports Management         │    18    │ [Seleccionar ▼]   │  │
│  │ Venture Capital           │    15    │ [Seleccionar ▼]   │  │
│  │ Data Analytics            │    12    │ [Seleccionar ▼]   │  │
│  │ ...                       │   ...    │       ...         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [Mapear seleccionadas]                    [Mapear todas a →]  │
└─────────────────────────────────────────────────────────────────┘
```

#### Vista: Detalle de Industria Maestra

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Volver    Tecnología y Software                   [Guardar] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Nombre: [Tecnología y Software_____]                           │
│  Icono:  [Monitor ▼]                                            │
│  Orden:  [1___]                                                 │
│                                                                 │
│  Industrias Mapeadas (32)                        [+ Agregar]   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ • Information Technology & Services (3,315) [✕]          │  │
│  │ • IT Services and IT Consulting (1,969) [✕]              │  │
│  │ • Software Development (1,550) [✕]                       │  │
│  │ • Computer Software (758) [✕]                            │  │
│  │ • Technology, Information and Internet (542) [✕]         │  │
│  │ • ...                                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ⚠️ Remover una industria la moverá a "Sin Mapear"             │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Funcionalidades del Panel

| Función | Descripción |
|---------|-------------|
| Ver industrias sin mapear | Lista ordenada por cantidad de empresas afectadas |
| Mapear industria individual | Dropdown para seleccionar industria maestra |
| Mapeo masivo | Seleccionar múltiples y asignar a una industria |
| Editar industria maestra | Cambiar nombre, icono, orden |
| Ver mapeos de una industria | Lista de industrias originales mapeadas |
| Remover mapeo | Mover industria a "sin mapear" |
| Agregar industria maestra | Crear nueva categoría (máximo 30) |

### 4.4 API del Panel Admin

```typescript
// GET /api/admin/industries
// Lista todas las industrias maestras con conteos
{
  masterIndustries: [
    { id: 'technology', name: 'Tecnología y Software', mappedCount: 32, companyCount: 8432 },
    ...
  ],
  unmappedCount: 46,
  totalOriginalIndustries: 358
}

// GET /api/admin/industries/unmapped
// Lista industrias sin mapear
{
  unmapped: [
    { originalIndustry: 'Civic Organizations', companyCount: 23 },
    ...
  ]
}

// POST /api/admin/industries/map
// Mapear una o más industrias
{
  mappings: [
    { originalIndustry: 'Civic Organizations', masterIndustryId: 'nonprofit' },
    ...
  ]
}

// DELETE /api/admin/industries/map/:originalIndustry
// Remover mapeo (vuelve a sin mapear)

// PUT /api/admin/industries/:id
// Actualizar industria maestra
{
  name: 'Tecnología y Software',
  icon: 'Monitor',
  displayOrder: 1
}
```

---

## 5. Proceso de Remapeo Automático

### 5.1 Trigger al Mapear

Cuando se agrega un nuevo mapeo en `industry_mappings`:

```sql
CREATE OR REPLACE FUNCTION on_industry_mapping_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Al insertar nuevo mapeo, actualizar companies existentes
  IF TG_OP = 'INSERT' THEN
    UPDATE companies
    SET master_industry_id = NEW.master_industry_id
    WHERE LOWER(industry) = LOWER(NEW.original_industry);
  END IF;
  
  -- Al eliminar mapeo, limpiar master_industry_id
  IF TG_OP = 'DELETE' THEN
    UPDATE companies
    SET master_industry_id = NULL
    WHERE LOWER(industry) = LOWER(OLD.original_industry);
  END IF;
  
  -- Al actualizar mapeo, re-mapear
  IF TG_OP = 'UPDATE' THEN
    UPDATE companies
    SET master_industry_id = NEW.master_industry_id
    WHERE LOWER(industry) = LOWER(NEW.original_industry);
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_industry_mapping_change
AFTER INSERT OR UPDATE OR DELETE ON industry_mappings
FOR EACH ROW
EXECUTE FUNCTION on_industry_mapping_change();
```

### 5.2 Detección de Nuevas Industrias

Job semanal (o al hacer ingesta) que detecta industrias nuevas:

```sql
-- Vista para industrias sin mapear
CREATE VIEW v_unmapped_industries AS
SELECT 
  c.industry as original_industry,
  COUNT(*) as company_count
FROM companies c
LEFT JOIN industry_mappings im ON LOWER(c.industry) = LOWER(im.original_industry)
WHERE c.industry IS NOT NULL 
  AND c.industry != ''
  AND im.id IS NULL
GROUP BY c.industry
ORDER BY company_count DESC;
```

### 5.3 Notificación a Admins

Cuando hay nuevas industrias sin mapear:
- Mostrar badge en sidebar de admin
- Opcional: Email semanal con resumen

---

## 6. Modificaciones a RPCs de Búsqueda

### 6.1 `search_companies_by_process_v2`

```sql
-- Agregar parámetro
p_master_industry_ids TEXT[] DEFAULT NULL

-- Agregar filtro en WHERE
AND (
  p_master_industry_ids IS NULL 
  OR array_length(p_master_industry_ids, 1) = 0
  OR c.master_industry_id = ANY(p_master_industry_ids)
)
```

### 6.2 `search_companies_by_technology_v2`

Misma modificación.

### 6.3 Nueva RPC: `get_search_industry_counts`

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

---

## 7. UI/UX de Búsqueda

### 7.1 Flujo Propuesto

```
[Buscar por Tecnología/Proceso] 
    → [Seleccionar País] 
    → [Filtrar por Industria (opcional)] 
    → [Ver Resultados]
```

### 7.2 Componente de Filtro

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
  isLoading?: boolean;
}

export function IndustryFilter({ 
  availableIndustries, 
  selectedIndustries, 
  onSelectionChange,
  isLoading 
}: IndustryFilterProps) {
  // Multi-select con badges
  // Solo muestra industrias con count > 0
  // Ordenadas por count descendente
}
```

### 7.3 Ubicación del Filtro

- **Desktop**: Panel lateral o dropdown sobre resultados
- **Mobile**: Sheet/Drawer con checkboxes
- **Ambos**: Chips activos mostrando filtros aplicados

---

## 8. Migración de Datos

### 8.1 Script de Seed Inicial

```sql
-- 1. Insertar industrias maestras
INSERT INTO master_industries (id, name, icon, display_order) VALUES
('technology', 'Tecnología y Software', 'Monitor', 1),
('financial_services', 'Servicios Financieros', 'Landmark', 2),
('banking', 'Banca', 'Building2', 3),
-- ... (25 registros)
('other', 'Otras Industrias', 'MoreHorizontal', 25);

-- 2. Insertar mapeos iniciales (358+ registros)
INSERT INTO industry_mappings (original_industry, master_industry_id) VALUES
('Information Technology & Services', 'technology'),
('IT Services and IT Consulting', 'technology'),
-- ... todos los mapeos del documento original
;

-- 3. Backfill master_industry_id en companies
UPDATE companies c
SET master_industry_id = im.master_industry_id
FROM industry_mappings im
WHERE LOWER(c.industry) = LOWER(im.original_industry);
```

### 8.2 Estimación de Impacto

| Métrica | Valor |
|---------|-------|
| Companies con industria original | ~10,315 (18%) |
| Companies que se mapearán | ~9,500 (92% de las que tienen industria) |
| Industrias que quedarán en "other" | ~50 |
| Industrias sin mapear (nuevas) | ~46 |

---

## 9. Fases de Implementación

### Fase 1: Base de Datos (2-3 horas)
- [ ] Crear tablas `master_industries` e `industry_mappings`
- [ ] Agregar columna `master_industry_id` a `companies`
- [ ] Crear triggers de normalización
- [ ] Ejecutar seed inicial con mapeos

### Fase 2: Panel Admin (4-5 horas)
- [ ] Crear página `/admin/industries`
- [ ] Vista de dashboard con métricas
- [ ] Vista de industrias sin mapear
- [ ] Funcionalidad de mapeo individual y masivo
- [ ] Vista de edición de industria maestra

### Fase 3: API de Búsqueda (2-3 horas)
- [ ] Crear RPC `get_search_industry_counts`
- [ ] Modificar `search_companies_by_process_v2`
- [ ] Modificar `search_companies_by_technology_v2`
- [ ] Crear endpoint `/api/search/industries`

### Fase 4: UI de Búsqueda (3-4 horas)
- [ ] Crear componente `IndustryFilter`
- [ ] Integrar en página de resultados
- [ ] Persistir filtros en URL params
- [ ] Tests de UI

**Tiempo total estimado: 11-15 horas**

---

## 10. Queries Útiles

```sql
-- Ver distribución actual
SELECT mi.name, COUNT(c.id) as companies
FROM companies c
JOIN master_industries mi ON mi.id = c.master_industry_id
GROUP BY mi.name
ORDER BY companies DESC;

-- Ver industrias sin mapear
SELECT * FROM v_unmapped_industries LIMIT 20;

-- Verificar cobertura
SELECT 
  COUNT(*) FILTER (WHERE master_industry_id IS NOT NULL) as mapeadas,
  COUNT(*) FILTER (WHERE master_industry_id IS NULL AND industry IS NOT NULL) as sin_mapear,
  COUNT(*) FILTER (WHERE industry IS NULL) as sin_industria
FROM companies;
```

---

## 11. Métricas de Éxito

| Métrica | Objetivo |
|---------|----------|
| Cobertura de mapeo | >95% de industrias mapeadas |
| Adopción del filtro | >20% de búsquedas usan filtro |
| Industrias en "other" | <5% del total |
| Tiempo de respuesta admin | <500ms para operaciones de mapeo |
