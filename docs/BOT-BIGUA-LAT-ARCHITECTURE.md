# BOT.BIGUA.LAT: Arquitectura MCP para Agentes de IA

## Resumen Ejecutivo

Nueva iteración de ASCI como MCP (Model Context Protocol) server que permite a agentes de IA consumir inteligencia de cuentas, gestionar secuencias de outreach y coordinar el envío de emails con aprobación humana. 

**Coexistencia en producción:**
- `asci.bigua.lat` - ASCI v2 actual (producción, usuarios reales)
- `bot.bigua.lat` - Nueva iteración MCP (beta testing)

Ambas aplicaciones comparten la misma base de datos Supabase y un paquete core común.

---

## Arquitectura General

### Estructura de Repositorios

```
Organización GitHub
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
    │   └── dashboard/            # Next.js - UI de configuración
    └── package.json              # Importa @asci/core
```

### Deployments en Vercel

| Proyecto | Dominio | Propósito |
|----------|---------|-----------|
| v0-asci-v2 | asci.bigua.lat | ASCI actual - búsqueda y bookmarks (PROD) |
| bigua-bot-dashboard | bot.bigua.lat | Dashboard de configuración MCP (BETA) |
| bigua-bot-mcp | api.bot.bigua.lat | MCP Server (streamable HTTP) |

### Base de Datos

**Decisión: Misma base de Supabase, nuevas tablas**

- Reutilizar tablas existentes: `companies`, `bookmarks`, `signals`, `news`, `contacts`, `documents`, `users`
- Agregar nuevas tablas para funcionalidad MCP (ver schema abajo)

---

## Modelo de Datos: Bookmarks = Whitelist (Cuentas Objetivo)

### Decisión Arquitectónica Clave

**Los bookmarks existentes SON la whitelist de cuentas objetivo.**

- Los usuarios actuales que tienen bookmarks con filtros → esos bookmarks son sus cuentas objetivo (whitelist)
- Cuando un usuario sube un CSV con nuevas cuentas whitelist → se crean bookmarks automáticamente
- La blacklist (base instalada / cuentas a no prospectar) es una tabla separada de exclusión

Esto significa:
1. **No necesitamos tabla `account_lists`** - los bookmarks ya cumplen esa función
2. **No necesitamos `account_list_items`** - los bookmarks ya hacen el link usuario → company
3. **Solo agregamos `excluded_accounts`** - para blacklist/base instalada

---

## Nuevas Tablas de Base de Datos

### 1. `excluded_accounts` - Blacklist / Base Instalada (NO prospectar)

```sql
CREATE TABLE excluded_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Puede estar vinculada a una company existente o no
  company_id UUID REFERENCES companies(id), -- NULL si no hay match
  
  -- Input del usuario (del CSV de exclusión)
  original_name TEXT NOT NULL,
  original_domain TEXT,
  
  -- Match con ASCI (para mostrar info si existe)
  match_status TEXT DEFAULT 'pending' CHECK (match_status IN ('pending', 'matched', 'ambiguous', 'no_match', 'ignored')),
  match_confidence FLOAT,
  match_candidates JSONB, -- [{company_id, name, score}] para casos ambiguos
  
  -- Razón de exclusión
  exclusion_reason TEXT, -- 'installed_base', 'competitor', 'do_not_contact', 'other'
  notes TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  matched_at TIMESTAMPTZ,
  
  -- Índice único: un usuario no puede excluir la misma cuenta dos veces
  UNIQUE(user_id, COALESCE(company_id, original_name))
);

-- RLS: usuarios solo ven sus propias exclusiones
ALTER TABLE excluded_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own exclusions" ON excluded_accounts
  FOR ALL USING (auth.uid() = user_id);
```

### 2. `csv_imports` - Tracking de importaciones de CSV

```sql
CREATE TABLE csv_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Tipo de importación
  import_type TEXT NOT NULL CHECK (import_type IN ('whitelist', 'blacklist')),
  
  -- Archivo original
  file_name TEXT NOT NULL,
  file_url TEXT, -- Vercel Blob URL
  
  -- Estadísticas
  total_rows INTEGER DEFAULT 0,
  matched_count INTEGER DEFAULT 0,
  ambiguous_count INTEGER DEFAULT 0,
  no_match_count INTEGER DEFAULT 0,
  
  -- Estado
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'pending_review', 'completed', 'failed')),
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

### 3. Migración tabla `bookmarks` existente

```sql
-- Agregar columna para distinguir bookmarks de seguimiento vs prospección activa
ALTER TABLE bookmarks ADD COLUMN is_target_account BOOLEAN DEFAULT true;

-- Agregar columna para tracking de última prospección
ALTER TABLE bookmarks ADD COLUMN last_prospected_at TIMESTAMPTZ;

-- Agregar columna para estado de secuencia actual
ALTER TABLE bookmarks ADD COLUMN current_sequence_id UUID REFERENCES email_sequences(id);

-- Índice para queries del MCP
CREATE INDEX idx_bookmarks_target_accounts ON bookmarks(user_id, is_target_account) 
  WHERE is_target_account = true;

-- Comentario para documentar
COMMENT ON COLUMN bookmarks.is_target_account IS 
  'true = cuenta objetivo para prospectar activamente (whitelist), false = solo seguimiento de señales';
```

### 4. `csv_import_rows` - Filas pendientes de resolver (ambiguas)

```sql
CREATE TABLE csv_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID REFERENCES csv_imports(id) ON DELETE CASCADE,
  
  -- Input del usuario
  original_name TEXT NOT NULL,
  original_domain TEXT,
  row_number INTEGER,
  
  -- Estado del matching
  match_status TEXT DEFAULT 'pending' CHECK (match_status IN ('pending', 'matched', 'ambiguous', 'no_match', 'resolved', 'skipped')),
  match_confidence FLOAT,
  match_candidates JSONB, -- [{company_id, name, domain, score}]
  
  -- Resolución
  resolved_company_id UUID REFERENCES companies(id),
  resolved_at TIMESTAMPTZ,
  resolution_type TEXT, -- 'auto', 'manual', 'skipped', 'new_company'
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 5. `api_keys` - Autenticación MCP

```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL, -- SHA256 del key, nunca guardar plaintext
  key_prefix TEXT NOT NULL, -- Primeros 8 chars para identificación (asci_xxxx)
  name TEXT NOT NULL, -- "Mi agente Claude", "Cursor", etc.
  
  -- Permisos y límites
  scopes TEXT[] DEFAULT ARRAY['read', 'write'], -- Granularidad futura
  tier TEXT DEFAULT 'beta' CHECK (tier IN ('beta', 'starter', 'pro', 'enterprise')),
  
  -- Rate limits según tier
  rate_limit_day INTEGER, -- Calls por día
  rate_limit_minute INTEGER, -- Calls por minuto
  
  -- Tracking
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
```

---

## Workflow de API Keys (Detalle)

### Generación de API Key (Dashboard MCP)

```
Usuario en bot.bigua.lat → "Crear API Key"
                    ↓
         Ingresa nombre descriptivo
         (ej: "Claude Desktop", "Cursor Work")
                    ↓
         Backend genera key segura:
         - Formato: asci_live_xxxxxxxxxxxxxxxxxxxx (32 chars random)
         - SHA256 del key → guardado en DB (key_hash)
         - Prefix "asci_live_" + primeros 4 chars → guardado (key_prefix)
                    ↓
         UI muestra key COMPLETA una única vez
         con botón "Copiar" y warning
                    ↓
         Usuario copia y guarda en su cliente MCP
```

### Estructura del API Key

```
asci_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
│    │    │
│    │    └── 32 caracteres random (crypto secure)
│    │
│    └── Ambiente: "live" (producción) o "test" (sandbox)
│
└── Prefijo identificador
```

### Autenticación en el MCP Server

```typescript
// El agente envía el API key en el header Authorization
// Formato: Bearer asci_live_xxxxxxxxxxxx

// Middleware de autenticación (api.bot.bigua.lat)
async function authenticateApiKey(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer asci_')) {
    throw new Error('Invalid API key format');
  }
  
  const apiKey = authHeader.replace('Bearer ', '');
  const keyHash = sha256(apiKey);
  
  // Buscar en DB por hash (nunca comparar plaintext)
  const keyRecord = await db.api_keys
    .findFirst({ where: { key_hash: keyHash, revoked_at: null } });
  
  if (!keyRecord) {
    throw new Error('Invalid or revoked API key');
  }
  
  // Actualizar last_used_at
  await db.api_keys.update({
    where: { id: keyRecord.id },
    data: { last_used_at: new Date() }
  });
  
  // Verificar rate limits según tier
  await checkRateLimits(keyRecord);
  
  return { userId: keyRecord.user_id, tier: keyRecord.tier };
}
```

### UI de Gestión de API Keys (Dashboard)

```
┌─────────────────────────────────────────────────────────────────┐
│  API Keys                                       [+ Nueva Key]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Claude Desktop                                                 │
│  asci_live_a1b2...  •  Creada hace 3 días  •  Usada hace 2h    │
│  [Ver uso] [Revocar]                                           │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Cursor Trabajo                                                 │
│  asci_live_x9y8...  •  Creada hace 1 semana  •  Nunca usada    │
│  [Ver uso] [Revocar]                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Configuración del Cliente MCP (Usuario Final)

El usuario configura su cliente MCP (Claude Desktop, Cursor, etc.) con:

```json
{
  "mcpServers": {
    "asci": {
      "url": "https://api.bot.bigua.lat/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer asci_live_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

### Rate Limits por Tier

| Tier | Calls/minuto | Calls/día | Emails/día | Cuentas ABM |
|------|-------------|-----------|------------|-------------|
| beta | 30 | 500 | 10 | 25 |
| starter | 60 | 2,000 | 50 | 100 |
| pro | 120 | 10,000 | 200 | 500 |
| enterprise | unlimited | unlimited | 1,000 | unlimited |

---

### 6. `email_sequences` - Secuencias de outreach por cuenta

```sql
CREATE TABLE email_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id),
  bookmark_id UUID REFERENCES bookmarks(id),
  
  -- Configuración
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  wait_days INTEGER DEFAULT 5, -- Días para esperar respuesta antes de escalar
  
  -- Tracking
  current_contact_index INTEGER DEFAULT 0, -- 0=A, 1=B, 2=C
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 7. `email_queue` - Cola de emails pendientes de aprobación

```sql
CREATE TABLE email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID REFERENCES email_sequences(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Contacto destino
  contact_id UUID REFERENCES contacts(id),
  contact_email TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_title TEXT,
  
  -- Contenido del email (generado por el agente)
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_plain TEXT NOT NULL,
  
  -- Icebreaker y contexto usado
  icebreaker TEXT,
  context_used JSONB, -- {signals: [...], news: [...], docs: [...]}
  
  -- Estado
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'sent', 'bounced')),
  
  -- Edición por el vendedor
  edited_subject TEXT,
  edited_body_html TEXT,
  edited_body_plain TEXT,
  editor_notes TEXT, -- Notas del vendedor sobre cambios
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  
  -- Tracking de respuesta
  response_received_at TIMESTAMPTZ,
  response_type TEXT CHECK (response_type IN ('reply', 'bounce', 'none'))
);
```

### 8. `contact_rankings` - Priorización A/B/C de decision makers

```sql
CREATE TABLE contact_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  user_id UUID REFERENCES auth.users(id),
  
  -- Contacto de Apollo
  contact_id UUID REFERENCES contacts(id),
  
  -- Ranking generado por IA
  rank TEXT CHECK (rank IN ('A', 'B', 'C')),
  rank_score FLOAT, -- 0-100
  rank_reasoning TEXT, -- Explicación de la IA
  
  -- Factores considerados
  factors JSONB, -- {seniority_match: 0.9, department_match: 0.8, doc_relevance: 0.7}
  
  -- Icebreaker personalizado
  icebreaker TEXT,
  icebreaker_context JSONB, -- Señales/noticias usadas para el icebreaker
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(company_id, user_id, contact_id)
);
```

### 9. `webhooks` - Configuración de webhooks del usuario

```sql
CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  url TEXT NOT NULL,
  secret TEXT NOT NULL, -- Para firmar payloads
  
  -- Eventos suscritos
  events TEXT[] NOT NULL, -- ['email.approved', 'email.sent', 'sequence.escalated', etc.]
  
  -- Estado
  active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 10. `user_tiers` - Límites por plan

```sql
CREATE TABLE user_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  
  tier TEXT DEFAULT 'beta' CHECK (tier IN ('beta', 'starter', 'pro', 'enterprise')),
  
  -- Límites
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
```

---

## MCP Server - Tools Expuestos

### 1. `get_bookmarks`
Lista los bookmarks del usuario (cuentas objetivo / whitelist) con resumen de señales.
**Nota:** Los bookmarks SON la whitelist. No se devuelven cuentas que estén en `excluded_accounts`.

```typescript
interface GetBookmarksInput {
  include_signals?: boolean;  // Incluir resumen de señales
  has_recent_signals?: boolean; // Filtrar solo con señales recientes
  industry?: string;          // Filtrar por industria
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
    // Campos de prospección
    has_active_sequence: boolean;
    last_contacted_at: string | null;
    sequence_status: 'not_started' | 'in_progress' | 'completed' | 'paused' | null;
  }>;
  total: number;
  has_more: boolean;
  // Info útil para el agente
  excluded_count: number; // Cuántas cuentas tiene en blacklist
}
```

### 2. `get_account_intelligence`
Obtiene inteligencia completa de una cuenta específica.

```typescript
interface GetAccountIntelligenceInput {
  company_id: string;
  include_news?: boolean;      // Default: true
  include_signals?: boolean;   // Default: true
  include_tech_radar?: boolean; // Default: true
  include_job_postings?: boolean; // Default: true
  news_limit?: number;         // Default: 10
  signals_days?: number;       // Señales de los últimos X días
}

interface GetAccountIntelligenceOutput {
  company: { /* datos básicos */ };
  news: Array<{
    title: string;
    summary: string;
    source: string;
    url: string;
    published_at: string;
    relevance_score: number;
  }>;
  signals: Array<{
    type: string; // 'job_posting', 'tech_adoption', 'expansion', etc.
    title: string;
    description: string;
    detected_at: string;
    source: string;
  }>;
  tech_radar: {
    current_stack: string[];
    recent_adoptions: string[];
    potential_needs: string[]; // Inferido de job postings
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
  refresh?: boolean; // Forzar re-análisis de IA
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
    ranking_reasoning: string; // "VP of IT, matches your ICP for cloud solutions..."
    icebreaker: string; // "Noté que están expandiendo su equipo de data..."
    icebreaker_context: {
      based_on: string[]; // ['job_posting:data_engineer', 'news:expansion_latam']
    };
  }>;
  analysis_date: string;
  user_documents_used: string[]; // IDs de docs usados para el análisis
}
```

### 4. `get_icebreakers`
Genera icebreakers personalizados para un contacto específico.

```typescript
interface GetIcebreakersInput {
  company_id: string;
  contact_id: string;
  context?: {
    meeting_type?: string; // 'cold_email', 'follow_up', 'referral'
    tone?: string; // 'formal', 'casual', 'consultative'
    focus_areas?: string[]; // ['cost_reduction', 'innovation', 'compliance']
  };
}

interface GetIcebreakersOutput {
  icebreakers: Array<{
    text: string;
    type: string; // 'news_based', 'job_posting_based', 'tech_based'
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
Obtiene documentos/propuesta de valor del usuario para contexto.

```typescript
interface GetUserDocumentsInput {
  document_ids?: string[]; // Específicos, o todos si vacío
  include_content?: boolean; // Default: false (solo metadata)
}

interface GetUserDocumentsOutput {
  documents: Array<{
    id: string;
    name: string;
    type: string; // 'value_proposition', 'case_study', 'product_sheet'
    summary: string; // Resumen generado por IA
    content?: string; // Solo si include_content=true
    key_points: string[]; // Puntos clave extraídos
    target_personas: string[]; // 'CTO', 'CFO', etc.
    industries: string[]; // Industrias relevantes
  }>;
}
```

### 6. `search_accounts`
Busca cuentas en la base de ASCI. Automáticamente excluye cuentas en la blacklist del usuario.

```typescript
interface SearchAccountsInput {
  query: string; // Nombre o dominio
  filters?: {
    industry?: string;
    employee_range?: { min?: number; max?: number };
    country?: string;
    has_signals?: boolean;
  };
  include_excluded?: boolean; // Default: false. Si true, incluye cuentas excluidas marcadas
  limit?: number;
}

interface SearchAccountsOutput {
  accounts: Array<{
    id: string;
    name: string;
    domain: string;
    industry: string;
    match_score: number; // Relevancia del search
    is_bookmarked: boolean; // Ya está en whitelist/objetivos
    is_excluded: boolean;   // Está en blacklist (solo si include_excluded=true)
    exclusion_reason?: string; // 'installed_base', 'competitor', etc.
  }>;
}
```

### 7. `queue_email_for_approval`
Encola un email para aprobación del vendedor.

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
  sequence_id?: string; // Si es parte de una secuencia existente
}

interface QueueEmailOutput {
  queue_id: string;
  status: 'queued';
  approval_url: string; // Deep link al dashboard para aprobar
  estimated_review_time?: string; // Basado en historial del usuario
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

## Flujo de Usuario Completo

### Fase 1: Configuración (Dashboard MCP - bot.bigua.lat)

1. **Login** - Usuario se autentica (misma auth de ASCI actual)

2. **Subir documentos** - Si no tiene docs, sube propuesta de valor, casos de éxito
   - Parser extrae key points, target personas, industrias
   - IA genera resumen y puntos clave

3. **Gestión de cuentas objetivo (Whitelist = Bookmarks)**
   
   **Opción A: Usar bookmarks existentes**
   - Si el usuario ya tiene bookmarks en ASCI → esos SON sus cuentas objetivo
   - No necesita hacer nada extra, el MCP ya puede consumirlos
   
   **Opción B: Importar CSV de cuentas objetivo**
   - Sube CSV con columnas: `nombre, dominio (opcional), industria (opcional)`
   - ASCI hace matching y crea bookmarks automáticamente para las cuentas matched
   - Dashboard muestra: matched (auto-bookmark), ambiguous (elegir), no_match (crear o ignorar)
   
4. **Gestión de exclusiones (Blacklist)**
   - Usuario puede subir CSV de base instalada / cuentas a no prospectar
   - Matching contra base de ASCI (mismo flujo)
   - Estas cuentas se guardan en `excluded_accounts`
   - El MCP automáticamente las filtra de resultados

5. **Matching de cuentas (para ambos flujos)**
   - ASCI hace regex match contra base de companies
   - Estados: `matched` (automático), `ambiguous` (requiere confirmación), `no_match`
   - Para `ambiguous`: UI muestra opciones, usuario elige la correcta
   - Para `no_match`: opción de crear company nueva o ignorar

6. **Generar API Key**
   - Usuario genera key con nombre descriptivo
   - Se muestra UNA vez, luego solo el prefix
   - Configurar tier/límites según plan

7. **Configurar webhooks** (opcional)
   - URL endpoint del agente
   - Seleccionar eventos: `email.approved`, `email.sent`, `sequence.escalated`

### Fase 2: Uso por Agente (MCP)

1. **Agente consulta bookmarks ABM**
   ```
   Tool: get_bookmarks
   Input: { include_signals: true }
   ```

2. **Para cada cuenta prioritaria, obtiene inteligencia**
   ```
   Tool: get_account_intelligence
   Input: { company_id: 'xxx', include_news: true, include_job_postings: true }
   ```

3. **Obtiene decision makers priorizados**
   ```
   Tool: get_decision_makers
   Input: { company_id: 'xxx' }
   ```
   - ASCI devuelve contactos A, B, C con icebreakers

4. **Agente redacta email usando contexto**
   - Usa: docs del usuario, señales, noticias, icebreaker
   - Personaliza según el contacto y la cuenta

5. **Encola email para aprobación**
   ```
   Tool: queue_email_for_approval
   Input: { company_id, contact_id, subject, body_html, body_plain, context_used }
   ```

### Fase 3: Aprobación (Dashboard MCP)

1. **Vendedor recibe notificación** (email + badge en dashboard)

2. **Revisa email en cola**
   - Ve: destinatario, empresa, asunto, cuerpo, contexto usado
   - Acciones: Aprobar, Editar y aprobar, Rechazar

3. **Si edita**: modifica texto, se guarda versión editada

4. **Al aprobar**: 
   - Webhook notifica al agente: `email.approved`
   - Agente envía email via su integración (Gmail)

5. **Tracking de respuesta**:
   - Usuario marca manualmente si recibió respuesta
   - O sistema detecta reply si hay integración futura

### Fase 4: Escalamiento de Secuencia

1. **Si pasan X días sin respuesta** (configurable, default 5):
   - Sistema marca secuencia para escalar
   - Webhook: `sequence.escalated`

2. **Agente consulta siguiente contacto**
   ```
   Tool: get_decision_makers
   # Devuelve contacto B con nuevo icebreaker (distinto al de A)
   ```

3. **Repite flujo de email** con contacto B
   - Mensaje diferente para evitar parecer automatizado

---

## Integración con Apify (Job Postings)

### Nuevo desarrollo requerido

```typescript
// lib/apify/linkedin-scraper.ts

interface ApifyJobPostingsInput {
  linkedin_company_url: string;
  max_posts: number;
}

interface ApifyJobPostingsOutput {
  job_postings: Array<{
    title: string;
    department: string;
    location: string;
    seniority_level: string;
    skills: string[];
    posted_date: string;
    linkedin_url: string;
  }>;
}
```

### Cron job bimensual
- Ejecuta cada 2 semanas
- Itera sobre companies con linkedin_url en bookmarks de usuarios
- Actualiza tabla `job_postings` (nueva o existente)
- Genera señales automáticas basadas en patrones

---

## Análisis de IA para Priorización

### Ubicación: ASCI (no el agente)

```typescript
// lib/ai/contact-ranker.ts

async function rankDecisionMakers(
  companyId: string,
  userId: string,
  contacts: Contact[],
  userDocuments: Document[],
  companySignals: Signal[]
): Promise<RankedContact[]> {
  
  const prompt = `
    Analiza los siguientes contactos de ${company.name} y priorízalos 
    según su relevancia para vender los siguientes productos/servicios:
    
    DOCUMENTOS DEL VENDEDOR:
    ${userDocuments.map(d => d.summary).join('\n')}
    
    SEÑALES RECIENTES DE LA EMPRESA:
    ${companySignals.map(s => s.description).join('\n')}
    
    CONTACTOS A EVALUAR:
    ${contacts.map(c => `- ${c.name}, ${c.title}`).join('\n')}
    
    Para cada contacto, devuelve:
    1. Rank (A, B o C)
    2. Score (0-100)
    3. Razonamiento (por qué es relevante o no)
    4. Un icebreaker personalizado basado en las señales
    
    Formato JSON...
  `;
  
  // Llamada a OpenAI/Anthropic
  const result = await ai.generate(prompt);
  return parseRankingResult(result);
}
```

---

## Sistema de Notificaciones

### Emails pendientes de aprobación

```typescript
// Trigger: nuevo email en cola
// Destino: email del vendedor + badge en dashboard

interface ApprovalNotification {
  type: 'email_pending_approval';
  user_id: string;
  queue_id: string;
  company_name: string;
  contact_name: string;
  subject_preview: string;
  approval_url: string;
}
```

### Canales de notificación (configurable por usuario)
- **Email**: Resend para enviar notificación
- **Dashboard**: Badge/contador en header + lista en página principal

---

## Paquete @asci/core (Scope Mínimo Viable)

```typescript
// packages/core/src/index.ts

// 1. Cliente Supabase tipado
export { createSupabaseClient, createSupabaseAdmin } from './db/client';

// 2. Tipos compartidos
export type { 
  Company, 
  Bookmark,        // Ahora incluye is_target_account
  Signal, 
  Contact,
  Document,
  ExcludedAccount, // Nueva tabla blacklist
  CsvImport,       // Tracking de importaciones
  EmailQueue,
  EmailSequence,
  ContactRanking,
  ApiKey,
  Webhook,
  UserTier
} from './types';

// 3. Utilidades básicas
export { hashApiKey, verifyApiKey } from './utils/auth';
export { normalizeCompanyName, matchCompanyByRegex } from './utils/matching';
```

### Publicación NPM privada
- GitHub Packages o npm privado
- Versionado semántico
- CI/CD para publicar en merge a main

---

## Plan de Implementación por Fases

### Fase 0: Setup (1-2 días)
- [ ] Crear repo `asci-core` con estructura básica
- [ ] Configurar npm privado (GitHub Packages)
- [ ] Crear repo `bigua-bot` con Turborepo (apps/mcp-server + apps/dashboard)
- [ ] Configurar proyectos en Vercel

### Fase 1: Base de datos (2-3 días)
- [ ] Migrar tabla `bookmarks`: agregar `is_target_account`, `last_prospected_at`, `current_sequence_id`
- [ ] Crear tabla `excluded_accounts` (blacklist)
- [ ] Crear tablas `csv_imports` y `csv_import_rows`
- [ ] Crear tablas `api_keys`, `webhooks`, `user_tiers`
- [ ] Crear tablas `email_sequences`, `email_queue`, `contact_rankings`
- [ ] Configurar RLS policies para todas las tablas nuevas
- [ ] Seed data para testing

### Fase 2: Dashboard MCP - Configuración (1 semana)
- [ ] Auth (reusar de ASCI actual)
- [ ] UI para subir/gestionar documentos
- [ ] UI para ver bookmarks existentes como cuentas objetivo
- [ ] UI para importar CSV de nuevas cuentas objetivo → crear bookmarks
- [ ] UI para importar CSV de blacklist → crear excluded_accounts
- [ ] Parser de CSV con matching regex
- [ ] UI de matching de cuentas (resolver ambiguos)
- [ ] Generación de API keys
- [ ] Configuración de webhooks

### Fase 3: MCP Server - Core (1 semana)
- [ ] Setup MCP server con `@modelcontextprotocol/sdk`
- [ ] Configurar transport **streamable HTTP** en `/mcp` endpoint
- [ ] Middleware de autenticación (API key en header `Authorization: Bearer asci_live_xxx`)
- [ ] Rate limiting por tier (usando Upstash Redis o similar)
- [ ] Implementar tools básicos: `get_bookmarks`, `search_accounts`, `get_user_documents`
- [ ] Health check endpoint en `/health`
- [ ] Logging y métricas básicas

### Fase 4: MCP Server - Intelligence (1 semana)
- [ ] `get_account_intelligence`
- [ ] `get_decision_makers` con ranking de IA
- [ ] `get_icebreakers`
- [ ] Integración con Apollo API para contactos

### Fase 5: Sistema de Emails (1 semana)
- [ ] `queue_email_for_approval`
- [ ] `get_email_status`
- [ ] Dashboard: cola de aprobación
- [ ] Edición de emails
- [ ] Sistema de webhooks
- [ ] Notificaciones por email

### Fase 6: Secuencias y Escalamiento (3-4 días)
- [ ] Lógica de secuencias
- [ ] Detección de "sin respuesta" (manual inicialmente)
- [ ] Escalamiento a contacto B/C
- [ ] Variación de mensajes

### Fase 7: Apify Integration (3-4 días)
- [ ] Integración con Apify para LinkedIn scraping
- [ ] Cron job bimensual
- [ ] Procesamiento y almacenamiento de job postings

### Fase 8: Testing y Beta (1 semana)
- [ ] Tests E2E del flujo completo
- [ ] Beta con usuarios seleccionados
- [ ] Ajustes basados en feedback

---

## Límites por Tier

| Tier | Cuentas ABM | Emails/día | API calls/día | API calls/min |
|------|-------------|------------|---------------|---------------|
| Beta | 100 | 50 | 1000 | 60 |
| Starter | 50 | 20 | 500 | 30 |
| Pro | 200 | 100 | 5000 | 120 |
| Enterprise | Ilimitado | Ilimitado | Ilimitado | 300 |

---

## Consideraciones de Seguridad

1. **API Keys**: Hasheadas con SHA256, nunca en plaintext
2. **Rate Limiting**: Por tier, con backoff exponencial
3. **Webhooks**: Firmados con HMAC para verificar origen
4. **RLS**: Usuarios solo acceden a sus propios datos
5. **Audit Log**: Registrar todas las acciones del MCP (futuro)

---

## Preguntas Resueltas

- **MCP Client**: Multi-cliente (cualquier MCP compatible)
- **Modelo Whitelist/Blacklist**: 
  - **Whitelist = Bookmarks**: Los bookmarks existentes son las cuentas objetivo
  - **Nuevas cuentas whitelist**: Al importar CSV, se crean bookmarks automáticamente
  - **Blacklist = excluded_accounts**: Tabla separada para cuentas a no prospectar
- **Core sharing**: NPM package privado @asci/core
- **Email OAuth**: Delegado al agente (Gmail API)
- **Match confirmation**: En dashboard web
- **MCP Auth**: API Key por usuario
- **Upload format**: CSV/Excel con columnas
- **Refresh rate**: Mensual manual + bimensual Apify
- **Approval queue**: Dashboard web + notificación por email
- **Contact filter**: Análisis en ASCI, ranking A/B/C
- **Email tracking**: Sin respuesta en X días (configurable, default 5)
- **Apify**: Nuevo desarrollo
- **Core scope**: Mínimo viable (tipos + cliente Supabase)
- **Notifications**: Email + Dashboard
- **Webhooks**: Sí, para notificar eventos al agente
- **Limits**: Por tier/plan

---

## Migración de Usuarios Existentes

### Usuarios actuales de ASCI con bookmarks:

1. **No requieren migración de datos** - sus bookmarks ya son su whitelist
2. **Nuevo flag en bookmarks**: Agregar columna `is_target_account BOOLEAN DEFAULT true`
   - Permite que usuarios marquen bookmarks como "solo seguimiento" vs "prospectar activamente"
3. **Onboarding MCP**: 
   - Al acceder por primera vez al dashboard MCP, se les muestra cuántos bookmarks tienen
   - Pueden generar API key inmediatamente sin configuración adicional
   - Opcionalmente pueden subir blacklist de base instalada
