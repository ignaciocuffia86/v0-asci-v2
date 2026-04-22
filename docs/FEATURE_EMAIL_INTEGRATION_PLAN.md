# Feature: Integración de Buzón de Correo (Gmail / Google Workspace)

> **Estado**: Diseño. No implementado.
> **Fase 1**: Google Workspace + Gmail API, envío individual desde Icebreaker, detección de respuestas vía polling.
> **Fuera de alcance Fase 1**: Microsoft 365, bulk send, secuencias, pixel/click tracking, unsubscribe automático.

---

## 1. Decisiones arquitectónicas (recap)

| Decisión | Elección | Motivo |
|---|---|---|
| Transporte de envío | **Gmail API del usuario** (OAuth 2.0) | Deliverability nativa Gmail→Gmail, reputación aislada, respuestas al inbox real del usuario. |
| Proveedor Fase 1 | **Google Workspace / Gmail** | Mayor adopción en el mercado objetivo. MS365 queda para Fase 2. |
| ¿Se usa Amazon SES? | **No, para outbound a prospects.** Sí eventualmente para mails de plataforma → usuario. | SES rompería el modelo "enviado desde mi buzón". |
| Almacenamiento de tokens | Supabase Postgres con encriptación a nivel columna (pgsodium o AES-GCM app-side). | Ya tenemos Supabase; evitamos dependencia extra. |
| Detección de respuestas | Polling de `gmail.users.history.list` vía cron Vercel (cada 10 min). | Infraestructura de crons ya existe; Pub/Sub es over-engineering para MVP. |
| Refresh de tokens | Lazy, on-demand, antes de cada operación. | Simple, no requiere job adicional. |

---

## 2. Arquitectura de infraestructura

```
┌─────────────────────────────────────────────────────────────────────┐
│                      GOOGLE CLOUD PLATFORM                          │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  GCP Project: "bigua-email-integration" (NUEVO, dedicado)     │  │
│  │                                                               │  │
│  │  ├── Gmail API (habilitada)                                   │  │
│  │  ├── OAuth Consent Screen (External, verificado)              │  │
│  │  ├── OAuth 2.0 Client ID (Web application)                    │  │
│  │  │     ├── Authorized origins: bigua.lat, localhost:3000      │  │
│  │  │     └── Redirect URIs: /api/auth/gmail/callback            │  │
│  │  └── (Opcional Fase 3) Pub/Sub topic para push notifications  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ OAuth 2.0 code/token flow
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         VERCEL (Next.js 16)                         │
│                                                                     │
│   Route Handlers                      Server Actions                │
│   ┌──────────────────────────┐        ┌────────────────────────┐    │
│   │ /api/auth/gmail/connect  │        │ sendEmailFromIcebreaker│    │
│   │ /api/auth/gmail/callback │        │ disconnectGmailAccount │    │
│   │ /api/auth/gmail/revoke   │        │ listEmailAccounts      │    │
│   └─────────┬────────────────┘        └──────────┬─────────────┘    │
│             │                                    │                  │
│             └───────────────┬────────────────────┘                  │
│                             ▼                                       │
│   ┌─────────────────────────────────────────────────────────┐       │
│   │  lib/email/ (NUEVO módulo)                              │       │
│   │  ├── gmail-client.ts     (wrapper de googleapis)        │       │
│   │  ├── token-service.ts    (encrypt / decrypt / refresh)  │       │
│   │  ├── mime-builder.ts     (RFC 5322 + base64url)         │       │
│   │  └── rate-limiter.ts     (chequeo diario y por-minuto)  │       │
│   └─────────────────────────────────────────────────────────┘       │
│                             │                                       │
│   Cron jobs (vercel.json)   │                                       │
│   ┌──────────────────────────────────────────────────────┐          │
│   │ /api/cron/poll-email-replies   (*/10 * * * *)        │          │
│   │ /api/cron/refresh-gmail-watch  (0 3 * * *, Fase 3)   │          │
│   └──────────────────────────────────────────────────────┘          │
│                             │                                       │
└─────────────────────────────┼───────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   SUPABASE (Postgres + Auth)                        │
│                                                                     │
│  Tablas nuevas:                                                     │
│  ├── user_email_accounts   (un registro por buzón conectado)        │
│  ├── email_sends           (cada envío individual)                  │
│  └── email_events          (timeline: sent/replied/bounced/error)   │
│                                                                     │
│  Extensiones:                                                       │
│  └── pgsodium              (encriptación de tokens en reposo)       │
│                                                                     │
│  RLS: todas las tablas aisladas por user_id = auth.uid()            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Google Cloud Platform — setup paso a paso

### 3.1. Crear el proyecto GCP dedicado

**Por qué dedicado**: la OAuth verification es por proyecto. Mezclar scopes de la plataforma (p.ej. algún día Google login) con Gmail restricted scopes complica el proceso. Un proyecto específico para Gmail integration es la recomendación oficial de Google.

Pasos en `console.cloud.google.com`:

1. **Crear proyecto**
   - Nombre: `bigua-email-integration` (o similar).
   - Organización: la de la empresa, no personal.
   - Billing account: asociar la tarjeta corporativa (aunque Gmail API es free tier generoso, se requiere billing habilitado).

2. **Habilitar APIs**
   - APIs & Services → Library → habilitar **Gmail API**.
   - (Fase 3) Habilitar **Cloud Pub/Sub API**.

3. **Configurar OAuth consent screen**
   - User Type: **External** (cualquier Google account puede consentir, no solo del workspace propio).
   - App name: `Bigua`.
   - User support email: soporte oficial del producto.
   - App logo: 120×120 px, PNG/JPG, URL pública.
   - App domain:
     - Application home page: `https://bigua.lat`
     - Application privacy policy: `https://bigua.lat/privacy` ← **debe existir y ser accesible**
     - Application terms of service: `https://bigua.lat/terms` ← **debe existir y ser accesible**
   - Authorized domains: `bigua.lat`.
   - Developer contact: email del equipo técnico.

4. **Declarar scopes solicitados**
   - `.../auth/userinfo.email` (no sensitive).
   - `.../auth/userinfo.profile` (no sensitive).
   - `openid` (no sensitive).
   - `https://www.googleapis.com/auth/gmail.send` ← **restricted scope**.
   - `https://www.googleapis.com/auth/gmail.readonly` ← **restricted scope**, necesario para detección de respuestas.
   - Por cada scope restricted, Google pide **justificación textual** de por qué se necesita. Hay que redactar bien esto (ver sección 4.3).

5. **Crear OAuth 2.0 Client ID**
   - Credentials → Create Credentials → OAuth client ID.
   - Application type: **Web application**.
   - Name: `Bigua Web Client`.
   - Authorized JavaScript origins:
     - `https://bigua.lat`
     - `https://*.vercel.app` (previews — o agregar cada preview manualmente, más seguro)
     - `http://localhost:3000` (dev local)
   - Authorized redirect URIs:
     - `https://bigua.lat/api/auth/gmail/callback`
     - `http://localhost:3000/api/auth/gmail/callback`
   - Guardar `client_id` y `client_secret` — irán a env vars de Vercel.

### 3.2. Testing mode vs Production mode

- Al crear el consent screen queda en modo **Testing**: hasta 100 usuarios de prueba, tokens expiran cada 7 días, banner "unverified app" visible.
- En Testing hay que agregar manualmente los emails de prueba en "Test users".
- Esto alcanza para **construir y testear la feature con usuarios internos / beta cerrada**.
- Pasar a **Production** requiere OAuth verification (sección 4).

---

## 4. OAuth Verification — el cuello de botella

**Este es el bloqueante temporal más grande del feature.** Conviene arrancar el trámite en paralelo al desarrollo, no después.

### 4.1. Qué se somete

Para scopes restricted (`gmail.send`, `gmail.readonly`) Google exige:

1. **Brand verification** (~días):
   - Ser owner verificado del dominio `bigua.lat` en Google Search Console.
   - Logo de la app consistente entre consent screen y la web.

2. **Privacy policy** accesible públicamente, que mencione explícitamente:
   - Qué datos de Gmail se acceden (metadata, contenido de mensajes enviados por el usuario, metadata de mensajes entrantes).
   - Para qué se usan (enviar emails outbound, detectar respuestas de prospects).
   - Que **no se comparten con terceros** ni se usan para entrenar modelos.
   - Cómo el usuario puede revocar el acceso.
   - Política de retención y borrado.

3. **Terms of service** accesibles públicamente.

4. **Demo video** (YouTube unlisted), mostrando:
   - Login en la plataforma.
   - Click en "Conectar Gmail".
   - Pantalla de consent de Google con los scopes visibles.
   - Redirección de vuelta a la app con el buzón conectado.
   - Uso del scope: mandar un email, ver el envío en Gmail, mostrar tracking de respuesta.
   - Opción de desconectar / revocar.

5. **Scope justification** por cada scope restricted. Texto sugerido (a pulir con legal):

   > `gmail.send`: "Bigua permite a usuarios de ventas B2B contactar manualmente a prospects verificados. Cada envío es iniciado explícitamente por el usuario desde la UI (no hay envío automático en lote ni por cron). El scope `gmail.send` se usa exclusivamente para enviar ese email desde la cuenta del usuario, usando su propia identidad y reputación, en lugar de un servidor SMTP de terceros. No se leen mensajes con este scope."

   > `gmail.readonly`: "Para informar al usuario cuando un prospect contesta, Bigua consulta periódicamente los headers (`In-Reply-To`, `References`, `Message-ID`) de los mensajes entrantes posteriores al envío. No se almacena ni se muestra el contenido de los mensajes entrantes; sólo se registra el evento 'respondió' asociado al envío original del usuario. El scope `readonly` es el mínimo posible para esta funcionalidad dado que Gmail no expone una variante que permita solo leer headers."

6. **CASA assessment** (Cloud Application Security Assessment):
   - **Tier 2** es el requerido para la mayoría de apps con Gmail restricted scopes.
   - Tier 2 = self-assessment más laboratorio de pentest aprobado por Google.
   - Costo real: USD 2.000–5.000 con un lab tercero (p.ej. Leviathan, NCC, Bishop Fox).
   - Duración: 4–8 semanas.
   - **No se puede lanzar a producción sin esto.**

### 4.2. Timeline realista

| Semana | Actividad |
|---|---|
| 0 | Crear proyecto GCP, consent screen, client ID. Arrancar desarrollo en modo Testing. |
| 0–2 | Publicar privacy policy y ToS definitivos. Verificar dominio en Search Console. |
| 2 | Grabar demo video. Redactar justificaciones de scope. |
| 2 | Enviar OAuth verification request. |
| 2–6 | Google pide aclaraciones, se itera (típico: 2–4 rondas de feedback). |
| 4–8 | Contratar CASA Tier 2 lab, ejecutar assessment. |
| 6–10 | Recibir aprobación final. Pasar el consent screen a "In production". |

**Recomendación**: mantener el producto en **beta cerrada** (lista blanca de test users en modo Testing) hasta tener la verificación, y comunicarlo como tal a los primeros usuarios.

### 4.3. Estrategia de transición

- Mientras se espera verificación, agregar una lógica en la UI: "Tu email no está en la lista beta. Contactá a soporte para solicitar acceso". Esto alinea la app con la realidad (modo Testing tiene hard cap de 100 test users).
- Una vez verificado, el cap desaparece y cualquier Google account puede consentir.

---

## 5. Variables de entorno requeridas

Todas se agregan en Vercel (Project Settings → Environment Variables) y en `.env.local` para dev:

| Variable | Scope | Valor | Uso |
|---|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Server | `xxxxx.apps.googleusercontent.com` | Client ID del OAuth client de GCP. Puede ser público pero por convención lo mantenemos server-side. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Server | `GOCSPX-xxxxx` | **Secreto**. Nunca expuesto al cliente. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Server | `https://bigua.lat/api/auth/gmail/callback` (prod) / `http://localhost:3000/...` (dev) | Debe coincidir exactamente con lo registrado en GCP. |
| `EMAIL_TOKEN_ENCRYPTION_KEY` | Server | 32 bytes random base64 | Master key para encriptar `access_token` / `refresh_token` si usamos AES-GCM en app (alternativa a pgsodium). Generar con `openssl rand -base64 32`. |
| `CRON_SECRET` | Server | Ya existe | Reutilizar para el nuevo cron de polling de respuestas. |
| `NEXT_PUBLIC_APP_URL` | Public | `https://bigua.lat` | Para construir redirect URIs absolutas. |

**No se requieren variables nuevas de Supabase** — se reutilizan `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` que ya existen.

---

## 6. Modelo de datos (diseño lógico)

### 6.1. `user_email_accounts`

Un registro por buzón conectado. Permitimos múltiples por usuario a futuro (no enforzamos `UNIQUE(user_id)`), pero sí `UNIQUE(user_id, email_address)`.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → `auth.users` | RLS anchor. |
| `provider` | text | `'google'` en Fase 1. Enum checkeado. |
| `email_address` | text | El buzón que conectó (puede ser distinto al email de login). |
| `display_name` | text | Ej. "Ignacio Cuffía". Tomado del userinfo endpoint. |
| `access_token_encrypted` | bytea / text | Encriptado. Nunca se loguea. |
| `refresh_token_encrypted` | bytea / text | Encriptado. Crítico — sin esto hay que re-consentir. |
| `token_expires_at` | timestamptz | Chequeo rápido antes de cada operación. |
| `scopes_granted` | text[] | Array de scopes que el usuario efectivamente otorgó (puede omitir readonly). |
| `status` | text | `active` / `expired` / `revoked` / `error`. |
| `last_used_at` | timestamptz | Para métricas y auditoría. |
| `last_error` | text | Último mensaje de error, para surfacing en UI. |
| `last_error_at` | timestamptz | |
| `daily_limit` | int | Default 50. Configurable por usuario hasta 200. |
| `sent_today` | int | Contador. Se resetea diariamente. |
| `sent_today_reset_at` | date | Fecha del último reset (UTC o timezone del usuario — decidir). |
| `gmail_history_id` | text | Último `historyId` sincronizado. Usado por el reply poller. |
| `gmail_watch_expiration` | timestamptz | (Fase 3) fecha en que vence el `watch` de Pub/Sub. |
| `is_default` | boolean | Si el usuario tiene varios, cuál es el default. |
| `connected_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Índices**:
- `(user_id)` para listados.
- `(status)` parcial donde `status = 'active'` para el cron.
- `UNIQUE (user_id, email_address)`.

**RLS**:
- SELECT/UPDATE/DELETE: `user_id = auth.uid()`.
- INSERT: solo vía server action con service role (el usuario no inserta directo).

### 6.2. `email_sends`

Un registro por destinatario. Si el usuario manda a `A` y `B`, son dos filas (aunque Fase 1 es 1-a-1).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | RLS anchor. |
| `email_account_id` | uuid FK → `user_email_accounts` | |
| `bookmark_id` | uuid FK | Contexto de dónde se envió. |
| `company_id` | uuid FK | |
| `contact_id` | uuid FK → `user_company_contacts` | |
| `icebreaker_id` | uuid FK → `user_icebreakers` | Nullable: puede enviarse sin icebreaker a futuro. |
| `to_email` | text | Snapshot (inmutable aunque cambie el contacto). |
| `to_name` | text | Snapshot. |
| `from_email` | text | Snapshot. |
| `subject` | text | |
| `body_html` | text | |
| `body_text` | text | |
| `message_id_header` | text UNIQUE | El `Message-ID` RFC 5322 generado por nosotros. **Clave para matching de respuestas.** |
| `gmail_thread_id` | text | Devuelto por Gmail API al enviar. |
| `gmail_message_id` | text | ID interno de Gmail (distinto del `Message-ID` header). |
| `status` | text | `queued` / `sent` / `failed` / `bounced` / `replied`. |
| `error_code` | text | |
| `error_message` | text | |
| `sent_at` | timestamptz | |
| `replied_at` | timestamptz | Primer reply detectado. |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Índices**:
- `(user_id, sent_at DESC)` para listados.
- `(contact_id)` para traer historial por prospect.
- `(message_id_header)` UNIQUE — usado por el poller.
- `(gmail_thread_id)` para matching fallback.
- `(status)` parcial donde `status IN ('sent')` para el poller.

**RLS**: `user_id = auth.uid()`.

### 6.3. `email_events`

Timeline detallado. Permite agregar pixel/click tracking sin redesignar el schema.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `email_send_id` | uuid FK | |
| `user_id` | uuid FK | Denormalizado para RLS eficiente. |
| `event_type` | text | `sent` / `delivered` / `bounced` / `replied` / `error` / (futuro) `opened` / `clicked`. |
| `payload` | jsonb | Detalles crudos: snippet de reply, código SMTP de bounce, etc. |
| `occurred_at` | timestamptz | Cuándo ocurrió el evento. |
| `created_at` | timestamptz | Cuándo lo detectamos. Puede diferir (polling cada 10 min). |

**Índices**:
- `(email_send_id, occurred_at DESC)`.
- `(user_id, event_type, occurred_at DESC)` para dashboards.

**RLS**: `user_id = auth.uid()`.

### 6.4. Cambios a tablas existentes

- `user_company_contacts`: sin cambios de schema. El campo `status` empieza a reflejar `'contacted'` / `'replied'` / `'bounced'` — escrito por el sistema de envío, con prioridad por encima de estados anteriores (`'new'`, `'reviewed'`).
- `profiles` (o equivalente): agregar columna `email_signature_html` (text, nullable) para que el usuario configure su firma.

---

## 7. Encriptación de tokens

Los `access_token` y `refresh_token` de Google son credenciales de acceso a la bandeja de entrada del usuario. Tratarlos como un secreto máximo.

### 7.1. Opciones evaluadas

| Opción | Pros | Contras |
|---|---|---|
| **A. `pgsodium` Transparent Column Encryption** | Encriptación transparente para la app, claves gestionadas por Supabase, auditable. | Requiere extension habilitada (lo está en Supabase), lock-in a Supabase. |
| **B. AES-256-GCM a nivel app** con key en env var | Portable, simple de razonar. | La clave vive en env vars; rotación manual; si la key leak todos los tokens están comprometidos. |
| **C. Vault externo (AWS KMS, GCP KMS)** | Mejor rotación, audit logs, separación estricta. | Dependencia extra, costo, latencia adicional por cada envío. |

### 7.2. Recomendación

**Opción A (pgsodium)** por defecto, con fallback a **Opción B** si operacionalmente resulta complejo. Justificación:

- Ya estamos full Supabase.
- No agrega latencia (encriptación en el propio INSERT).
- Las claves las maneja Supabase fuera de la DB exportable.
- Si en el futuro escala a enterprise con compliance SOC2/ISO, se puede migrar a Opción C sin cambiar el shape del schema.

### 7.3. Qué NO encriptamos

- `email_address`, `display_name`, `scopes_granted`, `status` — no son secretos, necesitamos queries directas.
- `message_id_header`, `gmail_thread_id`, `gmail_message_id` — son IDs, no contenido sensible.
- `body_html` / `body_text` de `email_sends` — **discusión abierta**. Argumento a favor de encriptarlos: son el contenido real del email. Argumento en contra: se muestran en UI, deben ser queryable. **Propuesta**: no encriptar en Fase 1, revisitar cuando definamos retention policy (ver sección 12).

---

## 8. Endpoints / routes backend

Todas las rutas viven bajo `/app/api/auth/gmail/*` y `/app/api/cron/*`. No se toca código en este hilo.

### 8.1. `GET /api/auth/gmail/connect`

- **Autenticación**: requiere sesión Supabase válida.
- **Acción**: construye URL de Google OAuth con:
  - `client_id`, `redirect_uri`, `response_type=code`
  - `scope=` todos los requeridos (userinfo, send, readonly)
  - `access_type=offline` + `prompt=consent` (para garantizar siempre refresh_token)
  - `state=` firmado (HMAC con secret server-side) que incluye `user_id` + `nonce` + `returnTo` path.
- **Respuesta**: `307 Redirect` a `accounts.google.com/o/oauth2/v2/auth?...`.

### 8.2. `GET /api/auth/gmail/callback`

- Sin autenticación Supabase previa garantizada (el usuario vuelve de Google). Re-autenticar vía `state` firmado.
- Valida `state` (HMAC match, nonce no reusado, timestamp < 10 min).
- Intercambia `code` → `{ access_token, refresh_token, expires_in, id_token }`.
- Parsea `id_token` para obtener `email` verificado.
- (Opcional) Llama a `gmail.users.getProfile` para capturar `historyId` inicial.
- Encripta tokens, hace UPSERT en `user_email_accounts`.
- Redirige a `/settings/email?connected=1` (o al `returnTo` del state).

### 8.3. Server Action `disconnectGmailAccount(accountId)`

- Verifica ownership (`user_id = auth.uid()`).
- Llama a `https://oauth2.googleapis.com/revoke?token={refresh_token}` para revocar del lado de Google.
- Marca la fila como `status='revoked'`, limpia tokens (set a null), mantiene historial de envíos.

### 8.4. Server Action `sendEmailFromIcebreaker({ icebreakerId, subject, bodyHtml })`

Flujo detallado:

1. Autenticar usuario (Supabase `auth.uid()`).
2. Cargar icebreaker, contact, bookmark, company (ownership check implícito por RLS).
3. Validar:
   - Contact tiene email verificado.
   - Usuario tiene `user_email_accounts` con `status='active'`.
   - `sent_today < daily_limit`.
   - Subject y body no vacíos, dentro de límites razonables (ej. <1MB combined).
4. Obtener token válido (llamar al token service, que refresca si está expirado — ver sección 9).
5. Generar `Message-ID: <uuid@bigua.lat>` nuevo.
6. Construir MIME (`multipart/alternative` con `text/plain` + `text/html`), codificar base64url.
7. `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` con `Authorization: Bearer {access_token}`.
8. Parsear respuesta: `{ id, threadId, labelIds }`.
9. Transacción Supabase:
   - INSERT en `email_sends` (status='sent', todos los campos).
   - INSERT en `email_events` (event_type='sent').
   - UPDATE `user_email_accounts` (sent_today++, last_used_at=now).
   - UPDATE `user_company_contacts` (status='contacted' si aplica).
10. Devolver `{ success: true, sendId }` a la UI.

**Manejo de errores**:
- 401 de Gmail → marcar cuenta como `status='expired'`, devolver error a UI con CTA a reconectar.
- 403 quota exceeded → incrementar contador interno, devolver "límite alcanzado".
- 4xx otros → log en `email_events(event_type='error')`, devolver mensaje.
- 5xx → retry una vez con backoff, si falla de nuevo → error.

### 8.5. Cron: `GET /api/cron/poll-email-replies`

- Protegido por `Authorization: Bearer ${CRON_SECRET}` (patrón ya existente).
- Schedule: `*/10 * * * *` (cada 10 minutos).
- Usa `SUPABASE_SERVICE_ROLE_KEY` para bypasear RLS.
- Registra ejecución en `cron_executions` (tabla ya existe).
- Usa concurrency guard (patrón ya existente).

**Lógica**:

```
para cada user_email_account WHERE status='active' Y tiene email_sends recientes sin respuesta:
  intentar refresh_token si expiró
  si falla refresh → marcar status='expired', saltar
  
  llamar gmail.users.history.list?startHistoryId={account.gmail_history_id}&historyTypes=messageAdded
  
  si devuelve 'historyId expired' (404):
    fallback: messages.list?q=after:{timestamp_de_hace_7d}
    re-baselinear gmail_history_id
  
  para cada mensaje nuevo:
    si labels incluye 'SENT' → skip (es un envío propio, no reply)
    fetchear headers (format=metadata, metadataHeaders=In-Reply-To,References,Message-ID,From)
    extraer lista de message IDs referenciados
    query: SELECT * FROM email_sends WHERE message_id_header = ANY($1) AND user_id = $2
    si hay match:
      INSERT email_events(event_type='replied', payload={snippet, from, at})
      UPDATE email_sends SET status='replied', replied_at=ahora WHERE id = match
      UPDATE user_company_contacts SET status='replied' WHERE id = contact_id
  
  UPDATE user_email_accounts SET gmail_history_id = último visto
```

**Time budget**: 45s por ejecución (patrón existente), procesar hasta N cuentas por tick y continuar en el próximo.

**Edge cases**:
- Cliente de correo que strippea `In-Reply-To`: fallback a match por `gmail_thread_id` de Gmail (el thread_id se preserva en el cliente nativo de Gmail siempre).
- Usuario marca como spam / borra el mensaje: sigue apareciendo en history, lo matcheamos igual. Correcto.
- Auto-replies (OOO): **idealmente filtrar**. Gmail marca muchos con `auto-submitted` header. Detectar y marcar como `event_type='auto_reply'` (nuevo subtype), **no** marcar el contact como `replied`.

### 8.6. (Fase 3) `POST /api/webhooks/gmail-push`

Para cuando migremos a Pub/Sub. No se diseña ahora.

---

## 9. Estrategia de refresh de tokens

### 9.1. Política

- **Lazy refresh**: antes de cualquier llamada Gmail API, chequear `token_expires_at`. Si faltan <60s o ya expiró, hacer refresh.
- **No hay job dedicado de refresh preventivo** en Fase 1 — agrega complejidad sin beneficio claro para 1-a-1.
- El polling de respuestas refresca implícitamente cada 10 min mientras la cuenta está en uso.

### 9.2. Algoritmo del token service

```
getValidAccessToken(accountId):
  account = SELECT * FROM user_email_accounts WHERE id = accountId
  if account.status != 'active': throw "not usable"
  
  if account.token_expires_at > now + 60s:
    return decrypt(account.access_token_encrypted)
  
  # Necesita refresh
  response = POST https://oauth2.googleapis.com/token
    grant_type=refresh_token
    refresh_token=decrypt(account.refresh_token_encrypted)
    client_id=...
    client_secret=...
  
  if response.error == 'invalid_grant':
    # El usuario revocó, cambió password, o pasaron 6 meses sin uso
    UPDATE user_email_accounts SET status='revoked', last_error=response.error_description
    throw "reconnect required"
  
  UPDATE user_email_accounts SET
    access_token_encrypted = encrypt(response.access_token),
    token_expires_at = now + response.expires_in seconds,
    last_used_at = now
  WHERE id = accountId
  
  return response.access_token
```

### 9.3. Race conditions

Si dos envíos concurrentes del mismo usuario disparan refresh a la vez, los dos llaman al endpoint de Google. Google acepta (ambos reciben tokens válidos), pero uno sobrescribe al otro en DB. En práctica no rompe nada (ambos tokens son válidos), pero genera writes innecesarios.

**Mitigación** (opcional, Fase 2): lock optimista con `UPDATE ... WHERE token_expires_at = $viejo` o usar `SELECT FOR UPDATE`. No prioritario.

---

## 10. Rate limiting y cuotas

### 10.1. Límites de Gmail API (a respetar)

| Límite | Valor | Scope |
|---|---|---|
| Envíos por día (Workspace) | 2.000 | Por usuario. |
| Envíos por día (Gmail personal) | 500 | Por usuario. |
| Destinatarios por mensaje | 500 | Por mensaje. |
| Tamaño de mensaje | 25 MB | Total. |
| API quota (read/send) | 1.000.000.000 units/día por project, 250 units/user/segundo | A nivel proyecto. |

### 10.2. Límites que imponemos nosotros (más conservadores)

| Límite | Valor inicial | Razón |
|---|---|---|
| Envíos por día por usuario | **50**, configurable hasta 200 | Proteger la reputación del dominio del usuario, warmup natural. |
| Envíos por minuto por usuario | 10 | Evitar ser flaggeados como bot. |
| Re-envío al mismo contact | Bloqueado si hay `email_sends` con `sent_at > now - 24h` | Evitar duplicados accidentales. |

### 10.3. Implementación

- Conteo en `user_email_accounts.sent_today` con reset diario por timezone del usuario (o UTC, decidir — propuesta: UTC, más simple).
- Chequeo por-minuto via query `COUNT(*) FROM email_sends WHERE user_id = $1 AND sent_at > now() - interval '1 minute'`.
- Chequeo anti-duplicado via query similar sobre `contact_id`.

---

## 11. Observabilidad y logging

### 11.1. Qué loguear

**Sí loguear** (con `[v0]` prefix para consistencia con el patrón existente):
- Intentos de conexión OAuth (success/failure), con `user_id` y motivo de falla.
- Envíos ejecutados, con `send_id`, `user_id`, `to_email` hasheado, status HTTP de Gmail.
- Errors de refresh token.
- Execuciones del cron poller (duración, cuentas procesadas, replies detectados).

**Nunca loguear**:
- Access tokens o refresh tokens (ni encriptados ni en claro).
- Contenido completo del body del email (solo metadata: subject hash, length).
- `client_secret`.

### 11.2. Tabla `cron_executions`

Ya existe. Agregar entradas con `cron_name='poll-email-replies'`. Mismo patrón que los crons actuales.

### 11.3. Métricas de producto (dashboard admin)

Para el admin panel (ya existe `/admin/*`):

- Cuentas conectadas totales / activas / expiradas.
- Envíos últimos 24h / 7d / 30d.
- Tasa de respuesta agregada (% de `email_sends` con reply dentro de 7 días).
- Errores de envío agrupados por tipo.
- Cuentas con `last_error` reciente (para soporte proactivo).

---

## 12. Seguridad y compliance

### 12.1. RLS

- Todas las tablas nuevas con RLS ON.
- Policies idénticas al patrón del resto del proyecto (`user_id = auth.uid()`).
- Operaciones del cron y del OAuth callback usan service role — documentar y aislar en funciones específicas.

### 12.2. Anti-abuso

- Rate limit de intentos de conexión OAuth: máx 5 por hora por usuario.
- Validación estricta del `state` en el callback (HMAC firmado).
- CSRF protection: el `state` incluye nonce + user_id + timestamp.
- Redirect URI whitelist estricta en GCP.

### 12.3. Retention policy (propuesta)

- `user_email_accounts`: permanece mientras exista la cuenta del usuario.
- `email_sends`: **30 días por default para el body**, metadata indefinida. El usuario puede exportar antes. Discusión abierta.
- `email_events`: indefinido (son pocos bytes, útiles para analítica).
- Al desconectar cuenta: tokens se borran inmediatamente. Historial de envíos se preserva (con marca `account_disconnected`).
- Al eliminar usuario: cascade delete de todo lo anterior.

### 12.4. Cumplimiento Google API Services User Data Policy

Google exige que cualquier app con restricted scopes cumpla con:
- **Limited Use**: los datos de Gmail solo se usan para proveer la feature al usuario. No para ads, no para entrenar modelos (incluyendo LLMs), no para venta a terceros.
- **Minimum scope**: pedir el mínimo scope posible (lo cumplimos con `gmail.send` + `gmail.readonly`, no pedimos `gmail.modify` ni `gmail.full`).
- **Transparencia**: privacy policy explícita.
- **Independent security assessment**: CASA Tier 2 (sección 4).

Esto **debe reflejarse en la privacy policy palabra por palabra** para pasar la verificación.

---

## 13. Checklist pre-launch (resumen ejecutivo)

Para poder abrir este feature a usuarios no-beta:

**Infraestructura GCP**
- [ ] Proyecto GCP creado y billing habilitado.
- [ ] Gmail API habilitada.
- [ ] OAuth consent screen configurado y verificado.
- [ ] OAuth Client ID con redirect URIs correctos.
- [ ] Dominio `bigua.lat` verificado en Search Console.

**Legal / Policy**
- [ ] Privacy policy publicada con cláusulas de Google API Services User Data Policy.
- [ ] Terms of service publicados.
- [ ] Demo video grabado y linkeado.
- [ ] Scope justifications redactados.

**OAuth Verification**
- [ ] Verification request submitted a Google.
- [ ] CASA Tier 2 assessment contratado y completado.
- [ ] Consent screen en estado "In production".

**Backend**
- [ ] Tablas `user_email_accounts`, `email_sends`, `email_events` creadas (migrations).
- [ ] pgsodium configurado para encriptación de tokens.
- [ ] Env vars de producción cargadas en Vercel.
- [ ] Routes `/api/auth/gmail/connect` y `/callback` funcionando.
- [ ] Server action `sendEmailFromIcebreaker` implementada.
- [ ] Cron `/api/cron/poll-email-replies` agendado en `vercel.json`.
- [ ] Monitoreo: entries en `cron_executions` visibles en `/admin`.

**UX**
- [ ] Pantalla "Conectar Gmail" en `/settings/email`.
- [ ] Modal de composición en Icebreakers tab.
- [ ] Badge "Respondió" en Prospects tab.
- [ ] Manejo de errores: cuenta expirada, límite diario, bounce.

**Observabilidad**
- [ ] Métricas en `/admin/email` (cuentas, envíos, replies, errores).
- [ ] Alertas de fallas repetidas (via Sentry o similar, si está conectado).

---

## 14. Preguntas abiertas para siguientes sesiones de diseño

1. **UX del modal de composición**: ¿qué variables dinámicas (`{{first_name}}`, `{{company}}`) soportamos? ¿Preview de merge? ¿Edición rich text o solo plain/HTML simple?
2. **Generación de subject**: ¿lo escribe el usuario, lo sugiere la IA como parte del icebreaker, o ambos?
3. **Firma del usuario**: ¿configurable en `/profile` (nuestro), o leemos la firma nativa de Gmail (requiere scope adicional `gmail.settings.basic`)?
4. **Retention del body**: 30 días propuesto. ¿Alinea con lo que queremos vs. lo que necesitamos para analítica posterior?
5. **Timezone del reset diario**: UTC o timezone del usuario. UTC es más simple, pero "se me reseteó a las 9 PM" puede confundir.
6. **Auto-replies (OOO)**: ¿los contamos como "replied" o los filtramos?
7. **Política de re-conexión automática**: si un token expira y el usuario no reconecta en X días, ¿se desactiva la cuenta? ¿se notifica al usuario por otro canal?
8. **Fase 2 — Microsoft 365**: ¿empezamos el diseño en paralelo o esperamos a validar Fase 1?

---

## 15. Resumen para stakeholders no-técnicos

Para implementar "envío de emails a prospects desde el buzón del usuario":

1. **Creamos un proyecto nuevo en Google Cloud** exclusivamente para esto (separado de cualquier otra integración).
2. **Configuramos OAuth** para que los usuarios puedan dar permiso a Bigua de enviar en su nombre.
3. **Pasamos por un proceso formal de Google** (OAuth verification + auditoría de seguridad externa) que puede tomar 4–8 semanas. **Este es el plazo real más largo del proyecto.**
4. **Creamos 3 tablas nuevas** en Supabase: cuentas conectadas, envíos realizados, eventos.
5. **Los tokens de acceso se guardan encriptados** con la encriptación nativa de Supabase.
6. **Cada envío usa el buzón real del usuario** (no un servidor intermedio como SES).
7. **Un proceso automático cada 10 minutos** revisa si los prospects respondieron y lo registra.

Lo que **NO** necesitamos:
- Amazon SES.
- Resend (aunque puede seguir usándose para mails de plataforma → usuario, pero no para outbound a prospects).
- Dominio de envío propio ni configuración DKIM/SPF/DMARC (esos son problema del dominio del usuario, no nuestro).
- Postmark, SendGrid, Mailgun u otros ESP.

Lo que **SÍ** necesitamos que no existe hoy:
- Privacy policy y ToS publicados (puede ser bloqueante legal).
- Presupuesto para CASA Tier 2 assessment (USD 2.000–5.000).
- Logo y branding definitivos para el consent screen.
- Un video demo grabado del flujo OAuth para Google.
