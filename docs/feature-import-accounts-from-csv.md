# Feature Blueprint: Import de Cuentas desde CSV/Excel

## Problema
Los usuarios/clientes definen sus cuentas target en un Excel externo, con nombres de empresas. Hoy no existe forma de importarlas masivamente a la plataforma. El usuario tiene que buscar cuenta por cuenta en `/search`, lo cual no escala.

## Objetivo
Permitir al usuario importar un archivo CSV/Excel con nombres de cuentas, matchearlas contra la base de `companies` de ASCI por heuristica, y crear bookmarks automaticamente. Post-import, permitir edicion bulk de filtros (proceso/tecnologia) y seleccion de doc/producto para la estrategia.

---

## Parte 1: Import y Matching de Cuentas

### 1.1 Formato del Archivo CSV

El archivo minimo debe contener:

| Columna | Requerido | Descripcion | Ejemplo |
|---|---|---|---|
| `nombre` | Si | Nombre de la empresa tal como la conoce el usuario | "Banco Galicia", "YPF S.A." |
| `pais` | No (recomendado) | Pais de la empresa. Critico para multinacionales | "Argentina", "Mexico" |
| `industria` | No | Industria como pista adicional para desambiguar | "Banking", "Oil & Gas" |
| `prioridad` | No | Tier de la cuenta: alta, transaccional, baja | "alta" |
| `notas` | No | Notas iniciales del usuario | "Cliente potencial Q2" |

**Decisiones de diseno:**
- No pedimos dominio/website porque el usuario generalmente no lo tiene.
- El pais es la pista mas fuerte para desambiguar multinacionales (ej: "BBVA" existe en Mexico, Espana, Colombia, etc.)
- La industria es hint adicional, no obligatorio.

### 1.2 Algoritmo de Matching

El matching se ejecuta en el backend row por row, con la siguiente cascada:

```
Para cada fila del CSV:
  1. Normalizar nombre: lowercase, remover SA/SRL/LLC/Inc/Corp, trim, removeAccents
     - Usar removeAccents() de lib/normalize-utils.ts (ya existe)
     - Ej: "YPF S.A." -> "ypf", "Banco Galicia S.A." -> "banco galicia"

  2. Buscar match EXACTO contra companies.normalized_name
     - Si hay 1 match y el pais coincide (o no se especifico pais) -> MATCH DIRECTO
     - Si hay multiples matches -> filtrar por pais (country_normalized / country)
       - Si queda 1 -> MATCH DIRECTO
       - Si quedan multiples -> MATCH AMBIGUO (requiere review manual)
       - Si quedan 0 -> intentar sin filtro pais, marcar como MATCH AMBIGUO

  3. Si no hay match exacto, buscar ILIKE '%normalized_name%'
     - Aplicar mismo filtro por pais
     - Si hay 1 resultado -> MATCH CANDIDATO (confianza media, requiere confirmacion)
     - Si hay multiples -> MATCH AMBIGUO (mostrar candidatos para seleccion manual)

  4. Si no hay resultado -> NO MATCH (la empresa no esta en la base de ASCI)
```

**Estados de matching por fila:**
- `matched` - Match directo con alta confianza. Se crea bookmark automaticamente.
- `candidate` - 1 candidato probable. Se muestra para confirmacion rapida.
- `ambiguous` - Multiples candidatos. Se muestran opciones para que el usuario elija.
- `not_found` - Sin match. Se registra para analisis (podria agregarse la empresa en el futuro).
- `already_bookmarked` - La empresa ya esta en los bookmarks del usuario.
- `error` - Error de procesamiento en la fila.

### 1.3 Infraestructura Existente Reutilizable

La plataforma ya tiene infraestructura de importacion que se puede reutilizar:

| Recurso | Tabla/Archivo | Uso |
|---|---|---|
| Batch tracking | `import_batches` | Tracking del batch: status, total_rows, processed_rows, failed_rows. Ya soporta `batch_type` |
| Row tracking | `import_rows` | Status individual por fila: row_data (jsonb), status, error_message |
| Normalize utils | `lib/normalize-utils.ts` | `removeAccents()`, `normalizeCountriesForSearch()` |
| Company normalized_name | `companies.normalized_name` | Nombre ya normalizado en la DB para matching rapido |
| Batch bookmark | `bookmarkCompanyBatch()` en `actions/bookmarks.ts` | Crear multiples bookmarks a la vez con search_context |
| Country mappings | `country_mappings` tabla | Mapear variantes de pais ("Arg", "AR") a normalizado ("Argentina") |
| Company search | `searchCompanies()` en `actions/companies.ts` | Busca por name, website, normalized_name con ILIKE |

**Nuevo `batch_type` necesario:** `"account_import"` en `import_batches`.

### 1.4 Flujo de UI

```
/bookmarks -> [Boton "Importar Cuentas"] -> Modal/Pagina de import

Paso 1: Upload
  - Drag & drop o file picker (.csv, .xlsx)
  - Preview de las primeras 5 filas parseadas
  - Mapeo de columnas (auto-detect por nombre de header, con override manual)
    - Detectar automaticamente: "nombre", "name", "empresa", "company" -> columna nombre
    - Detectar automaticamente: "pais", "country", "pais" -> columna pais
    - etc.
  - Boton "Procesar"

Paso 2: Review de Matching (tabla interactiva)
  - Tabla con todas las filas, agrupadas por status:
    - [verde] Matched (X) - se crean automaticamente
    - [amarillo] Candidatos (X) - confirmar/rechazar 1 a 1 o bulk "confirmar todos"
    - [naranja] Ambiguos (X) - dropdown para elegir empresa correcta entre candidatos
    - [rojo] No encontrados (X) - solo informativo
    - [gris] Ya bookmarked (X) - skip automatico

  - Cada fila muestra:
    | CSV: Nombre | CSV: Pais | -> | Match: Empresa | Match: Pais | Match: Industria | Confianza | Accion |

  - Acciones disponibles:
    - "Confirmar todos los matches directos" (bulk, activado por default)
    - "Confirmar" individual para candidatos
    - Dropdown con opciones para ambiguos
    - "Ignorar" individual
    - "Buscar manualmente" -> abre mini-search inline para buscar empresa en la DB

Paso 3: Configuracion Pre-Import
  - Antes de crear los bookmarks, permitir:
    - Asignar prioridad bulk (si no vino en el CSV)
    - Asignar status inicial (default: "nuevo")
  - Boton "Importar X cuentas"

Paso 4: Resultado
  - Resumen: X importadas, Y ya existian, Z sin match
  - CTA principal: "Ver mis cuentas" -> link a /bookmarks
  - CTA secundario: "Editar filtros de las cuentas importadas" -> activa bulk edit
```

### 1.5 Template Descargable

Proveer un boton "Descargar plantilla CSV" con las columnas correctas y filas de ejemplo:
```csv
nombre,pais,industria,prioridad,notas
"Banco Galicia","Argentina","Banking","alta","Target Q2"
"BBVA Mexico","Mexico","Financial Services","transaccional",""
"YPF S.A.","Argentina","Oil & Gas","alta","Contacto existente"
```

---

## Parte 2: Edicion Bulk de Bookmarks (Filtros de Proceso/Tecnologia)

### 2.1 Problema
Los bookmarks importados llegan sin `search_context` (sin filtro de proceso/tecnologia), lo que los hace "generales". Las senales que muestran son TODAS las de la empresa, no filtradas por relevancia para el usuario. El usuario necesita poder asignar filtros masivamente.

### 2.2 Diseno

**Ubicacion:** Dentro de `/bookmarks`, agregar un "modo edicion bulk" activable desde la toolbar.

```
Toolbar de /bookmarks:
  [Importar Cuentas] [Edicion Bulk] [Vista: Kanban | Lista] [Nueva Busqueda]
```

**Flujo de Edicion Bulk:**

```
1. Activar "Edicion Bulk"
   - Aparecen checkboxes en cada bookmark (lista y kanban)
   - Toolbar contextual flotante (bottom bar):
     "X seleccionados | [Asignar Filtro] [Asignar Prioridad] [Asignar Status] [Cancelar]"

2. "Asignar Filtro" -> Modal con:
   - Tipo de filtro: Proceso | Tecnologia (tabs o radio)
   - Lista de opciones SOLO de las que tienen senales activas en la plataforma
     (NO todas las del diccionario, solo las que tienen registros en signals)
   - Multi-select con search para elegir 1 o mas
   - Preview: "Se aplicara a X bookmarks: [SAP, Power BI]"
   - "Aplicar a X bookmarks seleccionados"

3. "Asignar Prioridad" -> Dropdown rapido:
   - Alta | Transaccional | Baja
   - Aplica a todos los seleccionados

4. "Asignar Status" -> Dropdown rapido:
   - Nuevo | Contactado | Reunion | Propuesta | Ganado | Perdido
   - Aplica a todos los seleccionados
```

### 2.3 Backend para Bulk Update

```
PATCH /api/bookmarks/bulk
Body: {
  bookmarkIds: string[],
  updates: {
    search_context?: {
      filtersUsed: { technology?: string[], process?: string[] },
      filterSignalIds: string[],
      filterType: "technology" | "process" | "mixed"
    },
    priority?: "alta" | "transaccional" | "baja",
    status?: BookmarkStatus
  }
}
```

Actualiza `bookmarks.search_context`, `priority`, y/o `status` para todos los IDs.

### 2.4 Senales Disponibles: Solo las que Existen

Nuevo endpoint para poblar los selectores:

```
GET /api/signals/available
Response: {
  technologies: [{ id: string, name: string, vendor: string, signalCount: number }],
  processes: [{ id: string, name: string, signalCount: number }]
}
```

SQL subyacente:
```sql
-- Tecnologias con senales activas
SELECT DISTINCT dp.id, dp.name, dv.name as vendor, COUNT(s.id) as signal_count
FROM dictionary_products dp
JOIN dictionary_vendors dv ON dp.vendor_id = dv.id
JOIN signals s ON s.signal_id = dp.id::text
GROUP BY dp.id, dp.name, dv.name
ORDER BY dp.name;

-- Procesos con senales activas
SELECT DISTINCT dp.id, dp.name, COUNT(s.id) as signal_count
FROM dictionary_processes dp
JOIN signals s ON s.signal_id = dp.id::text
GROUP BY dp.id, dp.name
ORDER BY dp.name;
```

### 2.5 Edicion Individual Mejorada

Extender el `EditBookmarkDialog` existente (hoy edita notas/prioridad/status) para incluir:
- Selector de filtro de proceso/tecnologia (reutilizar el mismo componente `SignalFilterSelect` del bulk)
- Mostrar tags actuales del bookmark si ya tiene search_context
- Permitir limpiar filtros (volver a "general")

---

## Parte 3: Seleccion de Producto/Doc en Tab Estrategia

### 3.1 Contexto Actual
La tab Estrategia hoy funciona asi:
1. `GET /api/documents/context-for-bookmark` llama a `rankDocumentsForBookmark()` que cruza los `document_tags` del usuario con los `filterSignalIds` del bookmark y la industria de la empresa.
2. Retorna los top 3 docs mas relevantes automaticamente.
3. `POST /api/documents/context-for-bookmark` genera la estrategia con Gemini usando esos docs + value profile + company context.
4. No hay forma de que el usuario elija que doc/producto usar. Todo es automatico.

### 3.2 Diseno Propuesto

Agregar un selector explicito en la tab Estrategia:

```
Tab Estrategia (mejorada):
  
  [1] Producto/Caso para esta cuenta (NUEVO)
      ----------------------------------------
      Dropdown/Selector:
      - "Automatico (ASCI elige los mas relevantes)" <- default actual
      - Doc: "Caso Exito - Migracion Cloud Energia" [tags: AWS, Cloud, Energia]
      - Doc: "Brochure Servicios BI" [tags: Power BI, Analytics]
      - Doc: "Propuesta Automatizacion" [tags: RPA, UiPath, Facturacion]
      
      Al seleccionar un doc especifico:
      - El indicador de relevancia/fit se recalcula mostrando solo las
        senales que matchean con los tags de ese doc
      - La generacion de estrategia se hace con foco en ESE documento
      - Se persiste la seleccion en user_company_strategies

  [2] ASCI Docs (existente, pero contextualizado)
      - Si hay doc seleccionado: muestra solo ese doc como relevante
      - Si es "automatico": muestra top 3 como hoy
      - Boton "Generar con ASCI Docs" (existente)

  [3] Propuesta de Valor (existente)
      - Textarea con la estrategia generada/editada
      - Guardar

  [4] (Nuevo) Preview de Senales Relevantes
      - Mini-lista mostrando las senales de la cuenta que matchean
        con el doc/producto seleccionado
      - Si es "automatico", muestra todas las senales del bookmark
      - Si hay doc, filtra solo las senales cuyos signal_id matchean
        con los tag_reference_id del doc
```

### 3.3 Impacto en Backend

**Nuevo campo en `user_company_strategies`:**
```sql
ALTER TABLE user_company_strategies 
  ADD COLUMN selected_document_id UUID REFERENCES user_documents(id) ON DELETE SET NULL;
```

**Cambios en `GET /api/documents/context-for-bookmark`:**
- Aceptar query param `?documentId=uuid` opcional
- Si viene documentId: retornar solo ese doc con todos sus tags (sin ranking)
- Si no viene: comportamiento actual (ranking automatico top 3)

**Cambios en `POST /api/documents/context-for-bookmark` (generar estrategia):**
- Aceptar `documentId` en el body, opcional
- Si viene: usar exclusivamente ese doc como fuente de experiencia en el prompt
- Si no viene: comportamiento actual (top 3 ranked)

**Nueva funcion utilitaria:**
```ts
// lib/documents/get-document-signal-match.ts
export async function getDocumentSignalMatch(
  userId: string,
  documentId: string,
  companyId: string
): Promise<{ signal: Signal; matchedTag: DocumentTag }[]>
```
Dado un doc especifico y una empresa, retorna que senales de la empresa matchean con los tags del doc. Esto alimenta el "Preview de Senales Relevantes".

---

## Parte 4: Orden de Implementacion Recomendado

### Fase 1: Import CSV (core) - Prioridad Alta
1. Extender `normalize-utils.ts` con `normalizeCompanyName()`
2. Crear API `POST /api/import/accounts/match` - recibe array de {nombre, pais}, retorna matches
3. Crear API `POST /api/import/accounts/confirm` - recibe confirmaciones, crea bookmarks via `bookmarkCompanyBatch()`
4. Crear componente `ImportAccountsDialog` en `/bookmarks`
5. Crear componente `ImportReviewTable` con la tabla interactiva de review
6. Agregar boton "Importar Cuentas" en toolbar de `/bookmarks`
7. Usar `import_batches` / `import_rows` para persistir el proceso

### Fase 2: Edicion Bulk - Prioridad Alta
1. Crear endpoint `GET /api/signals/available` (tecnologias y procesos con senales)
2. Crear componente reutilizable `SignalFilterSelect` (multi-select con search)
3. Agregar modo bulk edit en `/bookmarks` (checkboxes + toolbar contextual)
4. Crear endpoint `PATCH /api/bookmarks/bulk` para updates masivos
5. Extender `EditBookmarkDialog` con `SignalFilterSelect` para edicion individual

### Fase 3: Seleccion de Doc en Estrategia - Prioridad Media
1. Migration: agregar `selected_document_id` en `user_company_strategies`
2. Crear componente `DocumentSelector` para la tab Estrategia
3. Modificar `GET /api/documents/context-for-bookmark` para soportar `?documentId=`
4. Modificar `POST /api/documents/context-for-bookmark` para soportar doc especifico
5. Crear `getDocumentSignalMatch()` para preview de senales
6. Agregar panel de "Senales Relevantes" en la tab

---

## Consideraciones Tecnicas

### Performance del Matching
- Para archivos chicos (<100 filas): matching sincrono en el request
- Para archivos grandes (100-1000 filas): background job con polling de `import_batches.status`
- Batch DB queries: chunks de 50 nombres normalizados en una sola query IN
- Indices: `companies.normalized_name` ya existe, confirmar que tenga indice

### Normalizacion de Nombres
Expandir `normalize-utils.ts`:
```ts
export function normalizeCompanyName(name: string): string {
  return removeAccents(name)
    .toLowerCase()
    .replace(/\b(s\.?a\.?|s\.?r\.?l\.?|inc\.?|corp\.?|llc|ltd|pty|gmbh|s\.?a\.?s\.?|s\.?a\.?c\.?|s\.?c\.?a\.?|s\.?e\.?|n\.?v\.?|plc|co\.?|cia\.?|ltda\.?)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
```

### Multinacionales
- El pais es la pista critica: "Accenture" existe en 15+ paises en la DB
- Sin pais: mostrar TODOS los matches como "ambiguous" para seleccion manual
- Con pais: filtrar por `country` / `country_normalized`, usando `normalizeCountriesForSearch()` existente

### Parseo de Excel
- Usar libreria `xlsx` (SheetJS) para parsear .xlsx client-side
- Convertir a JSON array antes de enviar al backend
- Solo enviar JSON al API, nunca el archivo binario
- Soporte: .csv (nativo), .xlsx, .xls

### Seguridad
- Validar user autenticado es owner del batch (RLS en import_batches ya lo cubre)
- Limitar: max 1000 filas por import
- Rate limiting: 1 import activo por usuario a la vez
- Sanitizar nombres antes del ILIKE (prevenir SQL injection)
- bookmarks RLS: "Users can manage own bookmarks" ya existe

### Edge Cases
- Empresa duplicada en el CSV (mismo nombre 2 veces) -> deduplicar en parsing, avisar
- Empresa ya bookmarked -> marcar como `already_bookmarked`, no duplicar
- CSV con headers en ingles Y espanol -> auto-detect ambos idiomas
- Filas vacias o con solo espacios -> skip silencioso
- Nombre muy corto (1-2 chars) -> skip con warning "nombre muy corto"

---

## Metricas de Exito
- % de filas con match directo (target: >70% para bases de cuentas LATAM)
- Tiempo promedio de import end-to-end (target: <2 min para 100 cuentas)
- Adopcion: % de usuarios que usan import vs busqueda manual en 30 dias
- Completitud: % de bookmarks importados que reciben filtro de proceso/tecnologia
- Retencion: bookmarks importados que avanzan de status "nuevo" a otro en 14 dias
