# Feature: Cambiar Filtro de Señales en Bookmark

## Resumen

Permitir a los usuarios cambiar o asignar un filtro de señales (tecnología o proceso) a un bookmark existente, incluso si fue creado sin filtro inicial (búsqueda directa por empresa).

## Contexto Actual

### Estructura de `search_context` en Bookmarks

```jsonb
{
  "filterType": "technology" | "process" | null,
  "filtersUsed": {
    "technology": ["Oracle Forms", "AWS", ...],
    "process": ["Recursos Humanos", ...],
    "countries": ["Argentina", ...]
  },
  "filterSignalIds": ["uuid-1", "uuid-2", ...],  // IDs de dictionary_products o dictionary_processes
  "last_news_search": "2026-02-01T08:01:00.642Z",
  "last_implementations_search": "2025-11-28T13:18:05.587Z"
}
```

### Tipos de Bookmarks Actuales

1. **Con filtro**: Creado desde búsqueda por señal (technology/process)
   - `search_context` tiene `filterType`, `filtersUsed`, y `filterSignalIds`
   
2. **Sin filtro**: Creado desde búsqueda directa por empresa
   - `search_context` puede ser `null` o `{}`

---

## Diseño Propuesto

### 1. Modelo de Datos

**No se requieren cambios de schema.** El campo `search_context` JSONB ya soporta la estructura necesaria.

#### Extensión del `search_context`

```typescript
interface BookmarkSearchContext {
  // Filtro principal activo
  filterType: 'technology' | 'process' | null;
  
  // Filtros aplicados (nombres legibles)
  filtersUsed: {
    technology?: string[];
    process?: string[];
    countries?: string[];
  };
  
  // IDs de diccionario para los filtros
  filterSignalIds: string[];
  
  // Historial de filtros (NUEVO - opcional para auditoría)
  filterHistory?: {
    changedAt: string;
    previousFilterType: string | null;
    previousFilterSignalIds: string[];
    changedBy: 'user' | 'system';
  }[];
  
  // Timestamps de búsquedas
  last_news_search?: string;
  last_implementations_search?: string;
}
```

### 2. Lógica de Negocio

#### Obtener Señales Disponibles para un Bookmark

Para mostrar qué filtros puede elegir el usuario, necesitamos obtener las señales **activas** de la empresa:

```sql
-- RPC: get_available_signals_for_bookmark(p_bookmark_id UUID)
SELECT DISTINCT
  s.signal_type,
  COALESCE(dp.id, dpr.id) as signal_id,
  COALESCE(dp.name, dpr.name, s.keyword_matched) as signal_name,
  COUNT(DISTINCT s.id) as signal_count,
  COUNT(DISTINCT s.job_posting_id) FILTER (WHERE s.job_posting_id IS NOT NULL) as job_posting_count,
  COUNT(DISTINCT s.contact_id) FILTER (WHERE s.contact_id IS NOT NULL) as contact_count
FROM signals s
JOIN bookmarks b ON s.company_id = b.company_id
LEFT JOIN dictionary_products dp ON s.signal_id = dp.id AND s.signal_type = 'technology'
LEFT JOIN dictionary_processes dpr ON s.signal_id = dpr.id AND s.signal_type = 'process'
WHERE b.id = p_bookmark_id
GROUP BY s.signal_type, COALESCE(dp.id, dpr.id), COALESCE(dp.name, dpr.name, s.keyword_matched)
ORDER BY signal_count DESC;
```

**Retorno esperado:**

```typescript
interface AvailableSignal {
  signal_type: 'technology' | 'process';
  signal_id: string;
  signal_name: string;
  signal_count: number;        // Total de señales
  job_posting_count: number;   // Job postings con esta señal
  contact_count: number;       // Empleados con esta señal
}
```

#### Cambiar Filtro de un Bookmark

```typescript
// Action: updateBookmarkFilter
interface UpdateBookmarkFilterParams {
  bookmarkId: string;
  filterType: 'technology' | 'process' | null;  // null = quitar filtro
  signalIds: string[];  // IDs de dictionary_products o dictionary_processes
}

// Pasos:
// 1. Validar que el usuario es dueño del bookmark
// 2. Validar que los signalIds existen y son del tipo correcto
// 3. Obtener nombres de las señales para filtersUsed
// 4. Actualizar search_context preservando otros campos (last_news_search, etc.)
// 5. Opcionalmente: registrar en filterHistory
```

### 3. Interfaz de Usuario

#### A. Desde Vista de Lista/Kanban

**Opción 1: Dropdown en cada card** (Recomendado para UX rápida)

```
┌─────────────────────────────────────┐
│ Banco Galicia          [⚙️ ▼]      │
│ Filtro: Sin filtro                  │
│ 15 señales • 8 job postings         │
└─────────────────────────────────────┘
                    │
                    ▼
         ┌─────────────────────┐
         │ Cambiar filtro      │
         ├─────────────────────┤
         │ ○ Sin filtro        │
         ├─────────────────────┤
         │ TECNOLOGÍAS         │
         │ ○ React (5)         │
         │ ○ Express (2)       │
         ├─────────────────────┤
         │ PROCESOS            │
         │ ○ RRHH (3)          │
         │ ○ Tesorería (4)     │
         │ ○ Marketing (2)     │
         └─────────────────────┘
```

**Opción 2: Bulk action** (Para cambiar múltiples bookmarks)

```
┌─────────────────────────────────────────────────┐
│ [☑] Seleccionar todo    [Cambiar filtro ▼]     │
├─────────────────────────────────────────────────┤
│ [☑] Banco Galicia                              │
│ [☑] ICBC                                       │
│ [ ] Santander                                   │
└─────────────────────────────────────────────────┘
```

#### B. Desde Dentro del Bookmark (Drawer/Page)

**Ubicación: Header del bookmark, junto a la info de la empresa**

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  🏦 Banco Galicia                                        │
│  Argentina • Banca                                       │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │ Filtro activo: [React ▼]                           │ │
│  │                                                    │ │
│  │ Mostrando señales relacionadas a React             │ │
│  │ 5 empleados • 3 job postings                       │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  [Tabs: Señales | Prospectos | Noticias | ...]          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Componente de selector de filtro:**

```typescript
interface FilterSelectorProps {
  bookmarkId: string;
  currentFilter: {
    type: 'technology' | 'process' | null;
    signalIds: string[];
    signalNames: string[];
  };
  availableSignals: AvailableSignal[];
  onFilterChange: (newFilter: UpdateBookmarkFilterParams) => Promise<void>;
}
```

### 4. Comportamiento al Cambiar Filtro

#### Qué cambia:
- El `search_context` del bookmark se actualiza
- La UI filtra las señales mostradas según el nuevo filtro
- Los contadores se recalculan para el nuevo filtro

#### Qué NO cambia:
- Las señales de la empresa siguen existiendo (no se borran)
- Los prospectos de Apollo siguen asociados al bookmark
- Las notas y prioridad del bookmark se mantienen
- El historial de búsquedas (last_news_search, etc.) se preserva

#### Caso especial: Quitar filtro
- `filterType` → `null`
- `filterSignalIds` → `[]`
- `filtersUsed` → `{}`
- Se muestran TODAS las señales de la empresa

### 5. API Endpoints

```typescript
// GET /api/bookmarks/[id]/available-signals
// Retorna las señales disponibles para filtrar
Response: {
  signals: AvailableSignal[];
  currentFilter: {
    type: string | null;
    signalIds: string[];
    signalNames: string[];
  };
}

// PATCH /api/bookmarks/[id]/filter
// Actualiza el filtro del bookmark
Request: {
  filterType: 'technology' | 'process' | null;
  signalIds: string[];
}
Response: {
  success: boolean;
  bookmark: Bookmark;
}
```

### 6. Server Actions (Alternativa a API)

```typescript
// app/actions/bookmark-filters.ts

'use server'

export async function getAvailableSignalsForBookmark(bookmarkId: string): Promise<{
  signals: AvailableSignal[];
  currentFilter: CurrentFilter;
}> {
  // Implementación...
}

export async function updateBookmarkFilter(
  bookmarkId: string,
  filterType: 'technology' | 'process' | null,
  signalIds: string[]
): Promise<{ success: boolean; error?: string }> {
  // Implementación...
}
```

---

## Flujos de Usuario

### Flujo 1: Asignar filtro a bookmark sin filtro

1. Usuario busca "Banco Galicia" por nombre de empresa
2. Guarda bookmark (sin filtro)
3. Desde la vista de lista, hace clic en el selector de filtro
4. Ve las señales disponibles agrupadas por tipo (tecnología/proceso)
5. Selecciona "React" (tecnología)
6. El bookmark ahora muestra solo señales relacionadas a React

### Flujo 2: Cambiar filtro existente

1. Usuario tiene bookmark de Allianz con filtro "Oracle Forms"
2. Quiere cambiar a ver señales de "RRHH"
3. Abre el selector de filtro
4. Cambia de "Oracle Forms" a "Recursos Humanos"
5. La vista se actualiza mostrando señales de RRHH

### Flujo 3: Quitar filtro

1. Usuario tiene bookmark con filtro "AWS"
2. Quiere ver TODAS las señales de la empresa
3. Selecciona "Sin filtro" en el selector
4. Ahora ve todas las señales disponibles

---

## Consideraciones Técnicas

### Performance

- **Cache de señales disponibles**: Considerar cachear el resultado de `get_available_signals_for_bookmark` por 5-10 minutos
- **Optimistic updates**: Actualizar UI inmediatamente mientras se guarda en BD

### Validaciones

1. Usuario debe ser dueño del bookmark
2. Los `signalIds` deben existir en el diccionario correspondiente
3. Los `signalIds` deben tener señales activas en la empresa del bookmark

### Backward Compatibility

- Bookmarks existentes con `search_context` válido siguen funcionando
- Bookmarks con `search_context = null` se tratan como "sin filtro"
- No se requiere migración de datos

---

## Fases de Implementación

### Fase 1: Backend
- [ ] Crear RPC `get_available_signals_for_bookmark`
- [ ] Crear Server Action `updateBookmarkFilter`
- [ ] Tests de integración

### Fase 2: UI en Bookmark Drawer/Page
- [ ] Componente `FilterSelector`
- [ ] Integrar en header del bookmark
- [ ] Actualizar vista de señales según filtro

### Fase 3: UI en Vista Lista/Kanban
- [ ] Agregar dropdown de filtro en cards
- [ ] Indicador visual del filtro actual
- [ ] Bulk action para cambiar filtros masivamente

### Fase 4: Mejoras
- [ ] Historial de cambios de filtro (auditoría)
- [ ] Notificación cuando hay nuevas señales del filtro
- [ ] Sugerencias de filtros basadas en actividad
