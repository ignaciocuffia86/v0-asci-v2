# Feature: MCP Server (Integración con agentes IA vía Model Context Protocol)

> **Estado**: Diseño. No implementado.
> **Fase 1 (MVP)**: PAT (Personal Access Tokens) como método de auth, transporte Streamable HTTP, scope read + acciones seguras + Apollo, targets Claude Desktop / Claude Code / agentes custom (LangChain, AI SDK, Mastra, n8n).
> **Fuera de alcance Fase 1**: OAuth 2.1 + Dynamic Client Registration, Claude.ai web, ChatGPT Custom Connectors, envío de correos, push de notificaciones server→client, tools de mutación de docs.
> **Fase 2 (cuando aplique)**: Authorization Server OAuth 2.1 sobre el mismo MCP server para soportar Claude.ai web / ChatGPT.

---

## 0. Glosario rápido

- **MCP**: Model Context Protocol. Estándar abierto (Anthropic, 2024) para que agentes IA descubran y usen herramientas, recursos y prompts de un servidor remoto.
- **MCP Server**: en este caso, lo que vamos a construir dentro de la plataforma Bigua/ASCI.
- **MCP Client**: la app del usuario (Claude Desktop, Cursor, n8n, agente custom). No lo construimos nosotros.
- **Tool**: una función ejecutable que el agente puede invocar (ej. `bookmarks.list`, `apollo.search_people`).
- **Resource**: un dato leíble identificado por URI (ej. `bigua://bookmarks/123`). Útil para que el agente cite/lea contenido sin ejecutar lógica.
- **Prompt**: plantilla parametrizable que el cliente puede insertar en su contexto (ej. "investigá este bookmark").
- **PAT**: Personal Access Token. String opaco emitido por la plataforma, copiado por el usuario en su cliente MCP, enviado en `Authorization: Bearer ...`.
- **Streamable HTTP**: el transporte HTTP moderno definido por la spec MCP 2025-03-26+, que reemplazó al SSE legacy. Una sola URL, request/response normal + opcional streaming server-sent events sobre la misma conexión.

---

## 1. Decisiones arquitectónicas (recap)

| Decisión | Elección | Motivo |
|---|---|---|
| Método de autenticación Fase 1 | **PAT (Bearer token estático con TTL configurable)** | Cubre el 100% de targets elegidos. Cero infra OAuth. Patrón estándar (GitHub, Linear, Notion). |
| Transporte | **Streamable HTTP (`/mcp` único endpoint)** | Spec actual MCP. Compatible con Claude Desktop, Claude Code, n8n, AI SDK, LangChain MCP adapters. |
| Hosting del MCP server | **Mismo monorepo Next.js 16, ruta dedicada `/mcp`** | Reusa Supabase, env vars, deploys, observabilidad. |
| SDK servidor | **`@modelcontextprotocol/sdk` (oficial TypeScript)** | Mantenido por Anthropic, soporta Streamable HTTP nativo, JSON-RPC 2.0 framing automático. |
| Scope MVP | **Read + acciones seguras + Apollo + agregar contactos** | Cubre el journey completo del usuario. Excluye envío de correos y mutaciones destructivas. |
| Quotas | **Cuotas duras por token + cuotas separadas para Apollo y LLM (icebreakers)** | Protege costos externos. Visibilidad granular MCP vs UI. |
| Fase 2 (futuro) | **OAuth 2.1 + DCR opcional, conviviendo con PAT** | Para sumar Claude.ai web / ChatGPT cuando exista demanda. |
| Subdominio | **`mcp.bigua.lat`** (CNAME al mismo deploy de Vercel) | URL limpia para que el usuario pegue en su cliente. Permite reglas de firewall/rate-limit separadas. |

---

## 2. Arquitectura de infraestructura

```
┌──────────────────────────────────────────────────────────────────────┐
│                       CLIENTES MCP (no los construimos)              │
│                                                                      │
│  Claude Desktop   Claude Code   n8n / Mastra   LangChain / AI SDK    │
│       │                │              │                 │            │
│       └────────────────┴──────────────┴─────────────────┘            │
│                              │                                       │
│              Streamable HTTP (JSON-RPC 2.0 sobre HTTPS)              │
│              Header: Authorization: Bearer asci_pat_live_...         │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      VERCEL (Next.js 16, mismo deploy)               │
│                                                                      │
│   ┌────────────────────────────────────────────────────────────┐     │
│   │  Route Handler: app/mcp/route.ts                           │     │
│   │  ─ POST  /mcp  → JSON-RPC requests (initialize, tools/*)   │     │
│   │  ─ GET   /mcp  → SSE stream opcional para notifications    │     │
│   │  ─ DELETE /mcp → cierra sesión                             │     │
│   └─────────────────────────┬──────────────────────────────────┘     │
│                             │                                        │
│                             ▼                                        │
│   ┌────────────────────────────────────────────────────────────┐     │
│   │  lib/mcp/  (módulo nuevo)                                  │     │
│   │   ├── server.ts         (instancia McpServer + registro)   │     │
│   │   ├── auth.ts           (resolveBearerToken → Principal)   │     │
│   │   ├── principal.ts      (interface AuthenticatedPrincipal) │     │
│   │   ├── scopes.ts         (catálogo + validación)            │     │
│   │   ├── quota.ts          (chequeo y contabilidad por token) │     │
│   │   ├── audit.ts          (escritura a mcp_audit_log)        │     │
│   │   └── tools/                                               │     │
│   │        ├── bookmarks.ts    (list, get, create)             │     │
│   │        ├── docs.ts         (list, get)                     │     │
│   │        ├── signals.ts      (list, get)                     │     │
│   │        ├── news.ts         (list, get)                     │     │
│   │        ├── filters.ts      (list, apply)                   │     │
│   │        ├── apollo.ts       (search_people, get_person)     │     │
│   │        ├── contacts.ts     (list, add_to_bookmark)         │     │
│   │        └── icebreakers.ts  (list, generate)                │     │
│   └────────────────────────────────────────────────────────────┘     │
│                             │                                        │
│                             ▼                                        │
│   Reusa: lib/supabase/*, app/actions/* (extracción a servicios       │
│   compartibles entre Server Actions y MCP tools)                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          SUPABASE (Postgres)                         │
│                                                                      │
│   Tablas existentes (sin cambios estructurales)                      │
│   ─ user_bookmarks, bookmark_articles, user_signal_subscriptions,    │
│     user_company_contacts, user_icebreakers, ...                     │
│                                                                      │
│   Tablas nuevas                                                      │
│   ─ mcp_tokens          (PAT por usuario)                            │
│   ─ mcp_token_scopes    (relación token → scope)                     │
│   ─ mcp_audit_log       (1 fila por tool call)                       │
│   ─ mcp_quota_counters  (rolling counters por token + categoría)     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Modelo conceptual: ¿qué expone el MCP?

El protocolo MCP tiene tres primitivas. Mapeo lo que tenemos hoy en ASCI a cada una:

### 3.1 Tools (acciones invocables)

| Tool | Scope requerido | Tipo | Descripción |
|---|---|---|---|
| `bookmarks.list` | `bookmarks:read` | read | Lista los bookmarks del usuario, con paginación y filtros (carpeta, status, fecha). |
| `bookmarks.get` | `bookmarks:read` | read | Devuelve un bookmark con contadores de articles, contactos, icebreakers, señales. |
| `bookmarks.create` | `bookmarks:write` | write seguro | Crea un bookmark nuevo a partir de `company_id` o búsqueda por nombre. |
| `docs.list` | `docs:read` | read | Lista los seller documents y strategy documents asociados. |
| `docs.get` | `docs:read` | read | Devuelve el contenido completo de un doc específico (markdown). |
| `signals.list` | `signals:read` | read | Lista las señales suscritas + matches recientes (filtrable por bookmark/empresa). |
| `signals.get` | `signals:read` | read | Detalle de una señal disparada (empresa, evidencia, fecha, fuente). |
| `news.list` | `news:read` | read | Lista noticias recientes asociadas a empresas que el usuario sigue. |
| `news.get` | `news:read` | read | Devuelve una noticia individual con texto completo, summary y empresas vinculadas. |
| `filters.list` | `filters:read` | read | Lista filtros guardados del usuario. |
| `filters.apply` | `filters:read` | read | Aplica un filtro guardado y devuelve los resultados (empresas matcheadas). |
| `apollo.search_people` | `apollo:search` | costly | Busca tomadores de decisión en Apollo dado un dominio + filtros (titles, seniority, departments). **Consume créditos Apollo.** |
| `apollo.get_person` | `apollo:search` | costly | Enriquece un person_id de Apollo. Consume créditos. |
| `contacts.list` | `contacts:read` | read | Lista contactos de un bookmark con sus emails y status. |
| `contacts.add_to_bookmark` | `contacts:write` | write seguro | Persiste un person de Apollo (search result) como contacto del bookmark. |
| `icebreakers.list` | `icebreakers:read` | read | Lista icebreakers ya generados para un bookmark/contacto. |
| `icebreakers.generate` | `icebreakers:write` | costly | Genera un icebreaker nuevo usando el strategy doc + datos del contacto. **Consume tokens LLM.** |

> **No expuesto en Fase 1**: cualquier cosa relacionada con `email_sends`, `gmail`, eliminar bookmarks/docs, modificar filtros/señales suscritas, gestionar usuarios, gestionar tokens MCP (meta-administración).

### 3.2 Resources (datos leíbles por URI)

Útil para que el agente pueda "leer" un bookmark sin necesariamente ejecutar un tool. Los clientes MCP los citan como contexto.

| URI pattern | Devuelve |
|---|---|
| `bigua://bookmarks/{id}` | Markdown con resumen del bookmark + métricas. |
| `bigua://docs/{id}` | Markdown completo del doc. |
| `bigua://signals/{id}` | Markdown con señal + evidencia. |
| `bigua://news/{id}` | Markdown con la noticia. |
| `bigua://contacts/{id}` | vCard-like + LinkedIn URL. |

> Implementación: el handler de resources usa los mismos servicios que los tools `*.get`. La diferencia es semántica para el cliente — un resource es "léeme y citáme", un tool es "ejecutá algo".

### 3.3 Prompts (plantillas parametrizables)

Pre-armadas para que el cliente las exponga al usuario como "templates".

| Prompt | Argumentos | Qué hace |
|---|---|---|
| `research_bookmark` | `bookmark_id` | Pre-llena el contexto con el bookmark, sus señales, sus noticias, sus docs, y pide al LLM hacer un research profundo. |
| `find_decision_makers` | `bookmark_id`, `seniority?`, `departments?` | Llama `apollo.search_people` con parámetros del bookmark y devuelve resultados. |
| `draft_outbound_email` | `contact_id`, `tone?` | Genera icebreaker + sugerencia de subject + cuerpo, listo para enviar (no lo manda). |

> Los prompts son opcionales en MCP pero mejoran muchísimo la UX en Claude Desktop, donde aparecen como slash-commands.

---

## 4. Catálogo de scopes

Diseñado en formato `recurso:operación` (estilo GitHub / Google APIs). El usuario al generar un PAT marca checkboxes con scopes. El token solo puede invocar tools cuyo `requiredScope` esté incluido.

| Scope | Cubre |
|---|---|
| `bookmarks:read` | listar y leer bookmarks |
| `bookmarks:write` | crear bookmarks |
| `docs:read` | listar y leer docs |
| `signals:read` | listar y leer señales |
| `news:read` | listar y leer noticias |
| `filters:read` | listar y aplicar filtros |
| `contacts:read` | listar contactos |
| `contacts:write` | agregar contactos a bookmarks |
| `apollo:search` | buscar/enriquecer personas en Apollo (consume créditos) |
| `icebreakers:read` | listar icebreakers generados |
| `icebreakers:write` | generar icebreakers nuevos (consume tokens LLM) |

**Scope macro opcional para UX**: `read:all` (incluye todos los `:read`), `write:safe` (incluye `bookmarks:write` + `contacts:write` + `icebreakers:write`), `costly` (incluye `apollo:search` + `icebreakers:write`).

**Scope explícitamente NO emitible en Fase 1**: `email:send`, `bookmarks:delete`, `*:admin`, `tokens:manage`.

---

## 5. Modelo de datos (tablas nuevas)

### 5.1 `mcp_tokens`

Una fila por token generado. El plaintext del token nunca se guarda, solo su hash.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK auth.users | |
| `name` | text | nombre dado por el usuario ("Mi Claude Desktop"). |
| `prefix` | text | primeros 12 chars visibles del token, para identificarlo en UI sin exponerlo (`asci_pat_live_a1b2`). |
| `token_hash` | text | bcrypt o argon2id del token completo. **No se puede revertir.** |
| `last_4` | text | últimos 4 chars para mostrar en UI (`...3f9c`). |
| `status` | enum | `active` \| `revoked` \| `expired` |
| `expires_at` | timestamptz | nullable. Default: `now() + 90 days`. Configurable al crear. |
| `last_used_at` | timestamptz | actualizado en cada llamada autenticada (con throttle 1/min). |
| `last_used_ip` | inet | IP del último uso. Útil para detectar tokens filtrados. |
| `last_used_user_agent` | text | UA del cliente MCP. |
| `revoked_at` | timestamptz | |
| `revoked_reason` | text | nullable. `user_revoked` \| `expired` \| `security_incident` \| `quota_exhausted_persistent`. |
| `created_at`, `updated_at` | timestamptz | |

**Índices**: `(user_id, status)`, `(token_hash)` único, `(prefix)` para lookup rápido.

**RLS**: el usuario solo ve sus propios tokens; el MCP server lee con `service_role` (no RLS).

### 5.2 `mcp_token_scopes`

| Columna | Tipo |
|---|---|
| `token_id` | uuid FK mcp_tokens |
| `scope` | text |
| `created_at` | timestamptz |

PK compuesta `(token_id, scope)`. Tabla deliberadamente plana — la lista de scopes válidos se valida en código contra el catálogo de la sección 4.

### 5.3 `mcp_audit_log`

1 fila por tool call (incluso fallidos por auth/quota).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `token_id` | uuid FK | nullable si la llamada fue rechazada por token inválido. |
| `user_id` | uuid FK | nullable idem. |
| `auth_method` | enum | `pat` (futuro: `oauth`). |
| `tool_name` | text | ej. `apollo.search_people`. |
| `arguments_hash` | text | hash sha256 de los args (no guardamos PII de los argumentos). |
| `arguments_summary` | jsonb | versión sanitizada de args para debugging (sin emails completos, sin nombres si configurable). |
| `result_status` | enum | `ok` \| `error_auth` \| `error_quota` \| `error_validation` \| `error_internal` \| `error_upstream`. |
| `error_code` | text | nullable. |
| `latency_ms` | int | |
| `cost_units` | jsonb | `{ apollo_credits?: 1, llm_input_tokens?: 800, llm_output_tokens?: 200 }`. |
| `client_ip` | inet | |
| `client_user_agent` | text | |
| `mcp_session_id` | text | session id de Streamable HTTP, para correlacionar requests. |
| `occurred_at` | timestamptz | |

**Índices**: `(user_id, occurred_at desc)`, `(token_id, occurred_at desc)`, `(tool_name, occurred_at desc)`.

**Retention**: 90 días en hot storage. Después se mueve a tabla `mcp_audit_log_archive` o se exporta a Blob como NDJSON comprimido (decisión por costo).

### 5.4 `mcp_quota_counters`

Counters atómicos por token + categoría + ventana.

| Columna | Tipo |
|---|---|
| `token_id` | uuid FK |
| `category` | enum: `total_calls` \| `apollo_search` \| `icebreakers_generate` |
| `window` | enum: `daily` \| `monthly` |
| `period_start` | timestamptz (truncado al día/mes) |
| `count` | int |
| `last_increment_at` | timestamptz |

PK compuesta `(token_id, category, window, period_start)`.

**Por qué tabla y no Redis/Upstash**: el volumen MCP en MVP no justifica una dependencia más. `INSERT ... ON CONFLICT ... DO UPDATE SET count = count + 1` con un advisory lock es suficiente hasta varios miles de calls/min. Si Fase 2 escala, se migra a Upstash con la misma interface.

---

## 6. Flujos detallados

### 6.1 Generación de un PAT

**UI**: nueva sección `/profile/integrations/mcp`.

```
┌──────────────────────────────────────────────────────────────────┐
│ Integraciones MCP                                                │
│                                                                  │
│ [+ Generar nuevo token]                                          │
│                                                                  │
│ Tus tokens activos:                                              │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ Mi Claude Desktop                                            │ │
│ │ asci_pat_live_a1b2...3f9c · creado 2026-04-20                │ │
│ │ Scopes: read:all, contacts:write, apollo:search              │ │
│ │ Último uso: hace 3h desde 200.55.x.x (Claude/0.7.2)          │ │
│ │ Expira: 2026-07-19  ·  Uso hoy: 47/1000 calls                │ │
│ │                            [Ver actividad] [Revocar]         │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**Flow técnico**:
1. Click "Generar nuevo token" → modal con nombre, scopes (checkboxes agrupados), TTL (30/60/90 días/sin expiración), cuotas custom (opcional, si no usa defaults).
2. Click "Crear" → server action genera 32 bytes random → token plaintext = `asci_pat_live_<base62(bytes)>` (~43 chars). Hash con argon2id.
3. Inserta `mcp_tokens` + `mcp_token_scopes` en transacción.
4. Devuelve **una sola vez** el plaintext con UI tipo "Copiá esto ahora, no lo vas a poder ver de nuevo". Botón "Copiar". Snippet listo para pegar:
   ```json
   {
     "mcpServers": {
       "asci": {
         "url": "https://mcp.bigua.lat/mcp",
         "headers": { "Authorization": "Bearer asci_pat_live_..." }
       }
     }
   }
   ```
5. Cierra el modal → la UI ya solo muestra `prefix...last_4`.

**Decisiones de seguridad clave**:
- **Argon2id** preferido sobre bcrypt (más resistente a GPU). 64MB, 3 iterations, paralelismo 4.
- **Scopes** se eligen por checkbox. Default propuesto al usuario: `read:all` (todos los `:read`).
- **TTL default 90 días** con renovación. Opción "sin expiración" disponible pero advertida ("recomendamos rotar cada 90 días").
- **Límite por usuario**: máximo 5 tokens activos simultáneos en MVP (configurable). Evita "token sprawl".

### 6.2 Conexión desde el cliente (Claude Desktop / n8n / Mastra)

Sin participación del backend más allá de servir el endpoint.

1. Usuario va a Claude Desktop → Settings → MCP Servers → Add.
2. Pega URL `https://mcp.bigua.lat/mcp` y header `Authorization: Bearer asci_pat_live_...`.
3. Claude inicia handshake MCP:
   - `POST /mcp` con `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{...}}}`.
   - Server responde con sus capabilities (tools, resources, prompts).
4. Claude llama `tools/list`, `resources/list`, `prompts/list` para descubrir lo disponible (filtrado por scopes del token).
5. Sesión queda viva. Cualquier `tools/call` posterior usa el mismo `Mcp-Session-Id`.

### 6.3 Ejecución de una tool call

Ejemplo: agente decide llamar `apollo.search_people` con `{ domain: "ualabis.com", seniority: ["c_suite", "director"] }`.

```
1. Cliente → POST /mcp
   Headers: Authorization: Bearer asci_pat_live_...
            Mcp-Session-Id: 9f3a...
   Body: { jsonrpc, id, method: "tools/call",
           params: { name: "apollo.search_people", arguments: {...} } }

2. Server: middleware de auth
   ├── Extrae Bearer token
   ├── Hashea (argon2id) y busca en mcp_tokens
   ├── Valida status=active, expires_at>now, no revocado
   ├── Carga scopes asociados
   └── Construye Principal { user_id, token_id, scopes, auth_method:"pat" }

3. Server: middleware de scope
   ├── Tool "apollo.search_people" requiere "apollo:search"
   └── ¿Está en principal.scopes? → sí, continúa. Si no → JSON-RPC error -32001 + audit_log(error_auth).

4. Server: middleware de quota
   ├── Lee mcp_quota_counters para (token_id, "apollo_search", "daily", today)
   ├── ¿count < daily_limit? → sí, continúa. Si no → JSON-RPC error -32010 + audit_log(error_quota).
   └── Lee también (token_id, "total_calls", "daily", today)

5. Server: validación de argumentos
   ├── Schema Zod del tool valida domain, seniority, etc.
   └── Si falla → -32602 invalid params + audit_log(error_validation).

6. Server: ejecuta tool
   ├── Llama a lib/apollo/search-people.ts (mismo servicio que la UI usa)
   ├── Apollo responde 200 con N personas
   └── Resultado normalizado al schema MCP (content array).

7. Server: post-ejecución
   ├── Incrementa quota counters: apollo_search +1, total_calls +1
   ├── Insert mcp_audit_log con cost_units={apollo_credits:1}, latency_ms, result_status=ok
   ├── Update mcp_tokens.last_used_at, last_used_ip, last_used_user_agent
   └── Devuelve JSON-RPC result al cliente

8. Cliente: el agente recibe los resultados y decide qué hacer
   (ej. mostrar al usuario, llamar contacts.add_to_bookmark, etc.)
```

**Errores upstream (Apollo cae)**: el tool devuelve un JSON-RPC error con código de la familia `-32020` (custom upstream error) y el audit_log queda como `error_upstream`. La quota se descuenta igual si Apollo cobró el crédito (chequear el response code de Apollo: 402 = no se cobra, 200 = sí).

### 6.4 Revocación

Tres caminos:

1. **Manual por el usuario**: click "Revocar" → update `status='revoked'`, `revoked_at=now`. Próxima llamada del token devuelve `-32001 unauthorized`.
2. **Expiración automática**: cron job diario marca `status='expired'` los que tienen `expires_at < now`.
3. **Quota persistente exhaustada**: si un token excede su quota X días seguidos (heurística configurable), se revoca automáticamente con `revoked_reason='quota_exhausted_persistent'` y se notifica al usuario por email. (Opcional MVP+1.)

---

## 7. Streamable HTTP: detalles del transporte

El endpoint único `/mcp` acepta:

### `POST /mcp`
- Cliente envía request JSON-RPC.
- Server elige entre dos respuestas según necesidad:
  - **Single response**: `Content-Type: application/json` con el JSON-RPC response.
  - **Streamed response**: `Content-Type: text/event-stream` con eventos SSE conteniendo el response final + posibles notifications/progress events. Usado para tool calls largas (ej. `icebreakers.generate` que toma 4-8s).

### `GET /mcp`
- Abre un canal SSE para que el server pueda mandar notificaciones unsolicitadas al cliente (ej. `notifications/tools/list_changed`).
- Opcional, no crítico para MVP.

### `DELETE /mcp`
- Termina la sesión.

### Sesiones
- Server emite `Mcp-Session-Id` en el header de la respuesta `initialize`.
- Cliente lo envía en cada request subsiguiente.
- Server mantiene estado por sesión en memoria (Map en el process). **Limitación**: en Vercel serverless, los procesos son efímeros. Para MVP se acepta que las sesiones puedan resincronizar (`initialize` de nuevo) si el cliente cae a una invocation distinta. Mitigación: el SDK MCP tolera re-init transparente.
- Si en Fase 2 hay problemas: mover estado de sesión a Upstash Redis con TTL 30 min.

### CORS
- `mcp.bigua.lat` permite origen `*` para Streamable HTTP (los clientes MCP no son browser-based en su mayoría) **pero** rechaza credenciales y exige el `Authorization` header explícito. La spec MCP lo recomienda así.
- Header `Access-Control-Expose-Headers: Mcp-Session-Id`.

---

## 8. Quotas: diseño en detalle

### 8.1 Categorías

| Categoría | Default diario | Default mensual | Configurable por token | Razón |
|---|---|---|---|---|
| `total_calls` | 1.000 | 20.000 | sí | Protección general anti-loops. |
| `apollo_search` | 50 | 500 | sí, hasta 200/2000 | Apollo cobra por crédito. |
| `icebreakers_generate` | 100 | 1.000 | sí, hasta 300/3000 | LLM cuesta tokens. |

### 8.2 Comportamiento

- Counters se resetean al inicio de la ventana en zona UTC.
- Al alcanzar el 80%, el server agrega un campo `warning` en el `_meta` del response del tool ("quota_warning: 80% del límite diario alcanzado"). El cliente puede mostrarlo o no.
- Al 100%, el tool retorna error `-32010 quota_exceeded` con detalle de cuándo se resetea.
- Hay un override de emergencia: el usuario desde la UI puede "subir cuota por hoy" hasta el doble, una vez por día.

### 8.3 Anti-abuso adicional

- **Rate limit por minuto** (req/min) además del diario, vía Upstash Ratelimit (lo único nuevo de infra que sí justifica): 60 req/min default por token. Esto evita loops descontrolados antes de que el counter diario reaccione.
- **Detección de patrones sospechosos**: misma argumentos repetidos N veces, escalamiento exponencial de calls, etc. Heurísticas básicas que loguean en audit_log con flag y notifican vía PostHog/Sentry. (Opcional MVP+1.)

---

## 9. Reuso de servicios existentes

Crítico para no duplicar lógica entre Server Actions de la UI y MCP tools. Refactor previo necesario:

1. Hoy mucha lógica vive en `app/actions/*.ts` con `"use server"`. Eso impide invocarla desde un route handler arbitrario sin modificaciones.
2. **Plan**: extraer la lógica pura a `lib/services/*` (sin `"use server"`, sin acceso a cookies/headers), y dejar los `app/actions/*` como wrappers thin que solo agregan auth-from-cookie + revalidatePath.
3. El MCP server invoca `lib/services/*` directamente, pasando un `user_id` resuelto del PAT en lugar del de cookie.

**Servicios a extraer en orden de prioridad** (alineado con tools del MVP):
- `lib/services/bookmarks.ts` ← desde `app/actions/bookmarks.ts`
- `lib/services/docs.ts` ← desde acciones de seller/strategy docs
- `lib/services/signals.ts`
- `lib/services/news.ts`
- `lib/services/filters.ts`
- `lib/services/contacts.ts`
- `lib/services/apollo.ts` ← desde `app/actions/apollo.ts`
- `lib/services/icebreakers.ts`

> Esta refactorización es deuda técnica buena: además de habilitar MCP, hace los actions más testeables.

---

## 10. Variables de entorno

Tabla concreta para Vercel:

| Variable | Scope | Valor / nota |
|---|---|---|
| `MCP_PUBLIC_BASE_URL` | public | `https://mcp.bigua.lat/mcp`. Para mostrar en la UI al generar tokens. |
| `MCP_TOKEN_PEPPER` | server | string aleatorio 32+ bytes. Se concatena al token antes del argon2id. Permite invalidar todos los tokens cambiándolo. |
| `MCP_DEFAULT_TOKEN_TTL_DAYS` | server | `90` |
| `MCP_DEFAULT_DAILY_TOTAL_CALLS` | server | `1000` |
| `MCP_DEFAULT_DAILY_APOLLO_SEARCH` | server | `50` |
| `MCP_DEFAULT_DAILY_ICEBREAKERS_GENERATE` | server | `100` |
| `MCP_RATE_LIMIT_PER_MINUTE` | server | `60` |
| `UPSTASH_REDIS_REST_URL` | server | si usamos Upstash Ratelimit. |
| `UPSTASH_REDIS_REST_TOKEN` | server | idem. |

Las del proveedor IA (Vercel AI Gateway) ya existen para icebreakers. Las de Apollo idem.

---

## 11. Subdominio y DNS

- Comprar/configurar `mcp.bigua.lat` como CNAME a `cname.vercel-dns.com`.
- Vercel project: agregar el dominio. Mismo deploy que `bigua.lat` — el routing se resuelve en `proxy.ts` (middleware) chequeando `host`.
- En `proxy.ts`: si `host === "mcp.bigua.lat"`, rewrite la URL a `/mcp/...` siempre. Esto deja el endpoint limpio (`https://mcp.bigua.lat/mcp` literalmente) y evita exponer el resto de la app por ese subdominio.
- Alternativa más simple: no usar subdominio, vivir en `https://bigua.lat/mcp`. Pierde la separación visual pero ahorra config DNS. Decisión: subdominio si el costo es solo DNS (lo es).

---

## 12. Observabilidad y operación

Todo se enchufa al patrón existente:

- **`mcp_audit_log`** es la fuente de verdad para "qué pasó".
- **Sentry** captura errores de `error_internal` y `error_upstream` (excluir `error_auth` y `error_validation` que serían ruido).
- **PostHog** events:
  - `mcp_token_created` (props: scopes, ttl)
  - `mcp_token_revoked` (props: reason)
  - `mcp_tool_invoked` (props: tool_name, status, latency)
  - `mcp_quota_exceeded` (props: token_id, category)
- **Dashboard interno** (Fase 2): nueva sección admin con
  - Top usuarios MCP por volumen
  - Tools más invocadas
  - Tasa de error por tool
  - Costo Apollo + LLM atribuible a MCP (vs UI directa)

---

## 13. Seguridad: amenazas y mitigaciones

| Amenaza | Mitigación |
|---|---|
| **Token filtrado en GitHub público** | Argon2id (no se puede crackear por brute force razonable) + `last_used_ip` visible en UI + opción "alertarme si se usa desde IP nueva" (Fase 2). Subscripción a GitHub Secret Scanning con prefix `asci_pat_live_` (Fase 2). |
| **Prompt injection: agente convencido de llamar tools costosas en loop** | Quotas duras + rate limit por minuto + audit log + ningún tool del MVP es destructivo (no se puede borrar nada). |
| **Prompt injection: ex-filtrar datos de un usuario a otro** | Cada request se ejecuta con `user_id` del PAT. Servicios siempre filtran `WHERE user_id = $1`. Tests de aislamiento entre tenants. |
| **Replay de requests** | TLS + sesión con `Mcp-Session-Id` + audit log. JSON-RPC `id` único por request. |
| **DoS por agente loco** | Rate limit Upstash + Vercel firewall + circuit breaker en quota counters. |
| **Token con scope amplio → uso accidental** | UI obliga a marcar scopes (no hay "todos por default"). Default sugerido es `read:all` solamente. |
| **Argument injection en tools (ej. SQL via filtro)** | Schema Zod estricto en cada tool. Servicios usan queries parametrizadas (Supabase JS). |

---

## 14. Compatibilidad con clientes oficiales

| Cliente | Auth method aceptado | Transporte | Compatibilidad PAT MVP |
|---|---|---|---|
| Claude Desktop | Headers custom (PAT) o stdio | Streamable HTTP | OK |
| Claude Code (CLI) | Headers custom o stdio | Streamable HTTP | OK |
| Cursor | Headers custom | Streamable HTTP / stdio | OK |
| n8n MCP node | Headers custom | Streamable HTTP | OK (probado en captura del usuario) |
| Mastra (agentes) | Headers custom | Streamable HTTP | OK |
| LangChain MCP adapter | Headers custom | Streamable HTTP | OK |
| AI SDK (`experimental_createMCPClient`) | Headers custom | Streamable HTTP | OK |
| Continue.dev | Headers custom | Streamable HTTP / stdio | OK |
| **Claude.ai (web)** | **Solo OAuth 2.1** | Streamable HTTP | **No, requiere Fase 2** |
| **ChatGPT Custom Connectors** | **Solo OAuth 2.1** | Streamable HTTP | **No, requiere Fase 2** |

---

## 15. Diseño preparado para Fase 2 (OAuth 2.1)

Decisiones de Fase 1 que evitan reescribir nada después:

1. **Capa `Principal`** ya abstrae el método de auth. Sumar OAuth = nueva implementación de `resolveBearerToken` que reconozca tokens JWT/opacos OAuth en lugar de PAT. El resto de la lógica (scopes, quotas, tools) no cambia.
2. **Catálogo de scopes** ya está definido en formato `recurso:operación`, idéntico al que usaría un consent screen OAuth.
3. **`mcp_audit_log.auth_method`** existe desde el día 1 con valor `pat`. Sumar `oauth` es un valor más en el enum.
4. **Quotas por `token_id`** funcionan idénticas para tokens OAuth.
5. **Endpoint `/mcp`** es el mismo, solo cambia cómo el middleware de auth resuelve el principal.

Lo nuevo que sí se construye en Fase 2:
- Tablas `oauth_clients`, `oauth_authorization_codes`, `oauth_access_tokens`, `oauth_refresh_tokens`.
- Endpoints `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/introspect`, `/oauth/revoke`.
- Consent screen UI.
- JWKS endpoint y manejo de claves de firma.

---

## 16. Checklist pre-launch (MVP)

### Pre-requisitos de código
- [ ] Refactor de `app/actions/*` → `lib/services/*` para servicios que tools necesitan.
- [ ] Confirmar que todos los servicios reciben `user_id` como parámetro explícito (no de cookie).
- [ ] Schema Zod por cada tool, en archivos separados por dominio.

### Infraestructura
- [ ] DNS `mcp.bigua.lat` → CNAME Vercel.
- [ ] Vercel project: agregar dominio + verificar SSL.
- [ ] Variables de entorno cargadas (sección 10).
- [ ] Upstash Redis project para rate limiting (si se confirma).

### Base de datos
- [ ] Migración: tablas `mcp_tokens`, `mcp_token_scopes`, `mcp_audit_log`, `mcp_quota_counters`.
- [ ] RLS policies para `mcp_tokens` y `mcp_audit_log` (usuario ve solo lo suyo).
- [ ] Indices documentados.
- [ ] Seed inicial: catálogo de scopes válidos (puede vivir en código, no requiere tabla).

### Backend
- [ ] `app/mcp/route.ts` con handlers POST/GET/DELETE usando `@modelcontextprotocol/sdk` Streamable HTTP transport.
- [ ] `lib/mcp/auth.ts` resuelve PAT → Principal.
- [ ] `lib/mcp/quota.ts` y `lib/mcp/audit.ts`.
- [ ] Cada tool registrada con su schema, scope requerido, handler.
- [ ] Tests E2E con un cliente MCP de prueba.

### UI
- [ ] Página `/profile/integrations/mcp`: listar, crear, revocar tokens.
- [ ] Modal de generación con scopes, TTL, cuotas.
- [ ] Modal post-creación con plaintext + snippet de config + warning "no se vuelve a mostrar".
- [ ] Página de actividad por token (lee `mcp_audit_log`).

### Documentación pública
- [ ] `https://bigua.lat/docs/mcp`: cómo conectar Claude Desktop, Cursor, n8n, AI SDK.
- [ ] Lista de tools con schema y ejemplos.
- [ ] Política de quotas y límites.
- [ ] FAQ (¿qué hago si el token se filtra? ¿cómo rotar? ¿qué scopes pedir?).

### Compliance / legal
- [ ] Update Privacy Policy mencionando MCP y datos compartidos con clientes IA.
- [ ] Términos de servicio con cláusula sobre uso responsable de tokens y agentes.

### Lanzamiento
- [ ] Beta cerrada con 5-10 usuarios.
- [ ] Métricas iniciales: tasa de adopción, tools más usadas, errores frecuentes.
- [ ] Anuncio público.

---

## 17. Preguntas abiertas para próximas sesiones

1. **Servicio de scopes UX**: ¿exponemos los 11 scopes individualmente o agrupados (`read:all`, `write:safe`, `costly`)? Los individuales son más seguros pero más confusos.
2. **Apollo: ¿el agente puede hacer búsquedas que no están atadas a un bookmark?** Hoy la UI siempre asocia. ¿Permitimos `apollo.search_people({ domain })` sin bookmark_id, o forzamos el contexto?
3. **Icebreakers: ¿el agente puede pedir generación con un strategy doc *distinto* al default del usuario?** Esto le da poder al agente para "probar otro tono" sin tocar la config global.
4. **Resources vs Tools**: ¿cuáles datos expongo como resource (URI) y cuáles como tool (`*.get`)? Hay overlap. Propuesta: ambos, el cliente elige.
5. **¿Permitir tokens con `user_id` compartido entre miembros de un workspace?** Hoy no hay concepto fuerte de workspace en ASCI, pero si lo hubiera, un PAT a nivel workspace con scope cross-user sería valioso para integraciones organizacionales. Por ahora descartado.
6. **Política de retención de `mcp_audit_log`**: ¿90 días en hot, archivado a Blob después? ¿O 30 días y borrado?
7. **Soporte multi-idioma de descripciones de tools**: las descripciones que ven los agentes están en inglés (estándar) o español (mercado)? Propuesta: inglés para tool names + descriptions (lo que el LLM lee), español en la UI de gestión.
8. **Notificaciones server→cliente**: ¿hay algún caso donde la plataforma deba "avisarle" al agente activamente? Ej. "se acaba de disparar una señal nueva". El SSE GET soporta esto, pero requiere lógica de fan-out. Probablemente Fase 3.

---

## 18. Resumen ejecutivo (para stakeholders)

**Qué construimos**: un servidor MCP en `mcp.bigua.lat` que permite a cualquier agente IA del usuario (Claude, agentes custom, automatizaciones n8n) acceder a sus bookmarks, docs, señales, noticias, filtros, contactos de Apollo e icebreakers, con autenticación por token personal generado desde el perfil.

**Qué NO construimos en MVP**: integraciones con Claude.ai web ni ChatGPT (requieren OAuth 2.1, Fase 2). Tampoco envío de correos por MCP (espera al feature de Gmail integration y a un análisis de seguridad específico).

**Costo de implementación estimado**: 2-3 sprints de backend + 1 sprint de UI + 1 sprint de docs públicas y testing con clientes reales. Más el refactor previo `actions → services` que ya era deuda técnica buena.

**Costo de operación**: bajo. Reusa Vercel, Supabase y AI Gateway existentes. La única dependencia nueva opcional es Upstash Ratelimit (~$0-10/mes en su plan free/starter).

**Riesgos principales**: prompt injection (mitigado por scopes + quotas + no tools destructivos en MVP), abuso de créditos Apollo (mitigado por quota dura), filtrado de tokens (mitigado por argon2id + visibilidad de IP/UA).

**Diferenciador**: muy pocos productos B2B en LATAM tienen MCP server propio hoy (abril 2026). Esto convierte a Bigua en "ASCI dentro de Claude" sin que el usuario abandone su agente — es un ángulo de adopción y retención fuerte.
