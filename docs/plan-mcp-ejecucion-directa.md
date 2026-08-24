# Plan de implementación — MCP para ejecución directa sobre listas

**Estado:** propuesta, pendiente de validación
**Insumo:** `ASCI MCP — Diseño para ejecución directa` (sesión 24-ago-2026, screening Power BI / 61 cuentas Chile)
**Alcance:** MCP `asci-v3` (`app/api/v3/mcp/server/[transport]/route.ts` + `lib/v3/**`)

---

## 1. Qué validé del diagnóstico contra el código

El documento base es correcto en lo esencial: **el MCP está diseñado para exploración conversacional de una cuenta y el caso real es procesamiento de lotes contra una lista del cliente.** Verifiqué punto por punto contra el código y hay tres cosas que hay que corregir antes de implementar, porque cambian *qué* se toca y *en qué orden*.

### Confirmado sin cambios

| Punto del `.md` | Verificación |
|---|---|
| §2.1 No hay cruce de lista | Confirmado. `search_companies` resuelve 1 nombre (`v3.search_companies_ranked`, scripts/426) y `search_companies_by_capability` va término → empresas (`v3.search_companies_by_capability`, scripts/429). Las dos piezas existen; falta la que las cruza. |
| §2.3 El atajo no escala | Confirmado. `getCompanySignalSummary` con `detail:"full"` trae hasta 100 señales, 30 implementaciones y 30 vacantes con 500 caracteres de descripción cada una (`lib/v3/services/company-signal-summary.ts:6-9, 97-99`). |
| §2.5 Cuatro medidores en tres tools | Confirmado. `getMcpUsage` (`lib/v3/mcp-usage.ts:324`) no expone créditos Apollo; viven en `getContactEnrichmentLimits` (`lib/v3/plans.ts:318`), a los que solo se llega desde `prepare_contact_enrichment`. |
| §2.6 Sin export | Confirmado, y hay camino: `exceljs` ya es dependencia y el patrón de Storage + `createSignedUrl` ya se usa en `app/actions/v3/documents.ts:383`. |
| §2.7 Teléfono | Confirmado como gap funcional: `getCompanyContacts` evalúa frescura de `phone` (`lib/v3/mcp-contact-coverage.ts:404`) pero el enrichment escribe `phone_status: "not_requested"` (`lib/v3/services/mcp-contact-enrichment.ts:593`). |
| §7.1 El enforcement vive en el server | Confirmado como principio y hoy **no existe** tope de presupuesto: `reserveMcpUsage` cuenta unidades del plan, no dólares. |

### Corrección 1 — El gate de `get_account_evidence_detail` no es el problema; la ausencia de datos globales sí

El `.md` (§2.2, §9 Fase 1) propone "sacar el gating de workspace de las tools Tier 0". Para esta tool **eso no alcanza y dejaría un vacío silencioso**:

- `getAccountEvidenceDetailTool` llama `assertWorkspaceAccount` (`lib/v3/mcp-read-tools.ts:180`), sí.
- Pero lo que lee es `v3.account_evidence_details` (`lib/v3/services/internal-account-snapshot.ts:340`), una tabla **scopeada por workspace y materializada por el research**. Sin research no hay fila que leer: sacar el guard devuelve `[]` igual, solo que sin explicar por qué.

La evidencia cruda global **sí existe** en `public.signals`, con `snippet`, `source_url`, `source_field`, `is_current_employee` y `contact_id`. Es exactamente de donde lee `get_company_signal_summary`.

**Consecuencia para el plan:** `detail: "evidence"` (§5.2) no es "un nivel intermedio más", es *el* fix de §2.2 y sube de prioridad. Y `get_account_evidence_detail` debe hacer **fallback a lectura global** con `source: "global_signals" | "workspace_snapshot"`, en vez de responder "corré prepare_account_research".

### Corrección 2 — `get_company_signal_summary` hoy no está gateada

El `.md` la lista entre las tools Tier 0 violadas (§3, "Hoy se viola en"). No lo está: `route.ts:247` solo llama `requirePaidMcp(..., "read")` y `getCompanySignalSummary(companyId, detail)` es global, sin `assertWorkspaceAccount`. De esa lista la única realmente gateada es `get_account_evidence_detail` (y por la Corrección 1). `get_company_contacts` es workspace-scoped por naturaleza —son contactos que el workspace compró—, así que ahí el gate es correcto.

**Consecuencia:** el ítem "sacar el gating de las tools Tier 0" de la Fase 1 se reduce a un solo caso y se resuelve con el fallback, no con un `delete`.

### Corrección 3 — La inflación de alias no viene de donde dice el documento

El `.md` (§2.4) atribuye el número inflado de Consorcio a `search_companies_by_capability`. Esa RPC **no consolida**: agrupa por `company_id` (CTE `per_company`, scripts/429:155-175). El 24 salió de `get_company_signal_summary`, y la causa es de diez líneas:

```ts
// lib/v3/services/company-signal-summary.ts:24-33
const nameScore = canonical.size ? shared.length / canonical.size : 0
```

Con una canónica de **un solo token** ("consorcio"), *cualquier* empresa cuyo nombre contenga ese token da `shared.length / 1 = 1.0`, pasa el filtro `score >= 0.6` (línea 84) y entra con `confidence: 1`. El score no es simétrico: no penaliza que el candidato tenga tres tokens y comparta uno.

**Consecuencia:** es un bug puntual con fix acotado y testeable, no un rediseño. Pero además, **en el flujo de listas el riesgo dominante es el inverso**: no la consolidación de más, sino la **mis-atribución** —elegir el homónimo equivocado para "CONSORCIO SEGUROS"— y la **fragmentación** —que la cuenta real esté partida en varias entidades y el conteo salga bajo. El contrato de `screen_account_list` tiene que exponer las dos cosas.

### Observación de performance (a favor)

`screen_account_list` es **más barata** que `search_companies_by_capability`, no más cara. El costo dominante de la búsqueda inversa es el escaneo global de `public.signals` (1,5M filas / 986 MB, medido 6,6 s en frío, scripts/429:31-46). Acá el orden se invierte: primero se resuelven los nombres a `company_id` (índice sobre `normalized_name`, barato) y recién después se cuentan señales filtrando por `company_id = ANY(...)`. El filtro más selectivo va primero.

---

## 2. Lo que no haría tal cual está escrito

1. **No sacar el guard de `get_account_evidence_detail` sin el fallback global.** Cambia un error explicativo por un vacío mudo. Ver Corrección 1.
2. **No dejar que `screen_account_list` resuelva la ambigüedad sola.** El ranking de `search_companies_ranked` está calibrado para una consulta interactiva donde un humano confirma. En un lote de 61 no hay 61 confirmaciones: el estado `matched_ambiguous` con candidatos y `matchConfidence` es obligatorio, y **nunca** puede colapsar en `matched`. Un icebreaker que cite evidencia de la constructora peruana atribuyéndosela a la aseguradora chilena es el peor error posible (§7.7 del `.md`, y coincido).
3. **No mover el cupo del Tier 2b sin decisión de pricing.** El `.md` lo plantea bien como pregunta abierta (§3 Tier 2b, §8). Es una decisión de negocio, no de código: lo dejo en Fase 4 con la decisión explicitada, no lo resuelvo por default.

---

## 3. Plan por fases

### Fase 0 — Precisión de alias (prerequisito)

El `.md` lo pone en Fase 4 pero él mismo dice que es prerequisito (§7.7). Coincido: **va primero**, porque todos los números que devuelvan las tools nuevas se apoyan en esto.

| Cambio | Archivo |
|---|---|
| `aliasScore` simétrico (Dice: `2·|∩| / (|A|+|B|)`). "Consorcio Cotienne-Arespa" pasa de 1.0 a 0.5 y queda afuera del umbral 0.6 | `lib/v3/services/company-signal-summary.ts:24-33` |
| Guarda de token único: si la canónica tiene ≤1 token discriminativo, exigir `domainMatch` (o país) para consolidar | ídem |
| Parámetro `aliasStrategy: "strict" \| "balanced" \| "broad"` | ídem + `route.ts:247` (schema zod) |
| Separar `signalsOwn` (la entidad pedida) de `signalsConsolidated` (con alias), y que `aliasWarning` liste los nombres consolidados, no solo el conteo | ídem |
| Tests de fixture: Consorcio, CCU, CGE, Melón, Masisa, EMIN, Colbún — los nombres cortos o genéricos que enumera el `.md` §2.4 | `tests/unit/shared/alias-score.test.ts` (nuevo) |

**Riesgo:** cambia números que el usuario ya vio. Mitigación: `signalsOwn` / `signalsConsolidated` explícitos, más la decisión de default (ver §5, decisión B).
**Esfuerzo:** ~0,5 día.

### Fase 1 — Desbloquear el caso de uso

**1.1 `screen_account_list`** — la pieza que falta.

- SQL nueva `v3.screen_account_list(...)` en `scripts/456_v3_screen_account_list.sql` + `supabase/migrations/`.
  - Entrada: `p_accounts jsonb` (`[{name, domain?}]`, hasta 200), `p_product_ids`, `p_process_ids`, `p_countries`, `p_min_signals`, `p_match_threshold`, `p_alias_strategy`.
  - Matching en dos pasadas: exacta por `company_core_name()` (la normalización canónica única, scripts/455) resuelta como join set-based para todos los nombres de una; difusa (prefijo / contiene, mismo `tier` que scripts/426) **solo** para los que fallan la exacta.
  - Conteo por término filtrando `company_id = ANY(...)`, reusando la forma del CTE `matched` de scripts/429 (`UNION ALL` producto/proceso, `count(*)` sin `DISTINCT`).
  - Devuelve **una fila por input**, nunca por match.
- `lib/v3/services/screen-account-list.ts`: resolución de términos reusando `resolveCapabilityTerms` (`lib/v3/services/capability-search.ts:145`), armado del payload y warnings.
- Tool `screen_account_list` en `route.ts`: **Tier 0** — sin cupo, sin `assertWorkspaceAccount`, sin confirmación.

Contrato (una fila por input, cuatro estados):

```
status: "matched" | "matched_ambiguous" | "matched_no_signal" | "no_match"
```

`matched_no_signal` ("está en ASCI, no tiene la señal") y `no_match` ("no está en ASCI") se separan porque comercialmente son cosas distintas: la primera es un descarte legítimo, la segunda se resuelve scrapeando. Cada fila lleva `matchConfidence`, `signalsOwn`, `signalsConsolidated`, `aliasWarning` y, en `matched_ambiguous`, `candidates[]`.

**1.2 `detail: "evidence"`** en `get_company_signal_summary` (`+ term`): solo el término pedido, máximo 2 fragmentos, con `sourceField`, `occurredAt`, `sourceUrl`, `personLinkedIn` e `isCurrentEmployee`. Objetivo &lt;600 tokens por cuenta. El flag de ex-empleado **tiene que sobrevivir** (§7.4 del `.md`): lo tomo como requisito de contrato, con test.

**1.3 Fallback global en `get_account_evidence_detail`**: si no hay snapshot de workspace, leer `public.signals` y devolver `source: "global_signals"` con el `nextAction` correcto, en vez de `ACCOUNT_NOT_AVAILABLE_IN_WORKSPACE`.

**1.4 `minSignals` con default 2** en el flujo de listas (§7.5: 20 de 42 cuentas tenían 1-2 señales) y `confidenceLevel` por fila en el output.

**1.5** Actualizar `instructions` del server (`route.ts:395-405`) y descripciones para que el modelo llegue a `screen_account_list` cuando el usuario trae una lista.

**Esfuerzo:** ~3-4 días. **Riesgo principal:** performance del matching difuso con 200 nombres contra el techo de 8 s de PostgREST. Mitigación: la pasada exacta resuelve la mayoría, la difusa va acotada y medida; si hace falta, índice trigram sobre `name` (decisión explícita, no se crea a ciegas — mismo criterio que scripts/429).

### Fase 2 — Control de costos

- Tabla `v3.mcp_batch_plans` (`batch_plan_hash`, workspace, payload congelado, `expires_at`, estado). Mismo patrón que `plan_hash` de enrichment (`lib/v3/services/mcp-contact-enrichment.ts:285-317`), que es lo mejor diseñado del MCP hoy y conviene replicar tal cual.
- Tool `estimate_batch` (Tier 0): agrega `checkResearchQuota` + `getContactEnrichmentLimits` + `PLAN_CONFIG` + `cacheHits` y devuelve **un** `batchPlanHash`. El costo USD sale de datos reales, no de una constante: promedio por cuenta de `v3.ai_usage_log` de los últimos 90 días (la telemetría ya existe: `verifiedAi.costUsd`).
- Exponer créditos Apollo en `get_ai_usage` (`lib/v3/mcp-usage.ts:324`), que hoy es el único medidor que no se puede consultar a priori.
- **Presupuesto por workspace con enforcement server-side** (§7.1): columna de tope mensual en USD + verificación dentro de `reserveMcpUsage`, que rechaza por encima del tope. En el server, no en el prompt.

**Esfuerzo:** ~2-3 días.

### Fase 3 — Escala

- `create_batch_job(batchPlanHash)` / `get_batch_job(jobId)` con estado por cuenta y reanudación, reusando `research-pipeline.ts` (`createResearchBatch` / `runResearchJob`) más una tabla de estado por lote.
- `create_export(jobId)` → `exceljs` (ya es dependencia) → bucket `workspace-exports` → `createSignedUrl` TTL 24 h (patrón de `app/actions/v3/documents.ts:383`). Resuelve el límite de 200 y el costo de transportar tablas por la conversación.
- Icebreaker `mode: "evidence_quote"` — template determinístico, Tier 0, sin IA y sin riesgo de alucinación. **Por default agrega en vez de individualizar** ("el equipo de TI reporta Power BI a nivel alto en varios perfiles"), con el nombre propio como opción explícita. Es la recomendación §7.3 del `.md` y la comparto: Ley 19.628 / 21.719 en Chile, GDPR si hay matriz europea, y además es incómodo de recibir.
- Sanitizar fragmentos antes de pasarlos a un modelo (§7.2): la evidencia sale de perfiles y vacantes escritos por terceros; es superficie de inyección directa. Se tratan como datos, nunca como instrucciones.

**Esfuerzo:** ~4-5 días.

### Fase 4 — Precisión y modelo de negocio

No es código en su mayoría, son decisiones:

- Separar cuentas **seguidas** (refresh programado, consume cupo) de **consultadas** (lectura puntual, no consume). Hoy un solo reporte de cliente puede agotar el plan: 42 de 60 en esta sesión, 139 en el de Legrand (§7.6).
- `includePhone` con costo diferencial explícito (§2.7).
- BYOK de Apollo (§8): elimina capital de trabajo inmovilizado, exposición de margen y soporte por cupos agotados a mitad de reporte.
- Revisar el cupo del Tier 2b: si el cliente pone los tokens, ASCI solo valida y persiste (§3 Tier 2b).

---

## 4. Cómo se vería el pedido original al final de la Fase 3

```
1. screen_account_list(61 nombres, "Power BI", Chile, strict)   [Tier 0, directo]
2. estimate_batch("research+enrichment", 42 ids, roles)         [Tier 0, directo]
   ── único punto de confirmación humana ──
3. create_batch_job(batchPlanHash)                              [Tier 2 + 3, autorizado]
4. create_export(jobId)                                         → planilla
```

Con la Fase 1 sola, el paso 1 ya reemplaza las 9 llamadas de paginación y el matching por orden alfabético.

---

## 5. Decisiones que necesito validar antes de escribir código

**A. Alcance del primer entregable.** Fase 0 + Fase 1 (desbloquea el caso, ~4 días) o hasta Fase 2 (suma control de costos, ~7 días).

**B. Default de `aliasStrategy`.** `strict` global cambia números que el usuario ya vio en pantalla pero corrige la inflación en todos lados; `balanced` como default y `strict` solo en las tools nuevas es más conservador pero deja el número inflado donde ya está.

**C. Icebreaker sin IA: agregado o nominal por default.** Recomiendo agregado (no nombrar personas físicas), con nominal como opción que el vendedor activa a conciencia.

**D. Modelo de cupo.** Si la separación seguidas/consultadas se decide ahora, la diseño desde la Fase 1; si es decisión de pricing posterior, las tools nuevas quedan Tier 0 puras y no tocan el cupo (que igual es lo correcto).
