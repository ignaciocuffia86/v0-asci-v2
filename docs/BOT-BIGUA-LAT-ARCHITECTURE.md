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
| Ambiente | Produccion directa (no hay usuarios actuales en BOT) |
| Auth MCP | API key vinculada a user_id, todas las operaciones scoped al usuario |
| Rate limits | Por usuario, 1 API key por usuario |
| API keys | Una sola key activa por usuario (tiers definen limites) |
| Integracion Apify | Nuevo desarrollo |
| Transporte MCP | HTTP Streamable (sin WebSockets) |
| Real-time dashboard | Supabase Realtime |
| Notificacion a agentes | Webhooks (HMAC-SHA256 firmados) |

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
│   ├── documents                 # Lectura compartida
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
    └── user_tiers                # Limites por plan
```

---

## Modelo de Datos: Bookmarks = Whitelist

### Decision Arquitectonica Clave

**Los bookmarks existentes SON la whitelist de cuentas objetivo.**

- Los usuarios que tienen bookmarks en ASCI -> esos bookmarks son sus cuentas objetivo
- Cuando un usuario sube un CSV con nuevas cuentas -> se crean bookmarks automaticamente
- La metadata adicional para MCP vive en `v3.bookmark_metadata` (sin modificar `public.bookmarks`)
- La blacklist vive en `v3.excluded_accounts`

---

## Nuevas Tablas de Base de Datos (Schema v3)

### 1. `v3.bookmark_metadata` - Extension de bookmarks para MCP

**IMPORTANTE**: Esta tabla extiende la funcionalidad de bookmarks SIN modificar la tabla `public.bookmarks`.

```sql
CREATE SCHEMA IF NOT EXISTS v3;

CREATE TABLE v3.bookmark_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bookmark_id UUID NOT NULL, -- Referencia logica a public.bookmarks(id), sin FK cross-schema
  user_id UUID NOT NULL,     -- Denormalizado para RLS
  
  -- Flags de prospeccion
  is_target_account BOOLEAN DEFAULT true, -- true = prospectar, false = solo seguimiento
  
  -- Tracking de prospeccion
  last_prospected_at TIMESTAMPTZ,
  current_sequence_id UUID, -- Referencia logica a v3.email_sequences(id)
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(bookmark_id)
);

-- Indice para queries del MCP
CREATE INDEX idx_bookmark_metadata_target ON v3.bookmark_metadata(user_id, is_target_account) 
  WHERE is_target_account = true;

-- RLS
ALTER TABLE v3.bookmark_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own bookmark metadata" ON v3.bookmark_metadata
  FOR ALL USING (auth.uid() = user_id);

COMMENT ON TABLE v3.bookmark_metadata IS 
  'Extension de public.bookmarks para funcionalidad MCP. No modifica la tabla original.';
```

### 2. `v3.excluded_accounts` - Blacklist / Base Instalada

```sql
CREATE TABLE v3.excluded_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Puede estar vinculada a una company existente o no
  company_id UUID, -- Referencia logica a public.companies(id), NULL si no hay match
  
  -- Input del usuario (del CSV de exclusion)
  original_name TEXT NOT NULL,
  original_domain TEXT,
  
  -- Match con ASCI
  match_status TEXT DEFAULT 'pending' CHECK (match_status IN ('pending', 'matched', 'ambiguous', 'no_match', 'ignored')),
  match_confidence FLOAT,
  match_candidates JSONB, -- [{company_id, name, domain, score}] para casos ambiguos
  
  -- Razon de exclusion
  exclusion_reason TEXT CHECK (exclusion_reason IN ('installed_base', 'competitor', 'do_not_contact', 'other')),
  notes TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  matched_at TIMESTAMPTZ,
  
  -- Un usuario no puede excluir la misma cuenta dos veces
  UNIQUE(user_id, COALESCE(company_id::text, original_name))
);

ALTER TABLE v3.excluded_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own exclusions" ON v3.excluded_accounts
  FOR ALL USING (auth.uid() = user_id);
```

### 3. `v3.csv_imports` - Tracking de importaciones

```sql
CREATE TABLE v3.csv_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Tipo de importacion
  import_type TEXT NOT NULL CHECK (import_type IN ('whitelist', 'blacklist')),
  
  -- Archivo original
  file_name TEXT NOT NULL,
  file_url TEXT, -- Vercel Blob URL
  
  -- Estadisticas
  total_rows INTEGER DEFAULT 0,
  auto_matched_count INTEGER DEFAULT 0,
  needs_review_count INTEGER DEFAULT 0,
  no_match_count INTEGER DEFAULT 0,
  
  -- Estado
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'pending_review', 'completed', 'failed')),
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE v3.csv_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own imports" ON v3.csv_imports
  FOR ALL USING (auth.uid() = user_id);
```

### 4. `v3.csv_import_rows` - Filas del CSV con estado de matching

```sql
CREATE TABLE v3.csv_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID REFERENCES v3.csv_imports(id) ON DELETE CASCADE,
  
  -- Input del usuario
  original_name TEXT NOT NULL,
  original_domain TEXT,
  row_number INTEGER,
  
  -- Estado del matching
  match_status TEXT DEFAULT 'pending' CHECK (match_status IN (
    'pending',      -- Aun no procesado
    'auto_matched', -- Match automatico (dominio + nombre similar)
    'needs_review', -- Dominio coincide pero nombre muy diferente
    'ambiguous',    -- Multiples candidatos posibles
    'no_match',     -- No se encontro en la base
    'resolved',     -- Usuario resolvio manualmente
    'skipped'       -- Usuario decidio ignorar
  )),
  match_confidence FLOAT,
  match_candidates JSONB, -- [{company_id, name, domain, score, reason}]
  
  -- Resolucion
  resolved_company_id UUID, -- Referencia logica a public.companies(id)
  resolved_at TIMESTAMPTZ,
  resolution_type TEXT CHECK (resolution_type IN ('auto', 'manual', 'skipped')),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_csv_import_rows_status ON v3.csv_import_rows(import_id, match_status);
```

### 5. `v3.api_keys` - Autenticacion MCP

```sql
CREATE TABLE v3.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE, -- UN usuario = UNA key activa
  
  key_hash TEXT NOT NULL,       -- SHA256 del key, nunca plaintext
  key_prefix TEXT NOT NULL,     -- Primeros 8 chars para identificacion (asci_xxxx)
  name TEXT NOT NULL,           -- "Mi agente Claude", "Cursor", etc.
  
  -- Permisos y limites
  scopes TEXT[] DEFAULT ARRAY['read', 'write'],
  tier TEXT DEFAULT 'beta' CHECK (tier IN ('beta', 'starter', 'pro', 'enterprise')),
  
  -- Rate limits segun tier (denormalizados para performance)
  rate_limit_day INTEGER,
  rate_limit_minute INTEGER,
  
  -- Tracking
  last_used_at TIMESTAMPTZ,
  total_calls INTEGER DEFAULT 0,
  
  -- Auditoria
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT
);

ALTER TABLE v3.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own api key" ON v3.api_keys
  FOR ALL USING (auth.uid() = user_id);
```

### 6. `v3.email_sequences` - Secuencias de outreach

```sql
CREATE TABLE v3.email_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID NOT NULL,    -- Referencia logica a public.companies(id)
  bookmark_id UUID NOT NULL,   -- Referencia logica a public.bookmarks(id)
  
  -- Configuracion
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  wait_days INTEGER DEFAULT 5, -- Dias para esperar respuesta antes de escalar
  
  -- Tracking
  current_contact_index INTEGER DEFAULT 0, -- 0=A, 1=B, 2=C
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE v3.email_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own sequences" ON v3.email_sequences
  FOR ALL USING (auth.uid() = user_id);
```

### 7. `v3.email_queue` - Cola de emails pendientes de aprobacion

```sql
CREATE TABLE v3.email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID REFERENCES v3.email_sequences(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  
  -- Contacto destino
  contact_id UUID,           -- Referencia logica a public.contacts(id)
  contact_email TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_title TEXT,
  company_name TEXT NOT NULL,
  
  -- Contenido del email (generado por el agente)
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_plain TEXT NOT NULL,
  
  -- Icebreaker y contexto usado
  icebreaker TEXT,
  context_used JSONB, -- {signals: [...], news: [...], documents: [...]}
  
  -- Estado
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'sent', 'bounced')),
  
  -- Edicion por el vendedor
  edited_subject TEXT,
  edited_body_html TEXT,
  edited_body_plain TEXT,
  editor_notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  
  -- Tracking de respuesta
  response_received_at TIMESTAMPTZ,
  response_type TEXT CHECK (response_type IN ('reply', 'bounce', 'out_of_office', 'none'))
);

ALTER TABLE v3.email_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own email queue" ON v3.email_queue
  FOR ALL USING (auth.uid() = user_id);

-- Indice para dashboard de aprobacion
CREATE INDEX idx_email_queue_pending ON v3.email_queue(user_id, status, created_at DESC)
  WHERE status = 'pending';
```

### 8. `v3.contact_rankings` - Priorizacion A/B/C de decision makers

```sql
CREATE TABLE v3.contact_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,  -- Referencia logica a public.companies(id)
  user_id UUID NOT NULL,
  contact_id UUID NOT NULL,  -- Referencia logica a public.contacts(id)
  
  -- Ranking generado por IA
  rank TEXT CHECK (rank IN ('A', 'B', 'C')),
  rank_score FLOAT, -- 0-100
  rank_reasoning TEXT,
  
  -- Factores considerados
  factors JSONB, -- {seniority_match: 0.9, department_match: 0.8, doc_relevance: 0.7}
  
  -- Icebreaker personalizado
  icebreaker TEXT,
  icebreaker_context JSONB, -- Senales/noticias usadas
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(company_id, user_id, contact_id)
);

ALTER TABLE v3.contact_rankings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own rankings" ON v3.contact_rankings
  FOR ALL USING (auth.uid() = user_id);
```

### 9. `v3.webhooks` - Configuracion de webhooks del usuario

```sql
CREATE TABLE v3.webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  url TEXT NOT NULL,
  secret TEXT NOT NULL, -- Para firmar payloads con HMAC-SHA256
  
  -- Eventos suscritos
  events TEXT[] NOT NULL, -- ['email.approved', 'email.sent', 'sequence.escalated']
  
  -- Estado
  active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  last_failure_reason TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE v3.webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own webhooks" ON v3.webhooks
  FOR ALL USING (auth.uid() = user_id);
```

### 10. `v3.user_tiers` - Limites por plan

```sql
CREATE TABLE v3.user_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  
  tier TEXT DEFAULT 'beta' CHECK (tier IN ('beta', 'starter', 'pro', 'enterprise')),
  
  -- Limites
  max_abm_accounts INTEGER DEFAULT 100,
  max_emails_per_day INTEGER DEFAULT 50,
  max_api_calls_per_day INTEGER DEFAULT 1000,
  max_api_calls_per_minute INTEGER DEFAULT 60,
  
  -- Uso actual (reset diario)
  emails_sent_today INTEGER DEFAULT 0,
  api_calls_today INTEGER DEFAULT 0,
  last_reset_at DATE DEFAULT CURRENT_DATE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE v3.user_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own tier" ON v3.user_tiers
  FOR SELECT USING (auth.uid() = user_id);
```

---

## Logica de Matching de CSV

### Campos esperados del CSV

```
company_name (obligatorio)
domain (opcional pero mejora precision)
```

### Algoritmo de Matching

```typescript
// lib/matching/company-matcher.ts

interface MatchResult {
  status: 'auto_matched' | 'needs_review' | 'ambiguous' | 'no_match';
  confidence: number;
  candidates: MatchCandidate[];
  reason: string;
}

interface MatchCandidate {
  company_id: string;
  name: string;
  domain: string;
  score: number;
  match_type: 'exact_domain' | 'similar_name' | 'fuzzy';
}

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
  // Implementar Levenshtein distance normalizado
  // Retorna 0-1 donde 1 es match exacto
}

async function matchCompany(
  csvName: string,
  csvDomain: string | null,
  companies: Company[]
): Promise<MatchResult> {
  const normalizedCsvName = normalizeCompanyName(csvName);
  const normalizedCsvDomain = csvDomain ? normalizeDomain(csvDomain) : null;
  
  const candidates: MatchCandidate[] = [];
  
  for (const company of companies) {
    const normalizedDbName = normalizeCompanyName(company.name);
    const normalizedDbDomain = company.domain ? normalizeDomain(company.domain) : null;
    
    let score = 0;
    let matchType: string = 'fuzzy';
    
    // Caso 1: Dominio coincide exactamente
    if (normalizedCsvDomain && normalizedDbDomain && 
        normalizedCsvDomain === normalizedDbDomain) {
      
      const nameRatio = fuzzyRatio(normalizedCsvName, normalizedDbName);
      
      if (nameRatio >= 0.85) {
        // Dominio exacto + nombre similar = AUTO MATCH
        score = 0.95 + (nameRatio * 0.05);
        matchType = 'exact_domain';
      } else {
        // Dominio exacto pero nombre muy diferente = NEEDS REVIEW
        score = 0.70 + (nameRatio * 0.20);
        matchType = 'exact_domain';
      }
    }
    // Caso 2: Solo nombre (sin dominio en CSV)
    else if (!normalizedCsvDomain) {
      const nameRatio = fuzzyRatio(normalizedCsvName, normalizedDbName);
      
      // Nombre exacto o muy similar
      if (normalizedCsvName === normalizedDbName) {
        score = 0.90;
        matchType = 'similar_name';
      } else if (nameRatio >= 0.85) {
        score = 0.70 + (nameRatio * 0.20);
        matchType = 'similar_name';
      } else if (nameRatio >= 0.60) {
        score = 0.40 + (nameRatio * 0.30);
        matchType = 'fuzzy';
      }
    }
    
    if (score > 0.40) {
      candidates.push({
        company_id: company.id,
        name: company.name,
        domain: company.domain || '',
        score,
        match_type: matchType as any
      });
    }
  }
  
  // Ordenar por score descendente
  candidates.sort((a, b) => b.score - a.score);
  
  // Determinar resultado
  if (candidates.length === 0) {
    return {
      status: 'no_match',
      confidence: 0,
      candidates: [],
      reason: 'No se encontraron empresas similares en la base de datos'
    };
  }
  
  const topCandidate = candidates[0];
  
  // AUTO MATCH: dominio exacto + nombre similar (>85%)
  if (topCandidate.match_type === 'exact_domain' && topCandidate.score >= 0.95) {
    return {
      status: 'auto_matched',
      confidence: topCandidate.score,
      candidates: [topCandidate],
      reason: `Dominio coincide y nombre es similar (${Math.round(topCandidate.score * 100)}%)`
    };
  }
  
  // NEEDS REVIEW: dominio exacto pero nombre diferente
  if (topCandidate.match_type === 'exact_domain' && topCandidate.score < 0.95) {
    return {
      status: 'needs_review',
      confidence: topCandidate.score,
      candidates: candidates.slice(0, 5),
      reason: 'Dominio coincide pero el nombre es diferente. Posible rebrand o adquisicion?'
    };
  }
  
  // AMBIGUOUS: multiples candidatos con scores similares
  const similarCandidates = candidates.filter(c => c.score >= topCandidate.score - 0.15);
  if (similarCandidates.length > 1) {
    return {
      status: 'ambiguous',
      confidence: topCandidate.score,
      candidates: similarCandidates.slice(0, 5),
      reason: `Multiples empresas posibles (${similarCandidates.length} candidatos)`
    };
  }
  
  // SINGLE CANDIDATE pero sin dominio = needs review
  if (topCandidate.score >= 0.70) {
    return {
      status: 'needs_review',
      confidence: topCandidate.score,
      candidates: candidates.slice(0, 5),
      reason: 'Coincidencia por nombre. Confirmar que es la empresa correcta.'
    };
  }
  
  // LOW CONFIDENCE
  return {
    status: 'ambiguous',
    confidence: topCandidate.score,
    candidates: candidates.slice(0, 5),
    reason: 'Baja confianza en el match. Revisar manualmente.'
  };
}
```

### Matriz de Decision del Matching

| Dominio CSV | Dominio DB | Nombre Ratio | Resultado | Accion |
|-------------|------------|--------------|-----------|--------|
| Existe | Coincide | >= 85% | `auto_matched` | Crear bookmark automaticamente |
| Existe | Coincide | < 85% | `needs_review` | Mostrar para confirmacion (posible rebrand) |
| Existe | No coincide | - | `ambiguous` | Mostrar candidatos por nombre |
| No existe | - | >= 85% exacto | `needs_review` | Confirmar empresa correcta |
| No existe | - | 60-84% | `ambiguous` | Mostrar multiples candidatos |
| No existe | - | < 60% | `no_match` | No se puede crear, ignorar |

---

## Flujo de Usuario Completo

### Fase 0: Pre-requisitos

El usuario ya tiene cuenta en ASCI (asci.bigua.lat) y posiblemente:
- Tiene bookmarks de empresas que sigue
- Tiene documentos de propuesta de valor subidos

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
│                                              [Continuar ->]         │
└─────────────────────────────────────────────────────────────────────┘
```

### Fase 2: Importar CSV de Whitelist (opcional)

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
│  │         company_name, domain (opcional)                     │    │
│  │                                                             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  [Descargar plantilla CSV]                                          │
└─────────────────────────────────────────────────────────────────────┘
```

**Paso 2.2: Procesamiento automatico**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Procesando target_accounts.csv                                     │
│                                                                     │
│  ████████████████████████░░░░░░░░░░░░░░░░░░░░  45%                  │
│                                                                     │
│  Analizando fila 45 de 100...                                       │
│  "Mercado Libre" -> Buscando en base de datos...                    │
└─────────────────────────────────────────────────────────────────────┘
```

**Paso 2.3: Resultados del matching**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Resultados de Importacion                               [Exportar] │
│                                                                     │
│  100 filas procesadas                                               │
│                                                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ 72 Auto-matched  │  │ 15 Requieren     │  │ 13 Sin match     │   │
│  │ ✓ Listos        │  │ revision         │  │                  │   │
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
│                    [Finalizar importacion]                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Fase 3: Configurar Blacklist (opcional)

Mismo flujo que whitelist, pero las empresas se guardan en `v3.excluded_accounts`.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Cuentas a Excluir (Base Instalada / Competidores)                  │
│                                                                     │
│  Estas empresas NO apareceran en resultados de busqueda ni en       │
│  sugerencias del agente.                                            │
│                                                                     │
│  [Importar CSV de exclusiones]                                      │
│                                                                     │
│  ─── O agregar manualmente ───                                      │
│                                                                     │
│  Empresa: [________________________]                                │
│  Razon:   [Base instalada     ▼]                                    │
│           [Agregar]                                                 │
│                                                                     │
│  Empresas excluidas (23):                                           │
│  • Accenture (competidor)                                           │
│  • BBVA (base instalada)                                            │
│  • ...                                                              │
└─────────────────────────────────────────────────────────────────────┘
```

### Fase 4: Generar API Key

```
┌─────────────────────────────────────────────────────────────────────┐
│  Generar API Key                                                    │
│                                                                     │
│  Tu agente de IA necesita una API key para conectarse a ASCI.       │
│                                                                     │
│  Nombre de la key: [Claude Desktop____________]                     │
│                                                                     │
│  Plan actual: Beta                                                  │
│  • 60 llamadas/minuto                                               │
│  • 1,000 llamadas/dia                                               │
│  • 50 emails/dia                                                    │
│  • 100 cuentas ABM                                                  │
│                                                                     │
│                                           [Generar API Key]         │
└─────────────────────────────────────────────────────────────────────┘
```

**Despues de generar:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  ! Tu API Key (solo se muestra una vez)                             │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ asci_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0           │  │
│  │                                                    [Copiar]   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Guarda esta key en un lugar seguro. No podras verla de nuevo.      │
│                                                                     │
│  Configuracion para tu cliente MCP:                                 │
│                                                                     │
│  {                                                                  │
│    "mcpServers": {                                                  │
│      "asci": {                                                      │
│        "url": "https://api.bot.bigua.lat/mcp",                      │
│        "transport": "streamable-http",                              │
│        "headers": {                                                 │
│          "Authorization": "Bearer asci_live_a1b2..."                │
│        }                                                            │
│      }                                                              │
│    }                                                                │
│  }                                                                  │
│                                                                     │
│                                              [Entendido, continuar] │
└─────────────────────────────────────────────────────────────────────┘
```

### Fase 5: Configurar Webhooks (opcional)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Webhooks (Opcional)                                                │
│                                                                     │
│  Recibe notificaciones cuando ocurran eventos importantes.          │
│                                                                     │
│  URL del endpoint: [https://mi-agente.com/webhook____]              │
│                                                                     │
│  Eventos a notificar:                                               │
│  [x] email.approved - Cuando apruebas un email                      │
│  [x] email.sent - Cuando se envia un email                          │
│  [x] email.rejected - Cuando rechazas un email                      │
│  [ ] sequence.escalated - Cuando una secuencia escala a contacto B  │
│                                                                     │
│  [Guardar configuracion]                   [Saltar por ahora]       │
└─────────────────────────────────────────────────────────────────────┘
```

### Fase 6: Dashboard Principal (Uso Diario)

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
│  │ Hola Juan, note que estan buscando un Cloud Architect...      │  │
│  │                                                               │  │
│  │ Contexto usado:                                               │  │
│  │ • Senal: Job posting "Cloud Architect" (hace 3 dias)          │  │
│  │ • Noticia: "ML expande operaciones en Brasil"                 │  │
│  │ • Doc: "Propuesta Cloud Migration"                            │  │
│  │                                                               │  │
│  │ [Ver completo]  [Editar]  [Aprobar ✓]  [Rechazar ✗]           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Para: Maria Garcia (VP Engineering @ Globant)       Hace 20m  │  │
│  │ ...                                                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Fase 7: Flujo del Agente (MCP)

El agente de IA del usuario se conecta y ejecuta:

```
1. AGENTE: get_bookmarks({ include_signals: true })
   ASCI: Retorna 47 empresas con resumen de senales
         (automaticamente excluye las 23 en blacklist)

2. AGENTE: Selecciona "Mercado Libre" por tener senales recientes

3. AGENTE: get_account_intelligence({ company_id: "ml-123" })
   ASCI: Retorna noticias, job postings, tech radar, senales

4. AGENTE: get_decision_makers({ company_id: "ml-123" })
   ASCI: Retorna contactos priorizados A/B/C con icebreakers
         - A: Juan Perez (CTO) - "Note que estan buscando Cloud Architect..."
         - B: Carlos Lopez (VP Infra) - "Vi que expandieron a Brasil..."
         - C: Ana Martinez (Dir Eng) - "Felicitaciones por el premio..."

5. AGENTE: Redacta email usando el contexto y icebreaker

6. AGENTE: queue_email_for_approval({
     company_id: "ml-123",
     contact_id: "jp-456",
     subject: "Optimizacion de infraestructura cloud",
     body_html: "...",
     body_plain: "...",
     icebreaker_used: "Note que estan buscando Cloud Architect...",
     context_used: { signals: [...], news: [...], documents: [...] }
   })
   ASCI: { queue_id: "eq-789", status: "queued" }

7. DASHBOARD: Usuario ve notificacion (badge + Supabase Realtime)
              Revisa email, hace pequeno ajuste, aprueba

8. WEBHOOK -> AGENTE: { event: "email.approved", queue_id: "eq-789" }

9. AGENTE: Envia email via Gmail API

10. AGENTE: (Opcional) Actualiza estado
    ASCI: Marca email como "sent"

11. (5 dias despues, sin respuesta)
    ASCI: Marca secuencia para escalar
    WEBHOOK -> AGENTE: { event: "sequence.escalated", sequence_id: "..." }

12. AGENTE: get_decision_makers({ company_id: "ml-123" })
    ASCI: Ahora sugiere contacto B con nuevo icebreaker

13. Repite flujo con contacto B...
```

---

## MCP Server - Tools Expuestos

### 1. `get_bookmarks`
Lista los bookmarks del usuario (cuentas objetivo / whitelist) con resumen de senales.

```typescript
interface GetBookmarksInput {
  include_signals?: boolean;
  has_recent_signals?: boolean;
  industry?: string;
  limit?: number;
  offset?: number;
}

interface GetBookmarksOutput {
  bookmarks: Array<{
    id: string;
    company: {
      id: string;
      name: string;
      domain: string;
      industry: string;
      employee_count: number;
    };
    signals_summary: {
      total_signals: number;
      recent_news_count: number;
      open_positions_count: number;
      tech_changes_count: number;
      last_signal_date: string;
    };
    prospection_status: {
      is_target_account: boolean;
      has_active_sequence: boolean;
      last_contacted_at: string | null;
      sequence_status: 'not_started' | 'in_progress' | 'completed' | 'paused' | null;
    };
  }>;
  total: number;
  has_more: boolean;
  excluded_count: number;
}
```

### 2. `get_account_intelligence`
Obtiene inteligencia completa de una cuenta especifica.

```typescript
interface GetAccountIntelligenceInput {
  company_id: string;
  include_news?: boolean;
  include_signals?: boolean;
  include_tech_radar?: boolean;
  include_job_postings?: boolean;
  news_limit?: number;
  signals_days?: number;
}

interface GetAccountIntelligenceOutput {
  company: { /* datos basicos */ };
  news: Array<{
    title: string;
    summary: string;
    source: string;
    url: string;
    published_at: string;
    relevance_score: number;
  }>;
  signals: Array<{
    type: string;
    title: string;
    description: string;
    detected_at: string;
    source: string;
  }>;
  tech_radar: {
    current_stack: string[];
    recent_adoptions: string[];
    potential_needs: string[];
  };
  job_postings: Array<{
    title: string;
    department: string;
    seniority: string;
    skills_required: string[];
    posted_at: string;
    linkedin_url: string;
  }>;
}
```

### 3. `get_decision_makers`
Obtiene contactos priorizados (A/B/C) con icebreakers.

```typescript
interface GetDecisionMakersInput {
  company_id: string;
  refresh?: boolean;
}

interface GetDecisionMakersOutput {
  decision_makers: Array<{
    rank: 'A' | 'B' | 'C';
    contact: {
      id: string;
      name: string;
      title: string;
      email: string;
      phone?: string;
      linkedin_url?: string;
    };
    ranking_reasoning: string;
    icebreaker: string;
    icebreaker_context: {
      based_on: string[];
    };
  }>;
  analysis_date: string;
  user_documents_used: string[];
}
```

### 4. `get_icebreakers`
Genera icebreakers personalizados para un contacto especifico.

```typescript
interface GetIcebreakersInput {
  company_id: string;
  contact_id: string;
  context?: {
    meeting_type?: string;
    tone?: string;
    focus_areas?: string[];
  };
}

interface GetIcebreakersOutput {
  icebreakers: Array<{
    text: string;
    type: string;
    confidence: number;
    source_signals: string[];
  }>;
  contact_insights: {
    tenure_at_company: string;
    recent_activity: string[];
    mutual_connections?: number;
  };
}
```

### 5. `get_user_documents`
Obtiene documentos/propuesta de valor del usuario.

```typescript
interface GetUserDocumentsInput {
  document_ids?: string[];
  include_content?: boolean;
}

interface GetUserDocumentsOutput {
  documents: Array<{
    id: string;
    name: string;
    type: string;
    summary: string;
    content?: string;
    key_points: string[];
    target_personas: string[];
    industries: string[];
  }>;
}
```

### 6. `search_accounts`
Busca cuentas en la base de ASCI. Automaticamente excluye blacklist.

```typescript
interface SearchAccountsInput {
  query: string;
  filters?: {
    industry?: string;
    employee_range?: { min?: number; max?: number };
    country?: string;
    has_signals?: boolean;
  };
  include_excluded?: boolean;
  limit?: number;
}

interface SearchAccountsOutput {
  accounts: Array<{
    id: string;
    name: string;
    domain: string;
    industry: string;
    match_score: number;
    is_bookmarked: boolean;
    is_excluded: boolean;
    exclusion_reason?: string;
  }>;
}
```

### 7. `queue_email_for_approval`
Encola un email para aprobacion del vendedor.

```typescript
interface QueueEmailInput {
  company_id: string;
  contact_id: string;
  subject: string;
  body_html: string;
  body_plain: string;
  icebreaker_used?: string;
  context_used?: {
    signals?: string[];
    news?: string[];
    documents?: string[];
  };
  sequence_id?: string;
}

interface QueueEmailOutput {
  queue_id: string;
  status: 'queued';
  approval_url: string;
  estimated_review_time?: string;
}
```

### 8. `get_email_status`
Consulta el estado de emails en cola/enviados.

```typescript
interface GetEmailStatusInput {
  queue_ids?: string[];
  sequence_id?: string;
  status_filter?: ('pending' | 'approved' | 'rejected' | 'sent')[];
}

interface GetEmailStatusOutput {
  emails: Array<{
    id: string;
    status: string;
    contact_name: string;
    company_name: string;
    subject: string;
    created_at: string;
    reviewed_at?: string;
    sent_at?: string;
    was_edited: boolean;
    response_received: boolean;
  }>;
}
```

---

## Sistema de Webhooks

### Formato de Payload

```typescript
interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, any>;
}

// Header de firma
// X-ASCI-Signature: sha256=<HMAC-SHA256(payload, secret)>
```

### Eventos Disponibles

| Evento | Descripcion | Data |
|--------|-------------|------|
| `email.queued` | Email encolado para aprobacion | `{ queue_id, company_name, contact_name }` |
| `email.approved` | Usuario aprobo email | `{ queue_id, was_edited }` |
| `email.rejected` | Usuario rechazo email | `{ queue_id, reason }` |
| `email.sent` | Email marcado como enviado | `{ queue_id, sent_at }` |
| `sequence.escalated` | Secuencia lista para escalar a siguiente contacto | `{ sequence_id, company_id, next_contact_rank }` |

### Reintentos

- 3 reintentos con exponential backoff (1s, 5s, 30s)
- Despues de 3 fallos, webhook se desactiva
- Usuario puede reactivar manualmente

---

## Rate Limits por Tier

| Tier | Calls/min | Calls/dia | Emails/dia | Cuentas ABM |
|------|-----------|-----------|------------|-------------|
| beta | 60 | 1,000 | 50 | 100 |
| starter | 30 | 500 | 20 | 50 |
| pro | 120 | 5,000 | 100 | 200 |
| enterprise | 300 | ilimitado | ilimitado | ilimitado |

---

## Consideraciones de Seguridad

1. **API Keys**: Hasheadas con SHA256, nunca en plaintext
2. **Rate Limiting**: Por usuario (no por key, ya que es 1:1)
3. **Webhooks**: Firmados con HMAC-SHA256
4. **RLS**: Todas las tablas v3 tienen policies por user_id
5. **No FK cross-schema**: Referencias logicas, no foreign keys entre v3 y public
6. **Audit futuro**: Preparado para logging de acciones MCP

---

## Plan de Implementacion por Fases

### Fase 0: Setup (1-2 dias)
- [ ] Crear repo `asci-core` con estructura basica
- [ ] Configurar npm privado (GitHub Packages)
- [ ] Crear repo `bigua-bot` con Turborepo
- [ ] Configurar proyectos en Vercel

### Fase 1: Base de datos (2-3 dias)
- [ ] Crear schema v3
- [ ] Crear tabla `v3.bookmark_metadata`
- [ ] Crear tabla `v3.excluded_accounts`
- [ ] Crear tablas `v3.csv_imports` y `v3.csv_import_rows`
- [ ] Crear tabla `v3.api_keys`
- [ ] Crear tablas `v3.email_sequences`, `v3.email_queue`, `v3.contact_rankings`
- [ ] Crear tablas `v3.webhooks`, `v3.user_tiers`
- [ ] Configurar RLS en todas las tablas

### Fase 2: Dashboard MCP - Configuracion (1 semana)
- [ ] Auth (compartida con ASCI)
- [ ] Onboarding flow
- [ ] UI para importar CSV whitelist
- [ ] Logica de matching con normalizacion + fuzzy
- [ ] UI de resolucion de matches ambiguos
- [ ] UI para importar CSV blacklist
- [ ] Generacion de API keys
- [ ] Configuracion de webhooks

### Fase 3: MCP Server - Core (1 semana)
- [ ] Setup MCP server con SDK
- [ ] Transport HTTP streamable
- [ ] Middleware de autenticacion
- [ ] Rate limiting
- [ ] Tools: `get_bookmarks`, `search_accounts`, `get_user_documents`

### Fase 4: MCP Server - Intelligence (1 semana)
- [ ] `get_account_intelligence`
- [ ] `get_decision_makers` con ranking IA
- [ ] `get_icebreakers`
- [ ] Integracion Apollo API

### Fase 5: Sistema de Emails (1 semana)
- [ ] `queue_email_for_approval`
- [ ] `get_email_status`
- [ ] Dashboard: cola de aprobacion con Supabase Realtime
- [ ] Edicion de emails
- [ ] Sistema de webhooks
- [ ] Notificaciones por email (Resend)

### Fase 6: Secuencias y Escalamiento (3-4 dias)
- [ ] Logica de secuencias
- [ ] Deteccion de "sin respuesta"
- [ ] Escalamiento automatico

### Fase 7: Apify Integration (3-4 dias)
- [ ] Integracion Apify para LinkedIn
- [ ] Cron job bimensual
- [ ] Procesamiento de job postings

---

## Preguntas Resueltas

| Pregunta | Respuesta |
|----------|-----------|
| Modificar public.bookmarks? | NO - usar v3.bookmark_metadata |
| Matching CSV | Auto (regex + fuzzy >85%) + confirmacion manual |
| Auto-match condicion | Dominio exacto + nombre similar (>85%) |
| Ambiente | Produccion directa |
| Auth MCP | API key -> user_id (scoped) |
| Keys por usuario | 1 key activa por usuario |
| Rate limits | Por usuario, segun tier |
| Integracion Apify | Nuevo desarrollo |
| MCP transport | HTTP Streamable |
| Real-time dashboard | Supabase Realtime |
| Notificacion agentes | Webhooks HMAC-SHA256 |
