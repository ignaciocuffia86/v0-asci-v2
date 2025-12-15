# Sistema ETL de ASCI v2

> Última actualización: Noviembre 2025

Este documento describe el sistema de Extracción, Transformación y Carga (ETL) de datos en ASCI v2.

---

## Arquitectura General

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   CSV Upload    │────▶│   import_rows   │────▶│   companies     │
│   (Admin UI)    │     │   (staging)     │     │   contacts      │
└─────────────────┘     └─────────────────┘     │   signals       │
                                                 │   job_postings  │
                                                 └─────────────────┘
```

---

## Tablas Principales

### 1. `import_batches`
Registro de cada importación de datos.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | UUID | Identificador único |
| user_id | UUID | Usuario que realizó la importación |
| file_name | TEXT | Nombre del archivo CSV |
| batch_type | TEXT | `contacts` o `job_postings` |
| total_rows | INT | Filas totales en el archivo |
| processed_rows | INT | Filas procesadas exitosamente |
| failed_rows | INT | Filas con errores |
| status | TEXT | `pending`, `processing`, `completed`, `failed` |
| created_at | TIMESTAMP | Fecha de creación |

### 2. `import_rows`
Datos crudos de cada fila del CSV.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | UUID | Identificador único |
| batch_id | UUID | Referencia al batch |
| row_data | JSONB | Datos crudos del CSV en JSON |
| status | TEXT | `pending`, `processed`, `failed` |
| error_message | TEXT | Mensaje de error si falló |
| processed_at | TIMESTAMP | Fecha de procesamiento |

---

## Flujo de Procesamiento

### Paso 1: Upload del CSV
El usuario sube un CSV desde `/admin/ingest`. El sistema:
1. Crea un registro en `import_batches`
2. Parsea cada fila del CSV y la guarda en `import_rows` como JSONB
3. Marca el batch como `pending`

### Paso 2: Procesamiento por CRON
El endpoint `/api/cron/process-queue` ejecuta cada minuto:
1. Busca batches con status `pending` o `processing`
2. Llama a `process_import_batch(batch_id, limit)` para cada uno

### Paso 3: Función `process_import_batch`
Esta función RPC de PostgreSQL es el dispatcher principal:

```sql
-- Determina el tipo de batch y llama a la función interna correcta
IF v_batch_type = 'job_postings' THEN
   v_processed := process_job_batch_internal(p_batch_id, p_limit);
ELSE
   v_processed := process_contact_batch_internal(p_batch_id, p_limit);
END IF;
```

---

## Procesamiento de Contactos

### Función: `process_contact_batch_internal`

Para cada fila pendiente:

1. **Upsert Company**: Crea o actualiza la empresa con `upsert_company()`
   - Parámetros: `name`, `linkedin_url`, `website`, `industry`, `country`, `logo_url`, `description`
   - Matching por LinkedIn URL (prioritario) o nombre normalizado

2. **Upsert Contact**: Crea o actualiza el contacto
   - Vincula al `company_id` de la empresa
   - Guarda posiciones anteriores como JSONB

3. **Process Signals**: Detecta señales en el perfil con `process_contact_signals()`
   - Analiza `headline`, `about`, `current_position_description`
   - Busca keywords de `dictionary_products` y `dictionary_processes`

### Campos del CSV de Contactos

| Campo CSV | Destino | Descripción |
|-----------|---------|-------------|
| `linkedin_url` | contacts.linkedin_url | URL del perfil de LinkedIn |
| `first_name` | contacts.first_name | Nombre |
| `last_name` | contacts.last_name | Apellido |
| `full_name` | contacts.full_name | Nombre completo |
| `headline` | contacts.headline | Titular del perfil |
| `about` | contacts.about | Bio del contacto |
| `current_position` | contacts.current_position_title | Cargo actual |
| `company_name` | companies.name | Nombre de la empresa |
| `company_linkedin_url` | companies.linkedin_url | LinkedIn de la empresa |
| `company_website` | companies.website | Sitio web |
| `company_industry` | companies.industry | Industria |
| `company_country` | companies.country | País |
| `company_logo_url` | companies.logo_url | Logo |
| `company_description` | companies.description | Descripción/bio de la empresa |
| `email1..4` | contacts.email1..4 | Emails |
| `phone1..2` | contacts.phone1..2 | Teléfonos |
| `previous_company_1..6` | contacts.previous_positions | Empresas anteriores |
| `previous_position_1..6` | contacts.previous_positions | Cargos anteriores |

---

## Procesamiento de Job Postings

### Función: `process_job_batch_internal`

Para cada fila pendiente:

1. **Upsert Company**: Similar a contactos
2. **Upsert Job Posting**: Crea o actualiza en `job_postings`
3. **Process Job Signals**: Detecta tecnologías en el job description

### Campos del CSV de Job Postings

| Campo CSV | Destino | Descripción |
|-----------|---------|-------------|
| `title` / `job_title` | job_postings.title | Título del puesto |
| `description` / `job_description` | job_postings.description | Descripción completa |
| `jobUrl` / `url` | job_postings.posting_url | URL del aviso |
| `location` / `city` | job_postings.location | Ubicación |
| `salary` | job_postings.salary_range | Rango salarial |
| `postedTime` / `publishedAt` | job_postings.posted_at | Fecha de publicación |
| `company_name` / `companyName` | companies.name | Empresa |

---

## Normalización de Empresas

### Función: `normalize_company_name`

Normaliza nombres para evitar duplicados:

```sql
-- 1. Lowercase y trim
-- 2. Remueve valores basura ('', '-', 'n/a', 'null', etc.)
-- 3. Normaliza espacios múltiples
-- 4. Remueve puntuación final
-- 5. Remueve sufijos corporativos (S.A., Ltd., Inc., LLC, etc.)
```

### Función: `upsert_company`

Estrategia de matching:

1. **Por LinkedIn URL** (más confiable): Si existe, actualiza metadata faltante
2. **Por nombre normalizado**: Si no hay LinkedIn, busca por nombre
3. **Insert nuevo**: Si no encuentra match, crea nueva empresa

---

## Detección de Señales

### Diccionarios

- `dictionary_products`: Tecnologías y productos (AWS, SAP, Salesforce, etc.)
- `dictionary_processes`: Procesos de negocio (DevOps, Transformación Digital, etc.)
- `dictionary_vendors`: Proveedores de software

Cada diccionario tiene `keywords` (array de strings) que se buscan en los textos.

### Función: `process_contact_signals`

```sql
-- Busca keywords en: headline + about + current_position_description
-- Usa regex con word boundaries: '\y' || keyword || '\y'
-- Guarda matches en tabla signals con snippet de contexto
```

---

## Jobs de Procesamiento del Diccionario

### Tabla: `dictionary_jobs`

Cuando se agrega un nuevo keyword al diccionario, se crea un job para:
1. Buscar el keyword en todos los contactos existentes
2. Buscar el keyword en todos los job postings existentes
3. Crear señales para los matches encontrados

### CRON: `/api/cron/process-dictionary`

Ejecuta cada minuto, procesa hasta 20 jobs por ejecución.

---

## Monitoreo

### Tabla: `system_health_logs`

Guarda snapshots del estado del sistema cada 15 minutos.

### CRON: `/api/cron/monitor`

Detecta:
- Jobs estancados (>30 min en processing)
- Jobs fallidos
- Cola muy alta (>500 pendientes)
- Sistema detenido (sin procesamiento en 1h)

Envía alertas por email vía Resend.

---

## Administración

### `/admin/ingest`
- Upload de CSVs
- Selección de tipo de batch
- Vista de batches recientes

### `/admin/processing`
- Estado de jobs del diccionario
- Alertas activas
- Acciones: reintentar fallidos, desbloquear estancados

### `/admin/logs`
- Historial de eventos de debug
- Filtros por batch y tipo de evento

---

## Variables de Entorno Requeridas

| Variable | Descripción |
|----------|-------------|
| `POSTGRES_URL` | Conexión a la base de datos |
| `CRON_SECRET` | Autenticación de endpoints CRON |
| `RESEND_API_KEY` | Para envío de alertas por email |
| `ALERT_EMAIL` | Destinatario de alertas |

---

## Scripts SQL Relevantes

| Script | Descripción |
|--------|-------------|
| `010_ingest_logic_plpgsql.sql` | Primera versión del ETL |
| `026_robust_company_normalization.sql` | Normalización de nombres |
| `043_add_job_postings_etl.sql` | Soporte para job postings |
| `072_dictionary_jobs_and_rpcs.sql` | Jobs del diccionario |
| `085_add_company_description.sql` | Soporte para descripción de empresa |
```

```md file="docs/ETL_PROCESS.md" isDeleted="true"
...deleted...
