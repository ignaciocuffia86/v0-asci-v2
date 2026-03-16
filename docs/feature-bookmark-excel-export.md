# Feature: Export de Bookmark a Excel

## Resumen
Permitir a los usuarios exportar la información de un bookmark (o múltiples bookmarks) a un archivo Excel para armar un "perfil" de la compañía.

## Ubicaciones de Acceso

1. **Desde dentro del bookmark** - Botón de export en la vista detalle del bookmark
2. **Desde la vista Kanban** - Acción en el menú de cada card o selección múltiple
3. **Desde la vista Lista** - Acción en el menú de cada fila o selección múltiple

---

## Estructura del Excel

### Hoja 1: "Información General"

| Campo | Fuente | Notas |
|-------|--------|-------|
| Nombre de la cuenta | `companies.name` | |
| País | `companies.country` | |
| Industria | `companies.industry` | |
| Website | `companies.website` | |
| LinkedIn | `companies.linkedin_url` | |
| Filtro aplicado | `bookmarks.search_context` | JSON con tecnología/proceso usado para encontrar la cuenta |
| Estado del bookmark | `bookmarks.status` | lead, contacted, qualified, proposal, won, lost |
| Prioridad | `bookmarks.priority` | high, medium, low |
| Notas | `bookmarks.notes` | |
| Fecha de bookmark | `bookmarks.created_at` | |

### Hoja 2: "Empleados con Señales"

Señales de tipo `technology` o `process` donde `is_current_employee = true`, agrupadas por contacto.

| Campo | Fuente | Notas |
|-------|--------|-------|
| Nombre | `contacts.first_name` | |
| Apellido | `contacts.last_name` | |
| Cargo Actual | `contacts.current_position_title` | |
| Email | `contacts.email1` | Email principal |
| LinkedIn | `contacts.linkedin_url` | |
| Señal Detectada | `signals.keyword_matched` | La tecnología/proceso detectado |
| Fuente de Señal | `signals.source_field` | Ej: "headline", "about", "experience" |
| Snippet | `signals.snippet` | Extracto donde se encontró la señal |

**Query base:**
```sql
SELECT DISTINCT ON (c.id)
  c.first_name,
  c.last_name,
  c.current_position_title,
  c.email1,
  c.linkedin_url,
  s.keyword_matched,
  s.source_field,
  s.snippet
FROM signals s
JOIN contacts c ON s.contact_id = c.id
WHERE s.company_id = :company_id
  AND s.is_current_employee = true
  AND s.signal_type IN ('technology', 'process')
ORDER BY c.id, s.created_at DESC
```

### Hoja 3: "Job Postings"

Job postings activos de la compañía que tienen señales relacionadas con el filtro del bookmark.

| Campo | Fuente | Notas |
|-------|--------|-------|
| Título del Puesto | `job_postings.title` | |
| Link | `job_postings.posting_url` | |
| Ubicación | `job_postings.location` | |
| Fecha de Publicación | `job_postings.posted_at` | |
| Señales Detectadas | Agregado de `signals.keyword_matched` | Lista de tecnologías/procesos encontrados |
| Activo | `job_postings.is_active` | |

**Query base:**
```sql
SELECT 
  jp.title,
  jp.posting_url,
  jp.location,
  jp.posted_at,
  jp.is_active,
  ARRAY_AGG(DISTINCT s.keyword_matched) as signals_detected
FROM job_postings jp
LEFT JOIN signals s ON s.job_posting_id = jp.id
WHERE jp.company_id = :company_id
GROUP BY jp.id
ORDER BY jp.posted_at DESC
```

### Hoja 4: "Prospectos (Apollo)"

Contactos obtenidos via Apollo para esta cuenta.

| Campo | Fuente | Notas |
|-------|--------|-------|
| Nombre | `user_company_contacts.first_name` | |
| Apellido | `user_company_contacts.last_name` | |
| Cargo | `user_company_contacts.headline` o `role` | |
| Email | `user_company_contacts.email` | |
| Estado del Email | `user_company_contacts.email_status` | verified, unverified, etc. |
| LinkedIn | `user_company_contacts.linkedin_url` | |
| Teléfono | `user_company_contacts.phone` | |
| Seniority | `user_company_contacts.seniority` | |
| Es Decision Maker | `user_company_contacts.is_decision_maker` | |
| Departamentos | `user_company_contacts.departments` | JSON array |

**Query base:**
```sql
SELECT 
  first_name,
  last_name,
  headline,
  email,
  email_status,
  linkedin_url,
  phone,
  mobile_phone,
  seniority,
  is_decision_maker,
  departments
FROM user_company_contacts
WHERE bookmark_id = :bookmark_id
  AND user_id = :user_id
ORDER BY is_decision_maker DESC, seniority, last_name
```

---

## Modelo de Datos para el Export

```typescript
interface BookmarkExportData {
  // Hoja 1
  company: {
    name: string
    country: string | null
    industry: string | null
    website: string | null
    linkedin_url: string | null
  }
  bookmark: {
    status: string
    priority: string
    notes: string | null
    search_context: {
      type: 'technology' | 'process'
      name: string
      keywords: string[]
    } | null
    created_at: string
  }
  
  // Hoja 2
  employees_with_signals: Array<{
    first_name: string
    last_name: string
    current_position_title: string | null
    email: string | null
    linkedin_url: string | null
    signal_keyword: string
    signal_source: string
    signal_snippet: string | null
  }>
  
  // Hoja 3
  job_postings: Array<{
    title: string
    posting_url: string | null
    location: string | null
    posted_at: string | null
    is_active: boolean
    signals_detected: string[]
  }>
  
  // Hoja 4
  prospects: Array<{
    first_name: string
    last_name: string
    headline: string | null
    email: string | null
    email_status: string | null
    linkedin_url: string | null
    phone: string | null
    seniority: string | null
    is_decision_maker: boolean
    departments: string[]
  }>
}
```

---

## API Endpoint

### Single Bookmark Export
```
GET /api/bookmarks/[id]/export
```

### Bulk Export (múltiples bookmarks)
```
POST /api/bookmarks/export
Body: { bookmark_ids: string[] }
```

### Response
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Content-Disposition: `attachment; filename="[company_name]_profile.xlsx"`

---

## Dependencias Sugeridas

```json
{
  "exceljs": "^4.4.0"
}
```

**Alternativas consideradas:**
- `xlsx` (SheetJS) - Más liviano pero menos features
- `xlsx-populate` - Bueno para templates
- **`exceljs`** - Recomendado: soporte completo de estilos, streaming, y buen mantenimiento

---

## Flujo de Usuario

### Desde el Bookmark Detail
1. Usuario abre un bookmark
2. Click en botón "Exportar a Excel" (icono de download)
3. Se genera el archivo y descarga automáticamente

### Desde Kanban/Lista
1. Usuario selecciona uno o más bookmarks (checkbox)
2. Aparece barra de acciones con "Exportar seleccionados"
3. Click genera un Excel con múltiples hojas o un ZIP con múltiples archivos

---

## Consideraciones de Performance

1. **Para exports grandes (>1000 contactos):**
   - Usar streaming de exceljs
   - Limitar a 10,000 filas por hoja
   
2. **Para bulk export:**
   - Máximo 50 bookmarks por request
   - Considerar job async para exports muy grandes

3. **Caching:**
   - No cachear el export (datos deben ser frescos)
   - Pero sí usar las queries optimizadas existentes

---

## Seguridad

1. Validar que el usuario tenga acceso al bookmark (`user_id` match)
2. Solo exportar prospectos del propio usuario (`user_company_contacts.user_id`)
3. Rate limiting: máximo 10 exports por minuto por usuario

---

## Tracking/Analytics

Registrar en `debug_events`:
```json
{
  "event_type": "bookmark_export",
  "details": {
    "bookmark_id": "uuid",
    "company_name": "string",
    "employees_count": number,
    "job_postings_count": number,
    "prospects_count": number,
    "export_format": "xlsx"
  }
}
```

---

## UI Components Necesarios

1. **ExportButton** - Botón reutilizable con loading state
2. **BulkExportBar** - Barra de acciones para selección múltiple
3. **ExportProgressModal** - Para exports grandes (opcional, v2)

---

## Fases de Implementación

### Fase 1: MVP
- [ ] Endpoint `/api/bookmarks/[id]/export`
- [ ] Botón de export en bookmark detail
- [ ] Las 4 hojas básicas

### Fase 2: Bulk Export
- [ ] Selección múltiple en Kanban
- [ ] Selección múltiple en Lista
- [ ] Endpoint POST para bulk

### Fase 3: Mejoras
- [ ] Filtros en el export (ej: solo prospectos verificados)
- [ ] Templates personalizados
- [ ] Export a Google Sheets (integración)
