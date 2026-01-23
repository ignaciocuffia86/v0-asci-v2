# ASCI - Roadmap de Features

> **Última actualización**: 21 de enero 2026

Este documento consolida todas las features planificadas para ASCI, con sus respectivos planes de implementación detallados.

---

## Resumen de Features

| # | Feature | Estado | Prioridad | Esfuerzo | Documento |
|---|---------|--------|-----------|----------|-----------|
| 1 | Documentos del Vendedor y Contexto Enriquecido | Planificación | Alta | 8-12 días | [Ver plan](./FEATURE_SELLER_DOCUMENTS_PLAN.md) |
| 2 | Filtro por Industria en Búsquedas | Planificación | Media | 8-13 horas | [Ver plan](./FEATURE_INDUSTRY_FILTER_PLAN.md) |
| 3 | Dashboard de Salud de la Plataforma v2 | Planificación | Media-Alta | 7-11 horas | [Ver plan](./FEATURE_DASHBOARD_IMPROVEMENTS_PLAN.md) |

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

## Otros Documentos Técnicos

| Documento | Descripción |
|-----------|-------------|
| [ETL_PROCESS.md](./ETL_PROCESS.md) | Documentación del proceso ETL |
| [ETL_SYSTEM.md](./ETL_SYSTEM.md) | Arquitectura del sistema ETL |
| [digest.md](./digest.md) | Notas y decisiones técnicas |

---

## Priorización Sugerida

### Corto Plazo (Q1 2026)
1. **Dashboard Improvements** - Visibilidad crítica para operaciones
2. **Filtro por Industria** - Quick win para mejorar UX de búsqueda

### Mediano Plazo (Q1-Q2 2026)
3. **Documentos del Vendedor** - Feature diferenciadora de alto valor

### Largo Plazo (Q2+ 2026)
4. **Recomendación de Cuentas** - Extensión natural de documentos del vendedor
5. **Enriquecimiento de Industrias** - API para completar el 82% sin industria

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
| 21/01/2026 | Creación del roadmap y feature de documentos del vendedor |
| 16/01/2026 | Plan de dashboard improvements |
| Enero 2026 | Plan de filtro por industria |
