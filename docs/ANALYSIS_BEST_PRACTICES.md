# Análisis de Best Practices - ASCI Platform

**Fecha**: 25/01/2026  
**Alcance**: Supabase/Postgres, React/Next.js, Web Design

---

## 1. SUPABASE / POSTGRES BEST PRACTICES

### 1.1 Hallazgos de Seguridad

#### CRÍTICO: Tablas sin RLS Policies
| Tabla | Issue | Impacto |
|-------|-------|---------|
| `job_postings` | RLS habilitado pero sin policies | Datos inaccesibles o expuestos |
| `pending_signals` | RLS habilitado pero sin policies | Datos de procesamiento expuestos |

**Remediación:**
```sql
-- job_postings: Acceso público de lectura (datos de scraping)
CREATE POLICY "Public read access" ON public.job_postings
FOR SELECT USING (true);

-- pending_signals: Solo acceso de service role (procesamiento interno)
-- No necesita policies para usuarios normales, solo service role accede
```

#### WARN: Functions con search_path mutable (26 funciones)
**Funciones afectadas:**
- `search_companies_by_technology_v2`
- `search_companies_by_process_v2`
- `merge_companies`
- `process_pending_signals_batch`
- `normalize_linkedin_url`
- `normalize_company_name`
- `get_icebreaker_context`
- `update_updated_at_column`
- `process_contact_batch_internal`
- `upsert_company_from_contact`
- `get_dashboard_counts`
- `get_cron_status`
- Y 14 más...

**Remediación:** Agregar `SET search_path = ''` a cada función:
```sql
CREATE OR REPLACE FUNCTION public.search_companies_by_technology_v2(...)
RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- Agregar esta línea
AS $$
BEGIN
  -- Usar schema explícito: public.companies en lugar de companies
END;
$$;
```

### 1.2 Hallazgos de Performance

#### Foreign Keys sin Índices (17 FKs)
| Tabla | Foreign Key | Impacto |
|-------|-------------|---------|
| `bookmarks` | `company_id` | JOINs lentos en búsquedas de bookmarks |
| `contacts` | `current_company_id` | Consultas de contactos por empresa lentas |
| `job_postings` | `company_id` | Búsquedas de job postings lentas |
| `pending_signals` | `contact_id`, `job_id` | Procesamiento de señales lento |
| `user_company_contacts` | `bookmark_id`, `company_id`, `apollo_cache_id` | Decision makers queries lentas |
| `user_company_signals` | `bookmark_id`, `company_id` | Señales por cuenta lentas |
| `user_company_strategies` | `company_id`, `user_id` | Estrategias lentas |
| `user_icebreakers` | `bookmark_id`, `company_id` | Icebreakers lentos |
| `icebreaker_templates` | `created_by` | Listado de templates lento |
| `ingestion_logs` | `uploaded_by` | Logs de usuario lentos |
| `dictionary_products` | `vendor_id` | Búsquedas de productos lentas |

**Remediación - Script de índices:**
```sql
-- Alta prioridad (tablas frecuentes)
CREATE INDEX CONCURRENTLY idx_bookmarks_company_id ON bookmarks(company_id);
CREATE INDEX CONCURRENTLY idx_contacts_current_company_id ON contacts(current_company_id);
CREATE INDEX CONCURRENTLY idx_user_company_contacts_bookmark_id ON user_company_contacts(bookmark_id);
CREATE INDEX CONCURRENTLY idx_user_company_contacts_company_id ON user_company_contacts(company_id);
CREATE INDEX CONCURRENTLY idx_user_company_signals_bookmark_id ON user_company_signals(bookmark_id);
CREATE INDEX CONCURRENTLY idx_user_company_signals_company_id ON user_company_signals(company_id);

-- Media prioridad
CREATE INDEX CONCURRENTLY idx_job_postings_company_id ON job_postings(company_id);
CREATE INDEX CONCURRENTLY idx_pending_signals_contact_id ON pending_signals(contact_id);
CREATE INDEX CONCURRENTLY idx_pending_signals_job_id ON pending_signals(job_id);
CREATE INDEX CONCURRENTLY idx_user_company_strategies_company_id ON user_company_strategies(company_id);
CREATE INDEX CONCURRENTLY idx_user_company_strategies_user_id ON user_company_strategies(user_id);
CREATE INDEX CONCURRENTLY idx_user_icebreakers_bookmark_id ON user_icebreakers(bookmark_id);
CREATE INDEX CONCURRENTLY idx_user_icebreakers_company_id ON user_icebreakers(company_id);

-- Baja prioridad (tablas menos frecuentes)
CREATE INDEX CONCURRENTLY idx_icebreaker_templates_created_by ON icebreaker_templates(created_by);
CREATE INDEX CONCURRENTLY idx_ingestion_logs_uploaded_by ON ingestion_logs(uploaded_by);
CREATE INDEX CONCURRENTLY idx_dictionary_products_vendor_id ON dictionary_products(vendor_id);
CREATE INDEX CONCURRENTLY idx_user_company_contacts_apollo_cache_id ON user_company_contacts(apollo_cache_id);
```

#### RLS Policies con re-evaluación por fila (8 policies)
| Tabla | Policy | Issue |
|-------|--------|-------|
| `profiles` | Users can view own profile | `auth.uid()` se re-evalúa por fila |
| `profiles` | Users can update own profile | `auth.uid()` se re-evalúa por fila |
| `user_company_signals` | Users can manage their own signals | Re-evaluación |
| `bookmarks` | Users can manage bookmarks | Re-evaluación |
| `user_company_contacts` | Users can manage their own contacts | Re-evaluación |
| `user_company_strategies` | Users can manage their own strategies | Re-evaluación |
| `user_icebreakers` | Users can manage their own icebreakers | Re-evaluación |
| `success_cases` | Users can manage their own cases | Re-evaluación |

**Remediación:** Cambiar `auth.uid()` por `(SELECT auth.uid())`:
```sql
-- Antes (lento)
CREATE POLICY "Users can view own profile" ON profiles
FOR SELECT USING (auth.uid() = id);

-- Después (optimizado)
CREATE POLICY "Users can view own profile" ON profiles
FOR SELECT USING ((SELECT auth.uid()) = id);
```

### 1.3 Resumen de Acciones Supabase

| Prioridad | Acción | Esfuerzo | Impacto |
|-----------|--------|----------|---------|
| **ALTA** | Crear índices para FKs principales (6) | 10 min | Performance +30-50% |
| **ALTA** | Optimizar RLS policies (8) | 30 min | Performance +20% |
| **MEDIA** | Crear índices restantes (11) | 15 min | Performance marginal |
| **MEDIA** | Agregar policies a tablas vacías (2) | 10 min | Seguridad |
| **BAJA** | Fix search_path en functions (26) | 2 horas | Seguridad hardening |

---

## 2. VERCEL / REACT BEST PRACTICES

### 2.1 Hallazgos Positivos

| Aspecto | Estado | Notas |
|---------|--------|-------|
| Loading states | OK | Skeleton loaders implementados en la mayoría de componentes |
| Error handling | OK | Try/catch en operaciones async (37+ archivos) |
| Memoization | PARCIAL | useMemo/useCallback en 15 archivos, pero falta en algunos críticos |
| TypeScript | OK | Tipado fuerte en toda la aplicación |
| Component splitting | OK | Páginas divididas en componentes pequeños |

### 2.2 Mejoras Recomendadas

#### 2.2.1 Memoization Faltante
**Componentes que se beneficiarían de React.memo:**

```tsx
// components/bookmarks/kanban-board.tsx
// La KanbanCard ya usa React.memo - BIEN

// Agregar memo a componentes de lista frecuentes:
// components/search/result-item.tsx - renderizado múltiples veces
export const ResultItem = React.memo(function ResultItem({ ... }) {
  // ...
});

// app/bookmarks/page.tsx - BookmarkRow en lista
const BookmarkRow = React.memo(function BookmarkRow({ bookmark, ... }) {
  // ...
});
```

#### 2.2.2 useCallback para Event Handlers
**Handlers que se pasan a children y causan re-renders:**

```tsx
// app/bookmarks/page.tsx
// Antes:
const handleStatusChange = (id: string, newStatus: BookmarkStatus) => {
  setBookmarks(prev => prev.map(b => b.id === id ? {...b, status: newStatus} : b))
}

// Después:
const handleStatusChange = useCallback((id: string, newStatus: BookmarkStatus) => {
  setBookmarks(prev => prev.map(b => b.id === id ? {...b, status: newStatus} : b))
}, [])
```

#### 2.2.3 Data Fetching Patterns
**Oportunidad: Usar SWR para caching automático**

```tsx
// Actualmente en muchos componentes:
useEffect(() => {
  async function fetchData() {
    const { data } = await supabase.from('...').select('...')
    setData(data)
  }
  fetchData()
}, [])

// Mejor con SWR:
import useSWR from 'swr'

const fetcher = async (key: string) => {
  const { data } = await supabase.from(key).select('...')
  return data
}

function Component() {
  const { data, error, isLoading, mutate } = useSWR('bookmarks', fetcher)
  // Beneficios: caching, revalidation, deduplication
}
```

#### 2.2.4 Lazy Loading de Tabs
**Actualmente:** Todas las tabs en bookmark detail se renderizan al montar

```tsx
// app/bookmarks/[id]/page.tsx - Mejora sugerida
import dynamic from 'next/dynamic'

const ContactsTab = dynamic(() => import('./_components/contacts-tab'), {
  loading: () => <TabSkeleton />
})
const SignalsTab = dynamic(() => import('./_components/signals-tab'), {
  loading: () => <TabSkeleton />
})
// etc...
```

#### 2.2.5 Optimistic Updates
**Ya implementado parcialmente en Kanban, extender a:**
- Bookmark notes editing
- Status changes en list view
- Priority changes

#### 2.2.6 Error Boundaries
**Agregar error boundaries para componentes críticos:**

```tsx
// components/error-boundary.tsx
'use client'
import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

export class ErrorBoundary extends Component<Props, { hasError: boolean }> {
  state = { hasError: false }
  
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  
  render() {
    if (this.state.hasError) {
      return this.props.fallback || <div>Algo salió mal. Recarga la página.</div>
    }
    return this.props.children
  }
}
```

### 2.3 Acciones Implementables Inmediatamente

| Prioridad | Acción | Esfuerzo | Impacto |
|-----------|--------|----------|---------|
| **ALTA** | Agregar useCallback a handlers en bookmarks page | 30 min | Reduce re-renders |
| **ALTA** | Lazy load tabs en bookmark detail | 1 hora | Faster initial load |
| **MEDIA** | Implementar SWR para data fetching | 2-3 horas | Caching, mejor UX |
| **MEDIA** | Agregar React.memo a ResultItem | 15 min | Búsquedas más fluidas |
| **BAJA** | Error boundaries globales | 1 hora | Mejor manejo de errores |

---

## 3. WEB DESIGN GUIDELINES (Solo propuestas)

### 3.1 Análisis del Estado Actual

#### Paleta de Colores
| Uso | Color Actual | Observación |
|-----|--------------|-------------|
| Primary | `slate-900` | Correcto, profesional |
| Accent | `blue-600/indigo-600` | Gradient en hero - OK |
| Background | `#fafafa` | Neutro, limpio |
| Text | `slate-600/900` | Buena legibilidad |

**Veredicto:** Paleta conservadora y profesional, apropiada para B2B.

#### Tipografía
- Font: Sistema (Geist) - Moderna y legible
- Hierarchy: Bien definida (7xl headings, xl subheadlines, sm body)
- Line height: `leading-relaxed` usado correctamente

### 3.2 Propuestas de Mejora (No implementar)

#### 3.2.1 Landing Page

**Hero Section:**
- Considerar agregar una imagen/ilustración del producto
- El hero actual es muy text-heavy
- Propuesta: Screenshot del dashboard o ilustración isométrica

**Social Proof:**
- Falta sección de logos de clientes
- Falta sección de testimonios
- Propuesta: Agregar "Empresas que usan ASCI" con logos

**Stats Section:**
- Los números están bien pero podrían tener más contexto
- Propuesta: Agregar iconos o mini-charts junto a cada stat

**Feature Cards:**
- Diseño consistente y limpio
- Propuesta: Agregar hover animations más distintivas
- Propuesta: Screenshots o GIFs de cada feature

#### 3.2.2 Dashboard / App

**Navigation:**
- Sidebar actual es funcional pero básica
- Propuesta: Agregar badges de notificaciones
- Propuesta: Estado de procesamiento visible en sidebar

**Data Density:**
- Las tablas de búsqueda son densas pero legibles
- Propuesta: Agregar vista de "tarjetas" como alternativa a tabla

**Kanban Board:**
- Implementación correcta con buen uso de colores por status
- Propuesta: Agregar avatares de contactos en las cards
- Propuesta: Quick actions on hover

**Empty States:**
- Algunos vacíos sin guía
- Propuesta: Agregar ilustraciones y CTAs en empty states

#### 3.2.3 Micro-interacciones

**Actuales:**
- Hovers básicos en botones
- Transitions en navegación

**Propuestas:**
- Agregar skeleton loaders más elaborados
- Animaciones de entrada en cards (stagger)
- Feedback visual en acciones (confetti en primer brief?)
- Toast notifications más distintivas

#### 3.2.4 Accesibilidad

**Estado Actual:**
- Contraste de colores OK
- Semantic HTML mayormente correcto

**Propuestas:**
- Agregar `aria-live` regions para updates dinámicos
- Mejorar focus states (más visibles)
- Skip links para navegación
- Reducir motion para usuarios con preferencia

#### 3.2.5 Mobile Experience

**Estado Actual:**
- Responsive básico implementado
- Kanban funciona en mobile pero no es óptimo

**Propuestas:**
- Rediseñar Kanban para mobile (stack vertical o swipeable)
- Bottom navigation en mobile
- Touch targets más grandes (44px mínimo)
- Pull-to-refresh en listas

### 3.3 Resumen de Propuestas de Diseño

| Área | Propuesta | Impacto UX | Esfuerzo |
|------|-----------|------------|----------|
| Landing | Agregar social proof (logos, testimonios) | Alto | Medio |
| Landing | Screenshot/ilustración en hero | Medio | Bajo |
| Dashboard | Empty states con ilustraciones | Medio | Bajo |
| Kanban | Avatares y quick actions | Medio | Medio |
| Mobile | Rediseñar Kanban mobile | Alto | Alto |
| Global | Mejorar micro-interacciones | Medio | Medio |
| A11y | Focus states y aria-live | Alto | Bajo |

---

## 4. PLAN DE ACCIÓN CONSOLIDADO

### Fase 1: Quick Wins (1-2 horas)
1. Crear índices para FKs principales (Supabase)
2. Optimizar RLS policies con SELECT wrapper (Supabase)
3. Agregar useCallback a handlers críticos (React)

### Fase 2: Mejoras Medias (1 día)
1. Crear índices restantes (Supabase)
2. Implementar lazy loading de tabs (React)
3. Agregar React.memo a componentes de lista

### Fase 3: Mejoras Mayores (2-3 días)
1. Fix search_path en functions (Supabase)
2. Implementar SWR para data fetching (React)
3. Error boundaries globales

### Fase 4: Diseño (Backlog)
1. Social proof en landing
2. Empty states mejorados
3. Micro-interacciones
4. Mobile Kanban redesign

---

## 5. SCRIPTS DE REMEDIACIÓN

### Script 1: Índices de Foreign Keys
```sql
-- Ejecutar en Supabase SQL Editor
-- Usar CONCURRENTLY para no bloquear la DB

-- Alta prioridad
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookmarks_company_id 
ON bookmarks(company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_current_company_id 
ON contacts(current_company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_company_contacts_bookmark_id 
ON user_company_contacts(bookmark_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_company_contacts_company_id 
ON user_company_contacts(company_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_company_signals_bookmark_id 
ON user_company_signals(bookmark_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_company_signals_company_id 
ON user_company_signals(company_id);
```

### Script 2: Optimizar RLS Policies
```sql
-- profiles
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
FOR SELECT USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
FOR UPDATE USING ((SELECT auth.uid()) = id);

-- Repetir patrón para: bookmarks, user_company_signals, 
-- user_company_contacts, user_company_strategies, 
-- user_icebreakers, success_cases
```

---

**Documento generado automáticamente por análisis de v0**  
**Referencia**: Supabase Advisors API + Code Analysis
