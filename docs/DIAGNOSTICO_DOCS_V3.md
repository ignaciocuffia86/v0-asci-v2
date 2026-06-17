# Diagnóstico + Plan — Sección DOCS (v3)

> Ronda de relevamiento. Foco exclusivo en **v3** (`app/v3/docs`).
> Estado: diagnóstico cerrado, plan propuesto pendiente de aprobación.
> Regla rectora: v3 no puede generar ningún cambio que afecte a v2 en producción.

---

## 1. Cómo funciona DOCS v3 hoy

### Flujo actual (carga → mapeo)

1. **UI** (`app/v3/docs/_components/documents-view.tsx`)
   - Sube archivos a **Vercel Blob** (`workspaces/{workspaceId}/...`) o registra una URL.
   - Crea fila en `v3.workspace_documents` con `status = 'processing'`.
   - Dispara `POST /api/v3/documents/process`.

2. **Extracción de texto** (`lib/documents/extract-text.ts`, compartido con v2)
   - PDF → `pdf-parse` con fallback visual a Gemini.
   - DOCX → `mammoth`.
   - PPTX → unzip + parseo de XML.
   - **URL → `fetch` server-side + `cheerio`**, con fallback a Gemini para SPAs.

3. **Análisis / mapeo** (`analyzeDocumentV3` en `lib/v3/ai.ts`)
   - Llama a AI Gateway (Gemini 2.5 flash-lite).
   - Mapea contra los **diccionarios de v2**:
     - `public.dictionary_products` (tecnología)
     - `public.dictionary_processes` (procesos)
     - Industrias de `public.companies`
   - Solo persiste tags con match exacto.

4. **Persistencia**
   - Tags → `v3.workspace_document_tags`.
   - Consolidación → `v3.workspace_value_profiles` (industrias / tecnologías / procesos como **arrays de strings**).

### Diagrama lógico

```
Upload (Blob) ──> workspace_documents (status: processing)
      │
      └─> /api/v3/documents/process
              ├─ extractText()  (pdf/docx/pptx/url)
              ├─ analyzeDocumentV3()  ──> tags (match exacto vs diccionarios v2)
              │        └─> workspace_document_tags
              └─> workspace_value_profiles (consolidado strings)
```

---

## 2. Hallazgos

### H1 — No existe generación de buyer/user persona (es feature NUEVA)
- La tabla **`v3.buyer_personas` existe** en el schema (`300_v3_schema_setup.sql`) pero **ningún código escribe en ella**. No hay un solo `insert` a `buyer_personas`.
- Solo se **lee** en `lib/v3/digest.ts`.
- Conclusión: lo que pediste ("guardar referencia de buyer/user persona por doc para luego recomendar cargos") **no está roto: no existe**. Hay que construirlo.

### H2 — La recomendación de cargos está desconectada (bug)
- `getRecommendedJobTitles` (`lib/v3/digest.ts`, ~líneas 265–275) lee `valueProfile.target_processes` esperando objetos `{ id }`, pero el value profile guarda **strings** (nombres).
- Resultado: `processIds` / `technologyIds` quedan **siempre vacíos** → siempre cae a `getDefaultJobTitles()` (lista hardcodeada: CTO / VP Eng / etc.).
- La recomendación "real" por proceso/tecnología **nunca se dispara**.
- `v3.dictionary_job_titles` se seedea por nombre de proceso (ILIKE) y no se conecta con los tags reales del documento.

### H3 — Scraping de LinkedIn: confirmado por qué falla
- `extractTextFromUrl` hace `fetch` server-side (User-Agent de browser) + cheerio, con fallback a Gemini sobre el HTML.
- Para una URL pública de LinkedIn de empresa, LinkedIn responde hoy con un **muro de login / página vacía** a peticiones de servidor sin sesión.
- El fallback a Gemini recibe el HTML del login wall → no hay contenido real para analizar.
- **No es un bug introducido**: LinkedIn endureció el bloqueo a scraping no autenticado. El método (`fetch` directo) ya no es viable contra LinkedIn.
- Para recuperarlo se necesita otro método: API / proveedor de scraping (Apollo, Parallel, Bright Data) o un servicio con sesión autenticada.
- Nota: en `lib/parallel.ts`, LinkedIn está **explícitamente excluido** (`exclude_domains: ["linkedin.com", ...]`).

### H4 — Inconsistencia de storage (Blob vs Supabase Storage)
- La **subida real es a Vercel Blob**.
- Pero `deleteWorkspaceDocument` y `getDocumentPreviewUrl` (`app/actions/v3/documents.ts`) usan **Supabase Storage** (bucket `workspace-documents`).
- Consecuencias:
  - Borrar un documento **no borra el blob** (huérfanos en Blob).
  - El preview firmado apunta a un bucket que **no se usa**.

### H5 — Procesamiento síncrono dentro del request HTTP
- Extracción + Gemini corren dentro del request de `/api/v3/documents/process`.
- PDFs grandes con fallback visual pueden acercarse al **timeout** de la función.

### H6 — Dos schemas v3 conviviendo (deuda/confusión)
- `200_v3_schema.sql` (viejo): `filename / file_url / extracted_industries[]`.
- `300_v3_schema_setup.sql` (vigente): `title / storage_path / extracted_text`.
- El código usa el de `300`. El `200` es **obsoleto** y debería marcarse/eliminarse para evitar confusión.

---

## 3. Decisiones tomadas (esta ronda)

| Tema | Decisión |
|------|----------|
| Granularidad de persona | **Las dos**: inferencia **por documento** + **consolidada por workspace** |
| Recomendación de cargos | **IA infiere cargos directamente del texto del documento** |
| Scraping LinkedIn | **Solo diagnosticar por ahora** (no se implementa fix en esta ronda) |
| Entregable de la ronda | Este documento de diagnóstico + plan |

---

## 4. Plan propuesto (para próxima ronda — pendiente de aprobación)

> Todo lo siguiente vive en schema `v3` / rutas `v3` / código `v3`. **Cero impacto en v2.**

### Pieza A — Inferencia de persona en el análisis
- Extender `analyzeDocumentV3` (`lib/v3/ai.ts`) para que, además de tags, devuelva:
  - `buyer_personas`: lista de personas inferidas del doc, cada una con:
    - `role_title` (cargo, ej. "CFO", "Head of Supply Chain")
    - `seniority` (ej. C-level / VP / Director / Manager)
    - `department` / `function`
    - `pains` / `priorities` (señales del documento)
    - `evidence` (fragmento o resumen que justifica la inferencia)
    - `confidence` (0–1)
  - Distinguir, cuando aplique, **buyer persona** (decisor de compra) vs **user persona** (usuario final).

### Pieza B — Persistencia por documento + consolidación
- **Por documento**: nueva tabla `v3.document_personas` (FK a `workspace_documents`), 1..N personas por doc.
  - Alternativa: columna JSONB en `workspace_documents`. A decidir en plan de implementación (tabla normalizada es más consultable).
- **Consolidada por workspace**: poblar realmente `v3.buyer_personas` agregando/deduplicando las personas de todos los docs del workspace (merge por `role_title` normalizado, sumando confianza/frecuencia).

### Pieza C — Recomendación de cargos basada en personas
- Reescribir `getRecommendedJobTitles` para alimentarse de las personas consolidadas (cargos inferidos por IA), en lugar del puente roto value-profile→IDs.
- Mantener `dictionary_job_titles` como **fuente de validación/normalización** opcional, no como única fuente.
- Eliminar la dependencia del fallback hardcodeado como camino "por defecto".

### Pieza D — Higiene (opcional, mismo PR o aparte)
- Unificar storage: que `delete` y `preview` usen **Vercel Blob** (coherente con la subida) y borrar blobs al eliminar docs.
- Marcar `200_v3_schema.sql` como obsoleto o eliminarlo.
- Evaluar mover el procesamiento pesado a background (cola / paso async) para evitar timeouts.

### Fuera de alcance de esta ronda
- Fix real del scraping de LinkedIn (queda documentado en H3; se evaluará proveedor en una ronda futura).

---

## 5. Próximo paso sugerido
Revisar este documento. Si estás de acuerdo, en la próxima ronda paso a **plan de implementación** detallado (cambios de schema `v3`, prompt de IA, rutas y UI) para aprobación antes de codear.

> Nota operativa: el push automático al repo falló por permisos de escritura del bot de v0 en `ignaciocuffia86/v0-asci-v2`. Este archivo está escrito localmente en el proyecto; para versionarlo en GitHub hay que darle permiso de escritura al bot (Settings → Git).
