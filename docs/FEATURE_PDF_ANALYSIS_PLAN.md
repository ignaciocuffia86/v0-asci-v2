# Feature: PDF Analysis & Integration with Signals

## Objetivo
Procesar automáticamente PDFs de implementaciones encontradas en búsquedas, detectar señales del diccionario (procesos, productos, vendors) e integrarlas con el sistema de scoring y búsqueda existente.

---

## 1. RESUMEN DE ARQUITECTURA

### Tablas Involucradas
- `company_implementations` (existente) - implementaciones ligadas a bookmarks
- `pdf_analysis_cache` (NUEVA) - cache global de análisis de PDFs por URL+company_id
- `dictionary_processes` - procesos con keywords array
- `dictionary_products` - productos con keywords array + vendor_id
- `dictionary_vendors` - vendors
- `bookmarks` - contiene search_context (JSONB) con filterType y filtersUsed
- `signals` (existente) - índice de todas las señales detectadas

### Características Clave

**Mode de Análisis:** OnDemand (no automático)
- Usuario hace click en "Analizar contenido del PDF"
- Sistema descarga, extrae, analiza y cachea

**Contexto en UI:** Bookmark-aware
- Si el bookmark busca "KYC" y el PDF contiene KYC, resalta ese tag
- Si el PDF contiene señales no relevantes al contexto, muestra badge informativo

**Cache Global:** Compartida entre usuarios
- Usuario A analiza PDF de Banco Hipotecario (PDF sobre KYC) → guardado en cache
- Usuario B crea bookmark sobre "Firma Digital" de Banco Hipotecario
- Si el mismo PDF aparece y ya fue analizado: reutiliza cache, filtra por contexto

**Integración con Scoring:** Boosts en relevancia
- PDFs analizados con señales que matchean la búsqueda = +5 puntos por PDF
- Más señales detectadas = mayor confianza

---

## 2. ESTRUCTURA DE BASE DE DATOS

### Nueva Tabla: `pdf_analysis_cache`

```sql
CREATE TABLE pdf_analysis_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  
  -- Estado del procesamiento
  pdf_status TEXT DEFAULT 'pending' 
    CHECK (pdf_status IN ('pending', 'processing', 'completed', 'failed', 'unavailable')),
  
  -- Metadata del PDF
  pdf_page_count INTEGER,
  pdf_file_size_kb INTEGER,
  
  -- Análisis y resultados
  pdf_analysis TEXT,  -- resumen enriquecido generado por AI (genérico)
  
  -- IDs de señales detectadas (para queries rápidas y scoring)
  detected_process_ids UUID[] DEFAULT '{}',
  detected_product_ids UUID[] DEFAULT '{}',
  detected_vendor_ids UUID[] DEFAULT '{}',
  
  -- Metadata detallada para UI (nombre, matches count)
  detected_signals JSONB DEFAULT '{"processes": [], "products": [], "vendors": []}',
  
  -- Errores
  error_message TEXT,
  
  -- Timestamps
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_company_pdf UNIQUE(company_id, source_url)
);

-- Índices
CREATE INDEX idx_pdf_cache_company_url ON pdf_analysis_cache(company_id, source_url);
CREATE INDEX idx_pdf_cache_status ON pdf_analysis_cache(pdf_status);
CREATE INDEX idx_pdf_cache_process_ids ON pdf_analysis_cache USING GIN(detected_process_ids);
CREATE INDEX idx_pdf_cache_product_ids ON pdf_analysis_cache USING GIN(detected_product_ids);

-- RLS
ALTER TABLE pdf_analysis_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view PDF analysis for their workspace companies"
  ON pdf_analysis_cache FOR SELECT
  USING (
    company_id IN (
      SELECT DISTINCT company_id FROM bookmarks WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert/update PDF analysis"
  ON pdf_analysis_cache FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update PDF analysis"
  ON pdf_analysis_cache FOR UPDATE
  USING (true);
```

### Cambios en `company_implementations`

```sql
-- Agregar referencia a cache (opcional, para queries más rápidas)
ALTER TABLE company_implementations 
ADD COLUMN IF NOT EXISTS pdf_cache_id UUID REFERENCES pdf_analysis_cache(id) ON DELETE SET NULL;

CREATE INDEX idx_company_implementations_pdf_cache 
ON company_implementations(pdf_cache_id);
```

---

## 3. ESTRUCTURA DE DATOS (TypeScript)

```typescript
// lib/types/pdf-analysis.ts

export interface PdfSignalDetection {
  id: string;
  name: string;
  matches: number;
  vendorId?: string; // solo para productos
}

export interface PdfDetectedSignals {
  processes: PdfSignalDetection[];
  products: PdfSignalDetection[];
  vendors: PdfSignalDetection[];
}

export interface PdfAnalysisCache {
  id: string;
  company_id: string;
  source_url: string;
  pdf_status: 'pending' | 'processing' | 'completed' | 'failed' | 'unavailable';
  pdf_page_count: number | null;
  pdf_file_size_kb: number | null;
  pdf_analysis: string | null;
  detected_process_ids: string[];
  detected_product_ids: string[];
  detected_vendor_ids: string[];
  detected_signals: PdfDetectedSignals;
  error_message: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface PDFExtractionResult {
  text: string;
  pageCount: number;
  fileSizeKB: number;
  error?: string;
}
```

---

## 4. PLAN DE IMPLEMENTACIÓN POR PASOS

### PASO 1: Migración de Base de Datos

**Archivo:** `scripts/2025_01_XX_add_pdf_analysis_cache.sql`

- Crear tabla `pdf_analysis_cache` con estructura descrita
- Crear índices e índices GIN
- Configurar RLS policies
- Agregar columna `pdf_cache_id` en `company_implementations`

**Verificación:**
```sql
-- Verificar que tabla existe y tiene datos
SELECT COUNT(*) FROM pdf_analysis_cache;
```

---

### PASO 2: Crear Utilidades de Extracción de PDF

**Archivo:** `lib/pdf/extract-text.ts`

**Responsabilidades:**
- Descargar PDF desde URL con timeout de 30s
- Verificar que es PDF (content-type)
- Usar `pdf-parse` para extraer texto
- Truncar a máximo 100 páginas (aproximado por caracteres)
- Contar páginas totales
- Capturar tamaño del archivo

**Entrada:**
```typescript
export async function extractPDFText(url: string): Promise<PDFExtractionResult>
```

**Salida:**
```typescript
{
  text: string,           // texto extraído
  pageCount: number,      // total de páginas
  fileSizeKB: number,     // tamaño en KB
  error?: string          // si algo falló
}
```

**Dependencias:**
- `npm install pdf-parse`

---

### PASO 3: Crear Detector de Señales

**Archivo:** `lib/pdf/detect-signals.ts`

**Responsabilidades:**
- Cargar desde BD todos los diccionarios (processes, products, vendors)
- Buscar keywords de cada señal en el texto extraído (case-insensitive)
- Usar regex con word boundaries para evitar falsos positivos
- Contar matches por señal
- Retornar arrays de IDs y metadata detallada

**Entrada:**
```typescript
export async function detectSignalsInText(
  text: string,
  supabase: SupabaseClient
): Promise<PdfDetectedSignals>
```

**Salida:**
```typescript
{
  processes: [
    { id: 'uuid-123', name: 'KYC', matches: 5 },
    { id: 'uuid-456', name: 'Onboarding', matches: 3 }
  ],
  products: [
    { id: 'uuid-789', name: 'VU Security', vendorId: 'vendor-1', matches: 2 }
  ],
  vendors: [
    { id: 'vendor-1', name: 'VU', matches: 2 }
  ]
}
```

---

### PASO 4: Crear API de Análisis de PDF

**Archivo:** `app/api/research/analyze-pdf/route.ts`

**Endpoint:** `POST /api/research/analyze-pdf`

**Request:**
```typescript
{
  implementationId: string; // UUID de company_implementations (opcional)
  sourceUrl: string;        // URL del PDF
  companyId: string;        // UUID de company
}
```

**Lógica:**
1. Validar que sourceUrl y companyId existan
2. Verificar si ya existe en `pdf_analysis_cache` con status='completed'
   - Si existe → retornar cache con `cached: true`
3. Si no existe → crear registro con status='processing'
4. Ejecutar extracción de PDF (lib/pdf/extract-text.ts)
   - Si falla → marcar como 'failed' o 'unavailable' y retornar error
5. Ejecutar detección de señales (lib/pdf/detect-signals.ts)
6. Generar análisis con Gemini AI
   - Prompt: resumen ejecutivo con contexto de señales encontradas
   - Máximo 2-3 párrafos
7. Guardar en `pdf_analysis_cache` con status='completed'
8. Si implementationId → actualizar `company_implementations.pdf_cache_id`
9. Retornar análisis

**Response:**
```typescript
{
  cached: boolean;
  analysis: {
    id: string;
    pdf_status: 'completed' | 'failed' | 'unavailable';
    pdf_page_count: number;
    pdf_file_size_kb: number;
    pdf_analysis: string;
    detected_signals: PdfDetectedSignals;
  };
}
```

---

### PASO 5: Actualizar Tipos de Brief Context

**Archivo:** `lib/brief/brief-types.ts`

Agregar tipo `PdfAnalysisCache` si no existe en brief-context types.

---

### PASO 6: Integrar con Brief Context

**Archivo:** `lib/brief/prepare-brief-context.ts`

**Cambios:**
- En la carga de `implementations`, también cargar `pdf_analysis_cache` asociados
- Agregar a `BriefContext` un nuevo campo:
  ```typescript
  pdfAnalyses: PdfAnalysisCache[];
  ```
- Cargar PDFs cuyo `company_id` = bookmark.company_id y que tengan status='completed'

---

### PASO 7: Integrar con Scoring

**Archivo:** `lib/brief/calculate-fit-score.ts`

**Cambios en `calculateBoosterScore()`:**
- Recibir `pdfAnalyses` y `filterSignalIds` como parámetros
- Filtrar PDFs que tengan signal IDs que matcheen con `filterSignalIds`
- Por cada PDF que matchee: +5 puntos
- Agregar razón: "X documentos PDF con Y señales relevantes detectadas"

**Código:**
```typescript
// En calculateBoosterScore
const matchingPdfAnalyses = pdfAnalyses.filter(pdf => {
  if (filterSignalIds.length === 0) return pdf.detected_process_ids.length > 0;
  const allDetectedIds = [...pdf.detected_process_ids, ...pdf.detected_product_ids];
  return filterSignalIds.some(id => allDetectedIds.includes(id));
});

if (matchingPdfAnalyses.length > 0) {
  boosterScore += matchingPdfAnalyses.length * 5;
  const matchCount = matchingPdfAnalyses.reduce((acc, pdf) => 
    acc + pdf.detected_process_ids.length + pdf.detected_product_ids.length, 0);
  
  reasons.push({
    reason: `${matchingPdfAnalyses.length} documentos PDF con ${matchCount} señales relevantes`,
    source: "implementations",
    confidence: "high",
    evidenceCount: matchCount,
  });
}
```

---

### PASO 8: Actualizar API de Implementations

**Archivo:** `app/api/research/implementations/route.ts`

**Cambios:**
- Después de guardar `company_implementations`, verificar si source_url es PDF
- Cargar `pdf_cache` asociado si existe
- Incluir en respuesta el `pdf_cache_id`

---

### PASO 9: Crear Componente de UI para Análisis

**Archivo:** `components/implementations/pdf-analysis-button.tsx`

**Props:**
```typescript
interface PdfAnalysisButtonProps {
  sourceUrl: string;
  companyId: string;
  implementationId?: string;
  onAnalysisComplete: (cache: PdfAnalysisCache) => void;
  isLoading?: boolean;
}
```

**Funcionalidades:**
- Botón "Analizar contenido del PDF"
- Estado de carga con barra de progreso
- Warning si el PDF tiene > 50 páginas (puede demorar)
- Manejo de errores con mensajes claros

---

### PASO 10: Actualizar UI de Implementations Tab

**Archivo:** `app/bookmarks/[id]/_components/implementations-tab.tsx`

**Cambios:**
- Detectar si `source_url` es PDF (termina en `.pdf`)
- Si es PDF y no tiene `pdf_cache_id` → mostrar badge "PDF" + botón "Analizar"
- Si es PDF y tiene `pdf_cache_id`:
  - Si status='completed' → mostrar badges de señales detectadas
    - Filtrar por contexto del bookmark (filterType)
    - Resaltar señales que matchean con la búsqueda actual
  - Si status='unavailable' → mostrar "PDF no disponible, pero aquí está el análisis anterior"
  - Si status='processing' → mostrar loader
- Botón para ver análisis completo (modal/expandible)

---

## 5. INTEGRACIÓN CON SCORING - FLUJO COMPLETO

```
1. Usuario A crea bookmark "KYC" en Banco Hipotecario
   ├─> Busca implementaciones
   ├─> Encuentra PDF sobre transformación digital
   └─> Ve badge "PDF" + botón "Analizar"

2. Usuario A hace click en "Analizar"
   ├─> Sistema descarga PDF (87 páginas)
   ├─> Extrae texto (trunca a 100 páginas max)
   ├─> Detecta señales: [KYC(5 matches), Onboarding(3), Firma Digital(2)]
   ├─> Genera resumen con AI
   ├─> Guarda en pdf_analysis_cache con detected_process_ids=[uuid-kyc, uuid-onboarding, uuid-firma]
   └─> UI muestra: badges [KYC] [Onboarding] [Firma Digital]

3. Usuario B crea bookmark "Firma Digital" en Banco Hipotecario (DESPUÉS)
   ├─> Busca implementaciones
   ├─> Encuentra MISMO PDF en resultados
   ├─> Sistema detecta que está en cache (source_url matchea)
   ├─> Filtra señales por contexto: Firma Digital matchea
   ├─> UI muestra: badges pero RESALTA [Firma Digital]
   └─> Score boost: +5 puntos por tener Firma Digital en PDF

4. Usuario C crea bookmark "API REST" en Banco Hipotecario
   ├─> Busca implementaciones
   ├─> Encuentra MISMO PDF en resultados
   ├─> Sistema detecta que está en cache
   ├─> Filtra señales por contexto: API REST NO matchea
   ├─> UI muestra badge "💡 PDF contiene 3 señales que podrían ser relevantes"
   └─> Score: sin boost porque no matchea con búsqueda
```

---

## 6. TESTING CHECKLIST

### Unit Testing
- [ ] `extractPDFText()` con PDF pequeño (< 10 páginas)
- [ ] `extractPDFText()` con PDF grande (> 100 páginas) → trunca correctamente
- [ ] `extractPDFText()` con URL 404 → retorna error 'unavailable'
- [ ] `extractPDFText()` con timeout > 30s → retorna error 'timeout'
- [ ] `detectSignalsInText()` detecta processes correctamente
- [ ] `detectSignalsInText()` detecta products correctamente
- [ ] `detectSignalsInText()` retorna IDs en arrays

### API Testing
- [ ] POST /api/research/analyze-pdf con sourceUrl válido → crea cache
- [ ] POST /api/research/analyze-pdf con sourceUrl ya en cache → retorna cached
- [ ] POST /api/research/analyze-pdf con sourceUrl inválido → maneja error
- [ ] Verificar que pdf_cache_id se actualiza en company_implementations

### Integration Testing
- [ ] Usuario A analiza PDF → se guarda en cache
- [ ] Usuario B accede al mismo PDF → reutiliza cache (no reanaliza)
- [ ] Scoring boost funciona con PDFs analizados
- [ ] Brief context carga pdf_analyses correctamente

### UI Testing
- [ ] Badge "PDF" aparece solo en source_url que termina en .pdf
- [ ] Botón "Analizar" clickeable y muestra loader
- [ ] Warning de tamaño si PDF > 50 páginas
- [ ] Tags de señales se muestran correctamente
- [ ] Tags se resaltan según contexto del bookmark
- [ ] Mensaje "PDF no disponible" si status='unavailable'

---

## 7. CONSIDERACIONES ESPECIALES

### Límites y Restricciones
- **Máximo de páginas a procesar:** 100 (los PDFs más grandes se truncan)
- **Timeout de descarga:** 30 segundos
- **Máximo tamaño de PDF:** No hay límite técnico, pero warning a usuario si > 50 páginas
- **No re-análisis:** Una vez completado, no se re-analiza el mismo PDF

### Costo de AI
- Gemini 2.0 Flash Exp: ~$0.01-0.05 por análisis (depende del tamaño del prompt)
- Cache global reduce costos: múltiples usuarios reutilizan análisis

### Performance
- Índices GIN en arrays de signal IDs permiten queries rápidas
- Única restricción: descarga de PDF es secuencial (no paralelizable)

---

## 8. MIGRATIONS A EJECUTAR

1. `scripts/2025_01_XX_add_pdf_analysis_cache.sql` - crear tabla, índices, RLS
2. Instalar `pdf-parse`: `npm install pdf-parse` (o agregar a package.json)

---

## 9. ARCHIVOS A CREAR/MODIFICAR

| Paso | Archivo | Acción |
|------|---------|--------|
| 1 | `scripts/2025_01_XX_add_pdf_analysis_cache.sql` | Crear |
| 2 | `lib/pdf/extract-text.ts` | Crear |
| 2 | `lib/types/pdf-analysis.ts` | Crear |
| 3 | `lib/pdf/detect-signals.ts` | Crear |
| 4 | `app/api/research/analyze-pdf/route.ts` | Crear |
| 5 | `lib/brief/brief-types.ts` | Modificar |
| 6 | `lib/brief/prepare-brief-context.ts` | Modificar |
| 7 | `lib/brief/calculate-fit-score.ts` | Modificar |
| 8 | `app/api/research/implementations/route.ts` | Modificar |
| 9 | `components/implementations/pdf-analysis-button.tsx` | Crear |
| 10 | `app/bookmarks/[id]/_components/implementations-tab.tsx` | Modificar |

---

## 10. NOTAS IMPORTANTES

- **User-aware context:** La UI debe considerar el `search_context` del bookmark para filtrar qué tags mostrar
- **Global cache:** El cache es por `company_id + source_url`, no por usuario. Todos los usuarios de una empresa comparten análisis
- **Scoring integration:** PDFs analizados que matchean señales buscadas reciben +5 puntos en score
- **Error handling:** Si PDF no disponible pero está en cache, mostrar análisis cacheado + aviso
- **RLS:** Asegurar que solo usuarios con acceso a bookmarks de la empresa pueden ver PDFs analizados

---

## Timeline Estimado (sin implementar aún)

- Paso 1 (DB): ~30 min
- Paso 2-3 (Utilities): ~1 hora
- Paso 4 (API): ~1.5 horas
- Paso 5-7 (Integration): ~1.5 horas
- Paso 8-10 (UI): ~2 horas
- Testing: ~1.5 horas

**Total:** ~8-9 horas de desarrollo

---

## Próximos Pasos

1. Revisar este documento con el equipo
2. Cuando esté listo, comenzar con Paso 1 (migrations)
3. Seguir pasos en orden (hay dependencias entre ellos)
4. Testing después de cada paso crítico
