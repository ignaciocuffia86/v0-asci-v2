# MCP v3 — Auditoría consolidada: comparación de modos, bugs y plan

Documento de cierre del Test A. Reemplaza las conclusiones sobre aislamiento de
`docs/mcp-ux-test-contactos-aislamiento.md`.

---

## 0. Retractación: la "fuga cross-tenant" NO era un bug

Reporté como hallazgo crítico que un workspace nuevo podía leer señales de una cuenta que
nunca siguió. **Era una mala interpretación mía del modelo de datos.** El modelo real,
confirmado contra el esquema, es exactamente el que está diseñado:

| Alcance | Tablas | Verificado |
|---|---|---|
| **Público / global** (compartido entre workspaces) | `public.company_news`, `public.company_implementations`, `public.company_public_docs` | Están en schema `public`, **no** en `v3`, y no tienen `workspace_id` |
| **Privado del workspace** | `v3.workspace_documents`, `v3.account_briefs`, `v3.account_scorecards`, `v3.icebreakers`, `v3.followed_accounts` | Todas tienen `workspace_id` |

O sea: que `get_company_signal_summary` lea sin filtrar por workspace es **correcto por
diseño** — esa info es el corpus público de la compañía. Y las 36 filas con `user_id` que
señalé como "exposición" también son públicas por diseño: `company_public_docs` son
documentos públicos *de la compañía*, no los documentos privados del usuario (esos viven en
`v3.workspace_documents`, que sí está aislado).

`get_account_intelligence` sí corta con `ACCOUNT_NOT_AVAILABLE_IN_WORKSPACE` porque expone
material del workspace (briefs, scorecards). La diferencia de comportamiento entre las dos
tools no era una inconsistencia: es la frontera público/privado bien trazada.

**No hay ninguna migración de esquema pendiente por este tema.** Queda un solo punto real,
mucho más chico, al final del listado de bugs (BUG-7).

---

## 1. Export y comparación: server-managed vs client-assisted

Ambos modos producen `account_briefs`. Comparación agregada sobre producción:

| Métrica | server-managed (20 briefs) | client-assisted (4 briefs) |
|---|---|---|
| `headline` (largo medio) | 53 car. | **144 car.** |
| `why_now` | 126 car. | **430 car.** |
| `fit_summary` | 107 car. | **542 car.** |
| Evidencias | **9,9** | 7,5 |
| Próximas acciones | 2,5 | **4,5** |
| **Contactos recomendados** | **4,9** | **0,0** ⚠️ |
| Warnings | 0 | 0 |

### Conclusión: hay UNA diferencia sustancial, y no está en la calidad del texto

La prosa del client-assisted es **3-5x más rica** (Claude Opus del lado del cliente redacta
mejor y propone más acciones). Con menos evidencias citadas pero más desarrolladas. Para el
contenido narrativo, el modo cliente no sólo no degrada: mejora.

La diferencia que importa es estructural: **el brief client-assisted llega con
`recommended_contacts` vacío**. No es el prompt ni el modelo — es el handler. El insert de
`lib/v3/mcp-client-ai.ts:252` escribe sólo 11 campos y **omite**:

- `recommended_contacts` → el brief no sugiere a quién contactar
- `coverage`, `freshness`, `warnings` → se pierde la trazabilidad de cobertura y frescura
- `scorecard_id`, `research_job_id` → el brief queda huérfano, sin vínculo al scorecard ni al job
- `status`, `profile_version`, `snapshot_version` → sin estado ni versionado de perfil

Comparado con el insert del modo server (`lib/v3/services/preliminary-fit.ts:58`), que sí
setea los 20 campos. Es un gap de paridad del handler, no de la IA. → **BUG-1**.

---

## 2. ¿El client-assisted se sube a ASCI como info de la cuenta?

Respuesta corta: **el circuito está construido, pero hoy no publica nada.** Hay que separar
dos caminos, porque se comportan distinto.

### Camino A — research/brief (el que corrí en el test): NO publica

`mcp-client-ai.ts` escribe únicamente a tablas **privadas del workspace**:
`account_briefs`, `account_scorecards`, `icebreakers`, `client_ai_executions`,
`client_ai_stage_submissions`. Cero escrituras a las tablas públicas de compañía.

Los stages que ejecutó el cliente (`internal_analysis`, `fit_scoring`,
`signal_classification`, `account_brief`) quedan como material del workspace. Según el
modelo que definiste, el análisis de señales **debería** volverse info pública de la
compañía, y hoy no lo hace. → **BUG-4** (gap de diseño, no defecto de código).

### Camino B — drilldown de noticias y casos de éxito: SÍ está diseñado para publicar

Las tools `prepare_company_news` / `submit_company_news` y
`prepare_company_success_cases` / `submit_company_success_cases` sí apuntan al corpus
público: `external-drilldown.ts:176` inserta en `public.company_implementations` con
`ai_provider: "client_mcp"`.

**Pero nunca se ejecutó.** Conteo por proveedor en producción:

| Tabla | Proveedores presentes | `client_mcp` |
|---|---|---|
| `company_implementations` | parallel (385), perplexity (97), gemini-2.0-flash (57), null (51), serpapi (30), gemini (27), gemini-relaxed (3) | **0** |
| `company_news` | gemini (65), null (49), serpapi (48) | **0** |

Todo el corpus público actual lo generó el research de **v2**. El caño del client-assisted
hacia la info pública existe, está cableado, y **nunca entregó una fila**. → **BUG-5**.

---

## 3. Listado de bugs

Ordenados por impacto. Estado: 🔴 abierto · ✅ arreglado en esta sesión.

### ✅ BUG-0 — Subreporte de costo de 1,65x (ARREGLADO)

`MODEL_PRICING` en `lib/v3/usage.ts` usaba claves con punto (`claude-opus-4.5`) y el AI
Gateway emite el id con guion (`claude-opus-4-5`). Todo Anthropic caía al `DEFAULT_PRICING`
de $3/$15 en vez de $5/$25 de Opus. La misma llamada pasa de $0,431091 a $0,718485.
Arreglado con `normalizeModelKey`, que compara sin separadores. Gemini nunca estuvo
afectado.

### 🔴 BUG-1 — El brief client-assisted pierde 9 campos (ALTO)

Detallado en §1. `mcp-client-ai.ts:252` omite `recommended_contacts`, `coverage`,
`freshness`, `warnings`, `scorecard_id`, `research_job_id`, `status`, `profile_version`,
`snapshot_version`. Efecto visible: briefs sin contactos sugeridos y sin trazabilidad.
Impacto directo en la utilidad del modo que queremos empujar.

### 🔴 BUG-2 — Atribución de costo incompleta (ALTO para negocio)

`logAiUsage` no escribe `research_job_id` ni `api_key_id`, aunque las columnas existen. No
se puede saber cuánto costó un job concreto ni imputar gasto a una API key o a un cliente.
Fix contenido a una función, sin migración.

### 🔴 BUG-3 — La cuota cobra igual dos costos que difieren en infinito (ALTO para negocio)

Medición final del research server-managed sobre Grupo Boldt (300 señales):

| | server-managed | client-assisted |
|---|---|---|
| Costo IA para ASCI | **$3,3905** | **$0,00** |
| Duración | 761 s (12,7 min) | — |
| Llamadas / tokens | 14 · 588.324 in / 39.545 out | 0 |
| Filas en `ai_usage_log` | 135 | 0 |

La cuota cobra "1 unidad" por cuenta en ambos casos. El input es **15x** el output: el
costo está en lo que se le manda al modelo, no en lo que genera.

### 🔴 BUG-4 — El análisis client-assisted no alimenta el corpus público (MEDIO)

§2 camino A. Los stages de clasificación de señales del modo cliente quedan encerrados en
el workspace, cuando por el modelo definido deberían enriquecer la info pública de la
compañía. Se pierde el efecto de red: el trabajo de un usuario no beneficia a los demás.

### 🔴 BUG-5 — El caño de publicación nunca entregó (MEDIO)

§2 camino B. `submit_company_news` / `submit_company_success_cases` están cableados a
`public.company_*` con `ai_provider='client_mcp'` y tienen 0 filas. Hay que determinar si
es porque nunca se invocaron o porque fallan al invocarse — no está diagnosticado.

### 🔴 BUG-6 — La key de producción no puede guardar cuentas (MEDIO)

La key real de Claude tiene `accounts:read` pero no `accounts:write`, así que `save_account`
falla con `MISSING_SCOPE` desde el chat. Puede ser deliberado; si no lo es, el flujo de
guardar cuenta desde el chat está roto en producción.

### 🔴 BUG-7 — `getCompanySignalSummary` no recibe `workspaceId` (BAJO)

Único resto real del tema aislamiento. La función no recibe `workspaceId` y usa
`createAdminClient()` (service_role, saltea RLS). Dado que el corpus es público, **hoy no
hay fuga**. Pero significa que si mañana querés marcar algo de ese corpus como privado, la
función no tiene con qué filtrar. Es deuda técnica, no vulnerabilidad.

### Nota — dos afirmaciones mías previas que quedaron sin sustento

1. **`generation_mode` no está roto.** Dije que salía de un DEFAULT que el código nunca
   setea. Falso: se setea explícito como `"client_model"` en `account_scorecards`,
   `account_briefs` e `icebreakers`. La confusión fue mía por buscar la comparación de modos
   en `ai_usage_log`, que por definición sólo puede tener filas server-managed.
2. **La proyección de costo por regla de tres sobreestima.** A 63% proyecté ~$5 reales; el
   final fue $3,39. Los pasos finales son más baratos que los de radar.

---

## 4. Plan de mejoras

Más allá de arreglar bugs, esto es lo que el recorrido dejó a la vista.

### MEJ-1 — Empujar el drilldown a client-assisted (mayor impacto en margen)

Es la palanca más grande: **$3,39 → $0 por cuenta**, con prosa que además mide mejor. Se
apoya en resolver BUG-1 para que el modo cliente alcance paridad estructural. Pendiente de
definición: si el modo cliente pasa a ser el default cuando el usuario entra por MCP, y qué
pasa con quien entra por la web (donde no hay modelo de cliente que preste inferencia).

### MEJ-2 — Recortar el input, no el modelo

El costo es 15x input vs output. Cada paso de radar manda 80-130k tokens. Antes de pensar
en bajar de Opus a Sonnet (que degradaría la calidad), hay margen en qué se le manda:
deduplicar señales entre pasos, recortar el snapshot a lo que cada categoría necesita,
cachear la parte del prompt que se repite entre las N categorías. Un 40% menos de input es
un 40% menos de factura, sin tocar calidad.

### MEJ-3 — Unificar los dos inserts de brief

BUG-1 existe porque hay **dos** lugares que construyen un `account_briefs` con dos listas de
campos distintas (`preliminary-fit.ts` y `mcp-client-ai.ts`). Mientras sigan duplicados van
a volver a divergir. Un único constructor de brief que ambos caminos usen elimina la clase
entera de bug, no sólo esta instancia.

### MEJ-4 — Feedback de progreso en el research asíncrono

`run_account_research` devuelve `batchId` en 2s y tarda 12,7 min. Un modelo que recibe ese
OK asume que terminó — me pasó a mí en el primer intento de medición. Existe
`get_research_status`, pero conviene que la respuesta del `run` diga explícitamente que hay
que hacer polling, cada cuánto y con qué tool.

### MEJ-5 — Cerrar el circuito del efecto de red

BUG-4 + BUG-5. Que el trabajo de análisis de un usuario enriquezca el corpus público es la
ventaja compuesta del producto: cada research hace más valiosa la plataforma para todos. Hoy
ese circuito está cableado y apagado.

---

## 5. Paridad MCP vs web: qué le falta al MCP

Superficie comparada. La web v3 tiene estas rutas: `accounts`, `accounts/[companyId]`,
`campaigns`, `chat`, `docs`, `onboarding`, `settings`, `settings/api-keys`,
`settings/workspace`, `admin/{agents,prompts,usage,users,workspaces}`.

El MCP expone 36 tools que cubren bien: búsqueda y guardado de cuentas, inteligencia y
evidencia, señales, contactos, enriquecimiento, icebreakers, documentos, research en ambos
modos, y uso/cuota.

### Faltantes identificados

| # | Funcionalidad web | Estado en MCP | Notas |
|---|---|---|---|
| **GAP-1** | **Campañas** (`v3.campaigns`, `campaign_accounts`, `campaign_account_digest`) | **Ausente por completo** | Ninguna tool de campañas. Es el faltante más grande: no se puede crear campaña, agregarle cuentas ni leer el digest desde el chat. |
| **GAP-2** | **Propuesta de valor** (`v3.workspace_value_profiles`) | Sólo lectura indirecta | Existe `recommend_accounts_for_value_proposition` (consume la propuesta) pero **no hay tool para crearla o editarla**. Y es un insumo obligatorio: sin ella el `fit_summary` sale como "Fit no evaluado". Un usuario nuevo por MCP no puede arrancar. |
| **GAP-3** | **Onboarding** | Ausente | Sin equivalente conversacional del setup inicial. Encadenado con GAP-2. |
| **GAP-4** | **Settings de workspace / API keys** | Ausente | Sin gestión de miembros, invitaciones ni keys. Defendible por seguridad, pero hay que decidirlo explícitamente. |
| **GAP-5** | **Admin** (agents, prompts, usage, users, workspaces) | Parcial | Sólo `get_ai_usage`. El resto del panel super-admin no está expuesto. Probablemente correcto que no lo esté. |
| **GAP-6** | **Bookmarks de contactos** | Parcial | Hay `get_company_contacts` y `run_contact_enrichment`, pero no vi tool para gestionar el bookmark del usuario. Según tu modelo, los decision makers de Apollo van al bookmark del usuario **y** al corpus público — falta confirmar que ambas escrituras ocurran. |

### Priorización sugerida

1. **GAP-2 (propuesta de valor)** — desbloquea el fit scoring, que hoy sale vacío. Es el que
   más valor entrega por línea de código.
2. **GAP-1 (campañas)** — el faltante funcional más grande.
3. **GAP-6 (bookmarks)** — verificar primero si es gap real o si ya está cubierto.
4. **GAP-3** — depende de GAP-2.
5. **GAP-4 / GAP-5** — decisión de política, no de implementación.
