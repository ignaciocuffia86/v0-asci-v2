# BOT.BIGUA.LAT — Arquitectura Definitiva

> Documento de referencia unico. Refleja todas las decisiones confirmadas.
> Principio rector: **v2 esta en produccion con usuarios reales. v3 no puede generar ningun cambio que afecte v2.**

---

## 0. Tabla de Decisiones Confirmadas

| Tema | Decision |
|------|----------|
| Schema isolation | Todas las tablas nuevas viven en `v3.*`. Cero modificaciones a `public.*` |
| Bookmarks v2 | `public.bookmarks` no se toca. v3 tiene `v3.campaign_accounts` |
| ETL v2 | `import_batches` / `import_rows` son intocables. CSV de v3 es proceso separado |
| Multi-tenant | Workspace por dominio de correo. Admin = primer usuario del dominio |
| Roles | admin / editor / viewer por workspace |
| Limite de cuentas | 100 por workspace total (todas las campanias combinadas) |
| Docs del workspace | `v3.workspace_documents` — compartido entre todos los miembros del workspace |
| Docs: blocker | Obligatorio subir al menos un documento antes de crear campanias |
| Docs: reprocesamiento | Los documentos se pueden reprocesar, actualizar y agregar |
| Tipos de campana | monitor / prospect / discover |
| Buyer personas | Por campana. Inferidas de docs + diccionario. Editables por el usuario |
| Job titles | Pre-laburados por proceso/tecnologia en diccionario. ASCI infiere y propone |
| Blacklist | Por campana. Una cuenta puede estar blacklisted en A y whitelisted en B |
| Cuentas nuevas (discover) | ASCI recomienda desde `public.companies` con senales que hacen fit |
| Cache global | `company_news`, `company_implementations`, `apollo_contacts_cache` — lectura solamente |
| Apollo | ASCI absorbe el costo. Agente lee cache. ASCI recomienda cargos; usuario dispara busqueda |
| Tech Radar scope | Solo para campanias prospect / discover |
| Tech Radar primera vez | On-demand: usuario selecciona 5 cuentas |
| Tech Radar siguiente | Las restantes se encolan automaticamente en tandas de 5 |
| Tech Radar cron | 1x/mes automatico mientras la cuenta este en alguna campana activa |
| Tech Radar herramienta | Parallel (existente en v2) con fallback a Gemini |
| Sistema de colas | Trigger.dev — de a 1, max 5 en cola, sin reintentos, con fallback |
| Contenedor de info | Cache global compartido + digest filtrado por buyer_persona por campana |
| MCP Auth | API key por usuario, scoped al workspace_id |
| MCP transporte | HTTP Streamable (sin WebSockets) |
| Real-time dashboard | Supabase Realtime |
| Notificacion agentes | Webhooks HMAC-SHA256 |
| Gmail | Integracion externa. TBD: threading y reply tracking |
| DKIM/SPF | Check obligatorio via DNS lookup. Agente bloqueado si no esta configurado |
| CSV matching | Normalizacion + fuzzy ratio >= 85%. No crea nuevas companies |
| CSV: no match | Queda en `csv_import_rows` como `no_match`. Usuario informado |
| Reporting | Trigger.dev dashboard + `v3.activity_log` |

---

## 1. Que es ASCI v3 / bot.bigua.lat

ASCI v3 es una plataforma de prospecting B2B asistida por IA con tres componentes:

1. **Dashboard web** (bot.bigua.lat): donde el usuario configura campanias, revisa señales de cuentas, aprueba emails del agente
2. **MCP Server**: expone herramientas de inteligencia de cuentas a agentes IA externos (Claude, GPT, etc.)
3. **Copiloto de ventas**: panel derecho del dashboard — recomienda icebreakers, redacta emails y gestiona la aprobacion antes del envio

### Layout del home

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  [Logo]   [ Campana actual ▼ ]                            [Workspace] [User] │
├──────────────┬──────────────────────────────────┬───────────────────────────┤
│              │                                  │                           │
│  SIDEBAR     │      DIGEST CENTRAL              │    COPILOTO / AGENTE      │
│  (fijo)      │                                  │    (fijo)                 │
│              │  [Cuenta seleccionada]            │                           │
│  Cuentas     │  ─────────────────────────────── │  Chat con el agente IA    │
│  de la       │                                  │                           │
│  campana:    │  Timeline de señales:             │  Icebreakers sugeridos    │
│              │                                  │  basados en señales       │
│  ○ Acme      │  ● [NUEVA] Acme lanza AI product  │                           │
│  ○ Bigua     │    hace 2 dias                   │  [Redactar email]         │
│  ○ Softtek   │                                  │  [Ver DMs disponibles]    │
│  ○ Despegar  │  ● Acme contrata VP Engineering   │  [Cargos a buscar]        │
│  ...         │    hace 5 dias                   │                           │
│              │                                  │  ─────────────────────── │
│  [+ Agregar  │  ● Uso de Salesforce detectado   │                           │
│   cuenta]    │    en perfil de CTO              │  Feedback de campana:     │
│              │                                  │  "3 emails enviados,      │
│              │  ─────────────────────────────── │   1 respuesta (33%)"      │
│              │                                  │                           │
│              │  DMs identificados:              │                           │
│              │  Juan Perez — CTO       [Email]  │                           │
│              │  Ana Lopez — VP Eng     [Email]  │                           │
│              │                                  │                           │
│              │  [Buscar mas DMs en Apollo]       │                           │
│              │  Cargos sugeridos:               │                           │
│              │  · VP Engineering                │                           │
│              │  · Head of IT                    │                           │
│              │                                  │                           │
└──────────────┴──────────────────────────────────┴───────────────────────────┘
```

**Notas del layout:**
- El selector de campana en el header cambia todo el contexto (sidebar + digest)
- El sidebar muestra cuentas de la campana seleccionada. Click en cuenta = digest de esa cuenta
- El digest tiene badge "NUEVA" para items desde el ultimo login del usuario
- La seccion DMs y cargos sugeridos solo aparece en campanias `prospect` y `discover`
- El copiloto es contextual a la cuenta/campana activa

---

## 2. Modelo de Datos

### 2.1 Tablas de v2 que v3 lee (NUNCA escribe directamente)

| Tabla | Uso en v3 |
|-------|----------|
| `public.companies` | Matching de CSV, display de cuentas, recomendaciones |
| `public.contacts` | Lectura de señales |
| `public.signals` | Filtrado por buyer_persona |
| `public.dictionary_processes` | Inferencia de buyer personas, job titles |
| `public.dictionary_products` | Idem |
| `public.dictionary_patterns_cache` | Matching de señales |
| `public.company_news` | Cache de noticias para digest |
| `public.company_implementations` | Cache de tech radar |
| `public.apollo_contacts_cache` | Contactos pre-enriquecidos |
| `public.job_postings` | Señales de hiring |

> Si v3 necesita escribir en tablas de v2 (ej: guardar contacto nuevo de Apollo),
> lo hace llamando a las RPCs existentes de v2 (`upsert_company`, etc.),
> nunca con INSERT/UPDATE directo.

### 2.2 Separacion ETL v2 vs CSV Import v3

Estos son procesos completamente distintos y no se tocan entre si:

| | ETL v2 (`public.import_batches`) | CSV Import v3 (`v3.csv_imports`) |
|-|----------------------------------|----------------------------------|
| **Que importa** | Contactos de LinkedIn (personas) y Job Postings | Companias (cuentas target) |
| **Para que** | Generar señales de prospeccion | Crear cuentas masivas en campanias |
| **Output** | `contacts`, `signals`, `job_postings` | `v3.campaign_accounts` |
| **Matching** | LinkedIn URL / nombre exacto | Fuzzy nombre + dominio |
| **Crea registros** | Si, contactos y companias nuevas | No — solo busca en `public.companies` |
| **Se toca en v3** | Nunca | Exclusivo de v3 |

### 2.3 Schema v3 completo

```sql
-- ═══════════════════════════════════════════════════════════
-- WORKSPACE Y MULTI-TENANT
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.workspaces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain        TEXT UNIQUE NOT NULL,       -- extraido del email del primer usuario
  name          TEXT NOT NULL,              -- nombre de la empresa
  website_url   TEXT,
  logo_url      TEXT,
  account_count INTEGER DEFAULT 0,          -- total de cuentas en todas las campanias
  max_accounts  INTEGER DEFAULT 100,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE v3.workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT CHECK (role IN ('admin', 'editor', 'viewer')) NOT NULL,
  status        TEXT CHECK (status IN ('pending', 'active', 'rejected')) DEFAULT 'pending',
  invited_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);

-- ═══════════════════════════════════════════════════════════
-- DOCUMENTOS DEL WORKSPACE
-- Separado de user_documents de v2. Compartido entre miembros.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.workspace_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  uploaded_by       UUID REFERENCES auth.users(id),
  filename          TEXT NOT NULL,
  file_url          TEXT NOT NULL,          -- Vercel Blob URL
  document_type     TEXT CHECK (document_type IN (
    'landing', 'case_study', 'brochure', 'deck', 'other'
  )),

  -- Output del procesamiento IA (matcheado contra el diccionario de v2)
  processing_status TEXT CHECK (processing_status IN (
    'pending', 'processing', 'completed', 'failed'
  )) DEFAULT 'pending',
  extracted_industries   TEXT[],
  extracted_processes    TEXT[],            -- IDs de dictionary_processes
  extracted_technologies TEXT[],            -- IDs de dictionary_products
  extracted_kpis         TEXT[],
  extracted_roi_signals  TEXT[],
  raw_extracted_text     TEXT,

  version      INTEGER DEFAULT 1,           -- incrementa al reprocesar
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- BUYER PERSONAS
-- Por campana. Inferidas de docs. Editables por el usuario.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.buyer_personas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  campaign_id   UUID,                       -- FK a v3.campaigns (se agrega con ALTER luego)
  name          TEXT NOT NULL,              -- "CTO en SaaS Fintech"

  -- Inferido de workspace_documents cruzado con el diccionario de v2
  target_processes       TEXT[],            -- IDs de public.dictionary_processes
  target_technologies    TEXT[],            -- IDs de public.dictionary_products
  target_industries      TEXT[],
  kpi_signals            TEXT[],
  roi_signals            TEXT[],

  -- Job titles recomendados
  -- Pre-laburados en el diccionario por proceso/tecnologia, luego ASCI infiere nuevos
  recommended_job_titles TEXT[],

  -- Señales que se consideran relevantes para el digest de esta persona
  relevant_signal_types  TEXT[],

  is_inferred  BOOLEAN DEFAULT true,        -- true = generado por ASCI, false = editado por usuario
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- CAMPANIAS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES auth.users(id),
  name          TEXT NOT NULL,

  type TEXT CHECK (type IN (
    'monitor',   -- solo señales de cuentas conocidas. Sin DMs, sin Tech Radar, sin email agent
    'prospect',  -- buscar DMs en cuentas conocidas: Tech Radar + Apollo + email agent
    'discover'   -- ASCI recomienda cuentas con señales: todo lo de prospect + recomendaciones
  )) NOT NULL,

  -- Solo para prospect / discover
  buyer_persona_id UUID,                    -- FK a v3.buyer_personas (post ALTER)
  country_filter   TEXT[],

  -- Feature flags calculados al crear segun tipo. Editables.
  enable_tech_radar   BOOLEAN DEFAULT false,
  enable_apollo       BOOLEAN DEFAULT false,
  enable_email_agent  BOOLEAN DEFAULT false,
  enable_signals_only BOOLEAN DEFAULT true,

  status  TEXT CHECK (status IN ('active', 'paused', 'archived')) DEFAULT 'active',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- FKs circulares se agregan despues de crear ambas tablas
ALTER TABLE v3.buyer_personas
  ADD CONSTRAINT fk_buyer_persona_campaign
  FOREIGN KEY (campaign_id) REFERENCES v3.campaigns(id) ON DELETE SET NULL;

ALTER TABLE v3.campaigns
  ADD CONSTRAINT fk_campaign_buyer_persona
  FOREIGN KEY (buyer_persona_id) REFERENCES v3.buyer_personas(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════
-- CUENTAS EN CAMPANIAS
-- Una company puede estar en multiples campanias del mismo workspace.
-- Puede ser whitelisted en una y blacklisted en otra.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.campaign_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID REFERENCES v3.campaigns(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL,               -- referencia a public.companies (sin FK cross-schema)

  -- Estado en esta campania
  list_status TEXT CHECK (list_status IN ('whitelisted', 'blacklisted')) DEFAULT 'whitelisted',
  match_source TEXT CHECK (match_source IN (
    'csv_import',          -- vino de un CSV upload
    'manual',              -- el usuario lo agrego manualmente
    'asci_recommendation'  -- ASCI lo recomendo (solo para campanias discover)
  )),

  -- Estado de prospeccion (solo relevante para prospect / discover)
  prospection_status TEXT CHECK (prospection_status IN (
    'pending',     -- en espera de ser seleccionada
    'queued',      -- encolada en Trigger.dev
    'running',     -- job en ejecucion
    'completed',   -- tech radar corrido, datos disponibles
    'failed'       -- fallo el job
  )) DEFAULT 'pending',

  tech_radar_run_at   TIMESTAMPTZ,
  apollo_checked_at   TIMESTAMPTZ,

  -- Para cron mensual
  last_refresh_at  TIMESTAMPTZ,
  next_refresh_at  TIMESTAMPTZ,             -- = last_refresh_at + 30 dias

  added_at  TIMESTAMPTZ DEFAULT NOW(),
  added_by  UUID REFERENCES auth.users(id),

  UNIQUE (campaign_id, company_id)
);

-- ═══════════════════════════════════════════════════════════
-- DIGEST FILTRADO POR CAMPANA/CUENTA
-- Capa por encima del cache global de v2, filtrada por buyer_persona
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.campaign_account_digest (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_account_id  UUID REFERENCES v3.campaign_accounts(id) ON DELETE CASCADE UNIQUE,

  -- Referencias al cache global de v2 (solo IDs, no duplicamos contenido)
  news_ids             UUID[],              -- IDs de public.company_news
  implementation_ids   UUID[],             -- IDs de public.company_implementations

  -- Metadatos del filtrado
  buyer_persona_id     UUID,               -- referencia a v3.buyer_personas
  signal_types_matched TEXT[],             -- señales que matchearon con el buyer_persona

  -- Timeline para badge "NUEVAS"
  last_fetched_at   TIMESTAMPTZ,
  new_items_count   INTEGER DEFAULT 0,
  last_user_seen_at TIMESTAMPTZ,

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- CSV IMPORT DE CUENTAS
-- Completamente separado del ETL de v2 (import_batches / import_rows)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.csv_imports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID REFERENCES v3.campaigns(id) ON DELETE CASCADE,
  uploaded_by  UUID REFERENCES auth.users(id),
  filename     TEXT NOT NULL,
  total_rows   INTEGER DEFAULT 0,
  status       TEXT CHECK (status IN (
    'processing', 'pending_review', 'completed', 'failed'
  )) DEFAULT 'processing',

  -- Resumen del matching
  auto_matched  INTEGER DEFAULT 0,
  needs_review  INTEGER DEFAULT 0,
  no_match      INTEGER DEFAULT 0,
  ignored       INTEGER DEFAULT 0,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE v3.csv_import_rows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id   UUID REFERENCES v3.csv_imports(id) ON DELETE CASCADE,
  row_number  INTEGER NOT NULL,

  -- Datos crudos
  raw_company_name  TEXT NOT NULL,
  raw_domain        TEXT,

  -- Datos normalizados (calculados al procesar)
  normalized_name   TEXT,                  -- lowercase, sin sufijos legales, sin puntuacion
  normalized_domain TEXT,                  -- sin www, sin protocolo, sin TLD

  -- Resultado del matching
  match_status TEXT CHECK (match_status IN (
    'auto_matched',  -- dominio exacto + nombre similar >= 85%
    'needs_review',  -- dominio exacto pero nombre diferente, o nombre exacto sin dominio
    'ambiguous',     -- multiples candidatos con score similar
    'no_match',      -- ningun match encontrado en public.companies
    'confirmed',     -- usuario confirmo manualmente
    'ignored'        -- usuario descarto esta fila
  )) DEFAULT 'needs_review',

  matched_company_id  UUID,                -- referencia a public.companies (sin FK cross-schema)
  match_candidates    JSONB,               -- [{company_id, name, domain, score, method}]
  match_method        TEXT,               -- 'domain_exact', 'name_fuzzy', 'domain_fuzzy', 'manual'
  match_score         FLOAT,              -- 0.0 a 1.0

  reviewed_at  TIMESTAMPTZ,
  reviewed_by  UUID REFERENCES auth.users(id)
);

-- ═══════════════════════════════════════════════════════════
-- COLA DE PROSPECCION (jobs de Trigger.dev)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.prospection_jobs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID REFERENCES v3.workspaces(id),
  campaign_account_id  UUID REFERENCES v3.campaign_accounts(id),

  job_type TEXT CHECK (job_type IN (
    'tech_radar',         -- ejecuta lib/tech-radar.ts existente (Parallel o Gemini fallback)
    'apollo_cache_check'  -- verifica y trae contactos del cache de Apollo
  )) NOT NULL,

  status TEXT CHECK (status IN (
    'pending', 'running', 'completed', 'failed'
  )) DEFAULT 'pending',

  trigger_job_id  TEXT,                    -- ID del job en Trigger.dev para tracking
  used_fallback   BOOLEAN DEFAULT false,   -- true si se uso Gemini en lugar de Parallel

  result_summary  JSONB,   -- { news_found: 3, techs: ["Salesforce"], contacts_cached: 5 }
  error_message   TEXT,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════
-- MCP API KEYS
-- 1 key por usuario. Scoped al workspace_id.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.mcp_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  key_hash    TEXT UNIQUE NOT NULL,         -- SHA-256. El key en claro se muestra una sola vez al crear
  key_prefix  TEXT NOT NULL,               -- primeros 8 chars para identificar ("asci_k1_...")
  name        TEXT,                        -- nombre descriptivo ("Claude en Cursor")

  scopes  TEXT[] DEFAULT ARRAY['read'],    -- ['read', 'write', 'email_draft']

  -- Rate limiting basado en plan del workspace
  rate_limit_per_hour  INTEGER DEFAULT 100,

  is_active         BOOLEAN DEFAULT true,
  last_used_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,           -- null = no expira
  revoked_at        TIMESTAMPTZ,
  revocation_reason TEXT,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (workspace_id, user_id)           -- 1 key por usuario
);

-- ═══════════════════════════════════════════════════════════
-- BORRADORES Y SECUENCIAS DE EMAIL
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.email_drafts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  campaign_account_id  UUID REFERENCES v3.campaign_accounts(id),

  -- Destinatario
  contact_id    UUID,                       -- referencia a public.contacts
  to_email      TEXT NOT NULL,
  to_name       TEXT,
  subject       TEXT NOT NULL,
  body_html     TEXT NOT NULL,
  body_text     TEXT,

  -- Contexto usado para generar el draft
  icebreaker_signals  JSONB,               -- señales usadas como contexto
  buyer_persona_id    UUID,                -- referencia a v3.buyer_personas

  -- Estado de aprobacion
  status TEXT CHECK (status IN (
    'pending_approval',  -- esperando al usuario en el dashboard
    'approved',          -- usuario aprobo
    'rejected',          -- usuario rechazo
    'sent',              -- enviado via Gmail
    'failed'             -- fallo el envio
  )) DEFAULT 'pending_approval',

  generated_by  TEXT CHECK (generated_by IN ('agent', 'copilot', 'user')) DEFAULT 'agent',

  reviewed_at  TIMESTAMPTZ,
  reviewed_by  UUID REFERENCES auth.users(id),
  sent_at      TIMESTAMPTZ,

  -- TBD: threading y reply tracking (post-MVP)
  gmail_message_id  TEXT,
  gmail_thread_id   TEXT,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE v3.email_sequences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  campaign_id   UUID REFERENCES v3.campaigns(id),
  name          TEXT NOT NULL,
  steps         JSONB NOT NULL,  -- [{day: 0, subject: "...", body: "..."}, {day: 3, ...}]
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- WEBHOOKS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.webhook_endpoints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  secret_hash   TEXT NOT NULL,             -- SHA-256. El agente verifica HMAC-SHA256
  events        TEXT[] NOT NULL,
  is_active     BOOLEAN DEFAULT true,
  last_fired_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- CONFIGURACION DKIM/SPF
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.email_domain_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  domain        TEXT NOT NULL,

  spf_valid     BOOLEAN DEFAULT false,
  dkim_valid    BOOLEAN DEFAULT false,
  dmarc_valid   BOOLEAN DEFAULT false,

  last_checked_at  TIMESTAMPTZ,
  check_details    JSONB,   -- { spf_record: "...", dkim_selector: "...", errors: [] }

  -- Columna generada: los 3 deben estar ok para habilitar el agente
  is_email_ready  BOOLEAN GENERATED ALWAYS AS (spf_valid AND dkim_valid AND dmarc_valid) STORED,

  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (workspace_id, domain)
);

-- ═══════════════════════════════════════════════════════════
-- ACTIVIDAD Y REPORTING
-- ═══════════════════════════════════════════════════════════

CREATE TABLE v3.activity_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES v3.workspaces(id),
  user_id       UUID REFERENCES auth.users(id),

  activity_type TEXT NOT NULL,
  -- Valores: 'csv_uploaded', 'account_matched', 'account_ignored',
  --          'tech_radar_run', 'apollo_searched', 'email_drafted',
  --          'email_approved', 'email_rejected', 'email_sent',
  --          'doc_uploaded', 'doc_processed', 'campaign_created',
  --          'apikey_created', 'apikey_revoked', 'webhook_fired'

  entity_type  TEXT,                        -- 'campaign', 'campaign_account', 'email_draft', etc.
  entity_id    UUID,
  meta         JSONB,

  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 3. Flujo de Matching CSV

### Contexto: que es este proceso

Cuando un usuario quiere agregar muchas cuentas a una campana de una vez, sube un CSV con nombres de companias y dominios opcionales. ASCI busca esas companias en `public.companies` (la base de datos compartida con v2) y propone los matches.

**No se crean companias nuevas.** Las que no se encuentran quedan como `no_match`.

### Normalizacion

```typescript
// lib/v3/csv-matcher.ts

const LEGAL_SUFFIXES = /\b(inc|llc|sa|srl|corp|corporation|ltd|gmbh|s\.a\.|s\.r\.l\.|ag)\b/gi;
const DOMAIN_PREFIXES = /^(https?:\/\/)?(www\.)?/i;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDomain(domain: string): string {
  return domain
    .replace(DOMAIN_PREFIXES, '')
    .split('/')[0]                           // quitar paths
    .split('.').slice(-2).join('.')          // quitar subdominios
    .toLowerCase()
    .trim();
}
```

### Matriz de decision

| Dominio CSV | Nombre CSV | Resultado | Accion automatica |
|-------------|-----------|-----------|-------------------|
| Exacto match | Normalizado exacto o fuzzy >= 85% | `auto_matched` | Crea `campaign_account` directamente |
| Exacto match | Diferente (fuzzy < 85%) | `needs_review` | Muestra al usuario (posible rebrand o holding) |
| No existe | Exacto normalizado | `needs_review` | Muestra: confirmar que es la empresa correcta |
| No existe | Fuzzy >= 50% y < 85% | `ambiguous` | Muestra top 3 candidatos con score |
| No existe o null | Fuzzy < 50% | `no_match` | Empresa no encontrada en ASCI |
| null / vacio | Exacto o fuzzy >= 85% | `needs_review` | Sin dominio para confirmar |

> Si `public.companies` tampoco tiene dominio para la empresa, el matching es solo por nombre.

### UX de resultados

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Resultado del import "Q1_2025.csv"                          [Exportar] │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐ │
│  │  38 Auto-match  │  │  7 Revision     │  │  5 Sin match            │ │
│  │  Listos         │  │  Pendientes     │  │  No estan en ASCI       │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘ │
│                                                                         │
│  Pendientes de revision:                                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ CSV: "Globant SA"  /  globant.com                               │   │
│  │ Dominio exacto, nombre diferente                                │   │
│  │ Candidato: Globant LLC (globant.com) — 78%                      │   │
│  │                           [Confirmar]  [Ignorar]                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ CSV: "Banco Galicia"  /  (sin dominio)                          │   │
│  │ Multiples candidatos:                                           │   │
│  │  ○ Banco de Galicia y Bs As SA — 89%                            │   │
│  │  ○ Grupo Financiero Galicia — 72%                               │   │
│  │  ○ Galicia Seguros — 65%                                        │   │
│  │                           [Seleccionar]  [Ignorar]              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Sin match (5): No existen en la base de ASCI                          │
│  · "Startup XYZ"  · "Empresa Nueva"  · ...                             │
│                                                                         │
│                        [Aplicar y agregar a campana]                   │
└─────────────────────────────────────────────────────────────────────────┘
```

Las cuentas confirmadas o auto-matched pasan a `v3.campaign_accounts` con `list_status = 'whitelisted'`.

---

## 4. Flujo de Prospeccion en Tandas

### Primera tanda (on-demand)

```
Usuario confirma cuentas del matching
          │
          ▼
"Selecciona hasta 5 cuentas para prospectar ahora"
(lista de campaign_accounts con prospection_status = 'pending')
          │
          ▼
Usuario selecciona 5 y confirma
          │
          ├─ Las 5 seleccionadas: status = 'queued'
          └─ Las restantes: se encolan automaticamente
             en tandas de 5 a medida que se libera la cola
                              │
                              ▼
          ┌───────────────────────────────────────────────────────┐
          │  Trigger.dev — por cada cuenta (de a 1, max 5 cola): │
          │                                                       │
          │  JOB: tech_radar                                      │
          │  1. lib/tech-radar.ts → runTechRadar()                │
          │     - Parallel busca noticias y casos de uso          │
          │     - Fallback: Gemini si Parallel falla              │
          │     - Escribe en public.company_news                  │
          │       y public.company_implementations via RPC de v2  │
          │                                                       │
          │  JOB: apollo_cache_check (post tech_radar)            │
          │  2. Verificar public.apollo_contacts_cache            │
          │     - Si hay contactos: disponibles en digest         │
          │     - Si no hay: generar cargos recomendados          │
          │       segun buyer_persona del workspace               │
          │                                                       │
          │  3. Actualizar v3.campaign_account_digest             │
          │     - Filtrar noticias por buyer_persona              │
          │     - Contar items nuevos desde ultimo login          │
          │                                                       │
          │  4. campaign_accounts:                                │
          │     prospection_status = 'completed'                  │
          │     tech_radar_run_at = NOW()                         │
          │     next_refresh_at = NOW() + 30 dias                 │
          │                                                       │
          │  5. Loggear en v3.activity_log                        │
          │  6. Supabase Realtime → notificar dashboard           │
          └───────────────────────────────────────────────────────┘
```

### Cron mensual (mantenimiento automatico)

```sql
-- Trigger.dev Cron: 1x/mes
-- Seleccionar cuentas que vencieron su refresh
-- y que esten en al menos una campana activa

SELECT ca.id
FROM v3.campaign_accounts ca
JOIN v3.campaigns c ON c.id = ca.campaign_id
WHERE ca.next_refresh_at <= NOW()
  AND ca.list_status = 'whitelisted'
  AND c.status = 'active'
  AND c.enable_tech_radar = true;

-- Si la cuenta no esta en ninguna campana activa,
-- NO se encola → se deja de actualizar automaticamente
-- hasta que un usuario la vuelva a agregar a una campana
```

---

## 5. Contenedor de Informacion por Cuenta

Cada cuenta tiene dos capas:

### Capa 1: Cache Global (v2 — compartido entre todos los workspaces)

| Tabla | Contenido |
|-------|----------|
| `public.company_news` | Noticias scrapeadas (Parallel/Gemini) |
| `public.company_implementations` | Tecnologias detectadas en el tech radar |
| `public.apollo_contacts_cache` | Contactos enriquecidos de Apollo |

Si dos workspaces distintos hacen tech radar de la misma cuenta, el segundo se
beneficia del trabajo del primero. El cache es global.

### Capa 2: Digest Filtrado (v3 — por campana)

`v3.campaign_account_digest` toma el cache global y lo filtra segun el
`buyer_persona` de la campana. Dos campanias del mismo workspace viendo la
misma cuenta pueden tener digests diferentes si tienen buyer_personas diferentes.

```
public.company_news (noticias de Acme Corp — global)
            │
            │  filtro: buyer_persona.target_processes = ['CRM', 'ERP']
            │           buyer_persona.target_technologies = ['Salesforce']
            ▼
v3.campaign_account_digest
  news_ids: [solo las relevantes al buyer_persona]
  signal_types_matched: ['CRM', 'Salesforce']
  new_items_count: 3   ← items nuevos desde ultimo login del usuario
            │
            ▼
Dashboard: digest personalizado para esa campana
```

---

## 6. MCP Server

### Arquitectura

El MCP Server son endpoints HTTP en `/app/api/mcp/` dentro del mismo Next.js.
No es un servidor separado.

```
Agente IA Externo
        │
        │  POST /api/mcp/tools/{tool_name}
        │  Authorization: Bearer asci_k1_xxxxxxxx
        │
        ▼
Middleware de autenticacion:
  1. SHA-256(key) → lookup en v3.mcp_api_keys
  2. is_active + expiracion
  3. Rate limit por workspace (in-memory + DB)
  4. Extrae workspace_id + user_id del registro
        │
        ▼
Tool handler:
  - Todas las queries filtran por workspace_id
  - Lee de public.* y v3.*
  - Escribe solo en v3.* o via RPCs de v2
```

### Herramientas disponibles

| Tool | Input | Output | Fuente |
|------|-------|--------|--------|
| `list_campaigns` | — | Campanias del workspace | v3.campaigns |
| `list_accounts` | campaign_id | Cuentas de la campana | v3.campaign_accounts + public.companies |
| `get_account_signals` | company_id, campaign_id | Señales filtradas por buyer_persona | v3.campaign_account_digest |
| `get_decision_makers` | company_id | Contactos del cache de Apollo | public.apollo_contacts_cache |
| `get_recommended_titles` | company_id, campaign_id | Cargos recomendados por buyer_persona | v3.buyer_personas + diccionario |
| `search_apollo` | company_id, job_titles[] | Dispara busqueda en Apollo | Apollo API → RPC v2 |
| `create_email_draft` | contact_id, signals[], body | Crea borrador para aprobacion | v3.email_drafts |
| `list_pending_approvals` | — | Emails pendientes | v3.email_drafts (pending_approval) |
| `get_workspace_context` | — | Docs, buyer personas, industrias | v3.workspace_documents, v3.buyer_personas |

### Flujo completo de email via agente

```
1. get_workspace_context()
   → buyer_persona, propuesta de valor, industrias, KPIs

2. get_account_signals(company_id, campaign_id)
   → señales filtradas y relevantes de la cuenta

3. get_decision_makers(company_id)
   → si hay contactos en cache: los retorna
   → si no hay: retorna get_recommended_titles() para que el usuario
     dispare la busqueda en Apollo desde el dashboard

4. create_email_draft(contact_id, signals, instructions)
   → se guarda en v3.email_drafts con status 'pending_approval'

5. Supabase Realtime notifica al dashboard
   → usuario ve el borrador en la cola

6. Usuario aprueba o rechaza desde el dashboard
   → si aprueba: status = 'approved'
   → webhook HMAC-SHA256 notifica al agente

7. Agente recibe el webhook y envia via Gmail
   → v3.email_drafts.status = 'sent'
   → v3.activity_log registra el evento
```

---

## 7. Webhooks

### Eventos disponibles

| Evento | Cuando |
|--------|--------|
| `email.draft.created` | El agente creo un borrador |
| `email.draft.approved` | Usuario aprobo un borrador |
| `email.draft.rejected` | Usuario rechazo un borrador |
| `account.prospected` | Tech radar completado para una cuenta |
| `account.contacts_ready` | Nuevos contactos disponibles en Apollo cache |
| `campaign.import_complete` | CSV import finalizo el matching |

### Payload y firma

```json
{
  "event": "email.draft.approved",
  "timestamp": "2025-05-14T15:30:00Z",
  "workspace_id": "uuid",
  "data": {
    "draft_id": "uuid",
    "contact_id": "uuid",
    "to_email": "juan@acme.com",
    "subject": "...",
    "body_html": "..."
  }
}
```

Header de firma:
```
X-ASCI-Signature: sha256=<hmac_hex>
```

Verificacion: `HMAC-SHA256(webhook_secret, JSON.stringify(payload)) === signature`

### Politica de entrega

- Un intento por evento. Sin reintentos automaticos.
- Timeout de 10s. Si el endpoint no responde: `failed` en `activity_log`.
- El agente puede compensar via polling con `list_pending_approvals`.

---

## 8. DKIM / SPF — Check Obligatorio

El agente de email queda bloqueado hasta que `v3.email_domain_config.is_email_ready = true`.

### Verificacion DNS

```typescript
// app/api/v3/email-domain/verify/route.ts
async function checkEmailDomain(domain: string) {
  const spfRecords  = await dns.resolveTxt(domain).catch(() => []);
  const dkimRecords = await dns.resolveTxt(`default._domainkey.${domain}`).catch(() => []);
  const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`).catch(() => []);

  return {
    spf_valid:   spfRecords.some(r => r.join('').includes('v=spf1')),
    dkim_valid:  dkimRecords.length > 0,
    dmarc_valid: dmarcRecords.some(r => r.join('').includes('v=DMARC1')),
  };
}
```

### UI del check

```
┌───────────────────────────────────────────────────────┐
│  Configura tu dominio para enviar emails              │
│                                                       │
│  SPF    ✓ Configurado                                 │
│  DKIM   ✗ No encontrado                               │
│  DMARC  ✓ Configurado                                 │
│                                                       │
│  El agente de email estara disponible cuando los      │
│  3 registros esten configurados.                      │
│                                                       │
│  [Verificar nuevamente]                               │
└───────────────────────────────────────────────────────┘
```

---

## 9. Multi-Tenancy y Roles

### Reglas de negocio

- El primer usuario de un dominio crea el workspace y es `admin` automaticamente
- Si un segundo usuario del mismo dominio se registra: `workspace_members` con `status = 'pending'`
- El admin recibe notificacion (Supabase Realtime) y acepta o rechaza

### Permisos por rol

| Accion | admin | editor | viewer |
|--------|-------|--------|--------|
| Ver digest y cuentas | si | si | si |
| Crear / editar campanias | si | si | no |
| Subir CSV | si | si | no |
| Aprobar emails | si | si | no |
| Subir documentos | si | si | no |
| Invitar miembros | si | no | no |
| Activar agente de email | si | no | no |
| Crear API key MCP | si | no | no |
| Borrar campanas | si | no | no |

### Deteccion de workspace al registrar

```typescript
// lib/v3/workspace.ts
async function handleNewUser(userId: string, email: string) {
  const domain = email.split('@')[1];

  const { data: existing } = await supabase
    .schema('v3')
    .from('workspaces')
    .select('id')
    .eq('domain', domain)
    .single();

  if (existing) {
    // Workspace existente: crear member con status pending
    await supabase.schema('v3').from('workspace_members').insert({
      workspace_id: existing.id,
      user_id: userId,
      role: 'editor',
      status: 'pending',
    });
    // Supabase Realtime notifica al admin del workspace
  } else {
    // Primer usuario del dominio: crear workspace y asignar como admin
    const { data: workspace } = await supabase
      .schema('v3')
      .from('workspaces')
      .insert({ domain, name: domain, created_by: userId })
      .select()
      .single();

    await supabase.schema('v3').from('workspace_members').insert({
      workspace_id: workspace.id,
      user_id: userId,
      role: 'admin',
      status: 'active',
    });
  }
}
```

---

## 10. Trigger.dev — Jobs

### Jobs definidos

| Job | Trigger | Descripcion |
|-----|---------|-------------|
| `tech-radar-run` | Manual (primeras 5) + Cron mensual | Tech radar de una cuenta |
| `apollo-cache-check` | Post tech-radar-run | Verifica contactos en cache |
| `csv-matching` | Al subir CSV | Procesa matching contra public.companies |
| `workspace-doc-process` | Al subir documento | Extrae industrias, procesos, KPIs |
| `digest-filter-update` | Post tech-radar-run | Actualiza campaign_account_digest |
| `dkim-verify` | Manual (boton en UI) | Verifica DNS del dominio |

### Configuracion de concurrencia

```typescript
// trigger/tech-radar-run.ts
export const techRadarRun = task({
  id: 'tech-radar-run',
  queue: {
    concurrencyLimit: 5,
    // Cola por workspace para no mezclar jobs de diferentes clientes
    name: ({ workspaceId }: { workspaceId: string }) => `tech-radar-${workspaceId}`,
  },
  run: async ({ campaignAccountId, workspaceId }: { campaignAccountId: string, workspaceId: string }) => {
    // 1. runTechRadar() de lib/tech-radar.ts (Parallel)
    // 2. Si falla Parallel: fallback a Gemini (lib/parallel.ts)
    // 3. Escribe en public via RPCs de v2
    // 4. apollo-cache-check como subtask
    // 5. digest-filter-update como subtask
    // 6. Actualizar v3.campaign_accounts
    // 7. Loggear en v3.activity_log
    // 8. Supabase Realtime notify al dashboard
  },
});
```

---

## 11. Onboarding Completo — Flujo del Usuario

### Paso 1: Registro

```
bot.bigua.lat/register
        │
        ├── Email del mismo dominio que otro usuario:
        │   → "Tu empresa ya tiene cuenta en ASCI. Solicitar acceso."
        │   → workspace_members con status 'pending'
        │   → Admin recibe notificacion para aceptar
        │
        └── Primer usuario del dominio:
            → Crear workspace
            → Usuario es admin
            → Ir a Paso 2
```

### Paso 2: Documentos del workspace (BLOCKER)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Para comenzar, necesitamos entender que vende tu empresa.          │
│  ASCI usara esto para recomendar cuentas e icebreakers.             │
│                                                                     │
│  Sube al menos un documento:                                        │
│                                                                     │
│  [+ Landing de solucion]                                            │
│  [+ Caso de exito]                                                  │
│  [+ Brochure / Deck]                                                │
│                                                                     │
│  ASCI detectara automaticamente:                                    │
│  · Industrias en las que vendés                                     │
│  · Procesos de negocio que impactas                                 │
│  · Tecnologias relacionadas                                         │
│  · KPIs y argumentos de ROI                                         │
│                                                                     │
│  [Puedo agregar mas documentos luego]   [Continuar →]               │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼
Trigger.dev: workspace-doc-process
  → Extrae texto del PDF / URL
  → Matchea contra public.dictionary_processes y public.dictionary_products
  → Genera buyer_persona inicial
  → Sugiere job titles recomendados por proceso/tecnologia
```

### Paso 3: Crear primera campana

```
┌─────────────────────────────────────────────────────────────────────┐
│  Crea tu primera campana                                            │
│                                                                     │
│  Nombre: [_________________________________]                        │
│                                                                     │
│  Tipo de campana:                                                   │
│                                                                     │
│  ○ Monitorear                                                       │
│    Seguir señales de cuentas que ya conoces.                        │
│    Sin busqueda de contactos ni envio de emails.                    │
│                                                                     │
│  ○ Prospectar                                                       │
│    Buscar decision makers en cuentas conocidas.                     │
│    Incluye Tech Radar, Apollo y agente de email.                    │
│                                                                     │
│  ○ Descubrir                                                        │
│    ASCI recomienda cuentas nuevas con señales relevantes.           │
│    Incluye todo lo de Prospectar.                                   │
│                                                                     │
│                                                    [Continuar →]   │
└─────────────────────────────────────────────────────────────────────┘
```

### Paso 4: Agregar cuentas

**Para Monitor / Prospect:**
```
Opcion A — Subir CSV:
  Upload → Matching (normalizacion + fuzzy) → Revision → campaign_accounts

Opcion B — Busqueda manual:
  Buscar en public.companies → Agregar de a una
```

**Para Discover:**
```
ASCI recomienda cuentas de public.companies que:
  1. Tengan signals.signal_type que matcheen con
     buyer_persona.target_processes o target_technologies del workspace
  2. No esten en blacklist del workspace para esta campana
  3. No superen el limite de 100 cuentas del workspace

┌─────────────────────────────────────────────────────────────────────┐
│  ASCI encontro estas cuentas con señales relevantes                 │
│                                                                     │
│  [+] Acme Corp          señales: CRM, ERP      [Agregar] [Omitir]  │
│  [+] Bigua Technologies señales: AI, Infra     [Agregar] [Omitir]  │
│  [+] Softtek            señales: ERP           [Agregar] [Omitir]  │
│                                                                     │
│                         [Agregar todas]  [Continuar →]             │
└─────────────────────────────────────────────────────────────────────┘
```

### Paso 5: Seleccionar primeras 5 para prospectar

(Solo para campanias prospect / discover)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Selecciona hasta 5 cuentas para comenzar                           │
│  Las restantes se procesaran automaticamente en tandas de 5.        │
│                                                                     │
│  ☑ Acme Corp           · señal reciente: Job posting CTO            │
│  ☑ Bigua Technologies  · señal reciente: Ronda de inversion         │
│  ☑ Softtek             · sin señales recientes                      │
│  ☐ Despegar            · señal reciente: Expansion Brasil           │
│  ☐ MercadoLibre        · señal reciente: Nuevo producto AI          │
│                                                                     │
│  Seleccionadas: 3 / 5                                               │
│                                                                     │
│                                       [Iniciar prospeccion →]      │
└─────────────────────────────────────────────────────────────────────┘
```

### Paso 6: Dashboard activo

- Trigger.dev ejecuta tech radar en background para las seleccionadas
- Las restantes se encolan automaticamente de a 5
- Supabase Realtime actualiza el dashboard a medida que completan
- El digest se va poblando con señales filtradas por buyer_persona
- El copiloto sugiere icebreakers segun las señales detectadas
- Los cargos recomendados aparecen para que el usuario dispare busqueda en Apollo

---

## 12. Buyer Personas — Logica de Inferencia

### Fuente 1: Diccionario pre-laburado (v2)

En `public.dictionary_processes` y `public.dictionary_products` ya existen entradas
con keywords. Para v3 se extiende el diccionario con job titles por proceso/tecnologia:

```sql
-- Ejemplo de extension al diccionario (tabla nueva en v3, no modifica public.*)
CREATE TABLE v3.dictionary_job_titles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dict_type       TEXT CHECK (dict_type IN ('process', 'technology')) NOT NULL,
  dict_id         UUID NOT NULL,          -- ID en dictionary_processes o dictionary_products
  job_titles      TEXT[] NOT NULL,        -- ["CTO", "VP Engineering", "Head of IT"]
  seniority_level TEXT[],                 -- ["C-Level", "VP", "Director"]
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### Fuente 2: Inferencia desde docs del workspace

Al procesar `v3.workspace_documents`, ASCI matchea el contenido del doc contra
el diccionario y extrae los procesos/tecnologias mencionados. Luego consulta
`v3.dictionary_job_titles` para proponer los cargos relevantes.

Ejemplo:
- Doc menciona "automatizacion de procesos de compras" → matchea `dictionary_processes.id = ERP`
- `v3.dictionary_job_titles` para ERP → ["CPO", "VP Supply Chain", "Head of Procurement"]
- ASCI propone esos cargos en el buyer_persona de la campana

### Fuente 3: Recomendacion IA adicional (Gemini)

Si el doc tiene contexto que no matchea con el diccionario, Gemini puede inferir
cargos adicionales que se suman a `buyer_persona.recommended_job_titles` con
`is_inferred = true`. El usuario puede editarlos o descartarlos.

---

## 13. Separacion v2/v3 — Tabla de Seguridad

| Riesgo | Mitigacion |
|--------|-----------|
| v3 escribe en tablas de v2 | Solo via RPCs existentes de v2. Nunca INSERT/UPDATE directo |
| v3 modifica el ETL de v2 | CSV de v3 usa `v3.csv_imports` / `v3.csv_import_rows`. Las tablas `public.import_batches` y `public.import_rows` no se tocan |
| v3 modifica bookmarks de v2 | `public.bookmarks` no se toca. v3 usa `v3.campaign_accounts` |
| FK cross-schema | No hay FK de v3 a tablas de v2. Las referencias a `companies.id` y `contacts.id` son campos UUID sin constraint FK formal |
| RLS de v2 se rompe | v3 tiene sus propias policies en schema v3. Las de v2 no se modifican |
| Performance de v2 | v3 crea sus propios indices. Los de v2 no se modifican |
| Trigger en auth.users | El trigger `on_auth_user_created` de v2 crea `public.profiles`. v3 agrega su logica en una funcion separada llamada desde la API, no modifica el trigger existente |

---

## 14. Variables de Entorno

### Ya existentes (v2 — se reutilizan en v3)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
APOLLO_API_KEY
PARALLEL_API_KEY
GOOGLE_AI_API_KEY
```

### Nuevas para v3

```
TRIGGER_SECRET_KEY         # Trigger.dev autenticacion
TRIGGER_API_URL            # Trigger.dev endpoint
BLOB_READ_WRITE_TOKEN      # Vercel Blob para workspace_documents
```
