# ASCI - Roadmap de Features

> **Última actualización**: 21 de enero 2026

Este documento consolida todas las features planificadas para ASCI, con sus respectivos planes de implementación detallados.

---

## Resumen de Features

| # | Feature | Estado | Prioridad | Esfuerzo | Documento |
|---|---------|--------|-----------|----------|-----------|
| 0 | Setup Dev/Prod Environments (Supabase Branches) | En Progreso | Crítica | 2-3 horas | [Ver plan](./SETUP_SUPABASE_BRANCHES.md) |
| 1 | Documentos del Vendedor y Contexto Enriquecido | Planificación | Alta | 8-12 días | [Ver plan](./FEATURE_SELLER_DOCUMENTS_PLAN.md) |
| 2 | Filtro por Industria en Búsquedas | Planificación | Media | 8-13 horas | [Ver plan](./FEATURE_INDUSTRY_FILTER_PLAN.md) |
| 3 | Dashboard de Salud de la Plataforma v2 | Planificación | Media-Alta | 7-11 horas | [Ver plan](./FEATURE_DASHBOARD_IMPROVEMENTS_PLAN.md) |
| 4 | FAQ Helper / Asistente de Ayuda | Planificación | Media | 2-3 días | [Ver plan](./FEATURE_FAQ_HELPER_PLAN.md) |
| 5 | Onboarding Guiado Interactivo | Planificación | Alta | 4-6 días | [Ver plan](./FEATURE_ONBOARDING_PLAN.md) |

---

## 0. Setup Dev/Prod Environments (Supabase Branches)

**Objetivo**: Separar desarrollo de producción usando Supabase Branches en el mismo repo GitHub, permitiendo desarrollo sin riesgo.

### Arquitectura
- **1 repositorio GitHub** (asci)
- **2 ramas**: main (prod), develop (dev)
- **1 proyecto Supabase** con 2 branches: production, preview
- **2 proyectos Vercel**: asci-production, asci-dev
- **3 workflows GitHub Actions**: ci.yml, deploy-dev.yml, deploy-prod.yml

### Flujo
```
Develop local → push develop → CI tests → Deploy dev.asci.bigua.lat
Merge a main → CI tests → Deploy asci.bigua.lat (PROD)
```

### Esfuerzo Estimado: 2-3 horas
1. Configurar Supabase Branches (30 min)
2. GitHub Environments + Secrets (30 min)
3. Vercel Projects + Variables (30 min)
4. Testing flujo completo (30-60 min)

### Status
- ✅ Workflows creados (.github/workflows/)
- ✅ Documentación lista
- ⏳ Pendiente: Configuración manual Supabase, GitHub, Vercel

📄 **[Plan completo](./SETUP_SUPABASE_BRANCHES.md)**

---

## 1. Documentos del Vendedor y Contexto Enriquecido

**Objetivo**: Permitir subir PDFs, brochures, presentaciones y links web para enriquecer briefs e icebreakers con casos de éxito y propuesta de valor específica.

### Alcance
- Máximo 15 documentos por usuario (PDF, DOCX, PPTX)
- Máximo 10 links web por usuario
- Búsqueda semántica con pgvector
- Matching automático de documentos relevantes por cuenta

### Costo Estimado
- **$15-20 USD/mes** para 10 usuarios activos
- Vercel Blob: $2-5/mes
- OpenAI Embeddings: $10/mes
- Gemini (resúmenes): $2-4/mes

### Fases de Implementación
1. **Fundamentos** (2-3 días): pgvector, tablas, upload básico
2. **Embeddings** (2-3 días): chunking, embeddings, búsqueda semántica
3. **Enriquecimiento** (2-3 días): integración con brief e icebreaker
4. **Web Scraping** (1-2 días): agregar URLs de servicios
5. **Recomendaciones** (futuro): matching de cuentas similares

📄 **[Plan completo](./FEATURE_SELLER_DOCUMENTS_PLAN.md)**

---

## 2. Filtro por Industria en Búsquedas

**Objetivo**: Permitir filtrar resultados de búsqueda por industria normalizada (~25 categorías).

### Problema Actual
- 82% de compañías sin industria
- 172 industrias sin normalizar
- Sin opción de filtrar en búsquedas

### Solución
- Crear 25 categorías normalizadas
- Tabla de mapeo industria → categoría
- Trigger para normalización automática
- Multi-select en UI de búsqueda

### Fases de Implementación
1. **Base de Datos** (1-2 horas): tablas y migración
2. **RPCs de Búsqueda** (2-3 horas): agregar filtro
3. **Backend Actions** (1-2 horas): modificar search-v2
4. **Frontend** (3-4 horas): componente IndustryFilter
5. **Admin** (1-2 horas): gestión de mapeos

📄 **[Plan completo](./FEATURE_INDUSTRY_FILTER_PLAN.md)**

---

## 3. Dashboard de Salud de la Plataforma v2

**Objetivo**: Mejorar visibilidad de métricas reales del sistema, tracking de CRONs, y estado de imports.

### Problemas Actuales
- Señales con cap de 1000 (real: 221K+)
- Jobs pendientes mostrando 0 (real: 667+)
- Sin tracking de ejecución de CRONs
- Logs con auto-refresh que rompe scroll

### Solución
- Nueva tabla `cron_executions` para tracking
- RPC sin límite para conteos reales
- Métricas de señales generadas por import
- Logs sin auto-refresh

### Fases de Implementación
1. **Schema** (1-2 horas): nuevas tablas y columnas
2. **CRONs** (2-3 horas): registrar ejecuciones
3. **Dashboard UI** (3-4 horas): nuevo diseño
4. **Real-time** (1-2 horas): Supabase Realtime (opcional)

📄 **[Plan completo](./FEATURE_DASHBOARD_IMPROVEMENTS_PLAN.md)**

---

## 4. FAQ Helper / Asistente de Ayuda Flotante

**Objetivo**: Botón flotante con centro de ayuda contextual para resolver dudas frecuentes de usuarios, con búsqueda y fallback a soporte humano.

### Alcance
- Botón flotante en esquina inferior derecha
- Panel con 9 categorías de ayuda (35+ artículos)
- Búsqueda con fuzzy matching
- Fallback a email: ignacio@bigua.lat

### Categorías de FAQ
1. Primeros Pasos
2. Búsqueda de Señales
3. Gestión de Cuentas (Bookmarks)
4. Detalle de Cuenta
5. Generación con IA
6. Decision Makers
7. Señales Públicas y Noticias
8. Filtros y Organización
9. Mi Perfil y Configuración

### Fases de Implementación
1. **MVP** (1-2 días): datos FAQ, botón flotante, panel accordion
2. **Búsqueda** (0.5 días): fuse.js, highlight de matches
3. **Polish** (0.5 días): animaciones, responsive, accesibilidad

📄 **[Plan completo](./FEATURE_FAQ_HELPER_PLAN.md)**

---

## 5. Onboarding Guiado Interactivo

**Objetivo**: Sistema de onboarding con popups/tooltips que guía a nuevos usuarios paso a paso, requiriendo acciones reales para avanzar.

### Comportamiento
- **Trigger**: Primer login post-registro
- **Persistencia**: Continúa entre sesiones hasta completar o saltar
- **Interactivo**: Usuario realiza acciones reales, no solo lee

### Flujo de 8 Pasos
1. **Bienvenida + Perfil**: Completar propuesta de valor
2. **Búsqueda**: Ejecutar primera búsqueda de señales
3. **Bookmark**: Guardar primera cuenta
4. **Tier**: Asignar prioridad (Alta/Transaccional/Baja)
5. **Kanban**: Cambiar a vista Kanban
6. **Detalle**: Ingresar al detalle de una cuenta
7. **Tour de Tabs**: Recorrer todas las tabs (6 sub-pasos)
8. **Brief**: Generar primer brief ejecutivo

### Modelo de Datos
- Nueva tabla `user_onboarding` con estado y progreso
- Trigger automático al crear usuario
- Migration para usuarios existentes (marcar como completado)

### Diseño Visual
- Tooltips con spotlight en elemento target
- Overlay semi-transparente
- Barra de progreso visible
- Botón "Omitir onboarding" siempre disponible

### Fases de Implementación
1. **Infraestructura** (1-2 días): Tabla, provider, hooks
2. **Componentes Base** (1-2 días): Tooltip, modal, overlay
3. **Integración por Pasos** (1-2 días): 8 pasos + sub-pasos
4. **Polish** (0.5-1 día): Animaciones, responsive, testing

### Relación con FAQ Helper
- Onboarding: Activación inicial, guiado, obligatorio
- FAQ: Disponible siempre, autoservicio, opcional
- Al finalizar onboarding se muestra el FAQ Helper

📄 **[Plan completo](./FEATURE_ONBOARDING_PLAN.md)**

---

## Análisis de Best Practices (25/01/2026)

**Documento**: [ANALYSIS_BEST_PRACTICES.md](./ANALYSIS_BEST_PRACTICES.md)

Análisis completo de la plataforma cubriendo:

### Supabase/Postgres
- 2 tablas con RLS habilitado pero sin policies (`job_postings`, `pending_signals`)
- 26 functions con `search_path` mutable (vulnerabilidad de seguridad)
- 17 Foreign Keys sin índices (impacto en performance)
- 8 RLS policies que re-evalúan `auth.uid()` por fila

### React/Next.js
- Oportunidades de `React.memo` en componentes de lista
- `useCallback` faltante en handlers de bookmarks
- Lazy loading de tabs en bookmark detail
- SWR para data fetching con caching

### Web Design (Solo propuestas)
- Social proof en landing (logos, testimonios)
- Empty states con ilustraciones
- Micro-interacciones mejoradas
- Rediseño de Kanban para mobile

**Scripts de remediación incluidos en el documento.**

---

## Setup de Infraestructura: Development vs Production (Próximo)

**Documento**: [INFRASTRUCTURE_DEV_PROD_SETUP.md](./INFRASTRUCTURE_DEV_PROD_SETUP.md)

Guía completa para separar ambientes con bases de datos independientes:

### Configuración
- 3 Supabase projects independientes (dev, staging, prod)
- 3 branches de Git (develop, release/*, main)
- 3 projects de Vercel con dominios específicos
- GitHub Actions workflows para CI/CD automático

### Ambientes
- **Development** (dev.asci.bigua.lat): Desarrollo activo
- **Staging** (staging.asci.bigua.lat): Pre-producción
- **Production** (asci.bigua.lat): Usuarios reales

### Esfuerzo Estimado
- Fase 1-5: 7-10 horas totales
- Setup de Supabase: 1-2 horas
- Configuración GitHub/Vercel: 2 horas
- CI/CD workflows: 2-3 horas
- Testing e iteración: 2-3 horas

**Checklist y diagramas incluidos en el documento.**

---

## Otros Documentos Técnicos

| Documento | Descripción |
|-----------|-------------|
| [ETL_PROCESS.md](./ETL_PROCESS.md) | Documentación del proceso ETL |
| [ETL_SYSTEM.md](./ETL_SYSTEM.md) | Arquitectura del sistema ETL |
| [digest.md](./digest.md) | Notas y decisiones técnicas |
| [ANALYSIS_BEST_PRACTICES.md](./ANALYSIS_BEST_PRACTICES.md) | Análisis de best practices |
| [INFRASTRUCTURE_DEV_PROD_SETUP.md](./INFRASTRUCTURE_DEV_PROD_SETUP.md) | Setup dev/prod environments |

---

## Priorización Sugerida

### Corto Plazo (Q1 2026)
1. **Onboarding Guiado** - Crítico para activación de nuevos usuarios
2. **FAQ Helper** - Soporte al usuario, reduce carga de soporte manual
3. **Dashboard Improvements** - Visibilidad crítica para operaciones

### Mediano Plazo (Q1-Q2 2026)
4. **Filtro por Industria** - Quick win para mejorar UX de búsqueda
5. **Documentos del Vendedor** - Feature diferenciadora de alto valor

### Largo Plazo (Q2+ 2026)
6. **Recomendación de Cuentas** - Extensión natural de documentos del vendedor
7. **Enriquecimiento de Industrias** - API para completar el 82% sin industria

---

## Cómo Usar Este Roadmap

1. **Para retomar una feature**: Abrir el documento de plan correspondiente
2. **Para estimar**: Cada plan tiene estimación de esfuerzo detallada
3. **Para implementar**: Seguir las fases y checklist en cada documento
4. **Para agregar features**: Crear nuevo `FEATURE_[NOMBRE]_PLAN.md` y actualizar este índice

---

## Historial de Cambios

| Fecha | Cambio |
|-------|--------|
| 25/01/2026 | Setup de Infraestructura: Development vs Production |
| 25/01/2026 | Análisis de Best Practices (Supabase, React, Design) |
| 23/01/2026 | Plan de Onboarding Guiado Interactivo |
| 23/01/2026 | Plan de FAQ Helper / Asistente de Ayuda |
| 21/01/2026 | Creación del roadmap y feature de documentos del vendedor |
| 16/01/2026 | Plan de dashboard improvements |
| Enero 2026 | Plan de filtro por industria |
