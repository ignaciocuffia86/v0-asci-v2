# ASCI - Roadmap de Features

> **Ultima actualizacion**: 25 de febrero 2026

Este documento consolida todas las features de ASCI, separando lo ya implementado de lo planificado, con planes de implementacion detallados para cada feature nueva.

---

## Estado General

### Implementadas

| # | Feature | Estado | Fecha |
|---|---------|--------|-------|
| 1 | Documentos del Vendedor y Contexto Enriquecido | Implementada | Ene 2026 |
| 2 | Dashboard de Salud de la Plataforma v2 | Implementada | Ene 2026 |
| 3 | Onboarding Guiado Interactivo | Implementada | Feb 2026 |
| 4 | Dashboard de Uso / Adopcion (admin) | Implementada | Feb 2026 |
| 5 | llms.txt para AIs externas | Implementada | Feb 2026 |

### Planificadas

| # | Feature | Estado | Prioridad | Documento |
|---|---------|--------|-----------|-----------|
| 6 | Recomendaciones ASCI | Planificacion | Alta | [Ver plan](#6-recomendaciones-asci) |
| 7 | Integracion con CRM (HubSpot) | Planificacion | Alta | [Ver plan](#7-integracion-con-crm-hubspot) |
| 8 | Notificaciones por Email | Planificacion | Alta | [Ver plan](#8-notificaciones-por-email) |
| 9 | Filtro por Industria en Busquedas | Planificacion | Media | [Ver plan](./FEATURE_INDUSTRY_FILTER_PLAN.md) |
| 10 | FAQ Helper / Asistente de Ayuda | Planificacion | Media | [Ver plan](./FEATURE_FAQ_HELPER_PLAN.md) |

---

## Features Implementadas (resumen)

### 1. Documentos del Vendedor y Contexto Enriquecido
- Upload de PDFs, DOCX, PPTX (max 15 por usuario)
- Procesamiento con IA: extraccion de tags, resumen, industrias target, propuesta de valor
- Almacenamiento en Vercel Blob, metadata en Supabase
- Integracion con Icebreakers y Brief Ejecutivo: los documentos alimentan la generacion personalizada
- Organizacion por carpetas con filtros por tag

### 2. Dashboard de Salud de la Plataforma v2
- Conteos reales de senales (sin cap de 1000)
- Tracking de jobs pendientes y completados
- Metricas de imports y estado del sistema
- Logs mejorados sin auto-refresh

### 3. Onboarding Guiado Interactivo
- 3 tracks: Segmentacion (8 pasos), Documentacion (5 pasos), Prospeccion (10 pasos)
- 23 pasos totales con tooltips, spotlights y overlay
- Persistencia entre sesiones (tabla `user_onboarding`)
- Pasos interactivos que requieren acciones reales del usuario
- Hub central en `/onboarding` para ver tracks, progreso y retomar
- Navegacion automatica entre rutas segun el paso actual

### 4. Dashboard de Uso / Adopcion (admin)
- KPIs: usuarios activos, tasa de onboarding, bookmarks promedio, acciones AI
- Graficos: actividad por usuario (stacked bar), estado de onboarding (donut SVG), uso de features (bar horizontal), actividad semanal (area chart)
- Tabla detallada por usuario con engagement score
- Filtro para ocultar admins y ver solo usuarios reales
- Atribucion correcta de noticias/implementaciones via company_id

### 5. llms.txt para AIs externas
- `llms.txt` (indice corto) y `llms-full.txt` (contenido expandido)
- 10 secciones cubriendo toda la plataforma
- Accesible en `asci.bigua.lat/llms.txt`
- Estructura siguiendo buenas practicas de Vercel

---

## 6. Recomendaciones ASCI

**Objetivo**: Convertir ASCI de una herramienta reactiva (el usuario busca) a una proactiva (ASCI sugiere cuentas con alto fit basandose en los documentos, tags e industrias del vendedor).

### Problema que Resuelve
Hoy el vendedor debe buscar manualmente senales, filtrar por industria y revisar cuentas una por una. Con Recomendaciones ASCI, la plataforma analiza los documentos subidos (propuesta de valor, casos de exito, industrias target) y cruza esa informacion contra el universo de companias con senales activas para sugerir las cuentas con mayor probabilidad de fit.

### Fuentes de Datos para el Matching

| Fuente | Dato extraido | Uso |
|--------|--------------|-----|
| Documentos del vendedor | Tags, industrias target, propuesta de valor, keywords | Perfil del vendedor ideal |
| Tags de documentos | Tecnologias, verticales, casos de uso | Match directo con senales |
| Companias con senales | Industria, tech stack, procesos activos | Pool de candidatas |
| Noticias e implementaciones | Proyectos recientes, inversiones | Senales de timing |
| Bookmarks existentes | Cuentas ya guardadas | Exclusion (no recomendar duplicadas) |

### Algoritmo de Scoring (propuesto)

```
score = (industry_match * 0.30)     // La compania esta en una industria target del vendedor
      + (tag_overlap * 0.25)        // Tags de senales coinciden con tags de documentos
      + (signal_recency * 0.20)     // Senal reciente (ultimos 30 dias) vale mas
      + (signal_strength * 0.15)    // Tipo de senal (implementacion > noticia > proceso)
      + (company_size_fit * 0.10)   // Tamano de empresa dentro del ICP
```

Cada factor se normaliza de 0 a 1. El score final va de 0 a 100.

### UX y Ubicacion

- **Nueva seccion en sidebar**: "Recomendaciones" entre Bookmarks y Documentos
- **Vista principal**: Lista/grid de cuentas recomendadas, ordenadas por score descendente
- **Card de recomendacion**: Nombre de empresa, industria, score de fit (badge), razon principal del match (ej: "3 tags coinciden con tu propuesta de valor"), senales activas recientes, boton para bookmarkear directo
- **Filtros**: Por industria, por rango de score, por tipo de senal
- **Rotacion dinamica**: Las recomendaciones se recalculan cuando:
  - El vendedor sube o modifica un documento
  - Aparecen nuevas senales en el sistema (via imports/CRONs)
  - El vendedor bookmarkea una cuenta recomendada (se reemplaza)

### Modelo de Datos

```sql
-- Tabla de recomendaciones pre-calculadas
CREATE TABLE user_recommendations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  score NUMERIC(5,2) NOT NULL DEFAULT 0,           -- 0.00 a 100.00
  match_reasons JSONB NOT NULL DEFAULT '[]',        -- Array de razones
  -- Ejemplo: [{"type":"industry","label":"Fintech coincide con tu ICP"},
  --           {"type":"tag","label":"3 tags en comun: CRM, Cloud, ERP"}]
  signal_ids UUID[] DEFAULT '{}',                   -- Senales que contribuyeron
  status TEXT NOT NULL DEFAULT 'active',             -- active | dismissed | bookmarked
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,                            -- Para rotacion automatica
  UNIQUE(user_id, company_id)
);

CREATE INDEX idx_recommendations_user_score ON user_recommendations(user_id, score DESC)
  WHERE status = 'active';

-- Vista materializada para calculo eficiente del perfil del vendedor
CREATE MATERIALIZED VIEW seller_profiles AS
SELECT
  ud.user_id,
  array_agg(DISTINCT t.value) AS tags,
  array_agg(DISTINCT ud.industry_targets) AS industries,
  ud.updated_at
FROM user_documents ud
CROSS JOIN LATERAL unnest(ud.tags) AS t(value)
GROUP BY ud.user_id, ud.updated_at;
```

### Estrategia de Calculo y Rotacion

**Opcion A: Calculo on-demand (MVP)**
- Cuando el usuario entra a `/recommendations`, ejecutar la query de scoring en tiempo real
- Cachear resultado en `user_recommendations` con `expires_at` = ahora + 24h
- Si el cache es valido, mostrar directamente
- Ventaja: Simple, sin infraestructura extra
- Desventaja: Primera carga lenta si hay muchas companias

**Opcion B: Calculo periodico (produccion)**
- CRON diario que recalcula recomendaciones para todos los usuarios activos
- Invalidar cache cuando el usuario sube/modifica documentos
- Ventaja: Carga instantanea siempre
- Desventaja: Recomendaciones no reflejan cambios al instante

**Recomendacion**: Empezar con Opcion A (MVP), migrar a Opcion B cuando haya mas de 50 usuarios.

### Fases de Implementacion

**Fase 1 - Modelo de datos y scoring (2-3 dias)**
- Crear tabla `user_recommendations` y vista materializada
- Implementar funcion de scoring en una Server Action
- RPC de Supabase para obtener companias candidatas con sus senales
- Tests del scoring con datos reales

**Fase 2 - UI de recomendaciones (2-3 dias)**
- Pagina `/recommendations` con layout similar a bookmarks
- Card de recomendacion con score, razones y acciones
- Filtros por industria y rango de score
- Boton "Bookmarkear" que mueve la cuenta a bookmarks y la reemplaza
- Boton "Descartar" que la oculta y genera una nueva
- Empty state cuando no hay documentos subidos ("Subi tu primer documento para recibir recomendaciones")

**Fase 3 - Integracion y rotacion (1-2 dias)**
- Trigger al subir/modificar documentos que invalida el cache
- Badge en sidebar mostrando cantidad de recomendaciones nuevas
- Agregar al onboarding como paso opcional
- Actualizar llms.txt con esta seccion

### Dependencias
- Requiere que el usuario tenga al menos 1 documento procesado con tags
- Requiere datos de industria en companias (feature de normalizacion de industria ayuda)
- Las senales deben estar indexadas por company_id

---

## 7. Integracion con CRM (HubSpot)

**Objetivo**: Permitir a los usuarios sincronizar la informacion generada en ASCI (briefs ejecutivos, contactos/DMs encontrados, noticias relevantes, implementaciones) hacia su CRM en HubSpot, eliminando la carga manual y cerrando el loop entre investigacion y accion comercial.

### Problema que Resuelve
Hoy el vendedor investiga en ASCI y luego debe copiar manualmente la informacion al CRM: crear la empresa, agregar contactos, pegar el brief, registrar las noticias relevantes. Esto genera friccion, perdida de informacion y reduce la adopcion. La integracion directa permite un flujo continuo: investigar en ASCI y pushear al CRM con un clic.

### Investigacion Tecnica: HubSpot API

#### Autenticacion
HubSpot ofrece dos metodos de integracion:

| Metodo | Descripcion | Uso recomendado |
|--------|------------|-----------------|
| **Private App** | Token estatico por cuenta HubSpot. Se configura en HubSpot > Development > Legacy Apps | Para ASCI (cada usuario conecta su propia cuenta) |
| **OAuth 2.0 Public App** | Flujo OAuth estandar, permite instalar en multiples cuentas | Para marketplace de HubSpot (futuro) |

**Recomendacion para MVP**: Private App. El usuario genera un token en su cuenta de HubSpot y lo pega en ASCI. Es mas simple, no requiere publicar en el marketplace, y da acceso completo a los scopes necesarios.

#### Scopes Necesarios

```
crm.objects.companies.read      // Buscar si la empresa ya existe
crm.objects.companies.write     // Crear/actualizar empresas
crm.objects.contacts.read       // Buscar si el contacto ya existe
crm.objects.contacts.write      // Crear/actualizar contactos
crm.objects.deals.read          // Ver deals existentes (futuro)
crm.objects.deals.write         // Crear deals (futuro)
crm.schemas.companies.read      // Leer propiedades custom
crm.schemas.companies.write     // Crear propiedades custom
crm.schemas.contacts.read       // Leer propiedades custom
crm.schemas.contacts.write      // Crear propiedades custom
```

#### Endpoints Clave

**1. Buscar empresa por dominio (para matching)**
```
POST https://api.hubapi.com/crm/v3/objects/companies/search
{
  "filterGroups": [{
    "filters": [{
      "propertyName": "domain",
      "operator": "EQ",
      "value": "acme.com"
    }]
  }]
}
```

**2. Crear empresa**
```
POST https://api.hubapi.com/crm/v3/objects/companies
{
  "properties": {
    "name": "Acme Corp",
    "domain": "acme.com",
    "industry": "Technology",
    "asci_brief": "Brief ejecutivo generado por ASCI...",
    "asci_last_sync": "2026-02-25T00:00:00Z"
  }
}
```

**3. Crear contacto y asociar a empresa**
```
POST https://api.hubapi.com/crm/v3/objects/contacts
{
  "properties": {
    "firstname": "Juan",
    "lastname": "Perez",
    "email": "juan@acme.com",
    "jobtitle": "CTO",
    "asci_source": "true"
  },
  "associations": [{
    "to": { "id": "{companyId}" },
    "types": [{
      "associationCategory": "HUBSPOT_DEFINED",
      "associationTypeId": 279
    }]
  }]
}
```

**4. Crear nota con brief/noticias y asociar a empresa**
```
POST https://api.hubapi.com/crm/v3/objects/notes
{
  "properties": {
    "hs_timestamp": "2026-02-25T00:00:00Z",
    "hs_note_body": "<h3>Brief Ejecutivo - ASCI</h3><p>...</p>"
  }
}
// Luego asociar:
PUT https://api.hubapi.com/crm/v4/objects/note/{noteId}/associations/default/company/{companyId}
```

**5. Crear/leer propiedades custom**
```
POST https://api.hubapi.com/crm/v3/properties/companies
{
  "name": "asci_brief",
  "label": "ASCI Brief Ejecutivo",
  "type": "string",
  "fieldType": "textarea",
  "groupName": "companyinformation"
}
```

#### Limites de la API

| Plan HubSpot | Rate Limit (10 seg) | Rate Limit (diario) |
|-------------|---------------------|---------------------|
| Free / Starter | 100 por app | 250,000 por cuenta |
| Professional | 190 por app | 625,000 por cuenta |
| Enterprise | 190 por app | 1,000,000 por cuenta |

Para ASCI esto es mas que suficiente. Un push completo de una cuenta (buscar empresa + crear/actualizar + contactos + nota) usa ~5-8 calls.

#### Limitaciones Importantes
- Las notas solo pueden asociarse a contactos en la creacion. Para asociar a empresas, hay que usar la Associations API v4 en un segundo request.
- Las propiedades custom deben crearse una sola vez por cuenta de HubSpot (al momento de la primera sincronizacion).
- El token de Private App no tiene expiracion automatica, pero HubSpot recomienda rotarlo cada 6 meses.
- No hay webhooks en Private Apps para recibir cambios de HubSpot hacia ASCI (sync unidireccional ASCI -> HubSpot).

### Mapeo de Datos: ASCI -> HubSpot

#### Empresas (Companies)

| Campo ASCI | Propiedad HubSpot | Tipo | Notas |
|-----------|-------------------|------|-------|
| company.name | `name` | Nativa | Match principal |
| company.domain | `domain` | Nativa | Match secundario (mas preciso) |
| company.industry | `industry` | Nativa | Mapeo de industrias ASCI -> HubSpot |
| bookmark.summary (brief) | `asci_brief` | Custom (textarea) | Brief ejecutivo completo |
| news + implementations | `asci_intelligence` | Custom (textarea) | Resumen de noticias e implementaciones |
| bookmark.tier | `asci_tier` | Custom (select) | T1 / T2 / T3 |
| bookmark.status | `asci_status` | Custom (select) | Nueva / En Analisis / Contactada / etc |
| fecha de sync | `asci_last_sync` | Custom (date) | Timestamp de ultima sincronizacion |

#### Contactos (Contacts)

| Campo ASCI | Propiedad HubSpot | Tipo | Notas |
|-----------|-------------------|------|-------|
| contact.first_name | `firstname` | Nativa | - |
| contact.last_name | `lastname` | Nativa | - |
| contact.email | `email` | Nativa | Dedup key |
| contact.title | `jobtitle` | Nativa | - |
| contact.linkedin_url | `linkedin_url` | Custom | Perfil de LinkedIn |
| "ASCI" | `asci_source` | Custom (boolean) | Marca que vino de ASCI |

#### Notas (Engagements)

| Contenido ASCI | Formato en Nota | Asociacion |
|---------------|-----------------|------------|
| Brief ejecutivo | HTML formateado con titulo, resumen, senales clave | Company |
| Noticias relevantes | Lista HTML con fecha, titulo y resumen de cada noticia | Company |
| Implementaciones | Lista HTML con titulo, descripcion y tecnologias involucradas | Company |
| Icebreakers generados | HTML con los mensajes generados y el contacto target | Company + Contact |

### Pantallas de la Integracion

#### 7a. Configuracion de HubSpot (`/settings/integrations/hubspot`)

**Pantalla de conexion:**
- Input para pegar el token de Private App
- Boton "Conectar" que valida el token contra la API de HubSpot
- Status: Conectado / Desconectado / Error
- Instrucciones paso a paso para crear la Private App en HubSpot con los scopes correctos
- Boton "Desconectar" para revocar

**Pantalla de mapeo (post-conexion):**
- Seccion "Propiedades custom": Boton "Crear propiedades en HubSpot" que crea las custom properties (`asci_brief`, `asci_intelligence`, `asci_tier`, `asci_status`, `asci_source`, `asci_last_sync`) en la cuenta de HubSpot
- Seccion "Matching": Selector de campo de matching para empresas (dominio vs nombre)
- Seccion "Que sincronizar": Checkboxes para elegir que datos pushear (Brief, Contactos, Noticias, Implementaciones, Icebreakers)
- Preview del mapeo: tabla mostrando campo ASCI -> campo HubSpot

#### 7b. Push desde el Workspace (`/bookmarks/[id]`)

**Boton "Enviar a HubSpot" en el workspace de cada cuenta:**
- Aparece en el header del workspace si la integracion esta conectada
- Al hacer clic, abre un modal con:
  - Busqueda automatica de la empresa en HubSpot por dominio
  - Si existe: muestra match, opcion de actualizar
  - Si no existe: opcion de crear nueva
  - Checkboxes de que enviar: Brief, Contactos, Noticias, Implementaciones
  - Preview de lo que se va a enviar
  - Boton "Confirmar y enviar"
- Progress bar mostrando el avance del push (empresa -> contactos -> notas)
- Resultado final: links directos a los registros creados en HubSpot

#### 7c. Sync Masivo (`/settings/integrations/hubspot/sync`)

**Para pushear multiples cuentas a la vez:**
- Lista de bookmarks con checkbox de seleccion
- Filtro por tier, status
- Boton "Enviar seleccion a HubSpot"
- Cola de procesamiento con status por cuenta
- Log de resultados: exitoso / error / ya existia

### Modelo de Datos

```sql
-- Configuracion de integracion por usuario
CREATE TABLE user_integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'hubspot',          -- Para futuras integraciones
  access_token TEXT,                                  -- Token encriptado
  config JSONB DEFAULT '{}',                          -- Configuracion de mapeo
  -- Ejemplo config:
  -- {
  --   "match_field": "domain",
  --   "sync_brief": true,
  --   "sync_contacts": true,
  --   "sync_news": true,
  --   "sync_implementations": true,
  --   "sync_icebreakers": false,
  --   "custom_props_created": true
  -- }
  status TEXT NOT NULL DEFAULT 'disconnected',        -- connected | disconnected | error
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, provider)
);

-- Registro de cada push individual
CREATE TABLE integration_sync_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES user_integrations(id) ON DELETE CASCADE,
  bookmark_id UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'hubspot',
  action TEXT NOT NULL,                               -- create_company | update_company | create_contact | create_note
  hubspot_object_id TEXT,                             -- ID del objeto en HubSpot
  hubspot_object_type TEXT,                           -- company | contact | note
  status TEXT NOT NULL DEFAULT 'pending',             -- pending | success | error
  error_message TEXT,
  payload JSONB,                                      -- Lo que se envio
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sync_logs_user_bookmark ON integration_sync_logs(user_id, bookmark_id);
CREATE INDEX idx_sync_logs_status ON integration_sync_logs(status) WHERE status = 'error';
```

### Seguridad
- El token de HubSpot se almacena encriptado en la DB (AES-256)
- Se valida el token contra la API antes de almacenarlo
- El token nunca se expone al frontend (solo un flag de "conectado")
- Cada operacion de push valida que el usuario sea owner del bookmark
- Rate limiting: maximo 10 pushes por minuto por usuario
- RLS en `user_integrations` y `integration_sync_logs`

### Requisitos del Lado de HubSpot (para el usuario)

1. **Cuenta de HubSpot**: Cualquier plan (Free funciona, pero con limites de API)
2. **Permisos**: Ser Super Admin en la cuenta de HubSpot
3. **Crear Private App**:
   - Ir a HubSpot > Settings > Integrations > Private Apps
   - Crear nueva app con nombre "ASCI Integration"
   - Agregar los scopes listados arriba
   - Copiar el token generado
4. **Pegar token en ASCI**: Settings > Integraciones > HubSpot > Conectar

### Fases de Implementacion

**Fase 1 - Conexion y configuracion (3-4 dias)**
- Crear tabla `user_integrations`
- Pantalla de configuracion de HubSpot en settings
- Validacion de token contra API
- Almacenamiento encriptado del token
- Creacion automatica de propiedades custom en HubSpot
- Pantalla de mapeo con preview

**Fase 2 - Push individual (3-4 dias)**
- Boton "Enviar a HubSpot" en workspace
- Busqueda de empresa existente por dominio
- Crear/actualizar empresa con brief y metadata
- Crear contactos asociados
- Crear notas con noticias e implementaciones
- Modal con progress y resultado
- Tabla `integration_sync_logs` para registro

**Fase 3 - Sync masivo (2-3 dias)**
- Pagina de sync masivo con seleccion multiple
- Cola de procesamiento con manejo de rate limits
- Log de resultados con retry para errores
- Notificacion al completar

**Fase 4 - Polish y monitoreo (1-2 dias)**
- Dashboard de sync en admin: cantidad de pushes, errores, empresas sincronizadas
- Badge en bookmarks mostrando si la cuenta esta sincronizada con HubSpot
- Agregar al onboarding como paso opcional
- Actualizar llms.txt

### Futuras Extensiones
- **OAuth Public App**: Para publicar en marketplace de HubSpot y simplificar la conexion
- **Sync bidireccional**: Recibir cambios de HubSpot via webhooks
- **Creacion de Deals**: Crear oportunidades automaticamente al pushear
- **Salesforce**: Replicar la misma logica para Salesforce CRM
- **Pipedrive**: Tercera integracion de CRM

---

## 8. Notificaciones por Email

**Objetivo**: Enviar alertas automaticas por email a los usuarios cuando sus cuentas bookmarkeadas reciban actividad nueva: busquedas laborales cargadas, noticias, implementaciones o nuevos contactos encontrados. Convertir a ASCI en una herramienta que trabaja por el vendedor incluso cuando no esta conectado.

### Problema que Resuelve
Hoy el vendedor tiene que entrar a ASCI, navegar a cada bookmark y revisar manualmente si hay novedades. Esto genera que muchos usuarios no vuelvan con frecuencia y pierdan senales de timing criticas. Las notificaciones por email resuelven esto: el vendedor recibe un resumen de novedades directamente en su casilla, puede hacer clic para ir directo a la cuenta, y ASCI se mantiene presente en su workflow diario sin esfuerzo.

### Eventos que Disparan Notificaciones

| Evento | Tabla fuente | Condicion | Contenido del email |
|--------|-------------|-----------|---------------------|
| Nuevas busquedas laborales | `company_jobs` | job.company_id coincide con un bookmark del usuario | Titulo del puesto, ubicacion, link al workspace |
| Noticias nuevas | `company_news` | news.company_id coincide con un bookmark del usuario | Titulo de la noticia, resumen corto, fecha |
| Implementaciones nuevas | `company_implementations` | impl.company_id coincide con un bookmark del usuario | Titulo, descripcion corta, tecnologias |
| Nuevos contactos cargados | `user_company_contacts` | contact.user_id = usuario Y fue creado por Apollo/sistema | Nombre, titulo, empresa |

### Arquitectura de Envio

#### Enfoque: Digest Diario (recomendado para MVP)

En lugar de enviar un email por cada evento individual (que saturaría la casilla del usuario), ASCI agrupa todas las novedades del dia en un unico **email digest**.

```
Flujo:
1. Datos nuevos llegan a las tablas (via ETL/CRONs existentes)
2. Se marcan como "pendientes de notificacion" en tabla intermedia
3. CRON diario (pg_cron) a las 8:00 AM Argentina recoge pendientes
4. Edge Function o API Route genera el digest por usuario
5. Resend envia el email con template React Email
6. Se marcan como "notificados"
```

#### Por que Digest y no Real-time?
- **Resend Free**: 100 emails/dia. Con 20 usuarios y multiples eventos, los emails individuales agotarian el cupo.
- **UX**: Un email diario con 5 novedades > 5 emails separados. Menor spam, mayor open rate.
- **Tecnico**: Mas simple de implementar, mas facil de debuggear.

### Proveedor de Email: Resend + React Email

| Caracteristica | Detalle |
|---------------|---------|
| **Proveedor** | [Resend](https://resend.com) |
| **Plan Free** | 100 emails/dia, 3,000/mes |
| **Plan Pro** | $20/mes, 50,000 emails/mes |
| **Templates** | React Email (JSX/TSX) |
| **Integracion** | SDK oficial para Next.js, Vercel Functions compatible |
| **Dominio** | Requiere verificar dominio (asci.bigua.lat) con DNS TXT/CNAME |

#### Configuracion de Dominio
Para que los emails lleguen desde `notificaciones@asci.bigua.lat` (en vez de `onboarding@resend.dev`), se necesita:
1. Agregar dominio en Resend Dashboard
2. Configurar registros DNS:
   - `TXT` para SPF
   - `CNAME` para DKIM (3 registros)
   - `TXT` para verificacion de dominio
3. Verificar en Resend (~5 min de propagacion)

### Modelo de Datos

```sql
-- Cola de notificaciones pendientes
CREATE TABLE notification_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bookmark_id UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                    -- 'new_job' | 'new_news' | 'new_implementation' | 'new_contact'
  event_source_id UUID NOT NULL,               -- ID del job/news/impl/contact que genero el evento
  event_data JSONB NOT NULL DEFAULT '{}',      -- Datos relevantes para el email
  -- Ejemplo new_job: {"title": "Senior DevOps", "location": "Buenos Aires", "company_name": "Acme"}
  -- Ejemplo new_news: {"title": "Acme adquiere startup de IA", "summary": "...", "date": "2026-02-25"}
  status TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'sent' | 'skipped'
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX idx_notif_queue_pending ON notification_queue(user_id, status)
  WHERE status = 'pending';

-- Preferencias de notificacion por usuario
CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  digest_frequency TEXT NOT NULL DEFAULT 'daily',  -- 'daily' | 'weekly' | 'never'
  notify_new_jobs BOOLEAN NOT NULL DEFAULT true,
  notify_new_news BOOLEAN NOT NULL DEFAULT true,
  notify_new_implementations BOOLEAN NOT NULL DEFAULT true,
  notify_new_contacts BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_start TIME,                          -- Ej: '22:00' (no enviar de noche)
  quiet_hours_end TIME,                            -- Ej: '07:00'
  timezone TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  last_digest_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Trigger de Encolado

Cada vez que se inserta un registro nuevo en las tablas fuente, un trigger detecta si algun usuario tiene esa empresa bookmarkeada y agrega una entrada a `notification_queue`:

```sql
-- Trigger para company_news
CREATE OR REPLACE FUNCTION enqueue_news_notification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_queue (user_id, bookmark_id, event_type, event_source_id, event_data)
  SELECT
    b.user_id,
    b.id,
    'new_news',
    NEW.id,
    jsonb_build_object(
      'title', NEW.title,
      'summary', left(NEW.summary, 200),
      'company_name', (SELECT name FROM companies WHERE id = NEW.company_id),
      'date', NEW.published_date
    )
  FROM bookmarks b
  WHERE b.company_id = NEW.company_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_news_notification
  AFTER INSERT ON company_news
  FOR EACH ROW EXECUTE FUNCTION enqueue_news_notification();

-- Triggers similares para company_implementations, company_jobs, user_company_contacts
```

### CRON de Envio (pg_cron + Edge Function)

```sql
-- Programar digest diario a las 11:00 UTC (8:00 AM Argentina)
SELECT cron.schedule(
  'daily-email-digest',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url := 'https://asci.bigua.lat/api/notifications/send-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### API Route: `/api/notifications/send-digest`

```
Logica:
1. Obtener usuarios con notificaciones pendientes (status = 'pending')
2. Filtrar por preferencias (email_enabled = true, frecuencia correcta)
3. Agrupar eventos por usuario
4. Para cada usuario:
   a. Agrupar eventos por bookmark/empresa
   b. Renderizar template React Email con todas las novedades
   c. Enviar via Resend API
   d. Marcar eventos como 'sent'
5. Log de envios exitosos/fallidos
```

### Template del Email (React Email)

El email digest tiene esta estructura:

```
De: ASCI Notificaciones <notificaciones@asci.bigua.lat>
Asunto: "5 novedades en tus cuentas - ASCI Digest"

---
Logo ASCI

Hola {nombre},

Tenes novedades en {N} cuentas que estas siguiendo:

[Acme Corp] - 3 novedades
  - Nuevo puesto: "Senior DevOps Engineer" en Buenos Aires
  - Noticia: "Acme cierra ronda Serie B de USD 20M"
  - Implementacion: "Migracion a AWS con Kubernetes"
  [Ver cuenta ->] (link a /bookmarks/{id})

[Globant] - 2 novedades
  - Noticia: "Globant abre oficina en Mexico"
  - Nuevo contacto: Maria Lopez, VP Engineering
  [Ver cuenta ->] (link a /bookmarks/{id})

---
Gestionar preferencias (link a /settings/notifications)
Dejar de recibir estos emails (unsubscribe link)
```

### Pantalla de Preferencias (`/settings/notifications`)

- Toggle general: Activar/desactivar emails
- Frecuencia: Diario / Semanal / Nunca (radio buttons)
- Tipos de eventos: Checkboxes para cada tipo (jobs, news, impl, contacts)
- Zona horaria: Selector (default: Buenos Aires)
- Preview: "Recibiras un email de resumen {frecuencia} a las 8:00 AM {timezone} con las novedades de tus {N} cuentas bookmarkeadas."

### Pantalla de Historial de Notificaciones (in-app)

Ademas del email, mostrar un badge y panel de notificaciones dentro de la app:
- Icono de campana en el header con badge de notificaciones no leidas
- Panel desplegable con las ultimas novedades agrupadas por cuenta
- Cada item linkeado al workspace correspondiente
- Boton "Marcar todo como leido"

### Metricas y Monitoreo

| Metrica | Como se mide |
|---------|-------------|
| Emails enviados/dia | Conteo en `notification_queue` WHERE status='sent' |
| Open rate | Resend Analytics (tracking pixel automatico) |
| Click rate | Resend Analytics (link tracking) |
| Unsubscribes | Conteo en `notification_preferences` WHERE email_enabled=false |
| Eventos por usuario/dia promedio | AVG de eventos agrupados por user_id |
| Tiempo de entrega | Diferencia entre created_at y sent_at |

### Seguridad y Compliance

- **Unsubscribe**: Cada email incluye link de unsubscribe funcional (requerido por CAN-SPAM/GDPR)
- **Rate limiting**: Maximo 1 digest por usuario por dia (el CRON controla esto)
- **Datos sensibles**: El email solo incluye titulos y resumenes cortos, nunca datos completos
- **Resend API key**: Almacenada como variable de entorno `RESEND_API_KEY`, nunca expuesta al client
- **RLS**: `notification_queue` y `notification_preferences` protegidas por user_id

### Dependencias

- **Resend**: Cuenta creada + dominio verificado + API key configurada
- **pg_cron**: Extension habilitada en Supabase (ya disponible en el plan actual)
- **pg_net**: Extension habilitada (para HTTP calls desde pg_cron)
- **Tablas existentes**: `bookmarks`, `company_news`, `company_implementations`, `company_jobs`, `user_company_contacts` (todas existen)

### Capacidad del Plan Free de Resend

| Escenario | Emails/dia | Cubre Free? |
|-----------|-----------|-------------|
| 10 usuarios, digest diario | 10 | Si (limite: 100) |
| 30 usuarios, digest diario | 30 | Si |
| 50 usuarios, digest diario | 50 | Si |
| 100 usuarios, digest diario | 100 | Limite justo, migrar a Pro |

Con el volumen actual de ASCI, el plan free de Resend es mas que suficiente.

### Fases de Implementacion

**Fase 1 - Infraestructura de cola y triggers (2-3 dias)**
- Crear tablas `notification_queue` y `notification_preferences`
- Implementar triggers en `company_news`, `company_implementations`, `company_jobs`, `user_company_contacts`
- RLS policies para ambas tablas
- Seed de preferencias default para usuarios existentes

**Fase 2 - Envio de emails con Resend (2-3 dias)**
- Configurar cuenta Resend + verificar dominio `asci.bigua.lat`
- Crear template React Email para el digest
- Implementar API Route `/api/notifications/send-digest`
- Configurar CRON en Supabase (pg_cron + pg_net)
- Testing con envios reales

**Fase 3 - UI de preferencias y notificaciones in-app (2 dias)**
- Pantalla `/settings/notifications` con preferencias
- Icono de campana con badge en header
- Panel de notificaciones desplegable
- Integracion con onboarding (paso opcional)

**Fase 4 - Monitoreo y mejoras (1 dia)**
- Dashboard en admin: emails enviados, open rate, errores
- Agregar frecuencia semanal (digest los lunes)
- Agregar al llms.txt

### Futuras Extensiones
- **Alertas instantaneas**: Para eventos de alta prioridad (ej: noticia de una cuenta T1), enviar email inmediato ademas del digest
- **Canales alternativos**: Slack webhook, WhatsApp Business API
- **Email de bienvenida**: Al bookmarkear una cuenta, enviar resumen de senales existentes
- **Digest inteligente**: IA que prioriza las novedades mas relevantes para el vendedor basandose en sus documentos

---

## 9. Filtro por Industria en Busquedas

**Objetivo**: Permitir filtrar resultados de busqueda por industria normalizada (~25 categorias).

### Problema Actual
- 82% de companias sin industria
- 172 industrias sin normalizar
- Sin opcion de filtrar en busquedas

### Solucion
- Crear 25 categorias normalizadas
- Tabla de mapeo industria -> categoria
- Trigger para normalizacion automatica
- Multi-select en UI de busqueda

📄 **[Plan completo](./FEATURE_INDUSTRY_FILTER_PLAN.md)**

---

## 10. FAQ Helper / Asistente de Ayuda Flotante

**Objetivo**: Boton flotante con centro de ayuda contextual para resolver dudas frecuentes de usuarios, con busqueda y fallback a soporte humano.

### Alcance
- Boton flotante en esquina inferior derecha
- Panel con 9 categorias de ayuda (35+ articulos)
- Busqueda con fuzzy matching
- Fallback a email: ignacio@bigua.lat

📄 **[Plan completo](./FEATURE_FAQ_HELPER_PLAN.md)**

---

## Otros Documentos Tecnicos

| Documento | Descripcion |
|-----------|-------------|
| [ETL_PROCESS.md](./ETL_PROCESS.md) | Documentacion del proceso ETL |
| [ETL_SYSTEM.md](./ETL_SYSTEM.md) | Arquitectura del sistema ETL |
| [digest.md](./digest.md) | Notas y decisiones tecnicas |

---

## Priorizacion

### Corto Plazo (Q1 2026)
1. **Recomendaciones ASCI** - Diferenciador clave: hace que la plataforma sea proactiva
2. **Notificaciones por Email** - Retention y engagement: mantiene a ASCI presente sin esfuerzo del usuario
3. **Integracion HubSpot (Fase 1-2)** - Cierra el loop investigacion -> accion

### Mediano Plazo (Q2 2026)
4. **Integracion HubSpot (Fase 3-4)** - Sync masivo y monitoreo
5. **Filtro por Industria** - Quick win para mejorar UX de busqueda
6. **FAQ Helper** - Reduce carga de soporte manual

### Largo Plazo (Q3+ 2026)
7. **Integracion Salesforce** - Segundo CRM
8. **OAuth HubSpot** - Marketplace
9. **Enriquecimiento de Industrias** - API para completar el 82% sin industria
10. **Canales alternativos de notificacion** - Slack, WhatsApp Business

---

## Historial de Cambios

| Fecha | Cambio |
|-------|--------|
| 25/02/2026 | Feature 8: Notificaciones por Email (plan detallado con Resend + pg_cron) |
| 25/02/2026 | Feature 6: Recomendaciones ASCI (plan detallado) |
| 25/02/2026 | Feature 7: Integracion con CRM HubSpot (plan detallado con investigacion tecnica) |
| 25/02/2026 | Actualizacion: Features 1-5 marcadas como implementadas |
| 23/01/2026 | Plan de Onboarding Guiado Interactivo |
| 23/01/2026 | Plan de FAQ Helper / Asistente de Ayuda |
| 21/01/2026 | Creacion del roadmap y feature de documentos del vendedor |
| 16/01/2026 | Plan de dashboard improvements |
| Enero 2026 | Plan de filtro por industria |
