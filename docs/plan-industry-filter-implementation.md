# Plan de Implementación: Sistema Unificado de Industrias

## Resumen
Implementar el sistema centralizado de industrias maestras que unifica:
1. Filtro de búsqueda por industria
2. Matching mejorado de documentos
3. Panel de administración para gestión de mapeos

**Documento de diseño**: `/docs/feature-search-industry-filter.md`

---

## Fases de Implementación

### FASE 1: Base de Datos (Scripts SQL)
**Archivos a crear**: `scripts/136_master_industries_schema.sql`

#### 1.1 Crear tablas
- [ ] `master_industries` - 25 categorías maestras
- [ ] `industry_mappings` - Mapeos de valores originales a maestras

#### 1.2 Modificar tablas existentes
- [ ] `companies` - Agregar `master_industry_id`
- [ ] `document_tags` - Agregar `master_industry_id`

#### 1.3 Crear índices
- [ ] `idx_companies_master_industry`
- [ ] `idx_document_tags_master_industry`
- [ ] `idx_industry_mappings_lookup`

#### 1.4 Crear triggers
- [ ] `normalize_company_industry()` - Auto-normaliza al insertar/actualizar company
- [ ] `normalize_document_tag_industry()` - Auto-normaliza tags de documentos
- [ ] `on_industry_mapping_change()` - Propaga cambios al agregar mapeos

#### Tests Fase 1:
```sql
-- Test 1: Verificar tablas creadas
SELECT COUNT(*) FROM master_industries; -- Debe ser 25

-- Test 2: Verificar que no hay errores en estructura
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'companies' AND column_name = 'master_industry_id';

-- Test 3: Verificar triggers existen
SELECT tgname FROM pg_trigger WHERE tgname LIKE '%industry%';
```

---

### FASE 2: Migración de Datos Inicial
**Archivo a crear**: `scripts/137_seed_industry_mappings.sql`

#### 2.1 Insertar mapeos de companies (top 50 más frecuentes)
Mapeos prioritarios basados en análisis:
- "Information Technology & Services" → technology
- "Financial Services" → financial_services
- "Banking" → banking
- "Hospital & Health Care" → healthcare
- (... ~50 mapeos iniciales)

#### 2.2 Insertar mapeos de document_tags
Basado en tags existentes en `document_tags WHERE tag_type = 'industry'`

#### 2.3 Ejecutar normalización inicial
```sql
-- Propagar mapeos a companies existentes
UPDATE companies c
SET master_industry_id = im.master_industry_id
FROM industry_mappings im
WHERE LOWER(c.industry) = LOWER(im.original_value)
  AND im.source_type = 'company';

-- Propagar a document_tags existentes
UPDATE document_tags dt
SET master_industry_id = im.master_industry_id
FROM industry_mappings im
WHERE dt.tag_type = 'industry'
  AND LOWER(dt.tag_value) = LOWER(im.original_value)
  AND im.source_type = 'document';
```

#### Tests Fase 2:
```sql
-- Test 1: Verificar mapeos creados
SELECT COUNT(*) FROM industry_mappings WHERE source_type = 'company'; -- ~50+

-- Test 2: Verificar companies normalizadas
SELECT COUNT(*) FROM companies WHERE master_industry_id IS NOT NULL;

-- Test 3: Verificar document_tags normalizados
SELECT COUNT(*) FROM document_tags 
WHERE tag_type = 'industry' AND master_industry_id IS NOT NULL;

-- Test 4: Verificar que Banking → banking
SELECT master_industry_id FROM companies WHERE industry = 'Banking' LIMIT 1;
-- Debe ser 'banking'
```

---

### FASE 3: Panel de Administración
**Archivos a crear**:
- `app/admin/industries/page.tsx`
- `components/admin/industry-management-dashboard.tsx`
- `app/api/admin/industries/stats/route.ts`
- `app/api/admin/industries/unmapped/route.ts`
- `app/api/admin/industries/map/route.ts`
- `app/api/admin/industries/master/route.ts`

#### 3.1 API Endpoints

**GET `/api/admin/industries/stats`**
```typescript
// Response
{
  masterIndustries: 25,
  companyMappings: { total: 358, mapped: 312, unmapped: 46 },
  documentMappings: { total: 42, mapped: 34, unmapped: 8 }
}
```

**GET `/api/admin/industries/unmapped?source=company|document|all`**
```typescript
// Response
{
  unmapped: [
    { originalValue: "Civic Organizations", sourceType: "company", count: 23 },
    { originalValue: "Fintech", sourceType: "document", count: 5 }
  ]
}
```

**POST `/api/admin/industries/map`**
```typescript
// Request
{
  mappings: [
    { originalValue: "Civic Organizations", sourceType: "company", masterIndustryId: "nonprofit" }
  ]
}
```

#### 3.2 UI Components
- Dashboard con métricas (cards)
- Tabs: Companies | Documentos | Industrias Maestras
- Tabla de industrias sin mapear con dropdown para asignar
- Bulk mapping (seleccionar varios + asignar)
- Lista de industrias maestras con conteos

#### Tests Fase 3:
- [ ] GET /stats retorna datos correctos
- [ ] GET /unmapped filtra por source_type
- [ ] POST /map crea mapping y propaga a companies/docs
- [ ] Solo superadmin puede acceder
- [ ] UI muestra datos y permite mapear

---

### FASE 4: Integración con Matching de Documentos
**Archivo a modificar**: `lib/documents/rank-documents-for-bookmark.ts`

#### 4.1 Actualizar lógica de scoring
```typescript
// Antes
const industryMatch = docTags.some(
  tag => tag.tag_type === 'industry' && 
         tag.tag_value.toLowerCase() === company.industry?.toLowerCase()
);

// Después
const industryMatch = docTags.some(
  tag => tag.tag_type === 'industry' && 
         tag.master_industry_id != null &&
         tag.master_industry_id === company.master_industry_id
);
```

#### 4.2 Actualizar queries que traen document_tags
Incluir `master_industry_id` en los selects

#### Tests Fase 4:
```typescript
// Test 1: Company "Banking" matchea con Doc tag "Financial Services"
// Ambos deben tener master_industry_id que coincida o esté relacionado

// Test 2: Score de documento aumenta si hay match por master_industry_id

// Test 3: Fallback funciona si master_industry_id es null (usa string match)
```

---

### FASE 5: Filtro de Búsqueda por Industria
**Archivos a crear/modificar**:
- `scripts/138_search_industry_rpcs.sql` - RPCs para filtro
- `components/search/industry-filter.tsx` - Componente UI
- Modificar `app/actions/search-v2.ts` - Agregar parámetro industria
- Modificar componentes de búsqueda existentes

#### 5.1 Nueva RPC: `get_search_industry_counts`
```sql
-- Retorna industrias disponibles con conteo para un filtro dado
SELECT master_industry_id, name, icon, COUNT(*) as company_count
FROM companies c
JOIN signals s ON s.company_id = c.id
JOIN master_industries mi ON mi.id = c.master_industry_id
WHERE s.signal_id = $1 AND c.country = $2
GROUP BY mi.id, mi.name, mi.icon
HAVING COUNT(*) > 0
ORDER BY company_count DESC;
```

#### 5.2 Modificar RPCs de búsqueda existentes
Agregar parámetro `p_master_industry_ids TEXT[]` a:
- `search_companies_by_process_v2`
- `search_companies_by_technology_v2`

#### 5.3 Componente UI
```tsx
<IndustryFilter
  availableIndustries={industries}
  selectedIndustries={selected}
  onSelectionChange={setSelected}
/>
```
- Aparece después de seleccionar país
- Multi-select con checkboxes
- Solo muestra industrias con count > 0
- Chips de filtros activos con "X" para remover

#### Tests Fase 5:
- [ ] RPC retorna industrias con conteos correctos
- [ ] Filtro reduce resultados correctamente
- [ ] Multi-select funciona
- [ ] "Limpiar filtros" funciona
- [ ] Si no hay industrias con resultados, no muestra el filtro

---

## Edge Cases y Consideraciones

### Edge Case 1: Industria nueva sin mapeo
**Escenario**: Se ingesta una company con `industry = "Quantum Computing"`
**Comportamiento esperado**: 
- `master_industry_id` queda NULL
- Aparece en panel admin como "Sin mapear"
- La company sigue siendo buscable pero no aparece en filtro de industria

### Edge Case 2: Documento con tag de industria no mapeado
**Escenario**: Usuario sube doc con tag `industry = "Fintech"`
**Comportamiento esperado**:
- `master_industry_id` queda NULL
- Aparece en panel admin
- Matching por industria no funciona hasta mapear, pero otros matches (tech, proceso) sí

### Edge Case 3: Cambio de mapeo existente
**Escenario**: Admin cambia "Fintech" de `banking` a `technology`
**Comportamiento esperado**:
- Trigger propaga cambio a todas las companies/docs con ese valor
- Búsquedas reflejan nuevo filtro inmediatamente

### Edge Case 4: Company sin industria
**Escenario**: `company.industry = NULL`
**Comportamiento esperado**:
- `master_industry_id` = NULL
- No aparece en ningún filtro de industria
- Sigue siendo buscable por tech/proceso

### Edge Case 5: Múltiples variantes del mismo nombre
**Escenario**: "IT Services", "IT services", "it services"
**Comportamiento esperado**:
- Lookup es case-insensitive (`LOWER()`)
- Un solo mapeo cubre todas las variantes

### Edge Case 6: Industria maestra eliminada
**Comportamiento**: No permitir eliminar si tiene mapeos activos
```sql
-- Constraint o check en API
SELECT COUNT(*) FROM industry_mappings WHERE master_industry_id = $1;
-- Si > 0, no permitir eliminar
```

### Edge Case 7: Performance con muchas companies
**Escenario**: 50,000+ companies en una búsqueda
**Mitigación**:
- Índices en `master_industry_id`
- RPC usa `HAVING COUNT(*) > 0` para no retornar industrias vacías
- Límite de 25 industrias maestras mantiene UI manejable

### Edge Case 8: Documento con múltiples tags de industria
**Escenario**: Doc tiene tags "Banking" Y "Financial Services"
**Comportamiento esperado**:
- Cada tag se normaliza independientemente
- Match ocurre si CUALQUIER tag matchea con la company

---

## Rollback Plan

### Si falla Fase 1 (Schema):
```sql
-- Eliminar triggers primero
DROP TRIGGER IF EXISTS trg_normalize_company_industry ON companies;
DROP TRIGGER IF EXISTS trg_normalize_document_industry ON document_tags;
DROP TRIGGER IF EXISTS trg_industry_mapping_propagate ON industry_mappings;

-- Eliminar funciones
DROP FUNCTION IF EXISTS normalize_company_industry();
DROP FUNCTION IF EXISTS normalize_document_tag_industry();
DROP FUNCTION IF EXISTS on_industry_mapping_change();

-- Eliminar columnas
ALTER TABLE companies DROP COLUMN IF EXISTS master_industry_id;
ALTER TABLE document_tags DROP COLUMN IF EXISTS master_industry_id;

-- Eliminar tablas
DROP TABLE IF EXISTS industry_mappings;
DROP TABLE IF EXISTS master_industries;
```

### Si falla Fase 2 (Migración):
```sql
TRUNCATE industry_mappings;
UPDATE companies SET master_industry_id = NULL;
UPDATE document_tags SET master_industry_id = NULL WHERE tag_type = 'industry';
```

### Si falla Fase 3-5 (Código):
- Revertir commits de código
- Datos en DB pueden quedarse (no afectan funcionamiento actual)

---

## Checklist Pre-Deploy

### Antes de Fase 1:
- [ ] Backup de tablas `companies` y `document_tags`
- [ ] Verificar que no hay transacciones largas corriendo
- [ ] Notificar equipo de posible downtime corto

### Antes de Fase 2:
- [ ] Fase 1 ejecutada sin errores
- [ ] Verificar mapeos en documento de diseño están completos

### Antes de Fase 3:
- [ ] Fase 2 ejecutada y verificada
- [ ] Verificar que panel admin existente funciona

### Antes de Fase 4:
- [ ] Panel admin permite mapear correctamente
- [ ] Al menos 80% de industrias de companies están mapeadas

### Antes de Fase 5:
- [ ] Matching de documentos funciona con master_industry_id
- [ ] Tests de matching pasan

### Post-Deploy Final:
- [ ] Verificar búsqueda funciona con y sin filtro de industria
- [ ] Verificar nuevas companies se normalizan automáticamente
- [ ] Verificar panel admin muestra métricas correctas
- [ ] Monitorear performance de queries por 24h

---

## Orden de Ejecución

```
Día 1:
├── Script 136: Crear schema (tablas, columnas, índices, triggers)
├── Verificar: Triggers funcionan con INSERT de prueba
├── Script 137: Seed mapeos iniciales
└── Verificar: Companies normalizadas correctamente

Día 2:
├── Deploy código: Panel admin + APIs
├── Verificar: Panel muestra datos correctos
├── Mapear: Industrias faltantes manualmente desde panel
└── Verificar: 80%+ companies tienen master_industry_id

Día 3:
├── Deploy código: Matching de documentos actualizado
├── Verificar: Docs matchean correctamente
├── Script 138: RPCs de búsqueda
├── Deploy código: Filtro de búsqueda UI
└── Test E2E: Flujo completo de búsqueda con filtro

Día 4:
├── QA completo
├── Fix de bugs encontrados
└── Deploy a producción
```

---

## Estimación de Tiempo

| Fase | Tiempo Estimado | Dependencias |
|------|-----------------|--------------|
| Fase 1: Schema SQL | 1-2 horas | Ninguna |
| Fase 2: Migración datos | 1-2 horas | Fase 1 |
| Fase 3: Panel admin | 4-6 horas | Fase 2 |
| Fase 4: Matching docs | 1-2 horas | Fase 3 |
| Fase 5: Filtro búsqueda | 3-4 horas | Fase 4 |
| Testing & QA | 2-3 horas | Fase 5 |
| **Total** | **12-19 horas** | |

---

## Métricas de Éxito

1. **Cobertura de mapeo**: >90% de companies con industria tienen `master_industry_id`
2. **Mejora de matching**: Documentos matchean 30%+ más empresas por industria
3. **Uso de filtro**: >50% de búsquedas usan filtro de industria después de 1 semana
4. **Performance**: Queries de búsqueda <500ms con filtro de industria
5. **Admin**: Nuevas industrias sin mapear <10 por semana (fácil de gestionar)
