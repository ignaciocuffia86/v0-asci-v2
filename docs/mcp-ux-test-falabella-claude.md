# ASCI MCP — Test de UX y flujo (caso Falabella)

**Fecha:** 31-jul-2026 · **Cliente MCP:** Claude (claude.ai) · **Plan:** silver · **Endpoint:** asci.bigua.lat/api/v3

## 1. Recorrido ejecutado

Se recorrió el flujo completo end-to-end tal como lo haría un usuario real: `search_companies("Falabella")` → `check_account_access` → `get_company_profile` → `get_company_signal_summary` → `prepare_save_account` → `get_ai_usage` → tests de error en tools gated sin cuenta guardada → `save_account` → `prepare_account_research` → las 4 etapas client-assisted (`internal_analysis` → `signal_classification` → `fit_scoring` → `account_brief`) vía `submit_account_research_stage` → verificación con `get_account_intelligence`, `get_account_evidence_detail` y `get_company_contacts`.

El pipeline completó exitosamente: scorecard materializado (score 72, fit 70, buying 75, accessibility 60, timing 80), brief con status `ready`, snapshot con status `partial`. No se testearon (para no consumir más cuota): `prepare_company_news`, `prepare_company_success_cases`, icebreakers, `scrape_company_job_postings`, enrichment de contactos, `recommend_contact_roles` y el path server-managed (`run_account_research`).

---

## 2. Hallazgos críticos

### C1. `search_companies` no devuelve la entidad canónica real

Buscando "Falabella", el top-10 rankeó primero a **Sodimac** (4.069 señales, marcada `likelyCanonical: true`, con website `muevete.falabella.com` — un sitio de careers) y nunca mostró a **Falabella** (id `3ad30c78`, 16.065 señales, website falabella.com), que es la entidad con más evidencia de todo el grupo y la que un usuario buscando "Falabella" espera encontrar.

Consecuencia observada en el propio test: siguiendo la búsqueda se guardó la entidad equivocada (`falabella.com`, 382 señales), se consumió un cupo del plan, y recién al fallar el research se descubrió la canónica real. Es exactamente el escenario que el `duplicateWarning` intenta prevenir, pero el warning no sirve si la opción correcta ni siquiera aparece en la lista.

**Recomendaciones:**
- Auditar el ranking: si está ordenado "por evidencia disponible" como dice la descripción, una entidad con 16.065 señales no puede quedar fuera del top-10 de 50 matches. Probablemente el matching (¿full-text sobre `name`? ¿normalized_name?) está excluyendo el exact-match "falabella" o el ranking no pondera señales como declara.
- `likelyCanonical` debería exigir coincidencia de nombre con la query, no solo máxima evidencia. Que "Sodimac" sea el canónico de la query "Falabella" es un falso positivo grave.
- Boost explícito a exact-match de `normalized_name` y a dominio que coincida con la query.
- Devolver en cada resultado una pista de por qué matcheó (`matchReason: "exact_name" | "domain" | "alias" | "group"`).

### C2. El research resuelve por nombre free-text e ignora el companyId guardado

`prepare_account_research` / `run_account_research` reciben `companies: string[]` (nombres). Habiendo guardado la cuenta `6addc0f9` ("falabella.com") por su id, el research con el string exacto `"falabella.com"` resolvió a **otra entidad** ("Falabella", `3ad30c78`) y bloqueó con `ACCOUNTS_NOT_SAVED`. El contrato search → save(por id) → research(por nombre) se rompe: el usuario guarda A y el sistema le exige guardar B.

Pasar el UUID como string devuelve `COMPANY_RESOLUTION_REQUIRED` sin mensaje ni guía.

**Recomendaciones:**
- Aceptar UUIDs en `companies[]` (detección trivial por formato) o agregar un parámetro `companyIds[]`. Es el fix de mayor impacto/costo de todo el informe: el companyId ya es la moneda de todas las demás tools.
- Mientras tanto, si el resolver mapea el input a una entidad distinta de una ya guardada con nombre similar, priorizar las cuentas guardadas del workspace en la resolución.
- `COMPANY_RESOLUTION_REQUIRED` debe volver con el envelope estándar: qué se recibió, por qué no resolvió, y qué formato se espera.

> Nota: en este caso el resolver eligió *bien* (la canónica real) y la búsqueda era la rota. Pero la arquitectura sigue siendo frágil: dos resolvers distintos (search y research) con criterios distintos garantizan divergencias.

---

## 3. Hallazgos altos

### A1. Payloads que no entran en el contexto del cliente MCP

- `get_company_signal_summary` devolvió ~35 términos con 1–3 evidencias completas cada uno (snippet largo + ids + timestamps): decenas de KB para una pregunta que se responde con términos + counts.
- `prepare_account_research` devolvió **155 KB** en una sola respuesta. En Claude directamente no entró en contexto y hubo que procesarla por archivo — un cliente MCP sin filesystem no puede operar este flujo.
- Cada `submit_account_research_stage` re-envía **el pack de evidencia completo** (incluidas las 50 descripciones de vacantes: 107 KB solo eso) más `previousStages` acumulado. En 4 etapas, el mismo contenido viaja 4–5 veces (~650 KB total por research de una cuenta).

**Recomendaciones:**
- Evidencia por referencia: el package lleva términos + counts + ids; el detalle textual se pide on-demand con `get_account_evidence_detail` (el systemPrompt de hecho ya instruye eso — pero igual manda todo inline).
- De las vacantes, enviar título + ubicación + fecha + URL + extracto de ~300 chars, no la descripción completa (el 70% es boilerplate corporativo repetido: "Somos más de 88 mil personas…" aparece 50 veces).
- Entre etapas, mandar solo el delta: hash del pack ya entregado + `previousStages`. Si el cliente perdió el pack, que lo re-pida (`refresh_prompt_package` ya existe para esto).
- Parámetros `verbose`/`include` en las tools de lectura y límites por defecto más bajos (`signals: 100` es demasiado como default de un summary).

### A2. `fit_scoring` sin contexto de fit

El package de la etapa `fit_scoring` pide `fitScore 0..100` pero **no incluye ICP, propuesta de valor ni documentación del workspace** — nada contra qué medir el fit. El modelo cliente inventa el criterio (en este test se declaró la limitación en el rationale, pero un modelo menos cuidadoso puntuaría con total confianza). El dato existe en el sistema: `recommend_accounts_for_value_proposition` declara usar "toda la documentación complementaria del workspace".

**Recomendación:** incluir en el package de `fit_scoring` (y de `account_brief`) un bloque `workspaceContext` con la propuesta de valor, industrias/tecnologías objetivo y personas del ICP. Si el workspace no tiene documentación cargada, decirlo explícitamente en el package y degradar el schema (p.ej. `fitScore` opcional o `fit_status: "no_icp"`).

### A3. Validación laxa en los submits

- `category` acepta cualquier string: se enviaron `technology_adoption` / `process_maturity` / `hiring_signal` inventados y el servidor aceptó todo sin observaciones. Si esas categorías alimentan lógica downstream (el timing score, dashboards), cada modelo cliente va a inventar taxonomías distintas.
- El `responseSchema` es informal (`"score": "integer 0..100"` como string descriptivo), no JSON Schema ejecutable. El cliente no puede validar antes de enviar.

**Recomendaciones:**
- Publicar el `responseSchema` como JSON Schema draft-07 real (el server ya lo usa en `confirm_document_analysis`, donde el schema es ejemplar).
- Enum cerrado para `category` + rechazo o mapeo server-side de valores fuera del enum, informando en la respuesta qué se aceptó/normalizó (mismo patrón que ya usa `submit_company_news` con expansion/contraccion/neutro).

---

## 4. Hallazgos medios

### M1. Envelope de error inconsistente

Dos patrones conviven:
- **Excelente:** `get_company_contacts` y los checks de acceso devuelven `{state, nextAction, accountLimit, message}` con instrucciones accionables. Este patrón le permite al agente autocorregirse sin intervención.
- **Malo:** `get_account_intelligence` y `get_account_evidence_detail` sin cuenta guardada devuelven `{"success": false, "error": "ACCOUNT_NOT_AVAILABLE_IN_WORKSPACE"}` pelado, sin `nextAction` ni mensaje. `COMPANY_RESOLUTION_REQUIRED` igual.

**Recomendación:** estandarizar un envelope único de error para todo el server: `{error, message, nextAction, context}`. El costo es bajo y es la mejora de agente-UX más consistente disponible: cada error sin `nextAction` es un turno extra de prueba y error del modelo.

### M2. Dos fuentes de "evidencia" desincronizadas

`get_company_signal_summary` lee señales v2 crudas; `get_account_evidence_detail` lee el snapshot materializado del research. Antes de correr el research, el summary mostraba "SAP MM" con 2 evidencias pero evidence_detail devolvía vacío para el mismo término y la misma empresa. El agente no tiene forma de saber que son stores distintos.

**Recomendaciones:**
- Que `get_account_evidence_detail` haga fallback a señales v2 cuando no hay snapshot, marcando el origen (`source: "snapshot" | "raw_signals"`).
- O al menos que la nota de "no hay evidencia" distinga "término inexistente" de "snapshot no generado" con `nextAction: prepare_account_research` (la nota actual lo insinúa, bien, pero mezclado en prosa).

### M3. `evidenceLevel` agregado contradice sus fuentes

"SAP S/4HANA" figura como `Confirmado` a nivel término, pero sus 8 fuentes son todas `Inferido` (4, ex-empleados) o `Probable` (4). La regla de agregación infla el nivel y contradice la instrucción del propio systemPrompt ("no presentes como confirmado algo Probable o Inferido").

**Recomendación:** el nivel agregado no debería superar el máximo de sus fuentes vigentes (excluyendo ex-empleados), o al menos exponer la distribución (`levels: {confirmado: 0, probable: 4, inferido: 4}`).

### M4. Contactos: dos stores y señales contradictorias

El snapshot del research incluyó 8 contactos (CTO Digital Commerce & CIO, Heads de Data/Analytics, `matchConfidence: high`), pero `get_company_contacts` sobre la misma cuenta devuelve `totalContacts: 0` y recomienda enrichment "porque no hay contactos". Un vendedor ve 8 nombres en el brief y 0 en la tool de contactos, y el sistema le sugiere gastar créditos de Apollo para conseguir lo que ya le mostró.

Detalles adicionales: los 8 contactos venían con `email: null` y `emailStatus: null` pero `matchConfidence: high`; 4 comparten `rank: 44` exacto (¿default?); uno tiene `title` vacío y linkedinUrl con formato interno (`/in/ACwAAAUI…`).

**Recomendaciones:** unificar o federar los dos stores en `get_company_contacts` (con `source` por contacto); que `enrichmentRecommended` considere los contactos del snapshot; revisar el cálculo de `rank` y `matchConfidence` cuando no hay email.

### M5. Calidad de clasificación de señales (v2 crudas)

En la entidad `falabella.com` aparecieron como "procesos": *Excel, Administración, innovación, calidad, equity, Finanzas* — sustantivos genéricos de bios de LinkedIn, no procesos de negocio. Como "tecnología": *Functions* (mal parseado de "After Sales Coordinator • Functions"). Señales duplicadas exactas (mismo snippet, mismo timestamp, ids distintos: "SAP MM" ×2, "transformación digital" ×2).

Notablemente, el pipeline v2 materializado de la entidad canónica es mucho mejor (taxonomía limpia: "Control administrativo financiero", "SAP S/4HANA", etc.), lo que sugiere que el problema está en la clasificación cruda pre-snapshot.

**Recomendaciones:** stoplist de términos genéricos por idioma; deduplicación por (snippet, sourceField, persona); validar el parser de headlines con separadores "•".

### M6. Alias resolution no consolida el grupo

Hay 50 entidades Falabella (el `duplicateWarning` lo advierte, muy bien) pero `get_company_signal_summary` con estrategia `conservative_name_or_domain_overlap` resolvió **1 solo alias** (la propia entidad) para falabella.com. Falabella Retail S.A., Falabella Tecnología, Adessa Falabella, etc. quedaron afuera justo en el caso que motiva la feature.

**Recomendaciones:** relación explícita parent/child o `groupId` curado para grupos grandes (los 20–50 grupos económicos que más consultan tus clientes cubren el 80% del problema); que el summary informe qué entidades hermanas existen y cuántas señales tienen, aunque no las fusione.

---

## 5. Hallazgos bajos / detalles

- **Naming drift en descripciones:** varias tools instruyen "usala después de `get_account_panorama`" — tool que no existe en el set expuesto (hoy es `get_company_signal_summary`). El modelo cliente busca una tool fantasma.
- **`sourceUrl: null` en todas las señales** del summary: la evidencia no es verificable desde ahí (evidence_detail sí trae LinkedIn de la persona — bien).
- **Respuesta final del pipeline:** `{accepted: true, completed: true}` y nada más. Debería cerrar el loop: `{completed: true, companyId, nextAction: "get_account_intelligence", summary: {score: 72}}`.
- **`get_ai_usage`:** `verifiedAi` todo en 0 pese a 10 research usados en el mes; o el contador está roto o mide otra cosa — el nombre no lo aclara.
- **`snapshot.status: "partial"`** tras completar las 4 etapas, sin explicación de qué falta ni cómo completarlo.
- **Ventanas rígidas en `scrape_company_job_postings`** (1/7/30 días o sin límite): razonable, pero el fallback "si pedís otra cosa busco sin límite" es sorpresivo; mejor rechazar con mensaje.
- **`search_companies` no expone paginación** (totalMatches: 50, muestra 10, `limit` máx 25): con 50 homónimos el usuario no puede ver el resto.

---

## 6. Lo que está bien (conservar)

- **Guardrails de consumo:** el patrón preview → confirmación explícita (`prepare_save_account` → `save_account` con `userConfirmed`, `const: true` en el schema) es excelente y raro de ver. Ídem `remove_workspace_account`.
- **Idempotency keys obligatorias** en todas las operaciones con costo.
- **TTL + `refresh_prompt_package`** sin re-cobro de cuota: manejo maduro de expiración.
- **Mensajes con `nextAction`** en los checks de acceso: el mejor patrón del server — extenderlo a todo (ver M1).
- **Warnings de muestreo** ("1000 de 16065 señales"): honestidad metodológica que el modelo cliente puede propagar.
- **Atribución empleado actual vs ex-empleado** en evidence_detail, con LinkedIn verificable y la leyenda "no prueba uso actual": diferencial real del producto.
- **Arquitectura client-assisted** (server prepara/valida/persiste, cliente ejecuta con sus tokens): el diseño de fondo es sólido; los problemas son de ergonomía, no de arquitectura.
- **Clasificación server-side de noticias** (expansion/contraccion/neutro) para que malas noticias no sumen timing: buen guardrail de diseño (declarado; no testeado).

## 7. Priorización sugerida

| # | Fix | Impacto | Esfuerzo |
|---|-----|---------|----------|
| 1 | Aceptar companyId en research (C2) | Muy alto | Bajo |
| 2 | Ranking/matching de search + criterio likelyCanonical (C1) | Muy alto | Medio |
| 3 | Envelope de error uniforme con nextAction (M1) | Alto | Bajo |
| 4 | Dieta de payloads: evidencia por referencia + delta entre etapas (A1) | Alto | Medio |
| 5 | workspaceContext/ICP en fit_scoring (A2) | Alto | Bajo |
| 6 | JSON Schema real + enum de category (A3) | Medio | Bajo |
| 7 | Unificar stores de contactos y de evidencia (M2, M4) | Medio | Medio |
| 8 | Agregación de evidenceLevel (M3) | Medio | Bajo |
| 9 | Limpieza de clasificación cruda v2 (M5) | Medio | Medio |
| 10 | Consolidación de grupos económicos (M6) | Medio | Alto |

## 8. Pendientes de testeo

News, success cases, icebreakers (ambos paths), scraping de vacantes, enrichment Apollo, `recommend_contact_roles`, `recommend_accounts_for_value_proposition`, flujo de documentos (`create_document_draft` → `confirm_document_analysis`), path server-managed (`run_account_research`), y los flujos de expiración (`CLIENT_PACKAGE_EXPIRED` → `refresh_prompt_package`).

**Estado del workspace tras el test:** Falabella (canónica, `3ad30c78`) quedó guardada con research materializado; cupo 3/30; cuota research ~11+/30.
