# BOT.BIGUA.LAT: Arquitectura MCP para Agentes de IA

## Resumen Ejecutivo

Nueva iteracion de ASCI como MCP (Model Context Protocol) server que permite a agentes de IA consumir inteligencia de cuentas, gestionar secuencias de outreach y coordinar el envio de emails con aprobacion humana.

**Coexistencia en produccion:**
- `asci.bigua.lat` - ASCI v2 actual (produccion, usuarios reales)
- `bot.bigua.lat` - Nueva iteracion MCP

Ambas aplicaciones comparten la misma base de datos Supabase pero estan aisladas:
- **ASCI v2**: Opera sobre schema `public` (tablas existentes)
- **BOT MCP**: Opera sobre schema `v3` (tablas nuevas) + lectura de `public` para datos compartidos

**Principio rector**: v2 esta en produccion con usuarios reales. v3 no puede generar ningun cambio que afecte v2.

---

## Decisiones de Arquitectura Confirmadas

| Tema | Decision |
|------|----------|
| Metadata de bookmarks | Crear `v3.bookmark_metadata` en lugar de modificar `public.bookmarks` |
| Matching de CSV | Automatico con normalizacion + fuzzy ratio, requiere confirmacion manual |
| Auto-match | Solo cuando dominio coincide exactamente Y nombre es similar (>85%) |
| Creacion de companies | NO se pueden crear nuevas companies, solo buscar en `public.companies` |
| Ambiente | Produccion directa (no hay usuarios actuales en BOT) |
| Auth MCP | API key vinculada a user_id, todas las operaciones scoped al usuario |
| Rate limits | Por usuario, 1 API key por usuario |
| Apollo costs | ASCI absorbe el costo (rate limits controlan abuso) |
| Apollo data | Lee contactos existentes + puede disparar busquedas on-demand |
| Apollo scope | Solo bookmarks activos del usuario |
| Integracion Apify | Nuevo desarrollo |
| Transporte MCP | HTTP Streamable (sin WebSockets) |
| Real-time dashboard | Supabase Realtime |
| Notificacion a agentes | Webhooks (HMAC-SHA256 firmados) |
| Sistema de colas | Trigger.dev (mejor reporting) |
| Tech Radar | Ya existe (Parallel + Gemini), se ejecuta en tandas de 5 |
| Prospeccion | Usuario selecciona 5 cuentas a la vez para trabajar |

---

## Arquitectura General

### Estructura de Repositorios

```
Organizacion GitHub
├── asci-core/                    # Paquete NPM privado @asci/core
│   ├── src/
│   │   ├── db/                   # Cliente Supabase tipado
│   │   ├── types/                # Tipos TypeScript compartidos
│   │   └── utils/                # Utilidades comunes
│   └── package.json
│
├── v0-asci-v2/                   # ASCI Web actual (este repo)
│   ├── app/
│   └── package.json              # Importa @asci/core
│
└── bigua-bot/                    # NUEVO: MCP Server + Dashboard
    ├── apps/
    │   ├── mcp-server/           # MCP Server (Node.js)
    │   └── dashboard/            # Next.js - UI de configuracion
    └── package.json              # Importa @asci/core
```

### Deployments en Vercel

| Proyecto | Dominio | Proposito |
|----------|---------|-----------|
| v0-asci-v2 | asci.bigua.lat | ASCI actual - busqueda y bookmarks (PROD) |
| bigua-bot-dashboard | bot.bigua.lat | Dashboard de configuracion MCP |
| bigua-bot-mcp | api.bot.bigua.lat | MCP Server (streamable HTTP) |

### Base de Datos - Estrategia de Schemas

```
Supabase Database
├── public (schema)               # ASCI v2 - NO MODIFICAR
│   ├── companies                 # Lectura compartida
│   ├── bookmarks                 # Lectura compartida  
│   ├── signals                   # Lectura compartida
│   ├── news                      # Lectura compartida
│   ├── contacts                  # Lectura compartida
│   ├── documents                 # Lectura compartida (propuesta de valor)
│   └── users                     # Auth compartida
│
└── v3 (schema)                   # BOT MCP - Nuevas tablas
    ├── bookmark_metadata         # Extension de bookmarks (sin FK cross-schema)
    ├── excluded_accounts         # Blacklist
    ├── csv_imports               # Tracking de importaciones
    ├── csv_import_rows           # Filas pendientes de resolver
    ├── api_keys                  # Autenticacion MCP
    ├── email_sequences           # Secuencias de outreach
    ├── email_queue               # Cola de emails pendientes
    ├── contact_rankings          # Priorizacion A/B/C
    ├── webhooks                  # Configuracion de webhooks
    ├── user_tiers                # Limites por plan
    ├── prospection_batches       # Tandas de 5 cuentas a prospectar
    └── prospection_jobs          # Jobs de Trigger.dev
```

---

## Modelo de Datos: Bookmarks = Whitelist

### Decision Arquitectonica Clave

**Los bookmarks existentes SON la whitelist de cuentas objetivo.**

- Los usuarios que tienen bookmarks en ASCI -> esos bookmarks son sus cuentas objetivo
- Cuando un usuario sube un CSV con nuevas cuentas -> se crean bookmarks automaticamente
- La metadata adicional para MCP vive en `v3.bookmark_metadata` (sin modificar `public.bookmarks`)
- La blacklist vive en `v3.excluded_accounts`
- **NO se pueden crear nuevas companies**: El CSV solo matchea contra `public.companies` existentes

---

## Flujo de Usuario Completo

### Vision General del Journey

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FLUJO COMPLETO DEL USUARIO                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FASE 1: SETUP                    FASE 2: PROSPECCION                       │
│  ────────────────                 ─────────────────────                     │
│                                                                             │
│  ┌──────────────┐                 ┌──────────────────┐                      │
│  │ Subir CSV    │                 │ Seleccionar 5    │                      │
│  │ de cuentas   │                 │ cuentas para     │                      │
│  │ target       │                 │ prospectar       │                      │
│  └──────┬───────┘                 └────────┬─────────┘                      │
│         │                                  │                                │
│         ▼                                  ▼                                │
│  ┌──────────────┐                 ┌──────────────────┐                      │
│  │ Matching     │                 │ Tech Radar       │──┐                   │
│  │ automatico   │                 │ (Parallel)       │  │ Trigger.dev       │
│  │ + revision   │                 │ Senales, noticias│  │ en background     │
│  └──────┬───────┘                 └────────┬─────────┘  │                   │
│         │                                  │            │                   │
│         ▼                                  ▼            │                   │
│  ┌──────────────┐                 ┌──────────────────┐  │                   │
│  │ Crear        │                 │ Buscar decision  │◄─┘                   │
│  │ bookmarks    │                 │ makers (Apollo)  │                      │
│  │ confirmados  │                 │ Ranquear A/B/C   │                      │
│  └──────┬───────┘                 └────────┬─────────┘                      │
│         │                                  │                                │
│         ▼                                  ▼                                │
│  ┌──────────────┐                 ┌──────────────────┐                      │
│  │ Generar      │                 │ Agente IA genera │                      │
│  │ API Key      │                 │ emails con       │                      │
│  │              │                 │ icebreakers      │                      │
│  └──────────────┘                 └────────┬─────────┘                      │
│                                            │                                │
│                                            ▼                                │
│                                   ┌──────────────────┐                      │
│                                   │ Usuario aprueba  │                      │
│                                   │ o edita emails   │                      │
│                                   │ (Dashboard)      │                      │
│                                   └────────┬─────────┘                      │
│                                            │                                │
│                                            ▼                                │
│                                   ┌──────────────────┐                      │
│                                   │ Agente envia     │                      │
│                                   │ email (Gmail)    │                      │
│                                   └────────┬─────────┘                      │
│                                            │                                │
│                                            ▼                                │
│                                   ┌──────────────────┐                      │
│                                   │ Sin respuesta?   │                      │
│                                   │ Escalar a        │                      │
│                                   │ contacto B/C     │                      │
│                                   └──────────────────┘                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Fase 1: Onboarding en bot.bigua.lat

```
┌─────────────────────────────────────────────────────────────────────┐
│  Bienvenido a ASCI MCP                                              │
│                                                                     │
│  Conecta tu agente de IA para automatizar prospection.              │
│                                                                     │
│  Detectamos que ya tienes:                                          │
│  • 47 empresas en seguimiento (bookmarks)                           │
│  • 3 documentos de propuesta de valor                               │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Paso 1: Define tus cuentas objetivo                        │    │
│  │                                                             │    │
│  │  ( ) Usar mis 47 bookmarks actuales como whitelist          │    │
│  │  ( ) Importar CSV con nuevas cuentas objetivo               │    │
│  │  ( ) Ambos: bookmarks + CSV adicional                       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  IMPORTANTE: Solo puedes trabajar con empresas que ya existen       │
│  en la base de datos de ASCI. El CSV busca matches, no crea         │
│  nuevas empresas.                                                   │
│                                              [Continuar ->]         │
└─────────────────────────────────────────────────────────────────────┘
```

### Fase 2: Importar CSV de Whitelist

**Paso 2.1: Subir archivo**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Importar Cuentas Objetivo                                          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                                                             │    │
│  │         Arrastra tu CSV aqui o [Seleccionar archivo]        │    │
│  │                                                             │    │
│  │         Formato esperado:                                   │    │
│  │         company_name (obligatorio), domain (opcional)       │    │
│  │                                                             │    │
│  │         Nota: Solo se matcheara con empresas existentes     │    │
│  │         en ASCI. No se crean nuevas empresas.               │    │
│  │                                                             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  [Descargar plantilla CSV]                                          │
└─────────────────────────────────────────────────────────────────────┘
```

**Paso 2.2: Resultados del matching**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Resultados de Importacion                               [Exportar] │
│                                                                     │
│  100 filas procesadas contra base de datos de ASCI                  │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ 72 Auto-matched  │  │ 15 Requieren     │  │ 13 Sin match     │   │
│  │ ✓ Listos        │  │ revision         │  │ No en ASCI       │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  Requieren revision (15):                                           │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ CSV: "Globant SA"                                             │  │
│  │ Dominio CSV: globant.com ✓                                    │  │
│  │                                                               │  │
│  │ Match encontrado:                                             │  │
│  │ • Globant LLC (globant.com) - 78% confianza                   │  │
│  │                                                               │  │
│  │ Nota: El dominio coincide pero el nombre legal es diferente.  │  │
│  │                                                               │  │
│  │ [Confirmar match]  [Ignorar]                                  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ CSV: "Banco Galicia"                                          │  │
│  │ (sin dominio)                                                 │  │
│  │                                                               │  │
│  │ Candidatos encontrados:                                       │  │
│  │ ○ Banco de Galicia y Buenos Aires SA - 89%                    │  │
│  │ ○ Grupo Financiero Galicia - 72%                              │  │
│  │ ○ Galicia Seguros - 65%                                       │  │
│  │                                                               │  │
│  │ [Seleccionar]  [Ignorar]                                      │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Sin match (13): Estas empresas no existen en ASCI                  │
│  • "Startup XYZ" - No encontrada                                    │
│  • "Empresa Fantasma" - No encontrada                               │
│  (Puedes buscarlas manualmente en asci.bigua.lat)                   │
│                                                                     │
│                    [Finalizar importacion]                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Fase 3: Seleccionar Cuentas a Prospectar (Tandas de 5)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Selecciona las cuentas para prospectar                             │
│                                                                     │
│  Tienes 72 cuentas listas para trabajar.                            │
│  Selecciona hasta 5 para comenzar la prospeccion.                   │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ [x] Mercado Libre                                             │  │
│  │     Ultima senal: Job posting "Cloud Architect" (hace 3 dias) │  │
│  │     Tech Radar: Pendiente                                     │  │
│  │     Decision makers: No enriquecido                           │  │
│  ├───────────────────────────────────────────────────────────────┤  │
│  │ [x] Globant                                                   │  │
│  │     Ultima senal: Expansion Brasil (hace 1 semana)            │  │
│  │     Tech Radar: Pendiente                                     │  │
│  │     Decision makers: No enriquecido                           │  │
│  ├───────────────────────────────────────────────────────────────┤  │
│  │ [x] Despegar                                                  │  │
│  │     Ultima senal: Ninguna reciente                            │  │
│  │     Tech Radar: Pendiente                                     │  │
│  │     Decision makers: No enriquecido                           │  │
│  ├───────────────────────────────────────────────────────────────┤  │
│  │ [x] Ualá                                                      │  │
│  │     Ultima senal: Ronda de inversion (hace 2 semanas)         │  │
│  │     Tech Radar: Pendiente                                     │  │
│  │     Decision makers: No enriquecido                           │  │
│  ├───────────────────────────────────────────────────────────────┤  │
│  │ [x] Auth0                                                     │  │
│  │     Ultima senal: Nuevo producto (hace 5 dias)                │  │
│  │     Tech Radar: Pendiente                                     │  │
│  │     Decision makers: No enriquecido                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Seleccionadas: 5/5                                                 │
│                                                                     │
│  Al continuar se ejecutara:                                         │
│  1. Tech Radar para cada cuenta (noticias, casos de exito)         │
│  2. Busqueda de decision makers                                     │
│                                                                     │
│                                [Comenzar prospeccion ->]            │
└─────────────────────────────────────────────────────────────────────┘
```

### Fase 4: Prospeccion en Background (Trigger.dev)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Prospeccion en progreso                                            │
│                                                                     │
│  Tanda: 5 cuentas seleccionadas                                     │
│  Estado: Procesando                                                 │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  Mercado Libre                                                │  │
│  │  ├── Tech Radar    ████████████████████ Completado ✓          │  │
│  │  └── Decision Makers  Pendiente (esperando Tech Radar)        │  │
│  │                                                               │  │
│  │  Globant                                                      │  │
│  │  ├── Tech Radar    ████████████░░░░░░░░ 60%                   │  │
│  │  └── Decision Makers  Pendiente                               │  │
│  │                                                               │  │
│  │  Despegar                                                     │  │
│  │  ├── Tech Radar    ████░░░░░░░░░░░░░░░░ 20%                   │  │
│  │  └── Decision Makers  Pendiente                               │  │
│  │                                                               │  │
│  │  Ualá                                                         │  │
│  │  ├── Tech Radar    En cola...                                 │  │
│  │  └── Decision Makers  Pendiente                               │  │
│  │                                                               │  │
│  │  Auth0                                                        │  │
│  │  ├── Tech Radar    En cola...                                 │  │
│  │  └── Decision Makers  Pendiente                               │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Nota: El Tech Radar se ejecuta de a 1 cuenta para evitar          │
│  saturar los servicios. Maximo 5 en cola.                          │
│                                                                     │
│  Puedes cerrar esta pagina. Te notificaremos cuando este listo.    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Fase 5: Seleccion de Cargos para Apollo

Una vez que el Tech Radar termina, el usuario debe indicar que cargos buscar.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Buscar Decision Makers                                             │
│                                                                     │
│  El Tech Radar esta completo para 5 cuentas.                        │
│  Ahora necesitamos buscar los contactos correctos.                  │
│                                                                     │
│  Basado en tu propuesta de valor:                                   │
│  • Producto: "Plataforma de Cloud Migration"                        │
│  • Industrias: SaaS, Fintech, E-commerce                            │
│  • Proceso que impactan: Infraestructura, DevOps                    │
│  • KPIs: Reduccion de costos cloud 30%, Time to market -40%         │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Cargos recomendados para tu solucion:                        │  │
│  │                                                               │  │
│  │  [x] CTO / Chief Technology Officer                           │  │
│  │  [x] VP of Engineering                                        │  │
│  │  [x] Head of Infrastructure / Platform                        │  │
│  │  [ ] Director of IT                                           │  │
│  │  [ ] Cloud Architect                                          │  │
│  │  [ ] DevOps Manager                                           │  │
│  │                                                               │  │
│  │  + Agregar cargo personalizado: [____________________]        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Estos cargos se usaran para las 5 cuentas seleccionadas.          │
│  Puedes ajustar por cuenta individual despues.                     │
│                                                                     │
│                                    [Buscar decision makers ->]      │
└─────────────────────────────────────────────────────────────────────┘
```

### Fase 6: Dashboard de Cuentas Listas para Agente

```
┌─────────────────────────────────────────────────────────────────────┐
│  Cuentas listas para prospeccion                    [+ Nueva tanda] │
│                                                                     │
│  Tu agente IA ahora puede trabajar con estas cuentas.               │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Mercado Libre                                      [Ver mas]  │  │
│  │                                                               │  │
│  │ Tech Radar: ✓ Completado                                      │  │
│  │ • 3 noticias relevantes                                       │  │
│  │ • Stack: AWS, Kubernetes, Go, Java                            │  │
│  │ • Senal: Buscando Cloud Architect                             │  │
│  │                                                               │  │
│  │ Decision Makers: ✓ 3 encontrados                              │  │
│  │ A: Juan Perez (CTO) - juan@mercadolibre.com                   │  │
│  │ B: Carlos Lopez (VP Infra) - carlos@mercadolibre.com          │  │
│  │ C: Ana Martinez (Dir Eng) - ana@mercadolibre.com              │  │
│  │                                                               │  │
│  │ Icebreaker sugerido:                                          │  │
│  │ "Vi que estan buscando un Cloud Architect. Nuestra plataforma │  │
│  │  de migration podria acelerar la transicion..."               │  │
│  │                                                               │  │
│  │ Estado: Listo para contactar                                  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Globant                                            [Ver mas]  │  │
│  │ ...                                                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  67 cuentas restantes sin prospectar                                │
│  [Seleccionar proximas 5 cuentas]                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Fase 7: Flujo del Agente (MCP)

El agente de IA del usuario se conecta y ejecuta:

```
AGENTE                                    ASCI MCP                         DASHBOARD
   │                                          │                                │
   │ 1. get_bookmarks({ prospection_ready })  │                                │
   │─────────────────────────────────────────>│                                │
   │          Retorna 5 cuentas listas        │                                │
   │<─────────────────────────────────────────│                                │
   │                                          │                                │
   │ 2. get_account_intelligence("ML-123")    │                                │
   │─────────────────────────────────────────>│                                │
   │    Retorna tech radar, noticias, senales │                                │
   │<─────────────────────────────────────────│                                │
   │                                          │                                │
   │ 3. get_decision_makers("ML-123")         │                                │
   │─────────────────────────────────────────>│                                │
   │    Retorna A/B/C con icebreakers         │                                │
   │<─────────────────────────────────────────│                                │
   │                                          │                                │
   │ 4. get_user_documents()                  │                                │
   │─────────────────────────────────────────>│                                │
   │    Retorna propuesta de valor            │                                │
   │<─────────────────────────────────────────│                                │
   │                                          │                                │
   │ [Agente redacta email personalizado]     │                                │
   │                                          │                                │
   │ 5. queue_email_for_approval({...})       │                                │
   │─────────────────────────────────────────>│                                │
   │                                          │────Supabase Realtime──────────>│
   │                                          │                                │
   │                                          │                     Usuario ve │
   │                                          │                     email nuevo│
   │                                          │                                │
   │                                          │<───────Usuario aprueba─────────│
   │                                          │                                │
   │ 6. Webhook: email.approved               │                                │
   │<─────────────────────────────────────────│                                │
   │                                          │                                │
   │ [Agente envia via Gmail API]             │                                │
   │                                          │                                │
   │ 7. update_email_status("sent")           │                                │
   │─────────────────────────────────────────>│                                │
   │                                          │                                │
   │         [5 dias sin respuesta]           │                                │
   │                                          │                                │
   │ 8. Webhook: sequence.escalated           │                                │
   │<─────────────────────────────────────────│                                │
   │                                          │                                │
   │ 9. get_decision_makers("ML-123")         │                                │
   │─────────────────────────────────────────>│                                │
   │    Ahora sugiere contacto B              │                                │
   │<─────────────────────────────────────────│                                │
   │                                          │                                │
```

### Fase 8: Dashboard de Aprobacion de Emails

```
┌─────────────────────────────────────────────────────────────────────┐
│  ASCI MCP Dashboard                          [Configuracion] [Exit] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐            │
│  │ 3 Pendientes  │  │ 12 Enviados   │  │ 2 Respuestas  │            │
│  │ de aprobar    │  │ esta semana   │  │ recibidas     │            │
│  └───────────────┘  └───────────────┘  └───────────────┘            │
│                                                                     │
│  ═══════════════════════════════════════════════════════════════    │
│                                                                     │
│  Emails Pendientes de Aprobacion                                    │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Para: Juan Perez (CTO @ Mercado Libre)              Hace 5m   │  │
│  │ Asunto: Optimizacion de infraestructura cloud                 │  │
│  │                                                               │  │
│  │ Hola Juan,                                                    │  │
│  │                                                               │  │
│  │ Note que estan buscando un Cloud Architect en LinkedIn.       │  │
│  │ Nosotros ayudamos a empresas como Mercado Libre a reducir     │  │
│  │ costos de cloud hasta un 30%...                               │  │
│  │                                                               │  │
│  │ Contexto usado:                                               │  │
│  │ • Senal: Job posting "Cloud Architect" (hace 3 dias)          │  │
│  │ • Noticia: "ML expande operaciones en Brasil"                 │  │
│  │ • Doc: "Propuesta Cloud Migration"                            │  │
│  │                                                               │  │
│  │ [Ver completo]  [Editar]  [Aprobar ✓]  [Rechazar ✗]           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Integracion Apollo via MCP

### Arquitectura de Apollo en el MCP

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ASCI (Tu App)                                  │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐  │
│  │ lib/apollo/*    │    │ app/actions/*   │    │ app/api/mcp/*       │  │
│  │                 │    │                 │    │                     │  │
│  │ - client.ts     │◄───│ - apollo.ts     │◄───│  MCP Server HTTP    │  │
│  │ - search.ts     │    │ (Server Actions)│    │  Endpoints          │  │
│  │ - enrich.ts     │    │                 │    │                     │  │
│  └────────┬────────┘    └─────────────────┘    └──────────┬──────────┘  │
│           │                                               │             │
│           │  APOLLO_API_KEY                               │             │
│           │  (env var de ASCI)                            │             │
│           ▼                                               │             │
│  ┌─────────────────┐                                      │             │
│  │  Apollo.io API  │                                      │             │
│  └─────────────────┘                                      │             │
└───────────────────────────────────────────────────────────┼─────────────┘
                                                            │
                                            Autenticacion   │
                                            via API Key     │
                                            del usuario     │
                                                            ▼
                                              ┌─────────────────────────┐
                                              │   Agente IA Externo     │
                                              │   (Claude, GPT, etc.)   │
                                              │                         │
                                              │   Usa MCP para:         │
                                              │   - get_decision_makers │
                                              │   - search_companies    │
                                              │   - draft_email         │
                                              └─────────────────────────┘
```

### Flujo de get_decision_makers

```typescript
// app/api/mcp/tools/get-decision-makers/route.ts
export async function POST(req: Request) {
  // 1. Validar API key del usuario (de header Authorization)
  const apiKey = req.headers.get('Authorization')?.replace('Bearer ', '')
  const user = await validateMcpApiKey(apiKey) // busca en v3.api_keys
  
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  // 2. Rate limit check
  const allowed = await checkRateLimit(user.id)
  if (!allowed) {
    return Response.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }
  
  // 3. Verificar que el usuario tiene bookmark activo de esta company
  const { company_id } = await req.json()
  const bookmark = await verifyUserBookmark(user.id, company_id)
  
  if (!bookmark) {
    return Response.json({ 
      error: 'Company not in your bookmarks. Add it first in ASCI.' 
    }, { status: 403 })
  }
  
  // 4. Verificar si la cuenta fue prospectada (tiene metadata)
  const metadata = await getBookmarkMetadata(bookmark.id)
  
  if (!metadata?.prospection_ready) {
    return Response.json({ 
      error: 'Account not prospected yet. Select it in a batch of 5 first.' 
    }, { status: 400 })
  }
  
  // 5. Buscar contactos ya enriquecidos
  const existingContacts = await getEnrichedContacts(company_id, user.id)
  
  if (existingContacts.length > 0) {
    // Retornar contactos con rankings
    return Response.json({
      decision_makers: existingContacts,
      source: 'cached',
      analysis_date: metadata.last_prospected_at
    })
  }
  
  // 6. Si no hay, disparar busqueda en Apollo on-demand
  // Usa los job_titles configurados por el usuario
  const userJobTitles = await getUserPreferredTitles(user.id)
  
  const result = await searchApolloProspects(
    bookmark.id,
    userJobTitles,
    undefined,
    null,
    { maxResults: 10 }
  )
  
  // 7. Generar rankings A/B/C con IA
  const rankedContacts = await rankDecisionMakers(
    result.contacts,
    user.id,
    company_id
  )
  
  return Response.json({
    decision_makers: rankedContacts,
    source: 'apollo_live',
    analysis_date: new Date().toISOString()
  })
}
```

### Recomendacion de Cargos (basada en contexto del usuario)

```typescript
// lib/recommendations/job-titles.ts

interface UserContext {
  products: string[];           // De documents
  target_industries: string[];  // De documents
  processes_impacted: string[]; // De documents
  kpis: string[];              // De documents
  company_size_range: string;   // Configurado por usuario
}

const JOB_TITLE_RECOMMENDATIONS = {
  // Por proceso que impactan
  "Infrastructure": ["CTO", "VP of Engineering", "Head of Infrastructure", "Cloud Architect"],
  "DevOps": ["CTO", "VP of Engineering", "DevOps Manager", "Platform Engineer Lead"],
  "Security": ["CISO", "VP of Security", "Head of InfoSec", "Security Architect"],
  "Data": ["CDO", "VP of Data", "Head of Analytics", "Data Engineering Manager"],
  "Product": ["CPO", "VP of Product", "Head of Product", "Product Director"],
  
  // Por industria target
  "Fintech": ["CTO", "VP of Engineering", "Head of Platform", "CISO"],
  "E-commerce": ["CTO", "VP of Engineering", "Head of Infrastructure", "VP of Operations"],
  "SaaS": ["CTO", "VP of Engineering", "VP of Product", "Head of Platform"],
  
  // Por tamaño de empresa
  "startup": ["CTO", "VP of Engineering", "Head of Engineering"],
  "scaleup": ["CTO", "VP of Engineering", "VP of Infrastructure", "Engineering Director"],
  "enterprise": ["CTO", "VP of Engineering", "VP of Infrastructure", "SVP of Technology"]
}

async function getRecommendedJobTitles(
  userId: string,
  companyId: string
): Promise<string[]> {
  // 1. Obtener contexto del usuario (de sus documents)
  const userContext = await getUserContext(userId)
  
  // 2. Obtener info de la company target
  const company = await getCompany(companyId)
  
  // 3. Combinar recomendaciones
  const recommendations = new Set<string>()
  
  // Por proceso
  for (const process of userContext.processes_impacted) {
    const titles = JOB_TITLE_RECOMMENDATIONS[process] || []
    titles.forEach(t => recommendations.add(t))
  }
  
  // Por industria
  const industryTitles = JOB_TITLE_RECOMMENDATIONS[company.industry] || []
  industryTitles.forEach(t => recommendations.add(t))
  
  // Por tamaño
  const sizeCategory = categorizeCompanySize(company.employee_count)
  const sizeTitles = JOB_TITLE_RECOMMENDATIONS[sizeCategory] || []
  sizeTitles.forEach(t => recommendations.add(t))
  
  // Retornar top 5 mas frecuentes
  return Array.from(recommendations).slice(0, 5)
}
```

---

## Sistema de Colas: Trigger.dev

### Estructura de Jobs

```typescript
// trigger/prospection.ts
import { task, queue } from "@trigger.dev/sdk/v3"

// Cola para Tech Radar (de a 1, max 5 en cola)
export const techRadarQueue = queue({
  name: "tech-radar",
  concurrencyLimit: 1,
})

export const runTechRadar = task({
  id: "run-tech-radar",
  queue: techRadarQueue,
  run: async (payload: { 
    bookmarkId: string
    userId: string
    companyId: string 
  }) => {
    // 1. Buscar noticias y casos de exito (Parallel)
    const newsResult = await searchCompanyNews(payload.companyId)
    
    // 2. Analizar stack tecnologico
    const techStack = await analyzeTechStack(payload.companyId)
    
    // 3. Guardar resultados
    await saveTechRadarResults(payload.bookmarkId, {
      news: newsResult,
      tech_stack: techStack,
      analyzed_at: new Date()
    })
    
    // 4. Actualizar metadata
    await updateBookmarkMetadata(payload.bookmarkId, {
      tech_radar_completed: true,
      tech_radar_at: new Date()
    })
    
    return { success: true }
  },
  // Plan B si falla Parallel
  onFailure: async (payload, error) => {
    // Intentar con Gemini como fallback
    try {
      const fallbackResult = await runTechRadarWithGemini(payload.companyId)
      await saveTechRadarResults(payload.bookmarkId, fallbackResult)
    } catch (fallbackError) {
      // Marcar como fallido
      await markTechRadarFailed(payload.bookmarkId, error.message)
    }
  }
})

// Job para procesar un batch de 5 cuentas
export const processProspectionBatch = task({
  id: "process-prospection-batch",
  run: async (payload: {
    batchId: string
    userId: string
    bookmarkIds: string[]
  }) => {
    // Encolar Tech Radar para cada cuenta (se ejecutan de a 1)
    for (const bookmarkId of payload.bookmarkIds) {
      const bookmark = await getBookmark(bookmarkId)
      
      await runTechRadar.trigger({
        bookmarkId,
        userId: payload.userId,
        companyId: bookmark.company_id
      })
    }
    
    return { 
      success: true, 
      queued: payload.bookmarkIds.length 
    }
  }
})
```

### Tabla de Jobs para Reporting

```sql
CREATE TABLE v3.prospection_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  batch_id UUID REFERENCES v3.prospection_batches(id),
  bookmark_id UUID NOT NULL,
  
  -- Tipo de job
  job_type TEXT NOT NULL CHECK (job_type IN ('tech_radar', 'apollo_search', 'ranking')),
  
  -- Estado
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  
  -- Trigger.dev reference
  trigger_job_id TEXT,
  
  -- Resultados
  result JSONB,
  error_message TEXT,
  
  -- Timing
  queued_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE v3.prospection_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Cuentas en el batch
  bookmark_ids UUID[] NOT NULL,
  
  -- Configuracion
  job_titles TEXT[], -- Cargos a buscar en Apollo
  
  -- Estado agregado
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'partial_failure')),
  total_accounts INTEGER,
  completed_accounts INTEGER DEFAULT 0,
  failed_accounts INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

### Dashboard de Reporting

```
┌─────────────────────────────────────────────────────────────────────┐
│  Historial de Prospeccion                                           │
│                                                                     │
│  Este mes:                                                          │
│  • 35 cuentas subidas por CSV                                       │
│  • 20 cuentas prospectadas (4 batches)                              │
│  • 45 decision makers encontrados                                   │
│  • 28 emails enviados                                               │
│  • 3 respuestas recibidas                                           │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Batch #4 - Hace 2 dias                              Completado│  │
│  │ Cuentas: Mercado Libre, Globant, Despegar, Uala, Auth0       │  │
│  │ Tech Radar: 5/5 ✓                                             │  │
│  │ Decision Makers: 15 encontrados                               │  │
│  │ Emails enviados: 8                                            │  │
│  │ Respuestas: 1                                                 │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Batch #3 - Hace 1 semana                            Completado│  │
│  │ ...                                                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Nuevas Tablas de Base de Datos (Schema v3)

### 1. `v3.bookmark_metadata` - Extension de bookmarks para MCP

```sql
CREATE SCHEMA IF NOT EXISTS v3;

CREATE TABLE v3.bookmark_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bookmark_id UUID NOT NULL, -- Referencia logica a public.bookmarks(id), sin FK cross-schema
  user_id UUID NOT NULL,     -- Denormalizado para RLS
  
  -- Flags de prospeccion
  is_target_account BOOLEAN DEFAULT true,
  
  -- Estado de prospeccion
  prospection_ready BOOLEAN DEFAULT false, -- true cuando tech_radar + apollo completados
  
  -- Tech Radar
  tech_radar_completed BOOLEAN DEFAULT false,
  tech_radar_at TIMESTAMPTZ,
  tech_radar_result JSONB,
  
  -- Apollo
  apollo_searched BOOLEAN DEFAULT false,
  apollo_searched_at TIMESTAMPTZ,
  job_titles_used TEXT[],
  
  -- Tracking
  last_prospected_at TIMESTAMPTZ,
  current_sequence_id UUID,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(bookmark_id)
);

ALTER TABLE v3.bookmark_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own bookmark metadata" ON v3.bookmark_metadata
  FOR ALL USING (auth.uid() = user_id);
```

### 2-10: [Resto de tablas igual que antes...]

---

## Logica de Matching de CSV

### Campos esperados del CSV

```
company_name (obligatorio)
domain (opcional pero mejora precision)
```

### Importante: Solo Busqueda, No Creacion

El CSV matchea contra `public.companies` existentes. Las empresas que no se encuentran:
- Se marcan como `no_match`
- El usuario debe buscarlas manualmente en asci.bigua.lat
- NO se crean nuevas companies automaticamente

### Algoritmo de Matching

```typescript
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|sa|srl|corp|corporation|ltd|gmbh|s\.a\.|s\.r\.l\.)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, '')
    .replace(/\/.*$/, '')
    .trim();
}

function fuzzyRatio(str1: string, str2: string): number {
  // Levenshtein distance normalizado
  // Retorna 0-1 donde 1 es match exacto
}
```

### Matriz de Decision

| Dominio CSV | Dominio DB | Nombre Ratio | Resultado | Accion |
|-------------|------------|--------------|-----------|--------|
| Existe | Coincide | >= 85% | `auto_matched` | Crear bookmark automaticamente |
| Existe | Coincide | < 85% | `needs_review` | Mostrar para confirmacion (posible rebrand) |
| Existe | No coincide | - | `ambiguous` | Mostrar candidatos por nombre |
| No existe | - | >= 85% exacto | `needs_review` | Confirmar empresa correcta |
| No existe | - | 60-84% | `ambiguous` | Mostrar multiples candidatos |
| No existe | - | < 60% | `no_match` | No se puede crear, ignorar |

---

## MCP Server - Tools Expuestos

### 1. `get_bookmarks`
Lista los bookmarks del usuario con estado de prospeccion.

### 2. `get_account_intelligence`
Obtiene inteligencia de una cuenta (requiere que este prospectada).

### 3. `get_decision_makers`
Obtiene contactos priorizados A/B/C con icebreakers.
- Si hay contactos cacheados, los retorna
- Si no, dispara busqueda en Apollo on-demand

### 4. `get_recommended_job_titles`
**NUEVO**: Retorna cargos recomendados basados en el contexto del usuario.

```typescript
interface GetRecommendedJobTitlesInput {
  company_id: string;
}

interface GetRecommendedJobTitlesOutput {
  recommended_titles: string[];
  reasoning: {
    based_on_products: string[];
    based_on_industries: string[];
    based_on_processes: string[];
    company_size_factor: string;
  };
}
```

### 5. `get_user_documents`
Obtiene documentos/propuesta de valor del usuario.

### 6. `search_accounts`
Busca cuentas en la base de ASCI.

### 7. `queue_email_for_approval`
Encola un email para aprobacion.

### 8. `get_email_status`
Consulta el estado de emails.

---

## Sistema de Webhooks

### Eventos Disponibles

| Evento | Descripcion |
|--------|-------------|
| `email.queued` | Email encolado para aprobacion |
| `email.approved` | Usuario aprobo email |
| `email.rejected` | Usuario rechazo email |
| `email.sent` | Email marcado como enviado |
| `sequence.escalated` | Secuencia lista para contacto B/C |
| `prospection.batch_completed` | Batch de 5 cuentas listo |
| `tech_radar.completed` | Tech Radar de una cuenta listo |

### Firma HMAC-SHA256

```typescript
// Header: X-ASCI-Signature: sha256=<signature>
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(JSON.stringify(payload))
  .digest('hex')
```

---

## Rate Limits por Tier

| Tier | Calls/min | Calls/dia | Emails/dia | Cuentas ABM |
|------|-----------|-----------|------------|-------------|
| beta | 60 | 1,000 | 50 | 100 |
| starter | 30 | 500 | 20 | 50 |
| pro | 120 | 5,000 | 100 | 200 |
| enterprise | 300 | ilimitado | ilimitado | ilimitado |

---

## Decisiones Confirmadas

| Pregunta | Respuesta |
|----------|-----------|
| Modificar public.bookmarks? | NO - usar v3.bookmark_metadata |
| Crear companies desde CSV? | NO - solo buscar en public.companies |
| Matching CSV | Auto (regex + fuzzy >85%) + confirmacion manual |
| Apollo costs | ASCI absorbe el costo |
| Apollo scope | Solo bookmarks activos del usuario |
| Apollo data | Lee existentes + busqueda on-demand |
| Seleccion de cargos | ASCI recomienda basado en contexto del usuario |
| Tech Radar | Ya existe (Parallel), se ejecuta en tandas de 5 |
| Sistema de colas | Trigger.dev |
| Concurrencia Tech Radar | De a 1, hasta 5 en cola |
| Reintentos | No, pero hay fallback a Gemini |
| UI de progreso | Simple, solo para matching de CSV |
