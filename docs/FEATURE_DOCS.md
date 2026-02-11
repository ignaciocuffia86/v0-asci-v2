# Feature: Docs - Gestor Documental Inteligente

## Resumen

La seccion "Docs" permite a los usuarios subir documentos comerciales (PDFs, PPTXs, DOCXs) y URLs para que ASCI los analice, extraiga entidades (industrias, tecnologias, procesos) contra los diccionarios de la plataforma, y genere un perfil consolidado de propuesta de valor. Este perfil se usa para enriquecer los briefs y las estrategias de cada bookmark.

---

## Objetivo

1. **Entender que vende/ofrece el usuario** a partir de sus casos de exito, brochures, propuestas comerciales y landing pages.
2. **Taggear automaticamente** con industrias, tecnologias y procesos de los diccionarios existentes (`dictionary_products`, `dictionary_processes`, `companies.industry`).
3. **Enriquecer el brief de cada bookmark** con documentos relevantes rankeados por fit (industria x3, tecnologia x2, proceso x1).
4. **Generar estrategia contextualizada** en la tab de estrategia de cada bookmark usando el perfil consolidado + docs relevantes.

---

## Tablas de Base de Datos

### `user_documents`

Almacena los documentos subidos por cada usuario.

| Columna | Tipo | Descripcion |
|---------|------|-------------|
| `id` | uuid PK | ID unico |
| `user_id` | uuid FK -> auth.users | Owner del documento |
| `title` | text | Nombre del documento |
| `type` | enum: pdf, pptx, docx, url | Tipo de fuente |
| `source_url` | text nullable | URL original (solo para type=url) |
| `storage_path` | text nullable | Path en Supabase Storage (solo para archivos) |
| `file_size` | bigint nullable | Tamano en bytes |
| `status` | enum: uploading, processing, ready, error | Estado de procesamiento |
| `processing_error` | text nullable | Mensaje de error si fallo |
| `extracted_text` | text nullable | Texto plano extraido |
| `ai_summary` | text nullable | Resumen generado por Gemini |
| `created_at` | timestamptz | Fecha de creacion |
| `updated_at` | timestamptz | Ultima actualizacion |

**RLS:** Cada usuario solo puede ver/crear/editar/eliminar sus propios documentos.

### `document_tags`

Tags extraidos de cada documento, mapeados contra los diccionarios.

| Columna | Tipo | Descripcion |
|---------|------|-------------|
| `id` | uuid PK | ID unico |
| `document_id` | uuid FK -> user_documents (CASCADE) | Documento asociado |
| `user_id` | uuid FK -> auth.users (CASCADE) | Owner |
| `tag_type` | enum: industry, technology, process | Tipo de tag |
| `tag_value` | text | Nombre legible ("AWS", "Seguros") |
| `tag_reference_id` | uuid nullable | FK a dictionary_products.id, dictionary_processes.id, o null para industrias |
| `confidence` | real | 0.0 a 1.0 - confianza de la IA (1.0 = tag manual) |
| `created_at` | timestamptz | Fecha de creacion |

**RLS:** Cada usuario solo puede gestionar tags de sus propios documentos.

### `user_value_profiles`

Perfil consolidado de propuesta de valor, generado a partir de TODOS los documentos del usuario.

| Columna | Tipo | Descripcion |
|---------|------|-------------|
| `id` | uuid PK | ID unico |
| `user_id` | uuid FK -> auth.users (CASCADE, UNIQUE) | Owner (uno por usuario) |
| `profile_summary` | text nullable | Resumen consolidado generado por Gemini |
| `target_industries` | jsonb | Array de industrias target |
| `target_technologies` | jsonb | Array de tecnologias target |
| `target_processes` | jsonb | Array de procesos target |
| `raw_analysis` | jsonb | Analisis completo de Gemini |
| `generated_at` | timestamptz | Cuando se genero/regenero |
| `created_at` | timestamptz | Fecha de creacion |
| `updated_at` | timestamptz | Ultima actualizacion |

**RLS:** Cada usuario solo puede ver/editar su propio perfil.

---

## Supabase Storage

**Bucket:** `user-documents`
- **Publico:** No
- **Limite:** 50MB por archivo
- **MIME types permitidos:** PDF, PPTX, DOCX
- **Path format:** `{user_id}/{document_id}/{sanitized_filename}`
- **RLS policies:** Upload, view y delete limitados a archivos dentro de la carpeta del usuario (`storage.foldername(name)[1] = auth.uid()`)

**Nota sobre filenames:** Los nombres de archivo se sanitizan antes del upload: se remueven acentos, se reemplazan espacios y caracteres especiales con `_`.

---

## SQL Migrations

| Script | Descripcion |
|--------|-------------|
| `scripts/110_user_documents.sql` | Crea enums, tablas user_documents/document_tags/user_value_profiles, bucket de Storage y todas las RLS policies |
| `scripts/111_distinct_industries_rpc.sql` | Funcion RPC `get_distinct_industries()` que retorna industrias unicas de companies |

---

## Dependencias Nuevas

| Paquete | Version | Uso |
|---------|---------|-----|
| `pdf-parse` | ^1.1.1 | Extraccion de texto de PDFs |
| `mammoth` | ^1.8.0 | Conversion de DOCX a texto plano |
| `cheerio` | ^1.0.0 | Parsing de HTML para scraping de URLs |

**PPTX:** Se procesa enviando el binario a Gemini como adjunto multimodal (no requiere libreria adicional).

---

## Arquitectura de Archivos

### Pagina y Componentes UI

```
app/docs/
  page.tsx                              # Pagina principal - lista docs, perfil de valor, boton agregar
  _components/
    upload-dialog.tsx                   # Modal con tabs Archivo/URL, drag & drop, validacion de duplicados
    document-card.tsx                   # Card de cada documento (tipo, titulo, status, cantidad de tags)
    document-detail-dialog.tsx          # Modal detalle: resumen, tags, reprocesar, eliminar
    value-profile-card.tsx              # Card del perfil consolidado de propuesta de valor
```

### Backend - Server Actions

```
app/actions/documents.ts                # CRUD de documentos, tags y value profile
                                        # Incluye: getUserDocuments, getDocumentWithTags, createDocument
                                        #          deleteDocument, addDocumentTag, removeDocumentTag
                                        #          getUserValueProfile, getUserTags
                                        # Validacion de duplicados en createDocument (titulo+tipo y source_url)
```

### Backend - API Routes

```
app/api/documents/
  process/route.ts                      # POST - Procesa un documento: extrae texto, analiza con Gemini, guarda tags
  generate-profile/route.ts             # POST - Regenera el perfil consolidado de propuesta de valor
  context-for-bookmark/route.ts         # GET  - Retorna value profile + docs rankeados para un bookmark
```

### Libreria de Procesamiento

```
lib/documents/
  extract-text.ts                       # Extraccion de texto segun tipo:
                                        #   - PDF: pdf-parse
                                        #   - DOCX: mammoth
                                        #   - PPTX: Gemini multimodal (binario)
                                        #   - URL: fetch + cheerio (con fallback a Gemini para SPAs)
  analyze-document.ts                   # Analisis con Gemini:
                                        #   - Genera resumen del documento
                                        #   - Extrae tags de industria, tecnologia, proceso
                                        #   - Matchea contra dictionary_products, dictionary_processes, companies.industry
                                        #   - Solo guarda tags con match confirmado en diccionarios
  generate-value-profile.ts             # Consolida tags de TODOS los docs del usuario
                                        #   - Genera profile_summary con Gemini
                                        #   - Upsert en user_value_profiles
  rank-documents-for-bookmark.ts        # Rankea documentos por relevancia para un bookmark:
                                        #   - Industria match: x3 peso
                                        #   - Tecnologia match: x2 peso
                                        #   - Proceso match: x1 peso
                                        #   - Retorna top 3 documentos
```

### Archivos Modificados (existentes)

```
components/main-sidebar.tsx             # Agregado link "Docs" con icono FileText
lib/brief/brief-types.ts               # Extendido BriefContext con valueProfile y relevantDocs
lib/brief/prepare-brief-context.ts      # Fetchea user_value_profiles y rankea docs para el brief
lib/brief/generate-brief-prompt.ts      # Prompt enriquecido con perfil de valor + docs relevantes
                                        # Instruccion especial para icebreaker basado en doc con mayor fit
app/bookmarks/[id]/_components/
  strategy-tab.tsx                      # Card "ASCI Docs" con docs relevantes + boton "Generar con ASCI Docs"
                                        # Convive con la estrategia manual existente
```

### Archivos Eliminados

```
app/bookmarks/[id]/_components/
  success-cases-tab.tsx                 # Eliminado (no estaba en uso, reemplazado por Docs)
```

---

## Pipeline de Procesamiento

```
Archivo / URL
    |
    v
[1] Upload
    - Archivos: client-side upload a Supabase Storage (bucket: user-documents)
    - URLs: solo se guarda la source_url en DB
    - Validacion de duplicados por titulo+tipo (archivos) o source_url (URLs)
    - Se crea registro en user_documents con status "processing"
    |
    v
[2] Extraccion de texto (POST /api/documents/process)
    - PDF:  pdf-parse extrae texto plano
    - DOCX: mammoth convierte a texto plano
    - PPTX: Gemini recibe el binario como adjunto multimodal
    - URL:  fetch + cheerio (extrae body completo + meta tags + alt texts)
            Si el texto es < 100 chars (SPA), fallback a Gemini con HTML raw
    |
    v
[3] Analisis con Gemini (analyzeDocumentContent)
    - Modelo: gemini-2.0-flash, temperature 0.1
    - Input: texto extraido (max 30k chars) + diccionarios de tech/procesos/industrias
    - Output JSON: summary + arrays de industries/technologies/processes
    - Matching estricto: solo guarda tags con match exacto en diccionarios
    - Gemini busca relaciones (ej: "Bedrock" -> "AWS" si AWS esta en el diccionario)
    - Deduplica por ID para no repetir el mismo producto/proceso
    |
    v
[4] Actualizar perfil de valor (POST /api/documents/generate-profile)
    - Consolida tags de TODOS los docs del usuario (agrupados por tipo)
    - Gemini genera un profile_summary coherente
    - Upsert en user_value_profiles
    |
    v
[5] Integracion con Briefs (automatico al generar brief)
    - prepare-brief-context.ts lee user_value_profiles
    - rank-documents-for-bookmark.ts selecciona top 3 docs por fit
    - generate-brief-prompt.ts incluye perfil + docs + instruccion de fit en el prompt
    - El icebreaker referencia el documento con mayor fit
```

---

## Integracion con Strategy Tab

La tab de estrategia de cada bookmark tiene dos modos que conviven:

1. **ASCI Docs (automatico):** Si el usuario tiene documentos procesados, se muestra una card con:
   - Documentos con FIT para la cuenta (badges de tags matched)
   - Boton "Generar Propuesta con ASCI Docs" que pre-llena el textarea con el perfil + docs relevantes
   - Si no hay docs, se muestra un link a `/docs` invitando a subir

2. **Estrategia manual (existente):** Textarea para escribir la propuesta de valor manualmente, con opcion de guardar como predeterminada. No se modifico el comportamiento existente.

---

## Integracion con el Brief

Cuando se genera un brief para un bookmark:

- `prepare-brief-context.ts` agrega `valueProfile` y `relevantDocs` al `BriefContext`
- `generate-brief-prompt.ts` inyecta en el prompt:
  - Perfil de propuesta de valor (industrias, tecnologias, procesos target)
  - Hasta 3 documentos relevantes con su resumen, tags matched y contenido (max 1500 chars c/u)
  - Instruccion especial: "Usa estos documentos para explicar el FIT. En el icebreaker, referencia el documento mas relevante."
- La estrategia manual sigue funcionando como antes (prioridad menor que Docs si ambos estan)

---

## Validaciones

- **Duplicados de archivos:** Se valida por `titulo + tipo` en la DB antes de crear. Si ya existe, retorna error con el nombre del documento existente.
- **Duplicados de URLs:** Se valida por `source_url` exacta en la DB antes de crear.
- **Sanitizacion de filenames:** Se remueven acentos, espacios y caracteres especiales antes de subir a Storage.
- **Tipos permitidos:** Solo PDF, PPTX, DOCX (archivos) y URLs. Validado en frontend (react-dropzone) y backend (bucket MIME types).
- **Tamano maximo:** 50MB por archivo (validado en frontend y en bucket config).

---

## Fase 2 (Pendiente)

- Recomendaciones proactivas en dashboard (tab "Recomendaciones ASCI")
- Embeddings / busqueda semantica con pgvector
- Procesamiento batch de multiples URLs
- Notificacion de nuevas empresas que matchean con el perfil
