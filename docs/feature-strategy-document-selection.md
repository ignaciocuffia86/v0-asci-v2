# Feature: Seleccion de Documentos para Estrategia

## Resumen

Permitir al usuario seleccionar que documentos utilizar al generar la propuesta de valor/estrategia para un bookmark. Actualmente el sistema selecciona automaticamente los top 3 documentos por score de match (industria, tecnologia, proceso). Con esta feature, el usuario podra:

1. Ver todos los documentos sugeridos (pre-seleccionados por el algoritmo de ranking)
2. Deseleccionar documentos que no quiera usar
3. Seleccionar documentos adicionales que el algoritmo no sugirio
4. Confirmar la seleccion antes de generar la estrategia

---

## Estado Actual

### Flujo Actual (automatico)

```
Usuario hace clic en "Generar Propuesta con ASCI Docs"
    ↓
POST /api/documents/context-for-bookmark
    ↓
rankDocumentsForBookmark() → top 3 docs por score
    ↓
Prompt a Gemini con los 3 docs
    ↓
Estrategia generada (sin opcion de elegir docs)
```

### Codigo Actual Relevante

| Archivo | Responsabilidad |
|---------|-----------------|
| `app/bookmarks/[id]/_components/strategy-tab.tsx` | UI del tab de estrategia |
| `lib/documents/rank-documents-for-bookmark.ts` | Algoritmo de ranking de docs |
| `app/api/documents/context-for-bookmark/route.ts` | GET: obtener docs relevantes, POST: generar estrategia |

### Algoritmo de Ranking Actual

```typescript
// Scoring por tipo de match:
// - Industry match: x3 weight
// - Technology match: x2 weight  
// - Process match: x1 weight
// Multiplicado por confidence del tag
// Retorna top 3 ordenados por score descendente
```

---

## Diseno Propuesto

### Flujo Nuevo (con seleccion)

```
Usuario entra al tab de Estrategia
    ↓
GET /api/documents/context-for-bookmark (ya existe)
    ↓
UI muestra TODOS los documentos del usuario:
  - Pre-tildados: los que tienen score > 0 (recomendados)
  - No tildados: los que tienen score = 0 (sin match)
    ↓
Usuario ajusta seleccion (tildar/destildar)
    ↓
Usuario hace clic en "Generar Propuesta"
    ↓
POST /api/documents/context-for-bookmark 
  + body: { bookmarkId, selectedDocIds: string[] }
    ↓
Prompt a Gemini con docs seleccionados
    ↓
Estrategia generada
```

### Modelo de Datos

**No se requieren cambios de schema.** Los IDs de documentos seleccionados se envian en el request body.

```typescript
// Request body actualizado para POST
interface GenerateStrategyRequest {
  bookmarkId: string
  selectedDocIds?: string[]  // NUEVO - opcional para backward compatibility
}

// Response del GET actualizado
interface DocsContextResponse {
  hasDocuments: boolean
  valueProfile: ValueProfile | null
  // CAMBIO: incluir TODOS los docs, no solo los relevantes
  allDocs: {
    id: string              // NUEVO - necesario para seleccion
    title: string
    type: string
    summary: string | null
    matchedTags: MatchedTag[]
    score: number           // NUEVO - para ordenar y pre-seleccionar
    isRecommended: boolean  // NUEVO - score > 0
  }[]
}
```

### Cambios en Componentes

#### 1. `strategy-tab.tsx` - UI Principal

```tsx
// Estado nuevo
const [allDocs, setAllDocs] = useState<DocWithSelection[]>([])
const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set())

// Tipo para docs con seleccion
interface DocWithSelection {
  id: string
  title: string
  type: string
  summary: string | null
  matchedTags: MatchedTag[]
  score: number
  isRecommended: boolean
}

// Al cargar docs, pre-seleccionar los recomendados
useEffect(() => {
  if (allDocs.length > 0) {
    const recommended = allDocs
      .filter(d => d.isRecommended)
      .map(d => d.id)
    setSelectedDocIds(new Set(recommended))
  }
}, [allDocs])

// Handler de seleccion
const toggleDocSelection = (docId: string) => {
  setSelectedDocIds(prev => {
    const next = new Set(prev)
    if (next.has(docId)) {
      next.delete(docId)
    } else {
      next.add(docId)
    }
    return next
  })
}

// Generar con docs seleccionados
const handleGenerateFromDocs = async () => {
  const res = await fetch("/api/documents/context-for-bookmark", {
    method: "POST",
    body: JSON.stringify({ 
      bookmarkId, 
      selectedDocIds: Array.from(selectedDocIds) 
    }),
  })
  // ...
}
```

#### 2. UI de Seleccion de Documentos

```tsx
{/* Card de ASCI Docs con seleccion */}
<Card className="border-primary/30 bg-primary/5">
  <CardHeader>
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <CardTitle className="text-base">ASCI Docs</CardTitle>
      </div>
      <Badge variant="secondary">
        {selectedDocIds.size} seleccionado{selectedDocIds.size !== 1 ? "s" : ""}
      </Badge>
    </div>
    <CardDescription>
      Selecciona los documentos que quieres usar para generar la propuesta.
      Los recomendados estan pre-seleccionados segun el match con la cuenta.
    </CardDescription>
  </CardHeader>
  
  <CardContent className="space-y-3">
    {/* Seccion: Documentos Recomendados */}
    {allDocs.filter(d => d.isRecommended).length > 0 && (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Star className="h-3 w-3" />
          Recomendados para esta cuenta
        </p>
        {allDocs.filter(d => d.isRecommended).map(doc => (
          <DocumentCheckboxItem
            key={doc.id}
            doc={doc}
            isSelected={selectedDocIds.has(doc.id)}
            onToggle={() => toggleDocSelection(doc.id)}
          />
        ))}
      </div>
    )}
    
    {/* Seccion: Otros Documentos */}
    {allDocs.filter(d => !d.isRecommended).length > 0 && (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          Otros documentos disponibles
        </p>
        {allDocs.filter(d => !d.isRecommended).map(doc => (
          <DocumentCheckboxItem
            key={doc.id}
            doc={doc}
            isSelected={selectedDocIds.has(doc.id)}
            onToggle={() => toggleDocSelection(doc.id)}
          />
        ))}
      </div>
    )}
    
    {/* Boton de generar */}
    <Button
      onClick={handleGenerateFromDocs}
      disabled={isGenerating || selectedDocIds.size === 0}
      className="w-full"
    >
      {isGenerating ? <Loader2 className="animate-spin" /> : <Sparkles />}
      Generar Propuesta ({selectedDocIds.size} doc{selectedDocIds.size !== 1 ? "s" : ""})
    </Button>
  </CardContent>
</Card>
```

#### 3. Componente DocumentCheckboxItem

```tsx
interface DocumentCheckboxItemProps {
  doc: DocWithSelection
  isSelected: boolean
  onToggle: () => void
}

function DocumentCheckboxItem({ doc, isSelected, onToggle }: DocumentCheckboxItemProps) {
  return (
    <div 
      className={cn(
        "flex items-start gap-3 p-2 rounded-md border cursor-pointer transition-colors",
        isSelected 
          ? "border-primary/50 bg-primary/5" 
          : "border-transparent hover:bg-muted/50"
      )}
      onClick={onToggle}
    >
      <Checkbox 
        checked={isSelected} 
        onCheckedChange={onToggle}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-sm truncate">{doc.title}</span>
        </div>
        {doc.matchedTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {doc.matchedTags.map((tag, i) => (
              <Badge 
                key={i} 
                variant="outline" 
                className="text-[10px] px-1.5 py-0"
              >
                {tag.value}
              </Badge>
            ))}
          </div>
        )}
        {doc.summary && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {doc.summary}
          </p>
        )}
      </div>
      {doc.isRecommended && (
        <Badge variant="secondary" className="text-[10px] flex-shrink-0">
          Match
        </Badge>
      )}
    </div>
  )
}
```

### Cambios en API

#### `GET /api/documents/context-for-bookmark`

```typescript
// Cambio: retornar TODOS los docs con score, no solo top 3
const rankedDocs = hasDocuments
  ? await rankDocumentsForBookmark(user.id, {
      companyIndustry: company?.industry || null,
      filterSignalIds,
    }, { returnAll: true })  // NUEVO parametro
  : []

return NextResponse.json({
  hasDocuments,
  valueProfile: valueProfile || null,
  allDocs: rankedDocs.map((d) => ({
    id: d.id,
    title: d.title,
    type: d.type,
    summary: d.ai_summary,
    matchedTags: d.matchedTags,
    score: d.score,
    isRecommended: d.score > 0,
  })),
})
```

#### `POST /api/documents/context-for-bookmark`

```typescript
// Cambio: usar selectedDocIds si se proveen
const { bookmarkId, selectedDocIds } = body

// Si hay selectedDocIds, usar esos; sino, usar ranking automatico
let docsToUse: RankedDocument[]

if (selectedDocIds && selectedDocIds.length > 0) {
  // Obtener los docs especificos
  const { data: selectedDocs } = await supabase
    .from("user_documents")
    .select("id, title, type, ai_summary, extracted_text")
    .eq("user_id", user.id)
    .in("id", selectedDocIds)
  
  docsToUse = selectedDocs?.map(d => ({
    ...d,
    score: 1,  // score dummy
    matchedTags: [],
  })) || []
} else {
  // Backward compatibility: ranking automatico
  docsToUse = await rankDocumentsForBookmark(user.id, {
    companyIndustry: company.industry,
    filterSignalIds,
  })
}

// Continuar con la generacion usando docsToUse...
```

#### `lib/documents/rank-documents-for-bookmark.ts`

```typescript
// Agregar opcion para retornar todos los docs
export async function rankDocumentsForBookmark(
  userId: string,
  bookmarkContext: BookmarkContext,
  options?: { returnAll?: boolean }
): Promise<RankedDocument[]> {
  // ... scoring logic igual ...
  
  // Cambio en el return
  const sorted = scoredDocs.sort((a, b) => b.score - a.score)
  
  if (options?.returnAll) {
    return sorted  // Retornar todos, ordenados por score
  }
  
  // Default: solo top 3 con score > 0
  return sorted.filter((d) => d.score > 0).slice(0, 3)
}
```

---

## Consideraciones UX

### Estados de la UI

| Estado | UI |
|--------|-----|
| Sin documentos | Mostrar CTA para subir docs (ya existe) |
| Con docs, ninguno seleccionado | Boton deshabilitado, mensaje "Selecciona al menos un documento" |
| Con docs, algunos seleccionados | Boton habilitado con contador |
| Generando | Loading state en boton |
| Error | Toast de error |

### Orden de Documentos

1. **Recomendados primero** (score > 0), ordenados por score descendente
2. **Otros documentos** (score = 0), ordenados por fecha de creacion descendente

### Pre-seleccion

- Los documentos con `score > 0` vienen pre-tildados
- El usuario puede destildarlos si no quiere usarlos
- Esto mantiene el comportamiento actual como default

### Limite de Seleccion

- **Sugerencia**: Limitar a 5 documentos maximo para evitar prompts muy largos
- Mostrar warning si se seleccionan muchos: "Seleccionar muchos documentos puede afectar la calidad de la estrategia"

---

## Fases de Implementacion

### Fase 1: Backend (API)
1. Modificar `rankDocumentsForBookmark` para soportar `returnAll`
2. Actualizar GET para retornar todos los docs con scores
3. Actualizar POST para aceptar `selectedDocIds`

### Fase 2: Frontend (UI)
1. Crear componente `DocumentCheckboxItem`
2. Actualizar `strategy-tab.tsx` con estado de seleccion
3. Implementar UI de lista con checkboxes

### Fase 3: Polish
1. Agregar limite de seleccion (5 docs)
2. Agregar collapse/expand para lista larga de docs
3. Agregar busqueda/filtro si hay muchos docs

---

## Diagrama de Flujo

```
┌─────────────────────────────────────────────────────────────┐
│                     Tab de Estrategia                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  ASCI Docs                           2 seleccionados   │ │
│  │                                                        │ │
│  │  Selecciona los documentos para la propuesta.          │ │
│  │                                                        │ │
│  │  ★ Recomendados para esta cuenta                       │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │ [✓] Caso Exito Banco Regional        [Match]     │  │ │
│  │  │     Tags: Banca, SAP                             │  │ │
│  │  │     Implementacion exitosa de SAP en banco...    │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │ [✓] Brochure Servicios Financieros   [Match]     │  │ │
│  │  │     Tags: Finanzas                               │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │                                                        │ │
│  │  Otros documentos disponibles                          │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │ [ ] Propuesta Retail 2024                        │  │ │
│  │  │     Tags: Retail, E-commerce                     │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │ [ ] Caso Telco Migracion AWS                     │  │ │
│  │  │     Tags: Telecomunicaciones, AWS                │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │                                                        │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │       ✨ Generar Propuesta (2 docs)              │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Mi Propuesta de Valor                                 │ │
│  │  [Textarea con estrategia generada...]                 │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Metricas de Exito

1. **Adopcion**: % de usuarios que modifican la seleccion default
2. **Engagement**: Promedio de docs seleccionados vs recomendados
3. **Calidad**: Feedback implicito (si el usuario edita mucho la estrategia despues)
