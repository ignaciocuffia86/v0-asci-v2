# Plan de Implementación: Filtro por Industria en Búsquedas

## Fecha: Enero 2026
## Estado: Planificación

---

## 1. ANÁLISIS DEL ESTADO ACTUAL

### Datos Relevantes
| Métrica | Valor |
|---------|-------|
| Total de compañías | 56,319 |
| Compañías CON industria | 10,315 (18%) |
| Compañías SIN industria | 46,004 (82%) |
| Industrias únicas actuales | 172 |

### Problema Principal
- **82% de compañías no tienen industria** - Este es el mayor desafío
- **172 industrias** es demasiado para un dropdown útil (objetivo: ~25-30)
- **Industrias duplicadas** por diferencias de formato (ej: "Wine & Spirits" vs "Wine and Spirits")
- **Sin normalización** - cada ingesta trae el valor raw de LinkedIn/Apollo

### Top 20 Industrias Actuales (por cantidad de compañías)
| # | Industria | Compañías |
|---|-----------|-----------|
| 1 | Information Technology & Services | 1,419 |
| 2 | Computer Software | 594 |
| 3 | Financial Services | 589 |
| 4 | Higher Education | 366 |
| 5 | Automotive | 317 |
| 6 | Management Consulting | 299 |
| 7 | Construction | 287 |
| 8 | Food & Beverages | 286 |
| 9 | Government Administration | 274 |
| 10 | Retail | 271 |
| 11 | Transportation/Trucking/Railroad | 270 |
| 12 | Insurance | 253 |
| 13 | Banking | 235 |
| 14 | Oil & Energy | 228 |
| 15 | Hospital & Health Care | 208 |
| 16 | Pharmaceuticals | 205 |
| 17 | Food Production | 200 |
| 18 | Telecommunications | 198 |
| 19 | Human Resources | 187 |
| 20 | Consumer Goods | 173 |

---

## 2. PROPUESTA DE CATEGORÍAS NORMALIZADAS (~25 categorías)

### Categorías Propuestas y Mapeo

| ID | Categoría Normalizada | Industrias Originales que Agrupa |
|----|----------------------|----------------------------------|
| 1 | **Tecnología** | Information Technology & Services, Computer Software, Computer Hardware, Internet, Semiconductors, Computer & Network Security, Computer Games, IT Services and IT Consulting, Software Development, Technology Information and Internet |
| 2 | **Servicios Financieros** | Financial Services, Banking, Insurance, Investment Banking, Investment Management, Venture Capital & Private Equity, Capital Markets |
| 3 | **Salud y Farmacéutica** | Hospital & Health Care, Pharmaceuticals, Medical Device, Biotechnology, Health Wellness & Fitness, Mental Health Care, Medical Practice, Hospitals and Health Care, Medical Equipment Manufacturing, Veterinary |
| 4 | **Manufactura Industrial** | Mechanical Or Industrial Engineering, Industrial Automation, Machinery, Electrical & Electronic Manufacturing, Plastics, Glass Ceramics & Concrete, Building Materials |
| 5 | **Automotriz** | Automotive, Motor Vehicle Manufacturing |
| 6 | **Energía y Utilities** | Oil & Energy, Utilities, Renewables & Environment, Energy & Utilities |
| 7 | **Consumo Masivo** | Consumer Goods, Food & Beverages, Food Production, Consumer Electronics, Cosmetics, Apparel & Fashion, Luxury Goods & Jewelry, Wine & Spirits, Dairy, Personal Care Product Manufacturing, Retail Apparel and Fashion |
| 8 | **Retail y Comercio** | Retail, Wholesale, Supermarkets, E-learning (comercio digital) |
| 9 | **Construcción e Inmobiliaria** | Construction, Real Estate, Civil Engineering, Architecture & Planning, Commercial Real Estate |
| 10 | **Transporte y Logística** | Transportation/Trucking/Railroad, Airlines/Aviation, Logistics & Supply Chain, Package/Freight Delivery, Maritime, Warehousing, Shipbuilding, Transportation Logistics Supply Chain and Storage |
| 11 | **Telecomunicaciones** | Telecommunications, Wireless |
| 12 | **Educación** | Higher Education, Education Management, Primary/Secondary Education, E-learning, Professional Training & Coaching |
| 13 | **Gobierno y Sector Público** | Government Administration, Public Policy, Public Safety, Military, Judiciary, Law Enforcement, Government Relations |
| 14 | **Consultoría y Servicios Profesionales** | Management Consulting, Accounting, Law Practice, Legal Services, Business Consulting and Services, Consulting |
| 15 | **Recursos Humanos** | Human Resources, Staffing & Recruiting, Outsourcing/Offshoring, Human Resources Services |
| 16 | **Marketing y Publicidad** | Marketing & Advertising, Public Relations & Communications, Market Research, Advertising Services |
| 17 | **Medios y Entretenimiento** | Entertainment, Broadcast Media, Media Production, Online Media, Music, Publishing, Newspapers, Animation, Performing Arts, Spectator Sports, Sports |
| 18 | **Agricultura y Alimentos** | Farming, Fishery, Ranching, Food and Beverage Manufacturing, Food and Beverage Services |
| 19 | **Minería y Químicos** | Mining & Metals, Chemicals, Paper & Forest Products |
| 20 | **ONGs y Organizaciones Sociales** | Non-profit Organization Management, Civic & Social Organization, Individual & Family Services, Religious Institutions, Fundraising |
| 21 | **Hotelería y Turismo** | Hospitality, Leisure Travel & Tourism, Restaurants, Gambling & Casinos, Recreational Facilities & Services |
| 22 | **Seguridad** | Security & Investigations, Defense & Space, Aviation & Aerospace |
| 23 | **Servicios Ambientales** | Environmental Services |
| 24 | **Investigación y Desarrollo** | Research, Research Services, Think Tanks |
| 25 | **Otros Servicios** | Consumer Services, Facilities Services, Events Services, Translation & Localization, Design, Graphic Design, Photography, Fine Art, Writing & Editing, Printing, Libraries, Museums & Institutions |

---

## 3. DISEÑO DE LA SOLUCIÓN

### 3.1 Nueva Tabla: `industry_categories`

```sql
CREATE TABLE industry_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,           -- "Tecnología", "Salud y Farmacéutica", etc.
  slug TEXT NOT NULL UNIQUE,           -- "tecnologia", "salud-farmaceutica"
  icon TEXT,                           -- Opcional: nombre de icono de Lucide
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 Nueva Tabla: `industry_mappings`

```sql
CREATE TABLE industry_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_industry TEXT NOT NULL UNIQUE,  -- Valor original de LinkedIn/Apollo
  category_id UUID REFERENCES industry_categories(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.3 Modificar Tabla: `companies`

```sql
ALTER TABLE companies 
ADD COLUMN industry_category_id UUID REFERENCES industry_categories(id);

-- Índice para búsquedas
CREATE INDEX idx_companies_industry_category ON companies(industry_category_id);
```

### 3.4 Función de Normalización

```sql
CREATE OR REPLACE FUNCTION normalize_company_industry()
RETURNS TRIGGER AS $$
BEGIN
  -- Cuando se inserta/actualiza una compañía, buscar el mapeo
  IF NEW.industry IS NOT NULL THEN
    SELECT category_id INTO NEW.industry_category_id
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

## 4. MODIFICACIONES A RPCs DE BÚSQUEDA

### 4.1 `search_companies_by_process_v2`

Agregar parámetro opcional `p_industry_category_ids UUID[]`:

```sql
-- Nuevo parámetro
p_industry_category_ids UUID[] DEFAULT NULL

-- Nuevo filtro en WHERE
AND (
  p_industry_category_ids IS NULL 
  OR array_length(p_industry_category_ids, 1) = 0
  OR c.industry_category_id = ANY(p_industry_category_ids)
)
```

### 4.2 `search_companies_by_technology_v2`

Misma modificación que proceso.

### 4.3 Nueva RPC: `get_industry_categories_with_counts`

```sql
CREATE FUNCTION get_industry_categories_with_counts(
  p_filter_type TEXT DEFAULT NULL,  -- 'process' o 'technology'
  p_signal_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  icon TEXT,
  company_count BIGINT
) AS $$
  -- Retorna categorías con conteo de compañías que tienen señales
$$;
```

---

## 5. MODIFICACIONES EN FRONTEND

### 5.1 Componente: `IndustryFilter`

Nuevo componente con:
- Multi-select de categorías
- Badges con conteo de compañías
- Opción "Todas las industrias"
- Responsive (accordion en mobile)

### 5.2 Modificar: `SearchFilters` o panel de búsqueda

- Agregar `IndustryFilter` debajo de la barra de búsqueda principal
- Integrar con estado de búsqueda existente

### 5.3 Modificar: Actions de búsqueda

- `search-v2.ts`: Agregar parámetro `industryCategories`
- Pasar a las RPCs correspondientes

---

## 6. MIGRACIÓN DE DATOS EXISTENTES

### 6.1 Script de Migración

1. Crear tabla `industry_categories` con las 25 categorías
2. Crear tabla `industry_mappings` con los 172 mapeos
3. Agregar columna `industry_category_id` a `companies`
4. Ejecutar UPDATE masivo para categorizar compañías existentes

### 6.2 Estimación de Impacto

- Compañías que se categorizarán: ~10,315 (las que tienen industria)
- Compañías sin categoría: ~46,004 (seguirán sin industria)
- Tiempo estimado de migración: < 1 minuto

---

## 7. CONSIDERACIONES Y DESAFÍOS

### 7.1 Desafío: 82% sin industria

**Opciones:**
1. **No hacer nada** - El filtro solo afecta al 18% con industria
2. **Enriquecer datos** - Usar API de Apollo/LinkedIn para obtener industria faltante
3. **Inferir por dominio** - Usar servicios como Clearbit para inferir industria
4. **Categoría "Sin clasificar"** - Mostrar opción explícita

**Recomendación:** Opción 1 + 4 inicialmente, luego considerar enriquecimiento.

### 7.2 Desafío: Nuevas industrias no mapeadas

**Solución:**
- Función de normalización con fallback a NULL
- Dashboard de admin para ver industrias sin mapear
- Job periódico para alertar sobre nuevas industrias

### 7.3 Desafío: Performance

**Mitigación:**
- Índice en `industry_category_id`
- Filtro es opcional (no afecta queries sin filtro)
- Conteos pre-calculados si es necesario

---

## 8. PLAN DE IMPLEMENTACIÓN

### Fase 1: Base de Datos (1-2 horas)
- [ ] Crear script SQL con tablas y datos
- [ ] Ejecutar migración
- [ ] Verificar normalización

### Fase 2: RPCs de Búsqueda (2-3 horas)
- [ ] Modificar `search_companies_by_process_v2`
- [ ] Modificar `search_companies_by_technology_v2`
- [ ] Crear `get_industry_categories_with_counts`
- [ ] Tests de queries

### Fase 3: Backend Actions (1-2 horas)
- [ ] Modificar `search-v2.ts`
- [ ] Agregar types para industrias
- [ ] Crear action para obtener categorías

### Fase 4: Frontend (3-4 horas)
- [ ] Crear componente `IndustryFilter`
- [ ] Integrar en página de búsqueda
- [ ] Tests de UI

### Fase 5: Admin y Monitoreo (1-2 horas)
- [ ] Vista para ver industrias sin mapear
- [ ] Vista para agregar nuevos mapeos

**Tiempo total estimado: 8-13 horas**

---

## 9. CHECKLIST PRE-IMPLEMENTACIÓN

- [ ] Revisar y aprobar las 25 categorías propuestas
- [ ] Validar mapeos de industrias
- [ ] Definir comportamiento cuando no hay industria (mostrar o no en filtro)
- [ ] Definir si el filtro es inclusivo o exclusivo con "Sin clasificar"

---

## 10. QUERIES ÚTILES PARA VALIDACIÓN

```sql
-- Ver compañías por categoría después de migración
SELECT ic.name, COUNT(c.id) as company_count
FROM companies c
JOIN industry_categories ic ON ic.id = c.industry_category_id
GROUP BY ic.name
ORDER BY company_count DESC;

-- Ver industrias sin mapear
SELECT DISTINCT c.industry
FROM companies c
LEFT JOIN industry_mappings im ON LOWER(c.industry) = LOWER(im.original_industry)
WHERE c.industry IS NOT NULL 
AND im.id IS NULL;

-- Conteo de compañías con/sin categoría
SELECT 
  COUNT(*) FILTER (WHERE industry_category_id IS NOT NULL) as con_categoria,
  COUNT(*) FILTER (WHERE industry_category_id IS NULL) as sin_categoria
FROM companies;
```
