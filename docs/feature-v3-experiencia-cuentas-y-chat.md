# Feature: Experiencia v3 — Chat de búsqueda, rediseño de la cuenta, vacantes digeridas y Personas

> **Fecha**: 19 de agosto 2026
> **Estado**: Diseño propuesto (pendiente de aprobación de producto)
> **Alcance**: v3 (bot.bigua.lat) — no toca v2
> **Origen**: punteo de producto post-implementación de carga masiva + scraping automático
> (ver `feature-carga-masiva-cuentas-y-cron-jobpostings.md`, todo implementado a ago-2026)

Cuatro iniciativas que comparten un mismo principio: **la UI de v3 debe recorrer el mismo
funnel que ya diseñamos y testeamos en el MCP** (descubrir → guardar → investigar → leer
→ contactos → outreach), con **datos accionables por delante y prosa de IA por detrás**.

---

## 0. Principios de diseño (aplican a las 4 iniciativas)

1. **Mismo funnel, una sola capa.** El MCP ya define el viaje correcto con sus guardrails
   (cuenta guardada antes de gastar, `prepare → confirmación explícita → run`, cuotas por
   pool). La UI no inventa un viaje paralelo: expone el mismo, con los `userConfirmed` del
   MCP traducidos a diálogos de confirmación. Regla de implementación: las tools del chat
   y las del MCP consumen la MISMA capa de servicios (`lib/v3/services/*`, `mcp-*`); lo
   que hoy es exclusivo del MCP se extrae a servicio compartido, nunca se duplica inline.
2. **Datos > prosa.** Todo lo que pueda ser chip, badge, número o lista, no es un párrafo.
   La prosa de IA queda en tres lugares y acotada: el "por qué ahora" (≤400 chars), el
   racional del score (≤400 chars) y los icebreakers. Todo lo demás redactado se elimina
   o se colapsa detrás de un expand.
3. **Lo accionable arriba.** Cada pantalla abre con lo que el vendedor puede HACER
   (seguir, investigar, buscar decisores, generar icebreaker) y lo que cambió (delta de
   score, vacantes nuevas, señales frescas). El contexto justificativo va después.
4. **Simple = pocas superficies.** Se mantienen las 5 pestañas actuales de la cuenta y el
   chat existente; nada de pantallas nuevas salvo lo estrictamente indicado.

---

## A. Chat de ingreso = búsqueda en lenguaje natural + tablero accionable

### A.1 Problema

El chat actual (`/v3/chat`) funciona como orquestador conversacional cuenta-céntrico con
10 tools propias (`app/api/v3/chat/route.ts:47-350`), pero **no puede buscar el mercado**:
no expone `search_companies_by_capability` ("qué empresas usan Power BI"), ni el filtro
por industria/país, ni `recommend_accounts_for_value_proposition`. La consulta que define
la iniciativa — *"compañías con Power BI en Argentina que sean bancos"* — hoy no tiene
respuesta en la UI: solo en el MCP.

Además chat y MCP tienen sets de tools **disjuntos** (10 inline vs 34 del server), lo que
significa doble mantenimiento y funnels divergentes: el chat usa `followAccounts` directo
(sin preview de costo de cupo) mientras el MCP exige `prepare_save_account → save_account`
con confirmación.

### A.2 Diseño

**El chat pasa a ser LA pantalla de ingreso a la prospección**, con la búsqueda en
lenguaje natural como caso de uso primario y el resto del funnel encadenado detrás.

```
Usuario: "compañías con powerbi en argentina que sean bancos"
   │
   ▼  tool searchByCapability (nueva en chat; misma lógica que el MCP:
   │   screening por término del diccionario + país ISO + industria maestra)
   ▼
┌─ SearchResultsCard ────────────────────────────────────────────┐
│ 23 compañías · Power BI · Argentina · Banking                  │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ ☐ Banco Galicia      412 señales · 8 vacantes   [Seguir]   │ │
│ │ ☐ Banco Macro        233 señales · 3 vacantes   [Seguir]   │ │
│ │ ☐ BBVA Argentina     198 señales · 0 vacantes   [Seguir]   │ │
│ │   … (scroll, hasta 20)                                     │ │
│ └────────────────────────────────────────────────────────────┘ │
│ [Seguir seleccionadas (3)]   Cupo del plan: 41/120             │
└────────────────────────────────────────────────────────────────┘
```

Decisiones:

- **El resultado es un LISTADO, no prosa.** `SearchResultsCard` nueva en
  `tool-cards.tsx`: filas con checkbox, nombre, país, industria, conteo de señales y
  vacantes, link "ver señales" (drawer o `/v3/accounts/{id}` si ya está seguida). El
  modelo introduce el resultado en una línea, no lo narra.
- **Follow directo desde la card, con el gate del funnel.** El botón "Seguir" NO hace el
  round-trip por el modelo (el patrón `sendMessage` actual mete latencia y tokens): llama
  una server action que reusa la lógica de `prepare_save_account` + `followAccount` —
  muestra el costo de cupo ("ocupa 1 de tus 120") y confirma en un popover. El follow
  dispara el kick de scraping de vacantes ya implementado (Fase 4). Multi-select para
  seguir en lote respetando el preflight de cupo (mismo patrón del import masivo).
- **Vocabulario del diccionario.** "powerbi" se canoniza con
  `resolveProductByName`/`resolveProcessByName` (`lib/v3/services/dictionary.ts:159/187`);
  si el término no existe, la card lo dice y sugiere los más cercanos — nunca una
  búsqueda silenciosamente vacía. Industria vía el sistema de industrias maestras.

### A.3 Paridad de tools chat ↔ MCP (cierre de la brecha)

Tools a AGREGAR al chat (todas reusan servicios existentes; ninguna se reimplementa):

| Tool nueva del chat | Servicio que reusa | Gate/cuota |
|---|---|---|
| `searchByCapability` | `v3.search_companies_by_capability` (capability-search) | read, gratis |
| `getSignalSummary` | `company-signal-summary.ts` | read, gratis |
| `getEvidenceDetail` | `mcp-read-tools.getAccountEvidenceDetailTool` | read, gratis |
| `recommendAccountsForValueProp` | `value-proposition-recommender.ts` | read |
| `scrapeJobPostings` | `job-scrape-runner.scrapeCompanyJobPostings` | cuenta seguida + cooldown (ya lo maneja el runner) |
| `recommendContactRoles` | `mcp-contact-coverage.recommendContactRoles` | cuenta seguida, gratis |
| `getContactCoverage` | `mcp-contact-coverage.getCompanyContacts` | cuenta seguida, gratis |
| `prepareContactEnrichment` / `runContactEnrichment` | `mcp-contact-enrichment` | prepare gratis; run gasta créditos → **card de confirmación** con costo y planHash (el `userConfirmed` del MCP se vuelve un botón) |

Lo que el chat ya tiene (resolve, preview, research, overview, follow, icebreakers) se
mantiene; `followAccounts` incorpora el preview de cupo de `prepare_save_account`.

**Refactor habilitante:** extraer las definiciones de tools del chat de la route a
`lib/v3/chat-tools.ts` y hacer que cada una delegue en el servicio compartido. El MCP no
cambia. Criterio de terminado: ninguna lógica de negocio vive en `app/api/v3/chat/route.ts`.

### A.4 Cuotas del chat

El chat corre server-managed (lo paga ASCI, `logAiUsage feature "chat"`). Las tools que
gastan pools (research, enrichment, scraping) descuentan de los MISMOS pools del plan que
el MCP (`reserveMcpUsage` o su equivalente por sesión) — una sola contabilidad, ver D.4.

---

## B. Rediseño de la vista de cuenta

### B.1 Problema (diagnóstico con el código en la mano)

La pantalla actual (`account-detail-view.tsx`, 749 líneas) entierra lo útil bajo prosa:

- **`brief.headline`** (el "subtítulo redactado", `:398`): hasta 300 chars de narrativa
  que repite lo que el score y los chips ya dicen. **Se elimina del render.**
- **`brief.why_now` y `brief.fit_summary`** (`:408`, `:412`): hasta **3.000 caracteres
  cada uno** en modo client-AI. Y en modo server-managed `fit_summary` ES
  `scorecard.rationale` (`final-account-brief.ts:67`) → **el mismo párrafo aparece dos
  veces en la pantalla** (brief card y scorecard).
- **`scorecard.rationale`** (`:628`): hasta 3.000 chars más.
- **`finding.summary` × hasta 80 findings**: decenas de párrafos de micro-agentes.
- Mientras tanto, `brief.evidence`, `freshness` y `warnings` se cargan y **no se
  renderizan**, y `recommended_contacts` solo aparece como un contador.

### B.2 Nueva jerarquía (misma página, mismas 5 pestañas)

```
┌─ HEADER ────────────────────────────────────────────────────────────┐
│ Banco Ripley Chile  [78] (+6)   bancoripley.com · Chile · Banking   │
│ [Digest ●] [Dejar de seguir] [Chat]                                 │
├─ RESUMEN EJECUTIVO (reemplaza AccountBriefCard) ────────────────────┤
│ Fit 75 · Señales 88 · Acceso 55 · Timing 90      (4 barras, igual)  │
│ ▸ Por qué ahora (1 línea, ≤400 chars): "44 vacantes IT activas en   │
│   Las Condes incl. Data Architect e Ing. de IA (ago-2026)."         │
│ ▸ Chips de evidencia: [AWS ✓] [GCP ✓] [Python ✓] [DevOps ✓] [+3]    │
│ ▸ Próximos pasos (máx 3, un renglón cada uno, con CTA):             │
│     · Buscar Gerencia Analytics y BI  →  [Buscar decisores]         │
│     · Generar icebreaker para pitch de modernización  →  [Generar]  │
│ ▸ "Ver análisis completo" (collapse: ahí vive la prosa larga)       │
└─────────────────────────────────────────────────────────────────────┘
[Radiografía] [Señales] [Contexto] [Icebreakers] [Historial]
```

Reglas del bloque superior:

1. **Un solo bloque narrativo, no dos.** Se fusionan AccountBriefCard y ScorecardCard en
   una card "Resumen ejecutivo": las 4 barras de sub-scores + tooltips actuales (que ya
   son buenos: fórmula y breakdown), UNA línea de "por qué ahora" y chips.
   `headline` deja de renderizarse; `fit_summary` deja de renderizarse en modo server
   (duplicado) y en modo client se muestra dentro del collapse.
2. **La prosa larga existe pero cerrada**: collapse "Ver análisis completo" con
   `why_now` + `rationale` completos. Default cerrado.
3. **Chips desde datos que ya llegan y hoy se tiran**: `brief.evidence` y
   `coverage` alimentan los chips de evidencia (tecnología ✓ confirmada / ~ probable);
   `recommended_contacts` alimenta los CTAs de próximos pasos.
4. **Recorte en origen, no solo en render**: los schemas de `mcp-client-ai.ts` bajan
   `whyNow`/`fitSummary`/`rationale` de 3.000 → **600 chars máx**, y los prompts
   (`v3.ai_prompts`, editables en `/v3/admin/prompts`) piden explícitamente "2 oraciones,
   sin repetir números que ya están en el scorecard". Lo mismo para
   `scoring.rationale` (ya pide 2-4 oraciones; se refuerza el "sin relleno").

**Prioridad de orden (feedback 20-ago-2026):** los tabs hoy quedan escondidos debajo de
dos cards de prosa — para llegar a Señales o Icebreakers hay que scrollear pantalla y
media. La fusión de arriba no alcanza si el resumen sigue siendo alto: el "Resumen
ejecutivo" arranca **colapsado a ~3 líneas** (score + barras + por qué ahora en 1 línea)
y la `TabsList` queda **inmediatamente debajo del header, sticky** al scrollear, de modo
que la navegación de la cuenta sea lo primero que se ve y nunca se pierda. La prosa
(análisis completo) vive dentro del collapse del resumen, no entre el header y los tabs.

### B.3 Pestañas, una por una

- **Radiografía** (hallazgos explícitos): se mantiene el accordion por área con lo bueno
  (badges Convergente/Directa, fuentes clickeables). Cambios: `finding.summary` con
  `line-clamp-2` + expand por card; los chips de `payload.technologies` pasan ARRIBA del
  summary (el dato antes que la prosa); filtro rápido por área en el header del tab.
- **Señales**: ya rediseñada (fit + vacantes con búsqueda/orden/expand). Se suma la
  iniciativa C (tags por vacante + facetas). La sección "Personas" se muda a D.
- **Contexto** (inferidos): cards compactas — título + badge de confianza + summary
  `line-clamp-2` con expand. El disclaimer de "hipótesis, no afirmaciones" se mantiene.
- **Icebreakers**: sin cambios estructurales (feedback 👍👎 y regenerar ya están); solo
  ordenar por versión/fecha desc y colapsar los antiguos.
- **Historial**: sin cambios (ya es solo datos).

### B.4 Qué se elimina (lista explícita)

| Elemento | Motivo |
|---|---|
| `brief.headline` renderizado | Narrativa que duplica score+chips; el título de la página ya identifica la cuenta |
| `fit_summary` en modo server | Es literalmente `scorecard.rationale` repetido |
| Banner verboso de "no seguida" | Se reduce a un botón con tooltip |
| Párrafos completos de findings a primera vista | `line-clamp-2` + expand |

---

## C. Vacantes pre-digeridas con tags del diccionario

### C.1 Qué existe ya (verificado)

Cada vacante que pasa por el ETL ya queda tagueada en `public.signals`:
`process_job_signals` (baseline:5800) matchea título+descripción contra
`dictionary_patterns_cache` e inserta una fila por `(job_posting_id, signal_type,
signal_id)` con `keyword_matched` — dedup garantizado por unique, así que "conteo por
tag" = cantidad de vacantes que lo tienen. `signal_type='technology'` →
`dictionary_products`, `'process'` → `dictionary_processes` (no existe tipo vendor).

### C.2 Diseño

**Data**: `listAccountJobPostings` (`job-posting-provider.ts:157`) suma **una query**:
`signals` con `.in("job_posting_id", ids)` (o por `company_id` para facetas globales), y
resuelve nombres en memoria con `loadDictionary()` (cache 5 min) construyendo los Map
id→name como hace `fit.ts:81`. No hay FK de `signal_id` a los diccionarios, así que el
embedding de PostgREST no aplica — es el patrón TS canónico. `UiJobPosting` gana
`tags: Array<{ type: "technology" | "process"; name: string }>`.

**UI** (dentro de la card de vacantes ya rediseñada):

```
[ Power BI (12) ] [ SAP (8) ] [ Transformación Digital (21) ] [ +5 ]   ← facetas
──────────────────────────────────────────────────────────────────────
Data Architect ↗  NUEVA                                  hace 13 horas
Las Condes · Mid-Senior · Full-time · +200 postulantes
[ AWS ] [ Python ] [ Arquitectura de Datos ]                ← tags fila
```

- **Facetas arriba**: los tags con su conteo, ordenados desc, clickeables como filtro
  (combinable con la búsqueda por texto existente). Es la respuesta de un vistazo a
  "¿qué está contratando esta empresa?" sin leer una sola descripción.
- **Chips por fila**: máx 4 + "+N"; tecnología y proceso con estilos distintos (mismo
  criterio visual que los chips de findings de Radiografía).
- **Caveat de frescura** (documentado en el relevamiento): una vacante recién scrapeada
  aparece sin tags hasta que `process-queue` corre `process_job_signals` (≤1-2 min); no
  se bloquea el render, los chips aparecen al refrescar.

---

## D. Personas (Apollo) integrada al funnel de la cuenta

### D.1 Problema

Hoy conviven dos vías desconectadas: la UI tiene una búsqueda 1-click limitada (solo
search, sin emails, roles por **regex hardcodeadas** `ROLE_RULES` de `accounts.ts:284`,
rate limit propio) mientras el MCP tiene el funnel completo y superior
(`recommend_contact_roles` justificado por señales reales del diccionario + tasa de éxito
histórica → `get_company_contacts` con frescura/cobertura → `prepare` con costo y
planHash → `run` que gasta créditos y revela emails). **Nada de la vía MCP está en la
UI**, y las contabilidades están separadas.

### D.2 Diseño: el mismo funnel del MCP, en 4 pasos visibles

**Decisión de producto (19-ago-2026): sección dentro del tab Señales, NO pestaña
propia.** El framing importa: las personas son ante todo **fuente de señales** — sus
puestos y experiencia son la evidencia de qué tecnologías usa la compañía (así funciona
ya el motor: `signals` con `contact_id`, `source_field` current/past_position y el flag
`is_current_employee` que distingue empleado actual de ex-empleado). El dato de contacto
es el remate del funnel, no el centro de la experiencia. Por eso la sección vive donde
viven las señales, y su primera mitad (①-②) se lee como evidencia, no como agenda.

Las 4 zonas espejan las 4 tools:

```
① CARGOS RECOMENDADOS (gratis)          ← recommend_contact_roles
   "Gerencia Analytics y BI" — por 21 señales de Power BI/Datos (jul-ago 2026)
   "Jefe de Arquitectura"    — por vacantes Data Architect activas
   [+ agregar cargo manual]
② LO QUE YA TENÉS (gratis)               ← get_company_contacts
   3 contactos · 1 con email fresco · 2 desactualizados (>90 días)
   cobertura: 1 de 3 cargos recomendados
③ [Buscar y revelar emails]              ← prepare_contact_enrichment
   → diálogo: "Hasta 10 contactos = hasta 10 créditos (te quedan 132/150
     este mes). Cargos: …" [Confirmar]   ← el userConfirmed del MCP
④ RESULTADOS                             ← run_contact_enrichment
   filas con nombre/cargo/email (estado verified)/LinkedIn
   → CTA por contacto: [Generar icebreaker] (encadena al funnel de outreach)
```

Decisiones:

- **Muere `ROLE_RULES`**: la UI pasa a `recommendContactRoles` (señales reales del
  diccionario + `apollo_title_catalog`), con las justificaciones (`because`) como tooltip
  de cada cargo — el vendedor entiende POR QUÉ ese cargo.
- **Nunca gastar sin mostrar el costo**: el paso ③→④ replica `prepare → planHash →
  userConfirmed → run` con un diálogo. Cache-first: si `likelyCacheHit`, el diálogo lo
  dice ("probablemente sin costo").
- **Una sola contabilidad (D.4)**: `searchAccountDecisionMakers` (la vía vieja) se
  reemplaza; todo el gasto Apollo de la UI pasa por el pool `apollo_enrichment` del plan,
  igual que el MCP. El rate limit "1 búsqueda/rol/día" se retira: lo sustituyen la
  cobertura (¿ya lo tenés?) y el cupo mensual, que son los frenos correctos.
- **Teléfono queda fuera** (Fase 5 del plan MCP, hoy solo v2): el diseño lo contempla
  como columna futura, no lo implementa.

### D.3 Encadenamiento con outreach

Cada contacto enriquecido tiene CTA "Generar icebreaker" → el generador existente
(`generateIcebreaker`) con el contacto precargado; el resultado aparece en el tab
Icebreakers. Así el viaje completo dentro de la cuenta queda: señales → vacantes →
decisores → email verificado → icebreaker, que es exactamente el funnel del MCP.

### D.4 Unificación de contabilidad (prerequisito técnico)

`reserveMcpUsage`/pools hoy asumen principal MCP (API key). Se generaliza a "principal de
workspace" para que las server actions de la UI reserven/commiteen contra los mismos
pools (`research_server`, `apollo_enrichment`, `icebreaker_server`). `get_ai_usage` y el
panel de uso pasan a reflejar UI+MCP juntos. Sin esto, D y las tools nuevas del chat
duplicarían contabilidad — es la primera tarea técnica del paquete.

---

## E. Scorecard: revisión del cálculo de fit (feedback 20-ago-2026)

### E.1 Cómo se calcula hoy (verificado en `scoring.ts` y `fit.ts`)

`score = 35% fit + 35% señales + 15% accesibilidad + 15% timing`, determinístico
(la IA solo redacta el rationale). Por pilar:

- **Fit** (`scoring.ts:145`): intersección entre los targets del workspace
  (`workspace_value_profiles.target_technologies/processes`) y las tecnologías
  detectadas **solo en `radar_findings`** (research). Fórmula:
  `matches / min(totalTargets, 6) × 100`. Matching por substring bidireccional
  (`detectado.includes(target) || target.includes(detectado)`), sin longitud mínima.
- **Señales de compra** (`scoring.ts:177`): conteo ponderado de findings por nivel de
  evidencia (Confirmado ×12, Probable ×8, Inferido ×5) + `public.signals` capadas a
  10 filas ×2 (máx +20).
- **Accesibilidad** (`scoring.ts:198`): `contactos_en_cache ×10 + seniors ×10`.
- **Timing** (`scoring.ts:205`): eventos clasificados por regex sobre título+resumen
  (expansión +25, contracción −22, ejecutivo 20, implementación 15), con decaimiento
  1.0/0.7/0.4/**0** a los 30/60/90 días.

### E.2 Por qué "no tiene sentido" (diagnóstico)

1. **El fit ignora las vacantes.** Las señales de `public.signals` (los tags del
   diccionario que el ETL detecta en cada vacante — iniciativa C) **no entran al pilar
   fit**: solo alimentan +20 máx del pilar señales, capadas a 10 filas. Una cuenta con
   700 señales de vacantes matcheando los targets del workspace pero sin research
   puntúa **fit 0** ("Señales fit: 0"). Es la mayor fuente de resultados contraintuitivos
   (patrón YPF/Arauco/Molinos).
2. **La card "Señales fit con tu propuesta" y el fit del scorecard miden cosas
   distintas.** La card (`fit.ts`) marca fit cualquier señal que matchee el diccionario
   **global** aunque no tenga relación con la propuesta del workspace (etiqueta
   "matchea el diccionario"); el scorecard solo cuenta targets del workspace. Dos
   números con el mismo nombre que no coinciden.
3. **Substring sin mínimo** en scoring.ts: un target corto ("BI") matchea cualquier
   cadena que lo contenga. `fit.ts` sí filtra <3 chars; scoring.ts no.
4. **Denominador `min(targets, 6)`**: con 20 targets, matchear 6 = fit 100. El tope es
   arbitrario e invisible para el usuario.
5. **Accesibilidad mide el cache, no la accesibilidad**: crece con cuántas búsquedas de
   Apollo se hicieron, y satura rápido (5 contactos senior = 100).
6. **Timing muere a los 90 días** (decay 0) y depende de regex en español sobre titulares:
   una cuenta sin noticias recientes puntúa igual que una sin noticias jamás.

### E.3 Propuesta (a discutir antes de implementar)

1. **Fit por capas**: `targets del workspace ∩ (radar_findings ∪ señales de vacantes)`,
   con peso menor para la evidencia de vacantes (es indirecta) y recencia de la vacante
   como factor. Elimina el "fit 0 con 700 señales".
2. **Unificar la semántica de "fit"**: la card de Señales separa visualmente
   "matchea tu propuesta" (cuenta para el scorecard) de "matchea el diccionario"
   (contexto, no fit), con el mismo criterio de matching que scoring.ts.
3. **Matching robusto compartido**: extraer una función única (mín. 3 chars,
   word-boundary en términos cortos) usada por `fit.ts` y `scoring.ts`.
4. **Denominador honesto**: `matches / totalTargets` sin cap, o cap explícito en el
   tooltip del breakdown ("6 de tus 20 targets alcanzan para 100").
5. **Señales de vacantes sin cap de 10**: escala logarítmica
   (p.ej. `min(20, 8×log10(1+n))`) para que 700 señales > 10 señales sin romper el clamp.

---

## Fases de implementación propuestas

| Fase | Contenido | Dependencias |
|---|---|---|
| **1. Quick wins de legibilidad** | B.4 (eliminar headline y fit_summary duplicado, line-clamp en findings, collapse de prosa) + límites de redacción en prompts/schemas (B.2.4) | Ninguna — solo UI + prompts |
| **2. Vacantes con tags** | C completa (query + facetas + chips) | Ninguna |
| **3. Resumen ejecutivo + orden** | Fusión brief+scorecard con chips de evidencia y próximos pasos accionables (B.2), resumen colapsado por defecto y tabs sticky bajo el header (prioridad de orden) | Fase 1 |
| **3b. Scorecard v2** | E.3: fit alimentado también por señales de vacantes, matching unificado, card de señales con semántica separada | Decisión sobre E.3 |
| **4. Contabilidad unificada** | D.4 (pools compartidos UI/MCP) | Ninguna; prerequisito de 5 y 6 |
| **5. Personas en la cuenta** | D.2 + D.3 (funnel de 4 pasos, retiro de ROLE_RULES y de searchAccountDecisionMakers) | Fase 4 |
| **6. Chat de búsqueda** | A completa (refactor de tools a lib compartida, searchByCapability, SearchResultsCard con follow directo, resto de paridad) | Fase 4 (para tools que gastan) |

Las fases 1-2 son chicas y de impacto inmediato; 3 es mediana; 4-6 son el grueso.

## Métricas de éxito

- Tiempo hasta la primera acción en la cuenta (abrir → seguir/buscar decisor/icebreaker).
- % de sesiones de chat que terminan en al menos un follow (búsqueda NL → alta).
- Scroll depth de la vista de cuenta (hoy lo útil está abajo; debe invertirse).
- Créditos Apollo por email verificado obtenido (la cobertura previa debe bajarlo).
- Chars promedio de prosa IA renderizada por pantalla (baseline actual: ~6-9k; target <1.5k visibles).

## Decisiones tomadas

- **Personas es sección del tab Señales, no pestaña** (19-ago-2026): las personas son
  primariamente fuente de evidencia tecnológica de la compañía; el contacto es el paso
  final del funnel, no el organizador de la vista.

## Preguntas abiertas

1. El follow desde la SearchResultsCard del chat, ¿pide confirmación siempre o solo
   cuando el cupo restante es bajo (<20%)?
2. ¿El chat mantiene las conversaciones persistentes (sidebar actual) o la búsqueda NL
   amerita un modo "búsqueda" efímero + un modo "conversación"? (Recomendación: mantener
   una sola superficie; la persistencia no molesta.)
3. Límite de 600 chars para `why_now`/`rationale` client-assisted: validar con los
   prompts reales de los tests MCP (Falabella/Arcor) que no pierda información citada.
