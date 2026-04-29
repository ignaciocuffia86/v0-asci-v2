# Feature Plan: Export masivo de bookmarks como ZIP de archivos separados

> **Status**: Diseño aprobado, pendiente de implementación.
> **Contexto**: Este documento solo describe diseño. No incluye código ni ejecuta cambios.
> **Decisiones tomadas**: ZIP sync con buffer en RAM, solo archivos individuales, dropdown con coexistencia de formatos, naming `{Empresa}_{YYYY-MM-DD}.xlsx`.

---

## 0. Pre-requisito crítico: recuperar la base de selección múltiple

> **Hallazgo**: Al verificar el entorno deployado contra el código fuente del repo, los checkboxes por fila, el checkbox "seleccionar todo" y la barra flotante de acciones **no aparecen en la UI de producción**, aunque sí están presentes en el código de la branch de trabajo de este chat (`v0/ignaciocuffia-654f7e91`). El usuario confirmó: "supo estar pero no está más". Esto indica que la base nunca llegó a `main` o fue removida en algún momento.

### 0.1 Evidencia

| Fuente | Estado |
|---|---|
| Screenshot de producción (vista Lista) | 7 columnas: Empresa, Estado, Contexto, Prioridad, Notas, Fecha, Acciones. **Sin checkboxes**. **Sin barra flotante**. |
| `app/bookmarks/page.tsx` en branch `v0/ignaciocuffia-654f7e91` | 8 columnas: la primera es `<TableHead className="w-10">` con `<Checkbox />` (líneas 448-453). Por fila, checkbox en `<TableCell>` (líneas 466-471). Barra flotante con bulk export (líneas 587-624). |
| Archivos `app/api/bookmarks/export/route.ts` y `lib/export-bookmarks.ts` | Existen en la branch del chat. Estado en `main` por confirmar. |

### 0.2 Implicancia

El feature de "Export ZIP de archivos separados" **no se puede construir directamente sobre `main`** porque le falta la base de selección múltiple sobre la que se apoya (`selectedIds`, `handleSelectToggle`, `handleSelectAll`, barra flotante, endpoint bulk consolidado). Hay dos caminos posibles para recuperarla, y ambos deben resolverse antes de empezar el trabajo nuevo del ZIP:

| Camino | Cuándo aplica | Acción |
|---|---|---|
| **A. Merge de la branch del chat a `main`** | Si el código de la branch `v0/ignaciocuffia-654f7e91` sigue siendo válido y no choca con cambios posteriores. | Abrir PR de la branch del chat hacia `main`. Resolver conflictos si los hay. Validar que el deploy preview muestra checkboxes y barra flotante antes de mergear. |
| **B. Re-implementar la base** | Si la branch del chat divergió mucho de `main` o si hay razones de producto para que la base sea distinta a la que existe ahí. | Replicar en `main` la lógica de checkboxes, barra flotante, endpoints `/api/bookmarks/[id]/export` y `/api/bookmarks/export`, y `lib/export-bookmarks.ts`. Trabajo equivalente al que ya está hecho en la branch — evitable si A es viable. |

### 0.3 Pregunta abierta sobre la causa

No se documenta acá *por qué* la base no está en `main`. Puede ser que el merge nunca se hizo, que hubo un revert intencional (decisión de producto que desconocemos), o un revert accidental durante un rebase/merge conflictivo. **Antes de elegir entre A y B conviene revisar el git log de `main` sobre `app/bookmarks/page.tsx` y `app/api/bookmarks/`** para no repetir el problema. Si fue un revert intencional, hay que entender el motivo antes de re-introducir el feature.

### 0.4 Definición de listo del Pre-requisito #0

- [ ] El git log de `main` revisado y la causa del removal documentada (o confirmada como "merge nunca ocurrido").
- [ ] Camino A o B elegido y ejecutado.
- [ ] En el deploy productivo, en la vista Lista, se ven: checkbox en cada fila, checkbox de "seleccionar todo" en el header, y barra flotante con botón "Exportar Excel" cuando hay 1+ seleccionados.
- [ ] El endpoint `POST /api/bookmarks/export` responde con un `.xlsx` consolidado válido.
- [ ] Solo después de cumplir lo anterior se inicia el trabajo de las secciones 4-7 de este documento.

### 0.5 Impacto en estimación

La estimación original de **2-3 días para el ZIP nuevo sigue siendo válida**, pero ahora hay un pre-requisito que la antecede:

- Camino A (merge): horas de trabajo, dependiente de cuántos conflictos haya y si hay que justificar/desbloquear el merge a alguien.
- Camino B (re-implementar): ~2-3 días adicionales (porque es replicar lo que ya está escrito).

**Total optimista (camino A + ZIP)**: ~3-4 días.
**Total pesimista (camino B + ZIP)**: ~5-6 días.

---

## 1. Resumen ejecutivo

Permitir que el usuario, desde la vista de lista en `/bookmarks`, seleccione múltiples bookmarks vía checkboxes y descargue un **ZIP** con un Excel individual por cada bookmark, manteniendo el formato exacto del export individual existente (6 hojas por bookmark). En paralelo, se preserva el export consolidado actual (resumen + todos los prospectos en un único `.xlsx`) como segunda opción dentro de un dropdown.

---

## 2. Estado actual del código (medido)

Esta tabla refleja el estado del código en la branch de este chat (`v0/ignaciocuffia-654f7e91`). El estado en `main` puede ser distinto — ver Pre-requisito #0.

| Pieza | Estado en branch del chat | Estado confirmado en `main` | Archivo |
|---|---|---|---|
| Checkbox por fila en lista | Implementado | **Ausente** (confirmado por screenshot) | `app/bookmarks/page.tsx` |
| Checkbox "seleccionar todo" en header | Implementado | **Ausente** (confirmado por screenshot) | `app/bookmarks/page.tsx` |
| Estado `selectedIds: Set<string>` | Implementado | Por confirmar | `app/bookmarks/page.tsx` |
| Barra flotante de acciones | Implementado | **Ausente** (confirmado por screenshot) | `app/bookmarks/page.tsx` |
| Botón "Exportar Excel" (consolidado) | Implementado | Ausente (depende de barra flotante) | `app/bookmarks/page.tsx` |
| Endpoint export individual | Implementado | Por confirmar | `app/api/bookmarks/[id]/export/route.ts` |
| Endpoint export bulk consolidado | Implementado | Por confirmar | `app/api/bookmarks/export/route.ts` |
| `generateBookmarkExcel()` (6 hojas) | Implementado | Por confirmar | `lib/export-bookmarks.ts` |
| `generateBulkBookmarksExcel()` (consolidado) | Implementado | Por confirmar | `lib/export-bookmarks.ts` |
| RPC `get_bookmark_export_data` | Implementado | Probablemente sí (las migraciones suelen llegar a Supabase aunque la UI no se merge) | `scripts/135`, `136` |
| Validación de ownership por `user_id` | Implementado | Va con los endpoints | endpoints actuales |
| Límite duro de 50 bookmarks | Implementado | Va con el endpoint bulk | endpoint bulk |

**Lo que falta una vez resuelto el Pre-requisito #0**: empaquetar N excels en un ZIP, exponerlo como segundo formato y agregar el dropdown en la UI.

---

## 3. Decisiones de diseño

| Tema | Decisión |
|---|---|
| Estrategia de entrega | **ZIP sync con buffer en RAM** (sin streaming, sin async). |
| Contenido del ZIP | **Solo los excels individuales**. Sin Resumen.xlsx adentro. |
| Coexistencia con consolidado | **Dropdown** en la barra flotante con dos opciones. |
| Naming dentro del ZIP | `{NombreEmpresa}_{YYYY-MM-DD}.xlsx`. |
| Naming del ZIP | `ASCI_Bookmarks_{YYYY-MM-DD}.zip`. |
| Límite duro | 50 bookmarks (hereda del endpoint bulk actual). |
| Reuso de lógica | `generateBookmarkExcel()` por cada bookmark, sin tocar su firma. |

---

## 4. Diseño del backend

### 4.1 Nuevo endpoint

**Ruta**: `POST /api/bookmarks/export-zip`

**Por qué nuevo y no extender el existente**: el endpoint `/api/bookmarks/export` actual devuelve `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Cambiar su content-type según un flag rompe el contrato. Mejor un endpoint dedicado, paralelo, que reusa toda la lógica de validación y data fetching.

**Request body**:

```jsonc
{
  "bookmark_ids": ["uuid-1", "uuid-2", "..."]
}
```

**Validaciones** (idénticas al endpoint consolidado, conviene extraer a helper compartido):

1. Auth con `auth.getUser()`. 401 si falla.
2. `bookmark_ids` es array no vacío. 400 si falla.
3. `bookmark_ids.length <= 50`. 400 si falla.
4. Cada `bookmark_id` pertenece al `user_id` autenticado. 403 si falla (con la lista de ids no autorizados para debug).
5. Quitar duplicados antes de procesar.

**Response**:

- Content-Type: `application/zip`
- Content-Disposition: `attachment; filename="ASCI_Bookmarks_2026-04-29.zip"`
- Body: bytes del ZIP.

**Errores específicos**:

| Código | Caso |
|---|---|
| 401 | Sin sesión |
| 400 | `bookmark_ids` vacío, no array, o > 50 |
| 403 | Algún bookmark no pertenece al usuario |
| 404 | Algún bookmark no existe (poco probable después de validar ownership) |
| 504 | Timeout del Vercel Function (se devuelve por el runtime, no por nosotros — ver sección 5.2) |
| 500 | Error en generación de algún Excel — abortamos todo el ZIP |

### 4.2 Algoritmo de generación

```
Pseudocódigo del handler:

1. Validar request (auth + ownership + límite).
2. Para cada bookmark_id:
   a. Llamar RPC get_bookmark_export_data(bookmark_id).
   b. Llamar generateBookmarkExcel(data) → Buffer (o Uint8Array).
   c. Guardar { filename, buffer } en array.
3. Crear ZIP en memoria con jszip:
   a. Por cada item, zip.file(filename, buffer).
4. Generar bytes del ZIP con compression: 'DEFLATE', compressionOptions: { level: 6 }.
5. Devolver Response con headers de descarga.
```

**Concurrencia**: por simplicidad y para evitar saturar Supabase, **procesamos en serie** (no `Promise.all`). 50 bookmarks × ~600ms cada uno ≈ 30s. Con `Promise.all` bajamos a ~10s pero 50 conexiones simultáneas a Supabase pueden gatillar rate limits y dejar la app inestable. Dejamos serie en v1 y optimizamos después con un `pLimit(5)` si vemos que duele.

### 4.3 Naming de archivos dentro del ZIP

**Formato**: `{NombreEmpresa}_{YYYY-MM-DD}.xlsx`

**Sanitización del nombre de empresa** (crítica — caracteres ilegales en nombre de archivo):

| Carácter | Reemplazo |
|---|---|
| `/` `\` `:` `*` `?` `"` `<` `>` `|` | `_` |
| Espacios consecutivos | un solo `_` |
| Tildes / acentos | mantener (los browsers/OS modernos los toleran) |
| `&` `'` `,` `(` `)` | mantener (legales en file names) |
| Strings vacíos o solo símbolos | fallback a `Bookmark_{id_corto}` |

**Truncado**: si el nombre supera 100 caracteres, truncar a 100 (Windows tiene límite de 255 para path completo, conviene dejar margen).

**Manejo de colisiones**: si dos bookmarks tienen el mismo nombre de empresa exacto (caso raro pero real cuando hay duplicados), agregar sufijo `_2`, `_3`, etc. Detectarlo durante la construcción del array de archivos, no al final.

### 4.4 Librería de ZIP

**Elegida: `jszip`**.

| Criterio | jszip | archiver |
|---|---|---|
| API en memoria simple | Sí | No (orientado a streams) |
| Tamaño bundle | ~94KB | ~120KB + deps |
| Soporte Edge Runtime | Sí | Parcial |
| Funciona en Vercel Functions | Sí | Sí |
| Compresión DEFLATE | Sí | Sí |

`jszip` encaja con la decisión de "sync + buffer en RAM". Si en algún momento se migra a streaming (escenario async/Blob), `archiver` es la opción natural.

### 4.5 Memoria y timeout esperados

Estimaciones basadas en los Excels actuales (6 hojas, ~50 prospectos típicos):

| Variable | Valor estimado |
|---|---|
| Tamaño de un `.xlsx` individual | 200 KB – 1 MB |
| 50 archivos sin comprimir | 10 MB – 50 MB |
| Compresión DEFLATE en xlsx | ~5–15% (xlsx ya es zip internamente) |
| ZIP final | 9 MB – 45 MB |
| Pico de RAM (todos los buffers + zip) | hasta ~100 MB |
| Tiempo total con 50 bookmarks en serie | 25 – 60 s |

**Configuración requerida en Vercel**: `maxDuration: 60` en el route handler. Esto requiere plan **Pro o superior**. En Hobby el límite es 10s y solo aguantaríamos ~10 bookmarks. Lo dejamos documentado como prerequisito del feature.

---

## 5. Diseño del frontend

### 5.1 Cambio en la barra flotante

**Estado actual**: dos botones: `[Limpiar selección] [Exportar Excel]`.

**Estado nuevo**: `[Limpiar selección] [Exportar ▾]` donde el dropdown ofrece:

```
Exportar ▾
├── Archivos separados (.zip)
│   "Un Excel por cada bookmark, empaquetados en ZIP"
└── Excel consolidado (.xlsx)
    "Resumen + Todos los prospectos en un solo archivo"
```

Componente shadcn: `DropdownMenu` + `DropdownMenuTrigger` + `DropdownMenuContent` con `DropdownMenuItem`s. Cada item muestra título + descripción corta debajo (1 línea, `text-muted-foreground text-xs`).

### 5.2 Manejo del clic

**Para "Archivos separados (.zip)"**:

1. `setIsExporting(true)` para deshabilitar el dropdown.
2. Toast con `Sonner`: *"Generando ZIP de N bookmarks. Puede tardar hasta 60 segundos."* Persistente con spinner.
3. `fetch('/api/bookmarks/export-zip', { method: 'POST', body: JSON.stringify({ bookmark_ids }) })`.
4. Al recibir respuesta:
   - Si OK: `response.blob()` → crear `Object URL` → trigger download via `<a>` invisible → `URL.revokeObjectURL`.
   - Si error: toast de error con el mensaje del backend.
5. `setIsExporting(false)`. Cerrar toast persistente.
6. **No limpiar la selección automáticamente**: el usuario puede querer reintentarlo. Lo limpia él con el botón existente.

**Para "Excel consolidado (.xlsx)"**: misma lógica que ya hace `handleBulkExport()` actual, sin cambios.

### 5.3 Estados del botón

| Estado | UI |
|---|---|
| 0 seleccionados | Barra flotante oculta (comportamiento actual). |
| 1–50 seleccionados | Dropdown habilitado. |
| > 50 seleccionados | Dropdown deshabilitado + tooltip *"Máximo 50 bookmarks por export"*. |
| Export en curso | Dropdown deshabilitado, spinner inline en el trigger. |

### 5.4 Indicador de progreso

Para v1 dejamos un toast con spinner indeterminado. **No** mostramos progreso real (1 de 50 procesados...) porque requeriría streaming/SSE desde el backend. Es nice-to-have para v2 si los exports grandes se vuelven habituales.

---

## 6. Reuso vs código nuevo

### Reuso (sin tocar)
- `lib/export-bookmarks.ts → generateBookmarkExcel()` — la función ya devuelve el Excel completo, perfecto para empaquetar.
- RPC `get_bookmark_export_data` — la misma fuente de datos.
- Validación de ownership — el patrón del endpoint bulk se replica.
- Toda la UI de selección (`selectedIds`, checkboxes, barra flotante).

### Código nuevo
- Helper `lib/zip-bookmarks.ts` con `generateBookmarksZip(userId, bookmarkIds)` (puro: data fetching → array de buffers → JSZip → bytes).
- Endpoint `app/api/bookmarks/export-zip/route.ts` (handler delgado: auth + validación + llamada al helper).
- Helper compartido `lib/sanitize-filename.ts` para evitar duplicar la lógica de sanitización si en el futuro se reutiliza.
- Cambio puntual en `app/bookmarks/page.tsx`: reemplazar el botón "Exportar Excel" por un `DropdownMenu` con dos items + función `handleBulkExportZip()`.

### Refactor sugerido (no obligatorio)
- Extraer la validación `validateBookmarkOwnership(userId, bookmarkIds)` a `lib/bookmarks-auth.ts`. Hoy está duplicada implícitamente entre los dos endpoints existentes y el nuevo va a sumar una tercera copia. Evitamos drift futuro.

---

## 7. Seguridad

| Vector | Mitigación |
|---|---|
| Usuario A intenta exportar bookmarks de B | Validación de ownership por cada `bookmark_id`. Devolver 403, no 200 con datos vacíos. |
| Path traversal vía nombre de empresa | Sanitización agresiva (sección 4.3). El nombre nunca toca el filesystem real, es solo entry name dentro del ZIP — pero igual sanitizamos por defensa en profundidad y compatibilidad con el OS del usuario al descomprimir. |
| Zip bomb / abuso | Límite de 50 bookmarks. Auditoría: cada export logea `(user_id, count, total_size)` en una tabla `export_audit_log` (deuda técnica buena, lo agregamos como nice-to-have). |
| DoS por exports concurrentes del mismo usuario | Rate limit con Upstash (1 export en curso por usuario, retornar 429 si ya hay uno). v2 si vemos abuso. |
| Filtración de datos via headers | El endpoint no devuelve PII en headers, solo el filename. |

---

## 8. Observabilidad

- Log estructurado por export: `{ user_id, bookmark_count, total_size_bytes, duration_ms, success: bool, error?: string }`.
- Sentry breadcrumb para cada paso (validation → fetch → zip → respond).
- PostHog event `bulk_export_zip_started` y `bulk_export_zip_completed` con `bookmark_count` como property. Sirve para ver adopción.

---

## 9. Casos borde a contemplar

| Caso | Comportamiento |
|---|---|
| Usuario selecciona 1 solo bookmark y elige "Archivos separados" | Funciona: ZIP con un solo `.xlsx` adentro. No degradamos a descarga directa del xlsx (mantiene consistencia y predictibilidad). |
| Bookmark sin empresa asociada o `company_name = null` | Filename fallback: `Bookmark_{id_corto}_{fecha}.xlsx`. |
| Dos bookmarks con misma empresa | Sufijos `_2`, `_3`. Detectados durante la construcción del map de filenames. |
| `generateBookmarkExcel` falla para 1 de los 50 | Abortamos todo el ZIP y devolvemos 500 con `{ failed_bookmark_id, reason }`. Alternativa: continuar y devolver ZIP parcial + un `errors.txt` adentro — descartado por v1 (más complejo, menos esperable). |
| Usuario navega afuera de la página durante el export | El fetch sigue corriendo en background, pero el toast/handler se pierden. Estándar del browser, no lo manejamos. |
| Empresa con nombre en árabe / chino / emojis | Mantener UTF-8 en el filename. JSZip lo soporta. La mayoría de OS modernos también. Caso muy raro en el target ASCI pero documentado. |

---

## 10. Lo que no incluye este diseño

- Streaming del ZIP (sigue siendo response sync).
- Job async + Vercel Blob + notificación (descartado para v1, válido si > 50 bookmarks se vuelve común).
- "Resumen.xlsx" dentro del ZIP (descartado: solo archivos individuales).
- Selección de qué hojas exportar por bookmark (Bookmark Excel exporta siempre las 6).
- Filtrado de prospectos antes de exportar (se exporta todo lo que hay).
- Schedule de exports recurrentes (caso enterprise, fuera de alcance).
- Compresión avanzada (mantenemos `level: 6` que es el balance estándar).

---

## 11. Checklist pre-launch

### Pre-requisito #0 (bloqueante, ver sección 0)
- [ ] Revisar git log de `main` sobre `app/bookmarks/page.tsx` y `app/api/bookmarks/` para identificar si la base fue removida y por qué.
- [ ] Decidir entre camino A (merge de la branch del chat) y camino B (re-implementar).
- [ ] Ejecutar el camino elegido.
- [ ] Verificar en deploy productivo que se ven checkboxes, "seleccionar todo" y barra flotante.
- [ ] Verificar que `POST /api/bookmarks/export` responde correctamente con un `.xlsx` consolidado.

### Backend (solo después del Pre-requisito #0)
- [ ] Crear endpoint `POST /api/bookmarks/export-zip` con `maxDuration = 60`.
- [ ] Crear `lib/zip-bookmarks.ts` con la función pura.
- [ ] Crear `lib/sanitize-filename.ts` con tests unitarios para los caracteres ilegales.
- [ ] Refactor opcional: extraer `validateBookmarkOwnership` a helper compartido.
- [ ] Confirmar que `generateBookmarkExcel` devuelve `Buffer | Uint8Array` (verificar firma actual antes de implementar).

### Frontend
- [ ] Reemplazar botón "Exportar Excel" por `DropdownMenu` en `app/bookmarks/page.tsx`.
- [ ] Implementar `handleBulkExportZip()`.
- [ ] Toast persistente con spinner durante el export.
- [ ] Tooltip cuando hay > 50 seleccionados.
- [ ] Estado `isExporting` que deshabilita ambas opciones del dropdown.

### Infra / DevOps
- [ ] Confirmar plan Vercel **Pro o superior** (necesario para `maxDuration: 60`).
- [ ] Si está en Hobby: documentar como blocker para release del feature.

### QA
- [ ] Test manual con 1, 10, 25, 50 bookmarks.
- [ ] Test con bookmark de empresa con caracteres especiales (`/`, `&`, tildes, emojis).
- [ ] Test con dos bookmarks de empresa con nombre idéntico.
- [ ] Test con usuario A exportando bookmark de usuario B → debe ser 403.
- [ ] Test de timeout simulado (>60s) → respuesta 504.

---

## 12. Estimación de implementación

| Área | Trabajo |
|---|---|
| Pre-requisito #0 — Camino A (merge) | horas a 1 día (depende de conflictos y aprobaciones) |
| Pre-requisito #0 — Camino B (re-implementar base) | 2–3 días |
| Backend ZIP (endpoint + helpers + tests) | 1–1.5 días |
| Frontend (dropdown + handler + estados) | 0.5–1 día |
| QA manual y ajustes | 0.5 día |
| **Total optimista (A + ZIP)** | **3–4 días** |
| **Total pesimista (B + ZIP)** | **5–6 días** |

El feature de ZIP en sí es chico (~2–3 días) porque el código existe en la branch de este chat. La variabilidad la introduce el Pre-requisito #0 según cuán divergidas estén `main` y la branch.

---

## 13. Preguntas abiertas

1. **¿Logueamos los exports en una tabla o solo en Sentry/PostHog?** Una tabla `export_audit_log(user_id, type, bookmark_count, total_size, duration_ms, occurred_at)` permite reportes de uso por usuario y se alinea con el patrón de auditoría de otras features. Es nice-to-have, no blocker.
2. **¿Mostramos en algún lugar de la UI cuántos exports lleva el usuario?** Útil si se introduce un límite por plan en el futuro. Por ahora no.
3. **¿Política de retención de logs de export?** 90 días razonable, alineado con otros audit logs de la plataforma.
4. **Plan Vercel actual**: confirmar que estamos en Pro. Si estamos en Hobby, el feature no funciona para selecciones grandes y hay que repensar el límite a ~10 bookmarks o ir a la opción async desde el día 1.
