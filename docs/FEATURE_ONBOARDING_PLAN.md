# Feature: Onboarding Guiado Interactivo

> **Estado**: Planificación  
> **Prioridad**: Alta  
> **Esfuerzo estimado**: 4-6 días  
> **Última actualización**: 23/01/2026

---

## 1. Objetivo

Crear un sistema de onboarding interactivo con popups/tooltips que guíe a nuevos usuarios a través de las funcionalidades principales de ASCI, asegurando que completen acciones reales (no solo lean información) para maximizar la adopción y retención.

---

## 2. Comportamiento General

### 2.1 Cuándo se activa
- **Trigger**: Primer login después de crear la cuenta
- **Persistencia**: Continúa en sesiones subsiguientes hasta completar o saltar
- **Condición de fin**: 
  - Usuario completa todos los pasos, O
  - Usuario hace clic en "Omitir onboarding"

### 2.2 Características
- **Interactivo**: El usuario debe realizar acciones reales, no solo leer
- **Progresivo**: Cada paso desbloquea el siguiente
- **No bloqueante**: El usuario puede navegar libremente pero el popup reaparece
- **Persistente**: El progreso se guarda en base de datos
- **Skippable**: Opción de omitir en cualquier momento

---

## 3. Flujo de Pasos del Onboarding

### Paso 1: Bienvenida y Perfil
**Ubicación**: `/dashboard` → Modal de bienvenida → `/profile`

```
┌─────────────────────────────────────────────────────┐
│  🎉 ¡Bienvenido a ASCI!                             │
│                                                     │
│  Te guiaremos en tus primeros pasos para que       │
│  puedas aprovechar al máximo la plataforma.        │
│                                                     │
│  Empecemos configurando tu perfil y propuesta      │
│  de valor para personalizar tus búsquedas.         │
│                                                     │
│  [Comenzar]              [Omitir onboarding]       │
└─────────────────────────────────────────────────────┘
```

**Acción requerida**: Completar campos de perfil (nombre, empresa, propuesta de valor)  
**Validación**: `user_profiles.sender_context` no vacío  
**Tooltip en `/profile`**:
```
┌─────────────────────────────────────────────────────┐
│  📝 Paso 1 de 8: Tu Propuesta de Valor              │
│                                                     │
│  Describe brevemente qué servicios ofreces y       │
│  qué problemas resuelves. Esto ayudará a la IA     │
│  a generar mejores icebreakers y briefs.           │
│                                                     │
│  Ejemplo: "Consultor SAP especializado en          │
│  migraciones S/4HANA para el sector financiero"    │
│                                                     │
│  ──────────────────────────────────────────        │
│  [■■□□□□□□] 1/8                    [Omitir todo]   │
└─────────────────────────────────────────────────────┘
```

---

### Paso 2: Búsqueda de Señales
**Ubicación**: `/search`

**Tooltip posicionado sobre el buscador**:
```
┌─────────────────────────────────────────────────────┐
│  🔍 Paso 2 de 8: Busca tu primera señal            │
│                                                     │
│  Las señales son personas que mencionan            │
│  tecnologías o procesos en su perfil de LinkedIn.  │
│                                                     │
│  Prueba buscar una tecnología que vendas,          │
│  por ejemplo: "SAP", "Salesforce", "AWS"           │
│                                                     │
│  ──────────────────────────────────────────        │
│  [■■■□□□□□] 2/8                    [Omitir todo]   │
└─────────────────────────────────────────────────────┘
```

**Acción requerida**: Ejecutar al menos 1 búsqueda  
**Validación**: Detectar submit del formulario de búsqueda

---

### Paso 3: Guardar una Cuenta (Bookmark)
**Ubicación**: `/search` → Resultados

**Tooltip posicionado sobre botón de bookmark en una card de resultado**:
```
┌─────────────────────────────────────────────────────┐
│  ⭐ Paso 3 de 8: Guarda tu primera cuenta          │
│                                                     │
│  ¿Ves una empresa interesante? Haz clic en el      │
│  ícono de bookmark para guardarla en tu pipeline.  │
│                                                     │
│  Las cuentas guardadas te permiten:                │
│  • Organizar tu prospección                        │
│  • Generar briefs con IA                           │
│  • Hacer seguimiento del estado                    │
│                                                     │
│  ──────────────────────────────────────────        │
│  [■■■■□□□□] 3/8                    [Omitir todo]   │
└─────────────────────────────────────────────────────┘
```

**Acción requerida**: Crear al menos 1 bookmark  
**Validación**: `bookmarks` count > 0 para el usuario

---

### Paso 4: Asignar Tier/Prioridad
**Ubicación**: `/bookmarks` (se redirige automáticamente después del paso 3)

**Tooltip posicionado sobre el selector de prioridad**:
```
┌─────────────────────────────────────────────────────┐
│  🎯 Paso 4 de 8: Prioriza tu cuenta                │
│                                                     │
│  Asigna un Tier a tu cuenta para organizar         │
│  tu pipeline con metodología ABM:                  │
│                                                     │
│  • Alta: Cuentas estratégicas, alto valor          │
│  • Transaccional: Oportunidades de venta rápida    │
│  • Baja: Para explorar más adelante                │
│                                                     │
│  ──────────────────────────────────────────        │
│  [■■■■■□□□] 4/8                    [Omitir todo]   │
└─────────────────────────────────────────────────────┘
```

**Acción requerida**: Asignar prioridad a al menos 1 bookmark  
**Validación**: `bookmarks.priority` no nulo para al menos 1 registro

---

### Paso 5: Vista Kanban
**Ubicación**: `/bookmarks` → Toggle a vista Kanban

**Tooltip posicionado sobre el toggle de vista**:
```
┌─────────────────────────────────────────────────────┐
│  📋 Paso 5 de 8: Vista Kanban                      │
│                                                     │
│  Cambia a vista Kanban para visualizar tu          │
│  pipeline como un tablero de estados:              │
│                                                     │
│  Nuevo → Investigando → Contactado → Reunión       │
│                                                     │
│  Arrastra las tarjetas entre columnas para         │
│  actualizar el estado de cada cuenta.              │
│                                                     │
│  ──────────────────────────────────────────        │
│  [■■■■■■□□] 5/8                    [Omitir todo]   │
└─────────────────────────────────────────────────────┘
```

**Acción requerida**: Cambiar a vista Kanban  
**Validación**: Detectar clic en toggle de vista Kanban

---

### Paso 6: Ingresar al Detalle de Cuenta
**Ubicación**: `/bookmarks` → Clic en una cuenta → `/bookmarks/[id]`

**Tooltip posicionado sobre una tarjeta de cuenta**:
```
┌─────────────────────────────────────────────────────┐
│  👁️ Paso 6 de 8: Explora el detalle                │
│                                                     │
│  Haz clic en el ícono de ojo o en el nombre        │
│  de la cuenta para ver toda la información:        │
│                                                     │
│  • Datos de la empresa                             │
│  • Contactos y decision makers                     │
│  • Señales detectadas                              │
│  • Noticias recientes                              │
│                                                     │
│  ──────────────────────────────────────────        │
│  [■■■■■■■□] 6/8                    [Omitir todo]   │
└─────────────────────────────────────────────────────┘
```

**Acción requerida**: Navegar a `/bookmarks/[id]`  
**Validación**: Detectar navegación a ruta de detalle

---

### Paso 7: Tour por las Tabs del Detalle
**Ubicación**: `/bookmarks/[id]` → Cada tab

Este paso tiene **sub-pasos** para cada tab:

#### 7a: Tab Overview
```
┌─────────────────────────────────────────────────────┐
│  📊 Paso 7a: Resumen General                       │
│                                                     │
│  Aquí ves el resumen de la cuenta:                 │
│  • Brief ejecutivo generado por IA                 │
│  • Métricas clave                                  │
│  • Acciones rápidas                                │
│                                                     │
│  [Siguiente →]                                      │
└─────────────────────────────────────────────────────┘
```

#### 7b: Tab Contactos
```
┌─────────────────────────────────────────────────────┐
│  👥 Paso 7b: Contactos                             │
│                                                     │
│  Todos los contactos detectados en esta empresa:   │
│  • Empleados actuales y alumni                     │
│  • Señales de cada contacto                        │
│  • Links a LinkedIn                                │
│                                                     │
│  [← Anterior]  [Siguiente →]                       │
└─────────────────────────────────────────────────────┘
```

#### 7c: Tab Decision Makers
```
┌─────────────────────────────────────────────────────┐
│  🎯 Paso 7c: Decision Makers                       │
│                                                     │
│  Busca y guarda los tomadores de decisión:         │
│  • Usa el buscador de Apollo integrado             │
│  • Guarda los contactos relevantes                 │
│  • Genera icebreakers personalizados               │
│                                                     │
│  [← Anterior]  [Siguiente →]                       │
└─────────────────────────────────────────────────────┘
```

#### 7d: Tab Señales
```
┌─────────────────────────────────────────────────────┐
│  📡 Paso 7d: Señales Detectadas                    │
│                                                     │
│  Todas las señales de esta cuenta:                 │
│  • Tecnologías mencionadas                         │
│  • Procesos de negocio                             │
│  • Historial de detecciones                        │
│                                                     │
│  [← Anterior]  [Siguiente →]                       │
└─────────────────────────────────────────────────────┘
```

#### 7e: Tab Noticias
```
┌─────────────────────────────────────────────────────┐
│  📰 Paso 7e: Noticias                              │
│                                                     │
│  Noticias recientes de la empresa:                 │
│  • Generadas automáticamente con IA                │
│  • Útiles para icebreakers contextuales            │
│  • Se actualizan periódicamente                    │
│                                                     │
│  [← Anterior]  [Siguiente →]                       │
└─────────────────────────────────────────────────────┘
```

#### 7f: Tab Estrategia
```
┌─────────────────────────────────────────────────────┐
│  📝 Paso 7f: Estrategia                            │
│                                                     │
│  Define tu estrategia para esta cuenta:            │
│  • Propuesta de valor específica                   │
│  • Casos de éxito relevantes                       │
│  • Notas y contexto adicional                      │
│                                                     │
│  [← Anterior]  [Siguiente →]                       │
└─────────────────────────────────────────────────────┘
```

**Acción requerida**: Navegar por todas las tabs  
**Validación**: Haber visitado todas las tabs (trackear en estado local)

---

### Paso 8: Generar Brief Ejecutivo
**Ubicación**: `/bookmarks/[id]` → Tab Overview → Botón "Generar Brief"

**Tooltip posicionado sobre el botón de generar brief**:
```
┌─────────────────────────────────────────────────────┐
│  🤖 Paso 8 de 8: Genera tu primer Brief            │
│                                                     │
│  El Brief Ejecutivo combina toda la información:   │
│  • Datos de la empresa                             │
│  • Señales detectadas                              │
│  • Tu propuesta de valor                           │
│  • Noticias recientes                              │
│                                                     │
│  Haz clic en "Generar Brief" para crear tu         │
│  primer resumen ejecutivo con IA.                  │
│                                                     │
│  ──────────────────────────────────────────        │
│  [■■■■■■■■] 8/8                    [Omitir todo]   │
└─────────────────────────────────────────────────────┘
```

**Acción requerida**: Generar un brief  
**Validación**: Brief generado exitosamente

---

### Paso Final: Celebración
**Ubicación**: Modal overlay

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│              🎉 ¡Felicitaciones!                    │
│                                                     │
│       Has completado el onboarding de ASCI         │
│                                                     │
│  Ya sabes cómo:                                    │
│  ✓ Configurar tu perfil                           │
│  ✓ Buscar señales de compra                       │
│  ✓ Gestionar tu pipeline de cuentas               │
│  ✓ Generar briefs con IA                          │
│                                                     │
│  ¿Tienes dudas? Usa el botón de ayuda (?)         │
│  en la esquina inferior derecha.                   │
│                                                     │
│              [Comenzar a prospectar]               │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 4. Modelo de Datos

### 4.1 Nueva tabla: `user_onboarding`

```sql
CREATE TABLE user_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  
  -- Estado general
  status TEXT DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'skipped'
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  skipped_at TIMESTAMPTZ,
  
  -- Progreso por paso (JSON para flexibilidad)
  steps_completed JSONB DEFAULT '{
    "welcome": false,
    "profile": false,
    "search": false,
    "bookmark": false,
    "tier": false,
    "kanban": false,
    "detail": false,
    "tabs_tour": false,
    "brief": false
  }'::jsonb,
  
  -- Paso actual
  current_step TEXT DEFAULT 'welcome',
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE user_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own onboarding"
  ON user_onboarding FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding"
  ON user_onboarding FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own onboarding"
  ON user_onboarding FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

### 4.2 Trigger para crear registro automáticamente

```sql
-- Crear registro de onboarding cuando se crea un usuario
CREATE OR REPLACE FUNCTION create_user_onboarding()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_onboarding (user_id, status, started_at)
  VALUES (NEW.id, 'pending', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created_onboarding
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_user_onboarding();
```

---

## 5. Arquitectura de Componentes

```
/components/onboarding/
├── OnboardingProvider.tsx      # Context provider global
├── OnboardingTooltip.tsx       # Componente de tooltip posicionado
├── OnboardingModal.tsx         # Modales de bienvenida y celebración
├── OnboardingProgress.tsx      # Barra de progreso
├── OnboardingOverlay.tsx       # Overlay semi-transparente
├── steps/
│   ├── WelcomeStep.tsx
│   ├── ProfileStep.tsx
│   ├── SearchStep.tsx
│   ├── BookmarkStep.tsx
│   ├── TierStep.tsx
│   ├── KanbanStep.tsx
│   ├── DetailStep.tsx
│   ├── TabsTourStep.tsx
│   └── BriefStep.tsx
└── hooks/
    ├── useOnboarding.ts        # Hook principal
    └── useOnboardingStep.ts    # Hook por paso
```

### 5.1 OnboardingProvider

```tsx
// Pseudocódigo del provider
interface OnboardingContextType {
  status: 'pending' | 'in_progress' | 'completed' | 'skipped'
  currentStep: string
  stepsCompleted: Record<string, boolean>
  progress: number // 0-100
  
  // Actions
  startOnboarding: () => void
  completeStep: (step: string) => void
  skipOnboarding: () => void
  goToStep: (step: string) => void
}

// Se incluye en el layout principal para usuarios autenticados
// Solo se muestra si status !== 'completed' && status !== 'skipped'
```

### 5.2 OnboardingTooltip

```tsx
interface OnboardingTooltipProps {
  step: string
  targetSelector: string  // CSS selector del elemento target
  position: 'top' | 'bottom' | 'left' | 'right'
  title: string
  description: string
  children?: ReactNode
  showProgress?: boolean
  onComplete?: () => void
}

// Usa Floating UI para posicionamiento
// Incluye flecha apuntando al elemento target
// Overlay semi-transparente con spotlight en el target
```

---

## 6. Flujo de Detección de Acciones

### 6.1 Detección por observación de estado

| Paso | Cómo detectar completitud |
|------|--------------------------|
| Profile | `user_profiles.sender_context` no vacío |
| Search | Interceptar submit del form de búsqueda |
| Bookmark | `bookmarks` count > 0 |
| Tier | `bookmarks.priority` no nulo en algún registro |
| Kanban | Detectar clic en toggle de vista |
| Detail | Detectar navegación a `/bookmarks/[id]` |
| Tabs Tour | Estado local de tabs visitadas |
| Brief | Detectar generación exitosa de brief |

### 6.2 Integración con componentes existentes

```tsx
// Ejemplo: En el botón de bookmark
const BookmarkButton = ({ companyId }) => {
  const { currentStep, completeStep } = useOnboarding()
  
  const handleBookmark = async () => {
    await createBookmark(companyId)
    
    // Si estamos en el paso correcto, marcar como completado
    if (currentStep === 'bookmark') {
      completeStep('bookmark')
    }
  }
  
  return <Button onClick={handleBookmark}>...</Button>
}
```

---

## 7. Diseño Visual

### 7.1 Tooltip Style

```css
/* Estilo base del tooltip */
.onboarding-tooltip {
  background: white;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0,0,0,0.15);
  border: 1px solid #e2e8f0;
  padding: 20px;
  max-width: 360px;
  z-index: 9999;
}

/* Overlay con spotlight */
.onboarding-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9998;
}

/* Spotlight en el elemento target */
.onboarding-spotlight {
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  border-radius: 8px;
  position: relative;
  z-index: 9999;
}
```

### 7.2 Colores y Tipografía

- **Header del tooltip**: `text-slate-900`, `font-semibold`, `text-lg`
- **Descripción**: `text-slate-600`, `text-sm`, `leading-relaxed`
- **Progreso**: `bg-primary` para completado, `bg-slate-200` para pendiente
- **Botón principal**: `bg-primary text-white`
- **Botón secundario**: `text-slate-500 hover:text-slate-700`

---

## 8. Consideraciones de UX

### 8.1 No ser intrusivo
- El tooltip no bloquea toda la UI, solo resalta el elemento relevante
- El usuario puede cerrar temporalmente (reaparece al volver a la página)
- Opción de omitir siempre visible

### 8.2 Contexto inteligente
- Si el usuario ya tiene bookmarks, saltar pasos 1-3
- Si el usuario ya generó briefs, saltar al final
- Adaptar el onboarding al estado actual del usuario

### 8.3 Mobile-first
- En mobile, los tooltips aparecen como bottom sheets
- Simplificar el tour de tabs en mobile
- Gestos de swipe para navegar entre pasos

### 8.4 Accesibilidad
- Focus trap en el tooltip activo
- Soporte de teclado (Escape para cerrar, Tab para navegar)
- Aria labels descriptivos
- Contraste de colores WCAG AA

---

## 9. Plan de Implementación

### Fase 1: Infraestructura (1-2 días)
- [ ] Crear tabla `user_onboarding` con RLS
- [ ] Crear trigger para nuevos usuarios
- [ ] Implementar `OnboardingProvider` y contexto
- [ ] Hook `useOnboarding` con lógica de estado
- [ ] API routes para actualizar progreso

### Fase 2: Componentes Base (1-2 días)
- [ ] `OnboardingTooltip` con Floating UI
- [ ] `OnboardingModal` para welcome/celebration
- [ ] `OnboardingOverlay` con spotlight
- [ ] `OnboardingProgress` barra de progreso
- [ ] Estilos y animaciones

### Fase 3: Integración por Pasos (1-2 días)
- [ ] Paso 1: Welcome + Profile
- [ ] Paso 2: Search
- [ ] Paso 3: Bookmark
- [ ] Paso 4: Tier
- [ ] Paso 5: Kanban toggle
- [ ] Paso 6: Detail navigation
- [ ] Paso 7: Tabs tour (sub-pasos)
- [ ] Paso 8: Brief generation

### Fase 4: Polish y Testing (0.5-1 día)
- [ ] Animaciones de transición
- [ ] Responsive design
- [ ] Testing E2E del flujo completo
- [ ] Manejo de edge cases

---

## 10. Dependencias

### Nuevas
```json
{
  "@floating-ui/react": "^0.26.0"  // Para posicionamiento de tooltips
}
```

### Existentes que se usarán
- Framer Motion (animaciones)
- Tailwind CSS (estilos)
- Supabase (persistencia)

---

## 11. Métricas de Éxito

| Métrica | Objetivo |
|---------|----------|
| Tasa de completitud | > 60% de nuevos usuarios |
| Tiempo promedio de onboarding | < 10 minutos |
| Tasa de skip | < 30% |
| Retención D7 post-onboarding | +20% vs sin onboarding |

---

## 12. Relación con FAQ Helper

El onboarding y el FAQ Helper son complementarios:

| Aspecto | Onboarding | FAQ Helper |
|---------|------------|------------|
| Cuándo | Primera vez | Siempre disponible |
| Formato | Guiado, paso a paso | Autoservicio, búsqueda |
| Objetivo | Activación inicial | Resolución de dudas |
| Interacción | Obliga acciones | Solo informativo |

**Integración sugerida**: Al finalizar el onboarding, mostrar el botón de FAQ Helper y explicar que está disponible para dudas futuras.

---

## 13. Estimación de Esfuerzo

| Fase | Tiempo |
|------|--------|
| Infraestructura | 1-2 días |
| Componentes Base | 1-2 días |
| Integración por Pasos | 1-2 días |
| Polish y Testing | 0.5-1 día |
| **Total** | **4-6 días** |

---

## 14. Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Onboarding muy largo | Usuarios abandonan | Permitir skip, máximo 8 pasos |
| Conflictos con UI existente | Tooltips mal posicionados | Testing exhaustivo, fallbacks |
| Performance | Carga de JS adicional | Lazy load del módulo de onboarding |
| Usuarios existentes | No tienen registro | Migration script para crear registros |

---

## 15. Migration Script para Usuarios Existentes

```sql
-- Crear registros de onboarding para usuarios existentes (marcar como completado)
INSERT INTO user_onboarding (user_id, status, completed_at, steps_completed)
SELECT 
  id,
  'completed',
  NOW(),
  '{
    "welcome": true,
    "profile": true,
    "search": true,
    "bookmark": true,
    "tier": true,
    "kanban": true,
    "detail": true,
    "tabs_tour": true,
    "brief": true
  }'::jsonb
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM user_onboarding);
```

---

## Historial de Cambios

| Fecha | Cambio |
|-------|--------|
| 23/01/2026 | Creación del documento |
