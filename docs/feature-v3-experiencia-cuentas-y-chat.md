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

## F. Radiografía comercial self-service (norte del bookmark, 20-ago-2026)

El entregable manual que hoy se arma para clientes (ej. "Radiografía Legrand →
OMARSA S.A.") es el norte de lo que el bookmark tiene que generar solo, de forma
**incremental y on-demand**: el usuario entra/guarda la cuenta, el sistema sale a
buscar lo que falta (vacantes ya automático desde Fase 4; noticias a agregar), la
vista se va armando con lo que llega, y al mes siguiente el digest refresca y
puede enviar/exportar el informe.

### F.1 Estructura objetivo (la del documento entregado)

| # | Sección | Qué contiene |
|---|---|---|
| 0 | Encabezado | Cuenta, país, fecha, **estado semáforo** (🟢 abordar / 🟡 seguir de cerca / 🔴 sin señal) |
| 1 | Resumen ejecutivo | 4 puntos **factuales** (movimientos, noticia clave, dato de negocio, ausencias declaradas) |
| 2 | Scorecard de señales | Tabla fuente × volumen × **lectura**: movimientos de personal (6m), perfiles por categoría de foco, decisores, avisos con señal, noticias |
| 3 | Movimientos de personal | Ingresos nuevos / rotaciones internas con cargo, fecha de inicio, foco + contacto (LinkedIn, email `valid`, teléfono) |
| 4 | Búsquedas laborales activas | Solo avisos **con señal según la propuesta de valor**, con el fragmento del aviso donde aparece la señal y link al posteo; si no hay, se declara |
| 5 | Radar de noticias | Categoría, título, resumen, **"por qué le importa a [vendor]"**, fuente + fecha + URL, nota de cobertura (qué NO se encontró) |
| 6 | Ángulos de entrada comercial | Bullets concretos derivados de las señales |
| 7 | Riesgos a mitigar | Bullets |
| 8 | Método y limitaciones | Fuentes, ventanas, definiciones, disclaimers — **autogenerado** desde los metadatos reales (batches, fechas de scrape, tamaños de base) |

### F.2 Mapeo contra lo que existe (verificado en código)

| Necesidad | Estado hoy | Brecha |
|---|---|---|
| Vacantes de la cuenta | ✅ `job_postings` + cron corredor (Fase 4) + tags del diccionario (C) | Filtrar por señal de la **propuesta del workspace** (hoy tags globales); extraer el **fragmento** del aviso (existe `extract_snippet` y `signals.keyword_matched` para contactos; falta exponer snippet por vacante en la UI) |
| Noticias | ⚠️ `company_news` (título, resumen, fecha, dirección, evidence_level) se llena solo con research | Kick on-demand al guardar/abrir como el de vacantes; **"por qué le importa al vendor" por noticia** (hoy no existe: el rationale es global); nota de cobertura |
| Movimientos de personal | ❌ El ETL de contactos (`process_contact_batch`, baseline:5175) **descarta la fecha de ingreso al puesto** que viene en el export crudo; `previous_positions` se guarda sin fechas | Tomar `current_position_started_on` (y fechas del historial) en el ETL; **re-cargar los archivos crudos rearma el histórico** (upsert por `linkedin_url`); derivar ingreso nuevo vs rotación interna; clasificar cargo por categoría de foco |
| Contacto por persona | ✅ `contacts` tiene email1-4 con `*_status` y phone1-2 con `*_type` | Regla "solo emails `valid`" + etiqueta de teléfono en el render |
| Categorías de foco | ⚠️ `workspace_value_profiles` (target_technologies/processes) | Derivar categorías de foco (ej. datacenter/infra, energía, decisores) del perfil + **editables por el admin** en Ajustes |
| Scorecard operativo | ❌ Hoy score 0-100 con 4 pilares (ver E) | Tabla fuente × volumen × lectura; el 0-100 pasa a interno (ordenar listados); semáforo en el header |
| Ángulos y riesgos | ⚠️ `next_actions` del brief (genéricos) | Prompt dedicado que los derive de las señales concretas de la radiografía |
| Método y limitaciones | ❌ No existe | Autogenerar desde metadatos: fecha/tamaño del último scrape de vacantes, ventana de noticias, fecha del último export de personas |
| Export / digest | ⚠️ Digest mensual existe (score before/after) | Export .docx/PDF de la radiografía + adjuntarla/enviarla en el digest cuando se refresquen vacantes/noticias |

### F.3 Decisiones tomadas (20-ago-2026)

1. **Informe incremental on-demand**: al entrar/guardar el bookmark, si no hay
   noticias buscadas en el último mes se dispara la búsqueda; ídem vacantes (ya
   automático). La vista del bookmark ES el informe armándose; el export y el
   envío por correo van con el ciclo del digest mensual.
2. **Fecha de ingreso al puesto**: se agrega al ETL de contactos (actual +
   historial con fechas en `previous_positions`); se rearma el histórico
   re-cargando los exports crudos.
3. **Categorías de foco**: derivadas automáticamente de la propuesta de valor y
   editables por el admin del workspace.
4. **El scorecard operativo reemplaza al 0-100 en el bookmark**: semáforo +
   tabla fuente × volumen × lectura; el score numérico queda interno para
   ordenar listados. Esto absorbe la fase 3b (E.3): el problema del fit se
   resuelve mostrando los datos en vez de un índice opaco.

### F.4 Preguntas abiertas de F

1. Ventanas por fuente (personal 6 meses, vacantes 30 días, noticias 4 meses en
   el documento manual): ¿fijas o parametrizables por plan?
2. Umbrales exactos del semáforo 🟢🟡🔴 (el criterio de qué pesa ya está
   resuelto en G.5; falta calibrar los cortes con cuentas reales).
3. ~~"Por qué le importa al vendor" por noticia~~ → resuelto en G: lectura por
   workspace, generada al refrescar la radiografía, no al ingerir.
4. ~~¿bundle del research o flujo liviano?~~ → resuelto en G.1: flujo liviano.
5. Envío por correo del informe en el digest: ¿adjunto (PDF/docx) o el digest
   linkea a la vista?

---

## G. Noticias: scrape liviano + lectura por workspace (diseño, 21-ago-2026)

### G.1 Bundle de research vs. flujo liviano (costos medidos en `v3.ai_usage_log`)

| | Research completo | Flujo liviano de noticias |
|---|---|---|
| Qué hace | 3 bundles (tech-stack, news-business, expansion-timing); cada uno una búsqueda web server-side con prompt abierto (~39k tokens de input) | 1 búsqueda acotada a noticias + 1 estructurador |
| Costo real medido | $0,178 por bundle × 3 + estructuración + scoring ≈ **$0,52-0,55 por cuenta** | ≈ **$0,17** (la búsqueda; el estructurador cuesta $0,00035) |
| Efectos | Reescribe `radar_findings`, scorecard y brief | Escribe solo `company_news` |
| Cupo | Consume research del plan + cooldown de 30 días | No consume cupo de research |

**Decisión: flujo liviano.** Es 3x más barato, no tiene efectos colaterales sobre
la inteligencia de la cuenta y **ya existe probado en v2**
(`app/api/research/news/route.ts`: búsqueda + estructurador, con verificación de
URLs vivas, dedup y descarte de items sin fecha). La fase 8 lo porta a v3 como
servicio compartido en vez de reimplementarlo.

### G.2 Principio: el hecho es global, la lectura es por workspace

La misma noticia ("proyecto de innovación con nuevo datacenter") vale oro para un
workspace que vende datacenters y es apenas contexto para uno de staffing. De ahí
la separación en tres capas:

| Capa | Alcance | Dónde vive | Costo |
|---|---|---|---|
| **L0 · Scrape** | Global (compartido entre workspaces) | `public.company_news` | ~$0,17 por cuenta cada 30 días |
| **L1 · Clasificación del hecho** | Global | `company_news.direction` / `category` | ~$0,0004 (estructurador) |
| **L2 · Lectura para el vendor** | Por workspace | `v3.account_news_readings` (nueva) | ~$0,0004 por cuenta (batch de todas sus noticias) |

Dos workspaces que siguen YPF pagan **un solo** scrape — el mismo patrón que ya
usan las vacantes. Lo caro se comparte; lo específico es casi gratis.

Estado hoy: `company_news` tiene 1.141 noticias de 169 empresas, pero **solo 4
tienen `direction`**: la capa L1 existe en el esquema y está sin usar.

### G.3 Modelo de datos

```sql
-- L2: una lectura por (workspace, noticia). RLS deshabilitada como el resto de
-- v3: se accede con service-role + filtro por workspace_id en TS.
create table v3.account_news_readings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references v3.workspaces(id) on delete cascade,
  news_id uuid not null references public.company_news(id) on delete cascade,
  company_id uuid not null,
  relevance_type text not null check (relevance_type in ('propuesta','negocio','ruido')),
  relevance_score int not null default 0,      -- 0-100, determinístico (G.5)
  why_it_matters text,                          -- 1-2 oraciones, máx 300 chars
  matched_terms text[] not null default '{}',   -- trazabilidad del match
  profile_version text,                         -- para la regeneración lazy (G.6)
  created_at timestamptz not null default now(),
  unique (workspace_id, news_id)
);
```

`profile_version` es el hash que ya devuelve `getWorkspaceFitProfile()`: permite
detectar que la propuesta de valor cambió sin comparar textos.

### G.4 Clasificación híbrida: determinístico primero, IA después

1. **Match determinístico** (gratis, trazable): el texto de la noticia
   (título + resumen) pasa por el MISMO matcher que fit y vacantes contra los
   `target_technologies`/`target_processes` del workspace y el diccionario. Si
   matchea, la noticia es candidata a `propuesta` y quedan registrados los
   términos que matchearon.
2. **Redacción en batch** (IA barata): UNA llamada al estructurador con todas
   las noticias de la cuenta que aún no tienen lectura, que devuelve por noticia
   el `why_it_matters` citando el dato concreto y confirma el tipo. Prompt nuevo
   `news.reading`, editable en `/v3/admin/prompts` como todos los demás.

No se paga IA para clasificar (lo hace el matcher) y el usuario ve **por qué**
una noticia está destacada, no solo que lo está.

### G.5 Tipos de relevancia, score y semáforo

| Tipo | Definición | Tratamiento en la UI |
|---|---|---|
| `propuesta` | Toca directo lo que vende el workspace (proyecto de datacenter ↔ vendedor de datacenters) | **Destacada**, primera en el radar |
| `negocio` | Habla de la situación/capacidad de la cuenta: expansión → tiene recursos; contracción → CAPEX frenado | Contexto, sin destaque |
| `ruido` | No aporta a este workspace | Colapsada en "otras noticias" — no se borra |

Score determinístico para ordenar y para alimentar el semáforo:

```
score = base(direction) × recencia × multiplicador
  base:      expansión +25 · implementación tech +15 · cambio ejecutivo +10
             noticia general +8 · contracción −22
  recencia:  1.0 (≤30 días) · 0.7 (≤60) · 0.4 (≤90) · 0.2 (≤120)
  multiplicador: ×2 si relevance_type = 'propuesta', ×1 si 'negocio', ×0 si 'ruido'
```

**Semáforo (decisión 21-ago): propuesta y negocio suman, con peso distinto.** Una
cuenta en expansión sin proyecto puntual PUEDE llegar a 🟢 — es coherente con el
caso del workspace de staffing, para el que "se expande" ya es la señal. La
contracción reciente resta, no fuerza 🔴 por sí sola. Los cortes exactos se
calibran con cuentas reales (F.4.2).

### G.6 Disparo y frescura

- **On-demand al abrir/guardar el bookmark**, con la regla de las vacantes:
  si no hay noticias buscadas en los últimos **30 días** para esa cuenta, se
  dispara el scrape en background (`after()`), alineado con el ciclo del digest
  mensual. Decisión 21-ago: ventana fija de 30 días, no parametrizable por plan.
- **Anti-re-ejecución**: se marca el intento ANTES de gastar (misma lección del
  corredor de vacantes: sin la marca previa, una búsqueda que no encuentra nada
  se re-dispara en cada visita).
- **Regeneración lazy de las lecturas** (decisión 21-ago): al abrir el bookmark,
  si `profile_version` de la lectura ≠ el actual del workspace, se regenera solo
  esa cuenta (~$0,0004). El scrape NO se repite: el hecho no cambió, cambió la
  propuesta.

### G.7 Qué ve el usuario

```
┌─ Radar de noticias (últimos 4 meses) ───────────────────────────────┐
│ ⭐ CRECIMIENTO · destacada para tu propuesta        [AWS] [datacenter]│
│    "Omarsa prepara adquisiciones en Centroamérica y Europa"          │
│    Por qué te importa: la expansión por adquisición anticipa         │
│    infraestructura eléctrica y de red en ubicaciones nuevas.         │
│    Undercurrent News · 23-jun-2026 · [ver fuente]                    │
│                                                                      │
│    CONTEXTO DE NEGOCIO                                               │
│    "Supera los US$1.000M de ingresos en 2026" — tiene recursos.      │
│                                                                      │
│    ▸ 3 noticias sin relevancia para tu propuesta                     │
│                                                                      │
│    Nota de cobertura: sin evidencia pública de datacenter, obra      │
│    nueva ni CAPEX en TI en la ventana.                               │
└──────────────────────────────────────────────────────────────────────┘
```

La **nota de cobertura** (qué se buscó y NO apareció) se arma con los términos de
la propuesta que no matchearon ninguna noticia: es la diferencia entre "no hay
nada" y "no buscamos".

### G.8 Alcance de la fase 8

1. Servicio compartido `lib/v3/services/news-scrape-runner.ts` (port del flujo
   liviano de v2) + elegibilidad con marca previa al gasto.
2. Migración `v3.account_news_readings` + poblado de `company_news.direction`
   para las 1.141 noticias existentes (L1, batch barato).
3. `lib/v3/services/news-readings.ts`: matcher determinístico + redacción batch
   + regeneración lazy por `profile_version`.
4. Kick on-demand en la vista de cuenta y en `followAccountAction`.
5. Reglas puras (score, tipo, recencia) con tests, como en la fase 7.

La UI del radar (G.7) va con la fase 9, cuando el bookmark se convierte en la
radiografía completa.

---

## H. Fase 9: el bookmark ES la radiografía (definido 21-ago-2026)

Las fases 7 y 8 dejaron los datos en la base pero invisibles. Esta fase los pone
en pantalla con la estructura del informe que hoy se arma a mano.

### H.1 Navegación: informe vertical, no pestañas

**Decisión:** las 9 secciones se leen en scroll continuo con un **índice sticky**
al costado. Un informe se lee de arriba a abajo; las pestañas lo fragmentan.

`Icebreakers` e `Historial` quedan como pestañas aparte: son herramientas y
registro, no partes del informe. La `TabsList` sticky de la fase 3 se reemplaza
por el índice del informe + esas dos pestañas.

```
┌─ Banco Ripley Chile  🟡 SEGUIR DE CERCA   bancoripley.com · Chile ─┐
│ [Digest ●] [Dejar de seguir] [Chat]        [Icebreakers] [Historial]│
├──────────┬──────────────────────────────────────────────────────────┤
│ ÍNDICE   │ 1. Resumen ejecutivo                                     │
│ ·Resumen │    · 44 vacantes IT activas, 3 mencionan Power BI        │
│ ·Señales │    · Dos ingresos nuevos en infraestructura (feb, abr)   │
│ ·Personas│    · Supera US$1.000M de ingresos en 2026                │
│ ·Vacantes│    · Sin noticias de datacenter en la ventana            │
│ ·Noticias│                                                          │
│ ·Ángulos │ 2. Scorecard de señales   (tabla fuente × volumen × …)   │
│ ·Riesgos │ 3. Movimientos de personal (feb–ago)                     │
│ ·Método  │ 4. Búsquedas laborales activas                           │
│          │ 5. Radar de noticias                                     │
│          │ 6. Ángulos de entrada  7. Riesgos  8. Método             │
└──────────┴──────────────────────────────────────────────────────────┘
```

### H.2 Semáforo: por evidencia accionable

**Decisión** (cierra F.4.2). Reglas determinísticas, en este orden:

| Estado | Condición |
|---|---|
| 🟢 **Abordar** | ≥1 noticia con `relevance_type='propuesta'` **o** ≥1 vacante con señal de la propuesta en los últimos 30 días |
| 🟡 **Seguir de cerca** | Sin lo anterior, pero hay movimientos de personal en 6 meses **o** noticias de `negocio` en ventana |
| 🔴 **Sin señal** | Nada en ninguna ventana |

**La contracción reciente (≤60 días) baja un nivel**: 🟢→🟡, 🟡→🔴. Una cuenta
que frena el CAPEX no se aborda igual aunque tenga match de propuesta.

El score 0-100 pasa a interno (ordenar listados); deja de mostrarse en el
bookmark. Absorbe definitivamente la ex-fase 3b / sección E.

### H.3 Scorecard de señales (reemplaza al de 4 pilares)

Tabla fuente × volumen × lectura, todo determinístico:

| Fuente de señal | Volumen | Lectura |
|---|---|---|
| Movimientos de personal (6m) | `counts.total` | "N ingresos nuevos y M rotaciones internas; K con cargo de decisión" |
| Perfiles de interés según tu propuesta | `counts.perfilesObjetivo` | "Hay equipo moviéndose: interlocutor técnico disponible" / "Sin perfiles del foco en la ventana" |
| Decisores y compras | `counts.decisores` | "Hay poder de decisión recién llegado al rol" |
| Avisos con señal (30d) | vacantes con tag de la propuesta | "N de M avisos mencionan lo que vendés" |
| Noticias con señal (4m) | `counts.propuesta` / `counts.negocio` | "Señal pública verificable" / "Solo contexto de negocio" |

Cada fila lleva su lectura como texto fijo por rango (0 / 1-2 / 3+), no
generado por IA: son las mismas frases del informe manual.

### H.4 Vacantes y noticias: señal primero, resto colapsado

**Decisión:** las vacantes **con** señal de la propuesta van arriba, cada una con
el **fragmento del aviso** donde aparece el término (existe `extract_snippet` en
la base y `signals.keyword_matched`; falta exponerlo por vacante). Las demás
quedan en "ver las otras N vacantes". Mismo tratamiento que el radar de noticias
(`ruido` colapsado), y no se pierde nada.

### H.5 Textos generados: al refrescar datos, no al abrir

**Decisión:** el resumen en 4 puntos, los ángulos de entrada y los riesgos se
generan en **una sola llamada batch (~US$0,001)** cuando cambia el insumo, y se
guardan. Abrir la cuenta no cuesta nada.

Tabla nueva `v3.account_reports` (workspace_id, company_id):

```sql
summary_points   text[]      -- 4 bullets factuales, incluye declarar ausencias
entry_angles     text[]      -- ángulos de entrada comercial
risks            text[]      -- riesgos a mitigar antes de abordar
inputs_fingerprint text      -- hash de: último scrape de vacantes + de noticias
                             --  + profile_version + conteos por fuente
generated_at     timestamptz
```

Se regenera cuando `inputs_fingerprint` cambia — o sea, cuando entran vacantes o
noticias nuevas, o cambia la propuesta de valor. Mismo criterio de frescura que
la regeneración lazy de las lecturas (G.6), pero sobre el informe entero.

Regla de redacción del resumen: **4 puntos factuales**, y uno de ellos declara
explícitamente lo que NO se encontró ("sin avisos con señal en el scrape del
período"). Es lo que separa un informe honesto de uno inflado.

### H.6 Método y limitaciones: sin IA

Se arma con metadatos reales, no redactado: fecha y ventana del último scrape de
vacantes (`import_batches` con prefijo `apify://`), del de noticias
(`company_news_scrapes`), fecha del último export de personas y su tamaño, y los
disclaimers fijos (emails solo con estado `valid`, teléfonos sin validar, foto de
30 días y no histórico).

### H.7 Entregables

1. `lib/v3/services/account-report.ts` — semáforo, scorecard operativo y
   ensamblado de las 9 secciones desde los servicios ya existentes.
2. Reglas puras de semáforo y lecturas del scorecard, con tests.
3. Migración `v3.account_reports` + generación batch con prompt
   `report.narrative` editable.
4. Snippet por vacante (exponer `keyword_matched` + contexto en
   `job-posting-provider`) y partición señal/resto.
5. UI: informe vertical con índice sticky; `Icebreakers` e `Historial` como
   pestañas; retiro del scorecard 0-100 de la vista.

---

## Fases de implementación propuestas

| Fase | Contenido | Dependencias |
|---|---|---|
| ~~**1. Quick wins de legibilidad**~~ ✅ | B.4 + límites de redacción en prompts/schemas (B.2.4) — mergeado 20-ago (PR #106) | — |
| ~~**2. Vacantes con tags**~~ ✅ | C completa (query + facetas + chips) — mergeado 20-ago (PR #106/#107) | — |
| ~~**3. Resumen ejecutivo + orden**~~ ✅ | Fusión brief+scorecard, próximos pasos del funnel, tabs sticky — mergeado 20-ago (PR #107) | — |
| **4. Contabilidad unificada** | D.4 (pools compartidos UI/MCP) | Ninguna; prerequisito de 5 y 6 |
| **5. Personas en la cuenta** | D.2 + D.3 (funnel de 4 pasos, retiro de ROLE_RULES y de searchAccountDecisionMakers) | Fase 4 |
| **6. Chat de búsqueda** | A completa (refactor de tools a lib compartida, searchByCapability, SearchResultsCard con follow directo, resto de paridad) | Fase 4 (para tools que gastan) |
| **7. ETL: fechas de puesto + movimientos** | F: tomar `current_position_started_on` y fechas del historial en el ETL de contactos; re-carga de exports para rearmar histórico; derivación ingreso/rotación + clasificación por foco | Ninguna |
| **8. Noticias on-demand** | G completa: flujo liviano portado de v2, `v3.account_news_readings`, clasificación híbrida, regeneración lazy y kick con marca previa al gasto (alcance en G.8) | Ninguna — diseño cerrado |
| ~~**9. Bookmark = radiografía**~~ ✅ | H completa: informe vertical con índice, semáforo por evidencia accionable, scorecard operativo, vacantes con snippet, `v3.account_reports` con textos generados al refrescar — implementada ago-2026 | — |
| **10. Export + digest** | F: export .docx/PDF de la radiografía + envío en el digest mensual al refrescar vacantes/noticias | Fase 9 |

Las fases 1-3 ya están en producción; 4-6 son el funnel completo en la app; 7-10 convierten el bookmark en la radiografía self-service (norte F).

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
- **El bookmark apunta a la radiografía comercial self-service** (20-ago-2026): informe
  incremental on-demand, ETL con fechas de puesto, categorías de foco derivadas +
  editables, y el scorecard operativo reemplaza al 0-100 en la vista (detalle en F.3).
  La ex-fase 3b (Scorecard v2 / E.3) queda absorbida por la fase 9.
- **Noticias: scrape global liviano + lectura por workspace** (21-ago-2026): el hecho se
  paga una vez y se comparte; la interpretación ("por qué le importa") es por workspace y
  cuesta ~$0,0004. Flujo liviano (3x más barato que el bundle del research), ventana fija
  de 30 días, regeneración lazy al cambiar la propuesta de valor, y semáforo alimentado
  por relevancia de propuesta Y de negocio con pesos distintos. Detalle en G.

## Preguntas abiertas

1. El follow desde la SearchResultsCard del chat, ¿pide confirmación siempre o solo
   cuando el cupo restante es bajo (<20%)?
2. ¿El chat mantiene las conversaciones persistentes (sidebar actual) o la búsqueda NL
   amerita un modo "búsqueda" efímero + un modo "conversación"? (Recomendación: mantener
   una sola superficie; la persistencia no molesta.)
3. Límite de 600 chars para `why_now`/`rationale` client-assisted: validar con los
   prompts reales de los tests MCP (Falabella/Arcor) que no pierda información citada.
