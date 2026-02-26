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

## 8. Notificaciones por Email - Digest Semanal

**Objetivo**: Enviar un resumen semanal por email a cada usuario con todas las novedades que ocurrieron en sus cuentas bookmarkeadas: noticias recientes, implementaciones descubiertas, busquedas laborales nuevas y senales detectadas en contactos. ASCI trabaja para el vendedor incluso cuando no esta conectado.

### Problema que Resuelve
Hoy el vendedor tiene que entrar a ASCI, navegar a cada bookmark y revisar manualmente si hay novedades. Esto genera que muchos usuarios no vuelvan con frecuencia y pierdan senales de timing criticas. Un digest semanal resuelve esto sin saturar la casilla: un unico email con todo lo que paso en sus cuentas durante la semana, con links directos al workspace de cada cuenta.

### Concepto Clave: Digest Semanal, No Reactivo

No se envian emails individuales por cada evento. El sistema **acumula** novedades durante la semana y envia **un unico email los lunes a las 8:00 AM Argentina** con el resumen completo. Esto:
- Evita spam y mantiene alta la tasa de apertura
- Es sostenible con el plan free de Resend (al ser semanal, el volumen es muy bajo)
- El vendedor sabe que cada lunes tiene su "briefing semanal" de ASCI

### Triggers de Encolado

Los datos llegan a ASCI por distintos caminos (un usuario busca noticias, el backend carga jobs, el ETL detecta senales). Los triggers detectan esa actividad nueva y la encolan para **todos los usuarios que tengan esa empresa en bookmarks**, de forma transparente.

#### Trigger 1: Noticias Nuevas (< 1 mes de antiguedad)

**Cuando ocurre**: Un usuario (cualquiera) busca noticias de la empresa X. Se insertan noticias en `company_news`. Solo se encolan las que tengan `published_date` menor a 30 dias (son relevantes, no historicas).

**A quienes notifica**: A todos los usuarios que tengan en bookmark la empresa X y que **no hayan sido notificados previamente** de esa misma noticia (deduplicacion por constraint UNIQUE).

| Campo | Tabla | Detalle |
|-------|-------|---------|
| Fuente | `company_news` | Columnas: `id`, `company_id`, `title`, `summary`, `published_date`, `created_at` |
| Condicion | - | `published_date > NOW() - INTERVAL '30 days'` |
| Vinculo a usuarios | `bookmarks` | `bookmarks.company_id = company_news.company_id` |
| Deduplicacion | `notification_queue` | UNIQUE constraint en `(user_id, event_source_id, event_type)` |
| Dato para email | JSONB | `{ title, summary (200 chars), published_date, company_name }` |

```sql
CREATE OR REPLACE FUNCTION enqueue_news_notification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Solo noticias recientes (menos de 1 mes de antiguedad)
  IF NEW.published_date IS NULL OR NEW.published_date < NOW() - INTERVAL '30 days' THEN
    RETURN NEW;
  END IF;

  INSERT INTO notification_queue (user_id, bookmark_id, event_type, event_source_id, event_data)
  SELECT
    b.user_id,
    b.id,
    'new_news',
    NEW.id,
    jsonb_build_object(
      'title', NEW.title,
      'summary', left(COALESCE(NEW.summary, ''), 200),
      'company_name', (SELECT name FROM companies WHERE id = NEW.company_id),
      'published_date', NEW.published_date
    )
  FROM bookmarks b
  WHERE b.company_id = NEW.company_id
  ON CONFLICT (user_id, event_source_id, event_type) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_news_notification
  AFTER INSERT ON company_news
  FOR EACH ROW EXECUTE FUNCTION enqueue_news_notification();
```

#### Trigger 2: Busquedas Laborales Nuevas (Job Postings)

**Cuando ocurre**: El backend (via `dictionary_jobs` / ETL) carga nuevas posiciones abiertas en `job_postings` para la empresa X.

**A quienes notifica**: A todos los usuarios que tengan en bookmark la empresa X.

| Campo | Tabla | Detalle |
|-------|-------|---------|
| Fuente | `job_postings` | Columnas: `id`, `company_id`, `title`, `location`, `posting_url`, `posted_at`, `created_at` |
| Vinculo a usuarios | `bookmarks` | `bookmarks.company_id = job_postings.company_id` |
| Deduplicacion | `notification_queue` | UNIQUE constraint |
| Dato para email | JSONB | `{ title, location, posting_url, company_name }` |

```sql
CREATE OR REPLACE FUNCTION enqueue_job_notification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_queue (user_id, bookmark_id, event_type, event_source_id, event_data)
  SELECT
    b.user_id,
    b.id,
    'new_job',
    NEW.id,
    jsonb_build_object(
      'title', NEW.title,
      'location', COALESCE(NEW.location, 'No especificada'),
      'posting_url', NEW.posting_url,
      'company_name', (SELECT name FROM companies WHERE id = NEW.company_id)
    )
  FROM bookmarks b
  WHERE b.company_id = NEW.company_id
  ON CONFLICT (user_id, event_source_id, event_type) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_job_notification
  AFTER INSERT ON job_postings
  FOR EACH ROW EXECUTE FUNCTION enqueue_job_notification();
```

#### Trigger 3: Senales Nuevas en Contactos

**Cuando ocurre**: El backend carga contactos y se detectan senales en la tabla `signals`. Las senales indican que un contacto de la empresa X matchea con keywords del diccionario (ej: usa Kubernetes, experiencia con Salesforce, etc.).

**A quienes notifica**: A todos los usuarios que tengan en bookmark la empresa X. La notificacion incluye el tipo de senal y el keyword que matcheo.

| Campo | Tabla | Detalle |
|-------|-------|---------|
| Fuente | `signals` | Columnas: `id`, `company_id`, `signal_type`, `keyword_matched`, `snippet`, `contact_id`, `created_at` |
| Vinculo a usuarios | `bookmarks` | `bookmarks.company_id = signals.company_id` |
| Deduplicacion | `notification_queue` | UNIQUE constraint |
| Dato para email | JSONB | `{ signal_type, keyword_matched, snippet (150 chars), company_name }` |

```sql
CREATE OR REPLACE FUNCTION enqueue_signal_notification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_queue (user_id, bookmark_id, event_type, event_source_id, event_data)
  SELECT
    b.user_id,
    b.id,
    'new_signal',
    NEW.id,
    jsonb_build_object(
      'signal_type', NEW.signal_type,
      'keyword_matched', NEW.keyword_matched,
      'snippet', left(COALESCE(NEW.snippet, ''), 150),
      'company_name', (SELECT name FROM companies WHERE id = NEW.company_id)
    )
  FROM bookmarks b
  WHERE b.company_id = NEW.company_id
  ON CONFLICT (user_id, event_source_id, event_type) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_signal_notification
  AFTER INSERT ON signals
  FOR EACH ROW EXECUTE FUNCTION enqueue_signal_notification();
```

#### Trigger 4: Implementaciones Nuevas

**Cuando ocurre**: Un usuario busca implementaciones de la empresa X, o el backend las detecta. Se insertan en `company_implementations`.

**A quienes notifica**: A todos los usuarios que tengan en bookmark la empresa X.

```sql
CREATE OR REPLACE FUNCTION enqueue_implementation_notification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO notification_queue (user_id, bookmark_id, event_type, event_source_id, event_data)
  SELECT
    b.user_id,
    b.id,
    'new_implementation',
    NEW.id,
    jsonb_build_object(
      'title', NEW.title,
      'company_name', (SELECT name FROM companies WHERE id = NEW.company_id)
    )
  FROM bookmarks b
  WHERE b.company_id = NEW.company_id
  ON CONFLICT (user_id, event_source_id, event_type) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_implementation_notification
  AFTER INSERT ON company_implementations
  FOR EACH ROW EXECUTE FUNCTION enqueue_implementation_notification();
```

### Modelo de Datos

```sql
-- Cola de notificaciones pendientes
CREATE TABLE notification_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bookmark_id UUID NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                    -- 'new_news' | 'new_job' | 'new_signal' | 'new_implementation'
  event_source_id UUID NOT NULL,               -- ID del registro fuente que genero el evento
  event_data JSONB NOT NULL DEFAULT '{}',      -- Datos pre-computados para el template del email
  status TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'sent' | 'skipped'
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,

  -- Deduplicacion: un usuario no puede tener dos notificaciones del mismo evento
  UNIQUE(user_id, event_source_id, event_type)
);

CREATE INDEX idx_notif_queue_pending ON notification_queue(status, created_at)
  WHERE status = 'pending';
CREATE INDEX idx_notif_queue_user ON notification_queue(user_id, status);

-- Preferencias de notificacion por usuario
CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  notify_new_jobs BOOLEAN NOT NULL DEFAULT true,
  notify_new_news BOOLEAN NOT NULL DEFAULT true,
  notify_new_implementations BOOLEAN NOT NULL DEFAULT true,
  notify_new_signals BOOLEAN NOT NULL DEFAULT true,
  timezone TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  last_digest_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own notifications" ON notification_queue
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own preferences" ON notification_preferences
  FOR ALL USING (auth.uid() = user_id);
```

### Proveedor de Email: Resend + React Email

| Caracteristica | Detalle |
|---------------|---------|
| **Proveedor** | [Resend](https://resend.com) |
| **Plan Free** | 100 emails/dia, 3,000/mes |
| **Plan Pro** | $20/mes, 50,000 emails/mes |
| **Templates** | React Email (JSX/TSX, renderizado server-side) |
| **Integracion** | SDK oficial `resend` para Next.js |
| **Dominio** | Requiere verificar `asci.bigua.lat` con DNS TXT/CNAME |

#### Configuracion de Dominio
Para enviar desde `notificaciones@asci.bigua.lat`:
1. Agregar dominio en Resend Dashboard
2. Configurar registros DNS: `TXT` (SPF), `CNAME` x3 (DKIM), `TXT` (verificacion)
3. Verificar en Resend (~5 min de propagacion)

### CRON Semanal (pg_cron + pg_net)

El digest se envia **una vez por semana los lunes a las 11:00 UTC (8:00 AM Argentina)**:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'weekly-email-digest',
  '0 11 * * 1',           -- minuto 0, hora 11 UTC, cualquier dia del mes, cualquier mes, solo LUNES
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
Logica del endpoint (protegido con service_role_key):

1. Obtener todos los usuarios con notificaciones pendientes:
   SELECT DISTINCT user_id FROM notification_queue WHERE status = 'pending'

2. Para cada usuario:
   a. Verificar preferencias: email_enabled = true
   b. Obtener eventos pendientes:
      SELECT nq.*, b.company_id
      FROM notification_queue nq
      JOIN bookmarks b ON b.id = nq.bookmark_id
      WHERE nq.user_id = :uid AND nq.status = 'pending'
      ORDER BY nq.bookmark_id, nq.event_type, nq.created_at

   c. Filtrar por preferencias de tipo (notify_new_jobs, notify_new_news, etc.)

   d. Agrupar por empresa:
      - "Acme Corp": 3 noticias, 2 posiciones, 1 senal
      - "Globant": 1 implementacion, 5 senales

   e. Si no hay novedades despues de filtrar: skip, no enviar email vacio

   f. Renderizar template React Email

   g. Enviar via Resend:
      await resend.emails.send({
        from: 'ASCI <notificaciones@asci.bigua.lat>',
        to: user.email,
        subject: `${total} novedades en tus cuentas - ASCI Semanal`,
        react: <WeeklyDigestEmail novedades={grouped} />
      })

   h. Marcar eventos como 'sent':
      UPDATE notification_queue SET status = 'sent', sent_at = NOW()
      WHERE user_id = :uid AND status = 'pending'

   i. Actualizar last_digest_sent_at en preferences

3. Loggear: cantidad de usuarios notificados, eventos enviados, errores
```

### Template del Email

```
De: ASCI <notificaciones@asci.bigua.lat>
Asunto: "12 novedades en tus cuentas esta semana - ASCI"

---
[Logo ASCI]

Hola {nombre},

Esta semana hubo actividad en {N} de tus cuentas:

--------------------------------------------------
ACME CORP                              5 novedades
--------------------------------------------------
  Noticias:
    - "Acme cierra ronda Serie B de USD 20M" (hace 3 dias)
    - "Acme expande operaciones a Chile" (hace 5 dias)

  Posiciones abiertas:
    - Senior DevOps Engineer - Buenos Aires
    - Cloud Architect - Remote LATAM

  Senales detectadas:
    - Senal "Kubernetes" en 2 contactos

  [Ver cuenta ->] https://asci.bigua.lat/bookmarks/{id}

--------------------------------------------------
GLOBANT                                3 novedades
--------------------------------------------------
  Implementacion detectada:
    - "Migracion a AWS con Kubernetes"

  Senales detectadas:
    - Senal "Salesforce" en 1 contacto
    - Senal "AWS" en 3 contactos

  [Ver cuenta ->] https://asci.bigua.lat/bookmarks/{id}

---
Gestionar preferencias: https://asci.bigua.lat/settings/notifications
Dejar de recibir: {unsubscribe_link}
```

### Pantalla de Preferencias (`/settings/notifications`)

Dentro del menu de usuario (junto a Perfil y Documentos):

- **Toggle general**: Activar/desactivar digest semanal
- **Tipos de eventos** (checkboxes individuales):
  - Noticias nuevas
  - Busquedas laborales abiertas
  - Implementaciones detectadas
  - Senales en contactos
- **Preview**: "Cada lunes a las 8:00 AM recibiras un resumen con las novedades de tus {N} cuentas bookmarkeadas."

### Capacidad y Costos

| Escenario | Emails/semana | Emails/mes | Plan necesario |
|-----------|--------------|-----------|----------------|
| 20 usuarios | 20 | 80 | Free (limite: 3,000/mes) |
| 50 usuarios | 50 | 200 | Free |
| 200 usuarios | 200 | 800 | Free |
| 500 usuarios | 500 | 2,000 | Free |
| 1,000 usuarios | 1,000 | 4,000 | Pro ($20/mes) |

Al ser semanal (no diario), el plan free de Resend cubre ampliamente hasta 500+ usuarios.

### Seguridad y Compliance

- **Unsubscribe**: Cada email incluye link de unsubscribe funcional (requerido por CAN-SPAM)
- **Rate limiting**: 1 digest por usuario por semana (controlado por CRON + last_digest_sent_at)
- **Datos en email**: Solo titulos y resumenes cortos, nunca datos completos ni PII de contactos
- **Resend API key**: Variable de entorno `RESEND_API_KEY`, nunca expuesta al client
- **Endpoint protegido**: `/api/notifications/send-digest` valida `service_role_key` en el header Authorization
- **RLS**: Ambas tablas protegidas, cada usuario solo ve/edita sus propios datos

### Dependencias

| Dependencia | Estado | Notas |
|-------------|--------|-------|
| Resend (cuenta + dominio) | Por configurar | Requiere DNS de `asci.bigua.lat` |
| pg_cron | Disponible en Supabase | Extension a habilitar |
| pg_net | Disponible en Supabase | Extension a habilitar |
| `bookmarks` | Existe | Join via `company_id` |
| `company_news` | Existe | Trigger AFTER INSERT, filtra por `published_date` |
| `company_implementations` | Existe | Trigger AFTER INSERT |
| `job_postings` | Existe | Trigger AFTER INSERT |
| `signals` | Existe | Trigger AFTER INSERT, incluye `signal_type` y `keyword_matched` |

### Fases de Implementacion

**Fase 1 - Modelo de datos y triggers**
- Crear tablas `notification_queue` y `notification_preferences`
- Implementar los 4 triggers (news con filtro de 30 dias, jobs, signals, implementations)
- RLS policies para ambas tablas
- Seed de preferencias default para usuarios existentes
- Test: insertar datos en las tablas fuente y verificar que se encolan correctamente con deduplicacion

**Fase 2 - Envio de emails con Resend**
- Configurar cuenta Resend + verificar dominio `asci.bigua.lat`
- Instalar `resend` + `@react-email/components`
- Crear template React Email para el digest semanal
- Implementar API Route `/api/notifications/send-digest` con logica de agrupacion
- Habilitar pg_cron + pg_net y programar CRON semanal (lunes 11:00 UTC)
- Test: envio real a cuentas internas

**Fase 3 - UI de preferencias**
- Pantalla `/settings/notifications` con toggles por tipo de evento
- Link desde el email al settings
- Unsubscribe link funcional (one-click disable)
- Integracion con el menu de usuario existente

**Fase 4 - Monitoreo**
- Seccion en dashboard admin: emails enviados esta semana, eventos encolados, errores
- Resend Analytics: open rate, click rate
- Alerta si el CRON falla (revisar pg_cron logs)

### Futuras Extensiones
- **Alertas instantaneas**: Para eventos de alta prioridad (ej: noticia de una cuenta T1), email inmediato ademas del digest
- **Canales alternativos**: Slack webhook, WhatsApp Business API
- **Email de bienvenida**: Al bookmarkear una cuenta, enviar resumen de senales existentes
- **Digest inteligente**: IA que prioriza las novedades mas relevantes basandose en los documentos del vendedor
- **Frecuencia configurable**: Opcion de digest diario para power users

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
2. **Notificaciones por Email (Digest Semanal)** - Retention y engagement: mantiene a ASCI presente sin esfuerzo del usuario
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
