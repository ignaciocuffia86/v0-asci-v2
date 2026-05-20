# Plan de Implementacion MVP - BOT.BIGUA.LAT

## Alcance del MVP

### Incluido
- [x] Schema v3 completo
- [x] Multi-tenant (workspace por dominio)
- [x] Upload de docs (reutilizar v2 - Supabase Storage)
- [x] CSV import con matching (nombre y/o dominio)
- [x] Campanas tipo "Monitorear"
- [x] Busqueda manual de cuentas
- [x] Tech Radar (trigger a Parallel)
- [x] Apollo Search (reutilizar API v2)
- [x] Buyer persona basico (campo de texto para Apollo)
- [x] MCP Server (endpoints basicos)
- [x] UI: Copiloto placeholder "Coming Soon"

### Excluido del MVP
- [ ] Email Agent / envio de emails
- [ ] Campanas tipo "Prospectar" y "Descubrir"
- [ ] Recomendaciones automaticas de cuentas
- [ ] Cron mensual de actualizacion
- [ ] Webhooks de notificacion
- [ ] Multi-user dentro del workspace (solo admin por ahora)

---

## Fases de Implementacion

### FASE 0: Schema y Fundacion
**Duracion estimada:** 3-4 dias
**Dependencia:** Ninguna

#### 0.1 Crear schema v3 en Supabase

**Archivo a crear:** `scripts/200_v3_schema.sql`

```sql
-- Crear schema
CREATE SCHEMA IF NOT EXISTS v3;

-- Tablas en orden de dependencia:
-- 1. v3.workspaces
-- 2. v3.workspace_members
-- 3. v3.workspace_documents (analogo a user_documents)
-- 4. v3.workspace_document_tags
-- 5. v3.workspace_value_profiles
-- 6. v3.dictionary_job_titles
-- 7. v3.buyer_personas
-- 8. v3.campaigns
-- 9. v3.campaign_accounts
-- 10. v3.csv_imports
-- 11. v3.csv_import_rows
-- 12. v3.campaign_account_digest
-- 13. v3.mcp_api_keys
-- 14. v3.mcp_request_logs
```

**Referencia:** Ver seccion 2.3 de `docs/BOT-BIGUA-LAT-ARCHITECTURE.md` para DDL completo.

#### 0.2 RLS Policies para v3

**Archivo a crear:** `scripts/201_v3_rls.sql`

Todas las tablas de v3 deben tener RLS habilitado. Patron base:
- SELECT: usuario es miembro del workspace
- INSERT/UPDATE/DELETE: usuario es admin o editor del workspace

```sql
-- Ejemplo para v3.campaigns:
CREATE POLICY "workspace_members_can_select" ON v3.campaigns
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM v3.workspace_members wm
      WHERE wm.workspace_id = campaigns.workspace_id
      AND wm.user_id = auth.uid()
      AND wm.status = 'active'
    )
  );
```

#### 0.3 Seed de dictionary_job_titles

**Archivo a crear:** `scripts/202_v3_seed_job_titles.sql`

Poblar con job titles iniciales por proceso/tecnologia:

| Proceso/Tecnologia | Job Titles |
|-------------------|------------|
| ERP | CIO, CTO, VP Operations, Director IT |
| CRM | CMO, VP Sales, Sales Director, RevOps |
| Cloud (AWS/Azure/GCP) | CTO, VP Engineering, Cloud Architect |
| Data & Analytics | CDO, VP Data, Head of Analytics |
| Security | CISO, VP Security, Security Director |
| HR Tech | CHRO, VP HR, HR Director |

---

### FASE 1: Auth y Workspace
**Duracion estimada:** 4-5 dias
**Dependencia:** Fase 0 completa

#### 1.1 Logica de creacion de workspace

**Archivo a crear:** `lib/v3/workspace.ts`

```typescript
// Funciones principales:

export async function getOrCreateWorkspace(userId: string, email: string): Promise<Workspace>
// - Extrae dominio del email
// - Busca workspace existente por dominio
// - Si existe: crea workspace_member con status 'pending' (requiere aprobacion del admin)
// - Si no existe: crea workspace + workspace_member con rol 'admin'

export async function getWorkspaceForUser(userId: string): Promise<Workspace | null>
// - Retorna el workspace del usuario si tiene status 'active'

export async function approveWorkspaceMember(adminId: string, memberId: string): Promise<void>
// - Cambia status de 'pending' a 'active'
// - Verifica que adminId sea admin del workspace
```

**Referencia:** Ver seccion 4.1 de `docs/BOT-BIGUA-LAT-ARCHITECTURE.md`

#### 1.2 Middleware de workspace

**Archivo a crear:** `lib/v3/middleware.ts`

```typescript
export async function requireWorkspace(userId: string): Promise<Workspace>
// - Llama a getWorkspaceForUser
// - Si no tiene workspace activo, redirige a /v3/onboarding
// - Retorna workspace

export async function requireWorkspaceRole(
  userId: string, 
  roles: ('admin' | 'editor' | 'viewer')[]
): Promise<{workspace: Workspace, member: WorkspaceMember}>
// - Verifica que el usuario tenga uno de los roles especificados
```

#### 1.3 API Route de onboarding

**Archivo a crear:** `app/api/v3/workspace/route.ts`

```typescript
// POST - Crear/unirse a workspace
// GET - Obtener workspace actual del usuario
```

#### 1.4 Pagina de onboarding

**Archivo a crear:** `app/v3/onboarding/page.tsx`

Flujo:
1. Detectar si existe workspace para el dominio del usuario
2. Si existe: mostrar mensaje "Solicitud enviada al admin"
3. Si no existe: crear workspace automaticamente
4. Verificar si tiene docs subidos (blocker)
5. Redirigir a upload de docs o a dashboard

---

### FASE 2: Documentos del Workspace
**Duracion estimada:** 3-4 dias
**Dependencia:** Fase 1 completa

#### 2.1 Adaptar upload de docs para workspace

**Reutilizar de v2:**
- `app/docs/_components/upload-dialog.tsx` - UI de upload
- `lib/documents/extract-text.ts` - Extraccion de texto
- `lib/documents/analyze-document.ts` - Analisis con Gemini
- Bucket `user-documents` en Supabase Storage

**Archivo a crear:** `app/actions/v3/documents.ts`

```typescript
// Adaptacion de app/actions/documents.ts para workspace_id en lugar de user_id

export async function createWorkspaceDocument(data: {
  workspaceId: string
  title: string
  type: 'pdf' | 'pptx' | 'docx' | 'url'
  storagePath?: string
  sourceUrl?: string
  fileSize?: number
}): Promise<{data?: WorkspaceDocument, error?: string}>

export async function getWorkspaceDocuments(workspaceId: string): Promise<WorkspaceDocument[]>

export async function processWorkspaceDocument(documentId: string): Promise<void>
// - Extrae texto (reutiliza lib/documents/extract-text.ts)
// - Analiza con Gemini (reutiliza lib/documents/analyze-document.ts)
// - Guarda tags en v3.workspace_document_tags
// - Regenera v3.workspace_value_profiles
```

**Storage path en v3:** `workspaces/{workspace_id}/{document_id}/{filename}`

#### 2.2 Pagina de docs para v3

**Archivo a crear:** `app/v3/docs/page.tsx`

Componentes a crear:
- `app/v3/docs/_components/upload-dialog.tsx` (adaptar de v2)
- `app/v3/docs/_components/document-card.tsx` (adaptar de v2)
- `app/v3/docs/_components/value-profile-card.tsx` (adaptar de v2)

---

### FASE 3: Campanas y Cuentas
**Duracion estimada:** 5-6 dias
**Dependencia:** Fase 2 completa

#### 3.1 CRUD de campanas

**Archivo a crear:** `app/actions/v3/campaigns.ts`

```typescript
export async function createCampaign(data: {
  workspaceId: string
  name: string
  type: 'monitorear' // Solo este tipo en MVP
}): Promise<{data?: Campaign, error?: string}>

export async function getCampaigns(workspaceId: string): Promise<Campaign[]>

export async function getCampaignWithAccounts(campaignId: string): Promise<CampaignWithAccounts>

export async function deleteCampaign(campaignId: string): Promise<void>
```

#### 3.2 Busqueda manual de cuentas

**Archivo a crear:** `app/actions/v3/accounts.ts`

```typescript
export async function searchCompanies(query: string): Promise<Company[]>
// - Busca en public.companies por nombre o dominio
// - Usa normalizacion (reutiliza logica de v2)
// - Retorna top 20 resultados

export async function addAccountToCampaign(data: {
  campaignId: string
  companyId: string
  source: 'manual' | 'csv_import'
}): Promise<{data?: CampaignAccount, error?: string}>
// - Verifica limite de 100 cuentas por workspace
// - Crea registro en v3.campaign_accounts

export async function removeAccountFromCampaign(accountId: string): Promise<void>
```

#### 3.3 CSV Import con Matching

**Archivo a crear:** `lib/v3/csv-matcher.ts`

```typescript
// Algoritmo de matching documentado en BOT-BIGUA-LAT-ARCHITECTURE.md seccion 8

export function normalizeCompanyName(name: string): string
// - Lowercase
// - Remueve sufijos (Inc, LLC, SA, SRL, Corp, etc.)
// - Remueve puntuacion y caracteres especiales
// - Colapsa espacios multiples

export function normalizeDomain(domain: string): string
// - Lowercase
// - Remueve www., http://, https://
// - Extrae solo el dominio base

export function calculateFuzzyScore(str1: string, str2: string): number
// - Usa algoritmo de Levenshtein o similar
// - Retorna score 0.0 a 1.0

export async function matchCsvRow(row: CsvRow): Promise<MatchResult>
// - Aplica matriz de decision de seccion 8.2 del doc de arquitectura
// - Retorna: { status, matchedCompanyId, candidates, method }
```

**Archivo a crear:** `app/actions/v3/csv-import.ts`

```typescript
export async function createCsvImport(data: {
  campaignId: string
  filename: string
  rows: Array<{companyName: string, domain?: string}>
}): Promise<{importId: string}>

export async function processCsvImport(importId: string): Promise<void>
// - Itera filas
// - Aplica matchCsvRow a cada una
// - Guarda resultados en v3.csv_import_rows

export async function getCsvImportWithRows(importId: string): Promise<CsvImportWithRows>

export async function confirmCsvMatch(rowId: string, companyId: string): Promise<void>
// - Actualiza status a 'confirmed'
// - Crea campaign_account

export async function ignoreCsvRow(rowId: string): Promise<void>
// - Actualiza status a 'ignored'
```

#### 3.4 UI de Campanas

**Archivos a crear:**

```
app/v3/campaigns/
  page.tsx                              # Lista de campanas
  new/page.tsx                          # Crear campana
  [id]/page.tsx                         # Detalle de campana (lista de cuentas)
  [id]/_components/
    campaign-header.tsx                 # Nombre, tipo, stats
    accounts-list.tsx                   # Lista de cuentas con estado
    add-account-dialog.tsx              # Modal busqueda manual
    csv-import-dialog.tsx               # Modal upload CSV
    csv-review-dialog.tsx               # Modal revision de matches
```

---

### FASE 4: Digest y Senales
**Duracion estimada:** 4-5 dias
**Dependencia:** Fase 3 completa

#### 4.1 Lector de cache con service_role

**Archivo a crear:** `lib/v3/cache-reader.ts`

```typescript
// Usa SUPABASE_SERVICE_ROLE_KEY para bypasear RLS de v2

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function getCompanyNews(companyId: string): Promise<CompanyNews[]>
// - Lee de public.company_news

export async function getCompanyImplementations(companyId: string): Promise<CompanyImplementation[]>
// - Lee de public.company_implementations

export async function getCompanySignals(companyId: string): Promise<Signal[]>
// - Lee de public.signals

export async function getCompanyCachedContacts(companyId: string): Promise<ApolloContact[]>
// - Lee de public.apollo_contacts_cache
```

**Referencia:** Ver seccion 15.2 de `docs/BOT-BIGUA-LAT-ARCHITECTURE.md`

#### 4.2 Generador de digest

**Archivo a crear:** `lib/v3/digest.ts`

```typescript
export async function generateAccountDigest(
  campaignAccountId: string
): Promise<CampaignAccountDigest>
// - Obtiene company_id del campaign_account
// - Llama a cache-reader para obtener news, implementations, signals
// - Filtra por buyer_persona si existe
// - Obtiene contactos del cache de Apollo
// - Guarda/actualiza en v3.campaign_account_digest
// - Retorna digest completo

export async function markDigestAsSeen(campaignAccountId: string): Promise<void>
// - Actualiza last_user_seen_at
// - Resetea new_items_count a 0
```

#### 4.3 UI del Dashboard Principal

**Archivos a crear:**

```
app/v3/
  layout.tsx                            # Layout con sidebar de campanas
  page.tsx                              # Redirige a primera campana o /campaigns/new
  
app/v3/_components/
  sidebar.tsx                           # Menu izquierdo con campanas
  campaign-selector.tsx                 # Dropdown de campanas en header
  account-list-sidebar.tsx              # Lista de cuentas de la campana seleccionada
  digest-panel.tsx                      # Panel central con digest de la cuenta seleccionada
  copilot-panel.tsx                     # Panel derecho - placeholder "Coming Soon"
```

**Layout de 3 columnas:**
```
┌──────────────┬─────────────────────────────┬──────────────────┐
│              │                             │                  │
│   CUENTAS    │      DIGEST PRINCIPAL       │    COPILOT       │
│   (sidebar)  │                             │    (placeholder) │
│              │   - Noticias                │                  │
│   Lista de   │   - Tech Radar              │   "Coming Soon"  │
│   cuentas    │   - Senales                 │                  │
│   de la      │   - DMs disponibles         │                  │
│   campana    │                             │                  │
│              │                             │                  │
└──────────────┴─────────────────────────────┴──────────────────┘
```

---

### FASE 5: Tech Radar y Apollo
**Duracion estimada:** 4-5 dias
**Dependencia:** Fase 4 completa

#### 5.1 Wrapper de Tech Radar para v3

**Archivo a crear:** `lib/v3/tech-radar.ts`

```typescript
import { runTechRadar } from '@/lib/tech-radar'

export async function runTechRadarForAccount(
  campaignAccountId: string
): Promise<TechRadarResult>
// - Obtiene company_id y company_name del campaign_account
// - Crea un bookmark temporal si es necesario (para compatibilidad con runTechRadar)
// - Llama a runTechRadar existente de v2
// - Actualiza campaign_account con tech_radar_run_at
// - Actualiza digest con nuevas implementaciones
```

**Referencia:** `lib/tech-radar.ts` - funcion `runTechRadar()`

#### 5.2 Wrapper de Apollo para v3

**Archivo a crear:** `lib/v3/apollo.ts`

```typescript
import { searchPeople } from '@/lib/apollo/search'
import { enrichMany } from '@/lib/apollo/enrich'

export async function searchDecisionMakers(params: {
  campaignAccountId: string
  jobTitles: string[]          // Buyer persona como texto libre
  maxResults?: number
}): Promise<ApolloSearchResult>
// - Obtiene company del campaign_account
// - Llama a searchPeople existente de v2
// - Guarda resultados en apollo_contacts_cache (via funcion existente)
// - Actualiza digest con nuevos contactos
// - Retorna resultados

export async function getRecommendedJobTitles(
  workspaceId: string
): Promise<string[]>
// - Lee v3.workspace_value_profiles
// - Cruza con v3.dictionary_job_titles
// - Retorna lista de job titles recomendados
```

**Referencia:** 
- `lib/apollo/search.ts` - funcion `searchPeople()`
- `lib/apollo/enrich.ts` - funcion `enrichMany()`

#### 5.3 UI de Tech Radar y Apollo

**Archivos a modificar/crear:**

En `app/v3/_components/digest-panel.tsx`:
- Boton "Ejecutar Tech Radar" por cuenta
- Seccion de "Decision Makers" con:
  - Lista de contactos del cache
  - Input de texto para job titles (buyer persona simple)
  - Boton "Buscar en Apollo"
  - Resultados de busqueda

---

### FASE 6: MCP Server
**Duracion estimada:** 5-6 dias
**Dependencia:** Fase 5 completa

#### 6.1 Generacion de API Keys

**Archivo a crear:** `app/actions/v3/api-keys.ts`

```typescript
import crypto from 'crypto'

export async function generateApiKey(workspaceId: string): Promise<{
  key: string        // Solo se muestra una vez
  keyPrefix: string  // Primeros 8 chars para identificar
}>
// - Genera key aleatoria de 32 bytes
// - Hashea con SHA256 antes de guardar
// - Guarda en v3.mcp_api_keys
// - Retorna key en plain text (unica vez)

export async function revokeApiKey(keyId: string): Promise<void>
// - Actualiza revoked_at
// - Agrega revocation_reason

export async function validateApiKey(key: string): Promise<{
  valid: boolean
  workspaceId?: string
  userId?: string
}>
// - Hashea key recibida
// - Busca en v3.mcp_api_keys
// - Verifica que no este revocada
// - Verifica rate limits
```

**Referencia:** Ver seccion 9 de `docs/BOT-BIGUA-LAT-ARCHITECTURE.md`

#### 6.2 Middleware de MCP

**Archivo a crear:** `lib/v3/mcp-middleware.ts`

```typescript
export async function validateMcpRequest(req: Request): Promise<{
  valid: boolean
  workspace?: Workspace
  error?: string
}>
// - Extrae Bearer token del header Authorization
// - Valida con validateApiKey
// - Verifica rate limits
// - Loggea en v3.mcp_request_logs

export async function checkRateLimit(workspaceId: string): Promise<boolean>
// - Cuenta requests en ultimo minuto
// - Compara con limite (60/min default)
// - Retorna true si permitido
```

#### 6.3 Endpoints MCP

**Archivos a crear:**

```
app/api/v3/mcp/
  route.ts                              # GET - Manifest del MCP server
  tools/
    list-campaigns/route.ts             # GET - Lista campanas del workspace
    list-accounts/route.ts              # GET - Lista cuentas de una campana
    get-account-digest/route.ts         # GET - Digest de una cuenta
    get-signals/route.ts                # GET - Senales de una cuenta
    get-contacts/route.ts               # GET - Contactos de una cuenta
    search-companies/route.ts           # POST - Buscar empresas
    run-tech-radar/route.ts             # POST - Ejecutar tech radar
    search-decision-makers/route.ts     # POST - Buscar en Apollo
```

**Formato de respuesta MCP:**
```typescript
interface McpResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
  meta?: {
    requestId: string
    timestamp: string
  }
}
```

#### 6.4 UI de API Keys

**Archivo a crear:** `app/v3/settings/api-keys/page.tsx`

Componentes:
- Lista de API keys (mostrando solo prefix)
- Boton "Generar nueva key"
- Modal que muestra la key completa (una sola vez)
- Boton de revocar por key

---

### FASE 7: UI/UX Completo
**Duracion estimada:** 5-7 dias
**Dependencia:** Fases 1-6 completas (puede hacerse en paralelo parcialmente)

**Referencia obligatoria:** `docs/DESIGN-SYSTEM.md`

#### 7.1 Setup del Design System

**Archivo a modificar:** `app/globals.css`

Agregar los tokens CSS del Design System (seccion 2.1):
- Colores semanticos: `--background`, `--foreground`, `--card`, `--primary`, etc.
- Colores de senales: `--signal-technology`, `--signal-hiring`, `--signal-news`, `--signal-funding`
- Espaciado y radios

**Archivo a modificar:** `app/layout.tsx`

Configurar tipografia (seccion 2.2):
- Font principal: Inter (sans)
- Font mono: JetBrains Mono

**Archivo a modificar:** `tailwind.config.ts` (si existe) o `app/globals.css` (@theme inline para v4)

Extender tema con colores de senales.

#### 7.2 Layout Principal de 3 Columnas

**Referencia:** Design System seccion 3.1

**Archivo a crear:** `app/v3/layout.tsx`

```typescript
// Layout de 3 columnas:
// - Sidebar izquierdo (280px fixed) - Lista de cuentas
// - Main central (flex-1) - Digest
// - Panel derecho (380px collapsible) - Copilot placeholder

// Mobile: bottom sheet para sidebar, panel derecho oculto
// Tablet: 2 columnas, copilot en drawer
```

**Archivos a crear:**

```
app/v3/_components/
  layout/
    sidebar.tsx                         # Ref: Design System 4.1
    main-content.tsx                    # Contenedor central
    copilot-panel.tsx                   # Ref: Design System 4.4 (placeholder)
    mobile-bottom-sheet.tsx             # Para responsive
```

#### 7.3 Componentes de Cuenta y Senales

**Referencia:** Design System seccion 4

**Archivos a crear:**

```
components/v3/
  account-list-item.tsx                 # Ref: Design System 4.1
                                        # - Avatar con iniciales
                                        # - Nombre + industria
                                        # - Badge de senales nuevas
                                        # - Indicador de ultima actividad
  
  signal-card.tsx                       # Ref: Design System 4.2
                                        # - Icono por tipo (technology/hiring/news/funding)
                                        # - Color semantico segun tipo
                                        # - Titulo + descripcion
                                        # - Timestamp relativo
                                        # - Acciones: ver mas, guardar
  
  contact-card.tsx                      # Ref: Design System 4.3
                                        # - Avatar (imagen o iniciales)
                                        # - Nombre + cargo
                                        # - Empresa
                                        # - Email/LinkedIn (si disponible)
                                        # - Boton de accion
  
  news-card.tsx                         # Variante de signal-card para noticias
  implementation-card.tsx               # Variante para tech radar results
  signal-badge.tsx                      # Badge pequeno con color por tipo
```

#### 7.4 Panel de Digest

**Referencia:** Design System seccion 3.1 (area central)

**Archivos a crear:**

```
app/v3/_components/
  digest/
    digest-panel.tsx                    # Panel completo
    digest-header.tsx                   # Nombre empresa + stats
    digest-section.tsx                  # Seccion colapsable (News, Tech, DMs)
    digest-timeline.tsx                 # Timeline de eventos
    digest-empty.tsx                    # Estado vacio
```

#### 7.5 Componentes de Formulario

**Referencia:** Design System seccion 5

Usar shadcn/ui con los patrones del skill:
- `FieldGroup` + `Field` para formularios
- `InputGroup` para inputs con botones
- Validacion con `data-invalid` + `aria-invalid`

**Archivos a crear:**

```
components/v3/
  forms/
    campaign-form.tsx                   # Crear/editar campana
    csv-upload-form.tsx                 # Upload de CSV
    search-companies-input.tsx          # Busqueda con autocomplete
    job-titles-input.tsx                # Input de buyer persona
```

#### 7.6 Command Palette

**Referencia:** Design System seccion 6.1

**Archivo a crear:** `components/v3/command-palette.tsx`

Usar `Command` de shadcn dentro de `Dialog`:
- Cmd+K para abrir
- Buscar cuentas, campanas, acciones
- Navegacion rapida

#### 7.7 Rutas completas de v3

```
app/v3/
  layout.tsx                            # Layout 3 columnas (Design System 3.1)
  page.tsx                              # Redirige a primera campana
  
  onboarding/
    page.tsx                            # Wizard de onboarding
    
  docs/
    page.tsx                            # Gestion de documentos (blocker)
    
  campaigns/
    page.tsx                            # Lista de campanas
    new/page.tsx                        # Crear campana
    [id]/
      page.tsx                          # Dashboard de campana
      layout.tsx                        # Layout con lista de cuentas en sidebar
      accounts/
        [accountId]/page.tsx            # Digest de cuenta especifica
      import/page.tsx                   # Import CSV + review
      
  settings/
    page.tsx                            # Settings generales
    api-keys/page.tsx                   # Gestion de API keys
    workspace/page.tsx                  # Settings del workspace
```

#### 7.8 Estados de Carga y Vacios

**Referencia:** Design System seccion 6.2

**Archivos a crear:**

```
components/v3/
  states/
    loading-skeleton.tsx                # Skeleton animado
    empty-state.tsx                     # Estado vacio con CTA
    error-state.tsx                     # Estado de error
```

Usar `Skeleton` de shadcn, seguir patrones del skill.

---

## Dependencias entre Fases

```
Fase 0: Schema
    │
    ▼
Fase 1: Auth/Workspace ──────────────┐
    │                                │
    ▼                                │
Fase 2: Documentos                   │
    │                                │
    ▼                                │
Fase 3: Campanas/Cuentas             │
    │                                │
    ▼                                │
Fase 4: Digest/Senales               │
    │                                │
    ▼                                │
Fase 5: Tech Radar/Apollo            │
    │                                │
    ▼                                │
Fase 6: MCP Server ◄─────────────────┘
    │
    ▼
Fase 7: UI/UX (puede empezar parcialmente desde Fase 1)
```

---

## Reutilizacion de v2

### Codigo que se reutiliza SIN modificar

| Archivo v2 | Uso en v3 |
|------------|-----------|
| `lib/tech-radar.ts` | runTechRadar() |
| `lib/parallel.ts` | Cliente de Parallel |
| `lib/apollo/search.ts` | searchPeople() |
| `lib/apollo/enrich.ts` | enrichPerson(), enrichMany() |
| `lib/apollo/client.ts` | apolloRequest() |
| `lib/apollo/domain.ts` | normalizeDomain() |
| `lib/documents/extract-text.ts` | Extraccion de texto |
| `lib/documents/analyze-document.ts` | Analisis con Gemini |
| `lib/supabase/server.ts` | Cliente de Supabase |
| `lib/supabase/client.ts` | Cliente de Supabase (browser) |

### Codigo que se adapta (fork con modificaciones)

| Archivo v2 | Archivo v3 | Cambios |
|------------|------------|---------|
| `app/actions/documents.ts` | `app/actions/v3/documents.ts` | user_id → workspace_id |
| `app/docs/_components/*` | `app/v3/docs/_components/*` | Adaptar a workspace |
| `lib/documents/generate-value-profile.ts` | `lib/v3/value-profile.ts` | user_id → workspace_id |

### Tablas de v2 que se leen (nunca escriben directo)

- `public.companies`
- `public.company_news`
- `public.company_implementations`
- `public.signals`
- `public.apollo_contacts_cache`
- `public.dictionary_*`

---

## Estimacion Total

| Fase | Duracion | Acumulado |
|------|----------|-----------|
| Fase 0: Schema | 3-4 dias | 3-4 dias |
| Fase 1: Auth/Workspace | 4-5 dias | 7-9 dias |
| Fase 2: Documentos | 3-4 dias | 10-13 dias |
| Fase 3: Campanas/Cuentas | 5-6 dias | 15-19 dias |
| Fase 4: Digest/Senales | 4-5 dias | 19-24 dias |
| Fase 5: Tech Radar/Apollo | 4-5 dias | 23-29 dias |
| Fase 6: MCP Server | 5-6 dias | 28-35 dias |
| Fase 7: UI/UX | 5-7 dias | 33-42 dias |

**Total estimado MVP:** 6-8 semanas

---

## Checklist de Arranque

Antes de empezar Fase 0:

- [ ] Confirmar acceso a Supabase del proyecto
- [ ] Confirmar que las env vars estan configuradas:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `PARALLEL_API_KEY` (para Tech Radar)
  - `APOLLO_API_KEY` (para Apollo)
  - `GOOGLE_GENERATIVE_AI_API_KEY` (para Gemini)
- [x] Design System definido - ver `docs/DESIGN-SYSTEM.md`
- [ ] Revisar que no hay conflictos con rutas existentes de v2

---

## Documentos de Referencia

| Documento | Contenido |
|-----------|-----------|
| `docs/BOT-BIGUA-LAT-ARCHITECTURE.md` | Arquitectura completa, schema SQL, flujos |
| `docs/DESIGN-SYSTEM.md` | Colores, tipografia, componentes, layouts |
| `docs/MVP-IMPLEMENTATION-PLAN.md` | Este documento - plan de implementacion |

---

*Documento creado: 2025-05-15*
*Version: 1.1 - Agregadas referencias a Design System*
