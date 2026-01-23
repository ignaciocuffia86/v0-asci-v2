# Plan de Implementación: Documentos del Vendedor y Contexto Enriquecido

> **Fecha de creación**: 21 de enero 2026
> **Estado**: Planificación
> **Prioridad**: Alta

---

## 1. Objetivo

Permitir a los vendedores subir documentos propios (PDFs, brochures, presentaciones) y links web que enriquezcan la estrategia de cuenta, mejorando significativamente:

- **Brief Ejecutivo**: Con casos de éxito y servicios relevantes para cada cuenta
- **Icebreakers**: Personalizados con propuesta de valor específica
- **Recomendaciones futuras**: Matching de cuentas similares a éxitos pasados

---

## 2. Alcance Definido

| Parámetro | Valor |
|-----------|-------|
| Documentos por usuario | Máximo 15 |
| Links web por usuario | Máximo 10 |
| Tipos de archivo | PDF, DOCX, PPTX |
| Privacidad | Documentos privados por usuario |
| Scraping web | Páginas estáticas (no JS rendering) |

---

## 3. Arquitectura Propuesta

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FLUJO DE DATOS                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │   SOURCES    │    │  PROCESSING  │    │   STORAGE    │               │
│  └──────────────┘    └──────────────┘    └──────────────┘               │
│                                                                          │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                │
│  │ PDF Upload  │────▶│ PDF Parser  │────▶│ Vercel Blob │                │
│  │ DOCX, PPTX  │     │ (mammoth,   │     │ (archivo)   │                │
│  │             │     │  pptx-parse)│     │             │                │
│  └─────────────┘     └─────────────┘     └─────────────┘                │
│         │                   │                   │                        │
│         │                   ▼                   │                        │
│  ┌─────────────┐     ┌─────────────┐           │                        │
│  │ Web Links   │────▶│ Web Scraper │           │                        │
│  │ (servicios) │     │ (cheerio)   │           │                        │
│  └─────────────┘     └─────────────┘           │                        │
│         │                   │                   │                        │
│         │                   ▼                   │                        │
│         │            ┌─────────────┐           │                        │
│         └───────────▶│ Text Chunks │◀──────────┘                        │
│                      │ (~500 tokens)│                                    │
│                      └─────────────┘                                     │
│                             │                                            │
│                             ▼                                            │
│                      ┌─────────────┐     ┌─────────────┐                │
│                      │ Embeddings  │────▶│   Supabase  │                │
│                      │ (OpenAI)    │     │  pgvector   │                │
│                      └─────────────┘     └─────────────┘                │
│                                                 │                        │
│                                                 ▼                        │
│                                          ┌─────────────┐                │
│                                          │  Semantic   │                │
│                                          │   Search    │                │
│                                          └─────────────┘                │
│                                                 │                        │
│                                                 ▼                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    GENERACIÓN ENRIQUECIDA                        │   │
│  │  - Brief Ejecutivo con casos relevantes                          │   │
│  │  - Icebreakers con propuesta de valor específica                 │   │
│  │  - Recomendación de cuentas similares (futuro)                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Nuevas Tablas Requeridas

### 4.1 `seller_documents` - Documentos del vendedor

```sql
CREATE TABLE seller_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  
  -- Metadata
  title TEXT NOT NULL,
  description TEXT,
  document_type TEXT NOT NULL, -- 'brochure', 'case_study', 'presentation', 'proposal', 'other'
  
  -- Storage
  blob_url TEXT NOT NULL,           -- URL en Vercel Blob
  original_filename TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  
  -- Processing status
  processing_status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  extracted_text TEXT,              -- Texto extraído del documento
  chunk_count INTEGER DEFAULT 0,
  
  -- Categorization (generada por IA)
  industries TEXT[],                -- Industrias aplicables
  technologies TEXT[],              -- Tecnologías mencionadas
  services TEXT[],                  -- Servicios ofrecidos
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE seller_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own documents" ON seller_documents
  FOR ALL USING (auth.uid() = user_id);

-- Índices
CREATE INDEX idx_seller_documents_user ON seller_documents(user_id);
CREATE INDEX idx_seller_documents_status ON seller_documents(processing_status);
```

### 4.2 `seller_document_chunks` - Chunks para embeddings

```sql
-- Requiere: CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE seller_document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES seller_documents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  
  -- Content
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  
  -- Vector embedding (OpenAI text-embedding-3-small = 1536 dimensiones)
  embedding VECTOR(1536),
  
  -- Metadata for filtering
  section_title TEXT,
  content_type TEXT,                -- 'service', 'case', 'benefit', 'tech', 'general'
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE seller_document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chunks" ON seller_document_chunks
  FOR SELECT USING (auth.uid() = user_id);

-- Índice para búsqueda vectorial
CREATE INDEX idx_seller_chunks_embedding 
ON seller_document_chunks 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

CREATE INDEX idx_seller_chunks_user ON seller_document_chunks(user_id);
CREATE INDEX idx_seller_chunks_document ON seller_document_chunks(document_id);
```

### 4.3 `seller_web_content` - Contenido de URLs

```sql
CREATE TABLE seller_web_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  
  -- URL info
  url TEXT NOT NULL,
  page_title TEXT,
  
  -- Content
  extracted_text TEXT,
  summary TEXT,                     -- Resumen generado por IA
  
  -- Processing
  processing_status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  chunk_count INTEGER DEFAULT 0,
  last_scraped_at TIMESTAMPTZ,
  error_message TEXT,
  
  -- Categorization
  content_categories TEXT[],
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE seller_web_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own web content" ON seller_web_content
  FOR ALL USING (auth.uid() = user_id);

-- Índices
CREATE INDEX idx_seller_web_user ON seller_web_content(user_id);
```

### 4.4 RPC para búsqueda semántica

```sql
CREATE OR REPLACE FUNCTION search_seller_documents(
  p_user_id UUID,
  p_query_embedding VECTOR(1536),
  p_match_threshold FLOAT DEFAULT 0.7,
  p_match_count INT DEFAULT 5
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  document_title TEXT,
  chunk_text TEXT,
  content_type TEXT,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as chunk_id,
    c.document_id,
    d.title as document_title,
    c.chunk_text,
    c.content_type,
    1 - (c.embedding <=> p_query_embedding) as similarity
  FROM seller_document_chunks c
  JOIN seller_documents d ON d.id = c.document_id
  WHERE c.user_id = p_user_id
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> p_query_embedding) > p_match_threshold
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$ LANGUAGE plpgsql;
```

---

## 5. Estimación de Costos

### 5.1 Almacenamiento (Vercel Blob)

| Concepto | Cantidad | Costo/mes |
|----------|----------|-----------|
| Storage | 5GB (estimado) | $0.25/GB = **$1.25** |
| Operaciones PUT | 500/mes | $0.004/1000 = **~$0** |
| Operaciones GET | 5000/mes | $0.0004/1000 = **~$0** |

**Total Blob: ~$2-5/mes**

### 5.2 Embeddings (OpenAI)

| Modelo | Precio | Tokens estimados/mes | Costo |
|--------|--------|---------------------|-------|
| text-embedding-3-small | $0.00002/1K tokens | 500K tokens | **$10** |

**Recomendación: text-embedding-3-small** (suficiente calidad, bajo costo)

### 5.3 Generación de texto (para resúmenes y categorización)

| Modelo | Precio | Tokens estimados/mes | Costo |
|--------|--------|---------------------|-------|
| Gemini 1.5 Flash | $0.075/$0.30 per 1M | 200K input + 50K output | **$2** |

**Ya integrado vía AI Gateway**

### 5.4 Supabase (pgvector)

| Concepto | Costo |
|----------|-------|
| pgvector extension | **Incluido** en plan actual |
| Storage adicional | Minimal (~100MB vectors) |

### 5.5 **Costo Total Estimado**

| Componente | Costo/mes |
|------------|-----------|
| Vercel Blob | $2-5 |
| Embeddings (OpenAI) | $10 |
| Generación (Gemini) | $2-4 |
| Supabase | $0 (incluido) |
| **TOTAL** | **$15-20/mes** |

*Para 10 usuarios activos, ~50 documentos, ~500 búsquedas semánticas*

---

## 6. Dependencias Técnicas

### 6.1 Nuevos Paquetes NPM

```json
{
  "pdf-parse": "^1.1.1",           // Extracción de texto de PDFs
  "mammoth": "^1.6.0",             // Extracción de texto de DOCX
  "officeparser": "^4.0.0",        // Extracción de PPTX (alternativa)
  "cheerio": "^1.0.0-rc.12"        // Scraping de páginas web
}
```

### 6.2 Extensiones Supabase

```sql
-- Ya disponible, solo necesita habilitarse
CREATE EXTENSION IF NOT EXISTS vector;
```

### 6.3 Variables de Entorno

```env
# Ya existen
BLOB_READ_WRITE_TOKEN=xxx
GOOGLE_GENERATIVE_AI_API_KEY=xxx

# Nueva (para embeddings)
OPENAI_API_KEY=xxx
```

---

## 7. Flujos de Procesamiento

### 7.1 Subida de Documento

```
1. Usuario sube PDF/DOCX/PPTX (max 15 docs)
2. Validar tipo y tamaño (max 10MB)
3. Guardar archivo en Vercel Blob
4. Crear registro en seller_documents (status: pending)
5. Job async:
   a. Extraer texto según tipo de archivo
   b. Dividir en chunks (~500 tokens c/u)
   c. Generar embeddings para cada chunk (OpenAI)
   d. Guardar chunks en seller_document_chunks
   e. IA categoriza documento (industrias, servicios, tecnologías)
   f. Actualizar status a 'completed'
```

### 7.2 Agregar URL

```
1. Usuario agrega URL (max 10 links)
2. Validar URL accesible
3. Crear registro en seller_web_content (status: pending)
4. Job async:
   a. Fetch página con timeout
   b. Cheerio extrae contenido principal (remove nav, footer, ads)
   c. Generar chunks y embeddings
   d. IA genera resumen del contenido
   e. Actualizar status a 'completed'
```

### 7.3 Generación de Brief Enriquecido

```
1. Usuario genera brief para cuenta X
2. Sistema obtiene contexto actual:
   - Señales de la cuenta
   - Noticias de la empresa
   - Implementaciones detectadas
3. Crear query de búsqueda: 
   "servicios relevantes para industria [X] con tecnologías [Y]"
4. Generar embedding del query
5. Búsqueda semántica en seller_document_chunks
6. Top 5 chunks más relevantes se agregan al prompt
7. IA genera brief con casos de éxito relevantes
```

### 7.4 Recomendación de Cuentas (Fase Futura)

```
1. Sistema analiza nueva cuenta (industria, señales, tamaño)
2. Genera embedding del perfil de la cuenta
3. Busca similaridad con casos de éxito documentados
4. Recomienda: "Esta cuenta es similar a [Cliente X] 
   donde tuviste éxito con [Servicio Y]"
```

---

## 8. Casos de Uso Específicos

### 8.1 Mejorar Icebreaker

**Antes (genérico):**
> "Soy consultor de tecnología y me gustaría conversar sobre sus necesidades de transformación digital."

**Después (con contexto enriquecido):**
> "Vi que en ICBC están buscando perfiles con experiencia en SAP S/4HANA. Trabajé con Banco Galicia en una migración similar que redujo un 40% los tiempos de cierre contable. ¿Tienen algún proyecto de modernización de core bancario en agenda?"

### 8.2 Brief con Casos Relevantes

El brief ahora incluiría automáticamente:

```markdown
## CASOS DE ÉXITO RELEVANTES

Basado en que ICBC es del sector **Banca/Finanzas** y estás 
buscando oportunidades en **SAP S/4HANA**:

### Caso: Migración SAP en Banco Galicia
- **Desafío:** Sistemas legacy fragmentados
- **Solución:** Migración a S/4HANA con Fiori
- **Resultados:** -40% tiempo de cierre, -60% errores manuales
- **Relevancia:** Mismo sector, misma tecnología buscada

### Servicios Aplicables (de tu brochure)
- Consultoría SAP S/4HANA
- Integración de sistemas financieros
- Change Management
```

### 8.3 Recomendación Proactiva (Futuro)

```
🎯 Nueva recomendación para tu pipeline:

Detectamos que **Banco Macro** tiene señales similares a 
**Banco Galicia** donde documentaste éxito:
- Ambos buscan perfiles SAP S/4HANA
- Mismo tamaño (Enterprise)
- Misma industria (Banca)

¿Quieres agregarlo a tus cuentas?
```

---

## 9. UI Propuesta

### 9.1 Nueva Sección en Perfil de Cuenta

En la página `/bookmarks/[id]`, agregar tab "Mis Documentos" o integrar en "Estrategia":

```
┌─────────────────────────────────────────────────────┐
│ ESTRATEGIA DE CUENTA                                │
├─────────────────────────────────────────────────────┤
│                                                     │
│ [Tab: Propuesta de Valor] [Tab: Mis Documentos]     │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Documentos Relevantes para esta cuenta          │ │
│ │                                                 │ │
│ │ 📄 Caso de Éxito - Banco Galicia (92% match)   │ │
│ │    "Migración SAP S/4HANA con reducción..."    │ │
│ │                                                 │ │
│ │ 📄 Brochure Servicios Financieros (87% match)  │ │
│ │    "Soluciones de transformación digital..."   │ │
│ │                                                 │ │
│ │ [+ Agregar documento]                          │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Links de Servicios                              │ │
│ │                                                 │ │
│ │ 🔗 /servicios/sap-consulting (85% match)       │ │
│ │ 🔗 /casos/banca-digital (78% match)            │ │
│ │                                                 │ │
│ │ [+ Agregar link]                               │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 9.2 Página de Gestión de Documentos

Nueva página `/settings/documents` o `/my-content`:

```
┌─────────────────────────────────────────────────────┐
│ MIS DOCUMENTOS Y CONTENIDO                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Documentos (3/15)                    [+ Subir]      │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 📄 Caso Exito - Banco Galicia.pdf              │ │
│ │    Tipo: Caso de Éxito | 2.3 MB | ✅ Procesado │ │
│ │    Industrias: Banca, Finanzas                 │ │
│ │    Tecnologías: SAP, S/4HANA                   │ │
│ │    [Ver] [Eliminar]                            │ │
│ ├─────────────────────────────────────────────────┤ │
│ │ 📄 Brochure Servicios 2025.pptx                │ │
│ │    Tipo: Brochure | 5.1 MB | ⏳ Procesando...  │ │
│ │    [Ver] [Eliminar]                            │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Links Web (2/10)                     [+ Agregar]    │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 🔗 miempresa.com/servicios/sap                 │ │
│ │    ✅ Procesado | Última actualización: 3 días │ │
│ │    [Actualizar] [Eliminar]                     │ │
│ ├─────────────────────────────────────────────────┤ │
│ │ 🔗 miempresa.com/casos-exito                   │ │
│ │    ✅ Procesado | Última actualización: 1 sem  │ │
│ │    [Actualizar] [Eliminar]                     │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## 10. Plan de Implementación por Fases

### Fase 1: Fundamentos (2-3 días)
- [ ] Habilitar pgvector en Supabase
- [ ] Crear tablas nuevas con RLS
- [ ] Crear API route para subir documentos a Vercel Blob
- [ ] UI básica para subir documentos
- [ ] Extracción básica de texto de PDFs

### Fase 2: Embeddings y Búsqueda (2-3 días)
- [ ] Integración con OpenAI embeddings API
- [ ] Implementar chunking inteligente de documentos
- [ ] Almacenamiento de embeddings en pgvector
- [ ] RPC de búsqueda semántica
- [ ] Agregar soporte para DOCX y PPTX

### Fase 3: Enriquecimiento de Brief (2-3 días)
- [ ] Modificar `prepare-brief-context.ts` para incluir docs relevantes
- [ ] Actualizar prompts del brief e icebreaker
- [ ] UI para ver documentos relevantes por cuenta
- [ ] Mostrar % de match/relevancia

### Fase 4: Web Scraping (1-2 días)
- [ ] UI para agregar URLs de servicios
- [ ] Implementar scraping con Cheerio
- [ ] Procesamiento y embeddings de contenido web
- [ ] Manejo de errores y reintentos

### Fase 5: Recomendaciones (Futuro)
- [ ] Matching de cuentas por similaridad de perfil
- [ ] Notificaciones de cuentas recomendadas
- [ ] Dashboard de insights por documentos

**Tiempo total estimado: 8-12 días de desarrollo**

---

## 11. Archivos a Crear/Modificar

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `scripts/110_seller_documents.sql` | Crear | Tablas, RLS, índices, RPCs |
| `lib/documents/extract-text.ts` | Crear | Extracción de texto PDF/DOCX/PPTX |
| `lib/documents/chunking.ts` | Crear | División en chunks |
| `lib/documents/embeddings.ts` | Crear | Generación de embeddings |
| `lib/documents/semantic-search.ts` | Crear | Búsqueda semántica |
| `app/api/documents/upload/route.ts` | Crear | Upload a Vercel Blob |
| `app/api/documents/process/route.ts` | Crear | Procesamiento async |
| `app/settings/documents/page.tsx` | Crear | UI gestión de documentos |
| `lib/brief/prepare-brief-context.ts` | Modificar | Incluir docs relevantes |
| `lib/brief/generate-brief-prompt.ts` | Modificar | Prompt con casos de éxito |

---

## 12. Checklist Pre-Implementación

- [x] Definir límite de documentos (15) y links (10)
- [x] Definir tipos de archivo soportados (PDF, DOCX, PPTX)
- [x] Definir privacidad (documentos privados por usuario)
- [x] Definir prioridad (documentos primero, luego URLs)
- [ ] Configurar OPENAI_API_KEY en Vercel
- [ ] Habilitar pgvector en Supabase
- [ ] Estimar uso de tokens para pricing final

---

## 13. Queries Útiles para Testing

```sql
-- Verificar documentos por usuario
SELECT user_id, COUNT(*) as doc_count, 
       SUM(chunk_count) as total_chunks
FROM seller_documents
WHERE processing_status = 'completed'
GROUP BY user_id;

-- Ver chunks con embeddings
SELECT d.title, c.chunk_index, 
       LEFT(c.chunk_text, 100) as preview,
       c.content_type
FROM seller_document_chunks c
JOIN seller_documents d ON d.id = c.document_id
WHERE c.embedding IS NOT NULL
ORDER BY d.title, c.chunk_index;

-- Test búsqueda semántica (requiere embedding del query)
SELECT * FROM search_seller_documents(
  'user-uuid-here',
  '[embedding-vector-here]'::vector,
  0.7,
  5
);
```

---

## 14. Consideraciones de Seguridad

1. **RLS estricto**: Usuarios solo ven sus propios documentos
2. **Validación de archivos**: Verificar MIME type real, no solo extensión
3. **Límite de tamaño**: Max 10MB por archivo
4. **Sanitización de URLs**: Validar URLs antes de scraping
5. **Rate limiting**: Limitar procesamiento de documentos por usuario
6. **Limpieza de embeddings**: Borrar chunks cuando se elimina documento

---

## 15. Métricas de Éxito

| Métrica | Objetivo |
|---------|----------|
| Documentos subidos por usuario activo | > 3 |
| % de briefs que usan contexto enriquecido | > 50% |
| Tiempo de procesamiento de documento | < 30 segundos |
| Precisión de matching (relevancia) | > 80% |
| Costo por usuario/mes | < $2 USD |
