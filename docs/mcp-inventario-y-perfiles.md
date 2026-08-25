# MCP de ASCI — Inventario de tools, solapamientos y perfiles de acceso

**Fecha:** 24-ago-2026
**Alcance:** los tres servers MCP (`asci-v3`, `explore`, `profiles`) — 54 tools
**Objetivo:** entender qué hace y qué NO hace cada tool, dónde se solapan, y diseñar los dos perfiles de acceso: **admin** (consulta sin fricción, para armar información on-demand de clientes) y **standard** (con aviso de costos y tope por bookmarks).

---

## 1. Los tres MCP

No son tres versiones de lo mismo: operan sobre **capas de datos distintas** y esa es la razón de que existan por separado.

| MCP | Ruta | Sobre qué datos | Entrada natural |
|---|---|---|---|
| **`asci-v3`** (server) | `/api/v3/mcp/server` | Catálogo **normalizado**: `companies`, `signals` clasificadas contra el diccionario, `job_postings`, snapshots de research | Una empresa, una tecnología, una lista de cuentas |
| **`explore`** | `/api/v3/mcp/explore` | Base **CRUDA** de contactos y vacantes, **sin diccionario** | Un concepto en texto libre, cuando el término no existe en el diccionario |
| **`profiles`** | `/api/v3/mcp/profiles` | Tabla cruda de contactos, **persona-first** | Una persona por lo que sabe hacer, no por dónde trabaja |

La distinción que más se confunde: **`asci-v3` busca lo que ASCI ya clasificó; `explore` busca lo que todavía no clasificó.** Si el término está en el diccionario, `asci-v3` es más preciso y más barato. Si no está, `explore` es la única vía.

`profiles` es un producto distinto: devuelve **la persona** (email personal, teléfono, LinkedIn) para llegarle directo, no la cuenta.

---

## 2. Las tres capas de control (el mapa mental que hay que tener)

Casi toda la confusión sobre "qué exige esta tool" viene de que el control **no vive en un solo lugar**. Son tres capas independientes, y una tool puede pasar una y ser frenada por otra:

| Capa | Dónde vive | Qué controla | Se ve en `route.ts` |
|---|---|---|---|
| **1. Scope de la credencial** | `requirePaidMcp` (`lib/v3/mcp-usage.ts:63`) | Qué permisos tiene la API key / token OAuth. Con `mode:"read"` **sale ahí mismo**: no mira el plan ni la cuenta | Sí |
| **2. Guard de cuenta y cuota** | `assertWorkspaceAccount`, `requireSavedAccount`, `guardSavedAccounts`, `checkResearchQuota`, `reserveMcpUsage` | Si la cuenta está guardada, si hay cupo del plan, si hay créditos | **No** — vive adentro de las libs |
| **3. Prompt** | Descripciones de cada tool + `instructions` del server | Si el modelo **pregunta antes** de gastar | Sí, pero no es enforcement |

Las consecuencias prácticas:

- **`requirePaidMcp(..., "read")` NO exige bookmark.** Valida el scope y vuelve. El `companyId` ni le llega.
- **La capa 3 no es un control real.** Un modelo se puede convencer; un límite en la API no. Cualquier tope que importe tiene que vivir en la capa 2.
- **El perfil admin necesita moverse en las tres capas.** Solo cambiar los scopes no alcanza: los guards de cuenta siguen aplicando, y las descripciones siguen diciendo "confirmá con el usuario". Ver §6.

### Quién exige bookmark hoy

| Tool | Guard |
|---|---|
| `get_account_intelligence` | `assertWorkspaceAccount` (research_job **o** followed_account) |
| `recommend_contact_roles`, `get_company_contacts` | `requireSavedAccount` |
| `prepare_contact_enrichment`, `run_contact_enrichment` | `requireSavedAccount` |
| `run_account_research`, `scrape_company_job_postings` | `guardSavedAccounts` |
| `explore_scrape_jobs`, `explore_prepare_decision_makers` | `guardSavedAccounts` |
| **Todo el resto de lectura** | **Ninguno** — leen el catálogo global |

---

## 3. Inventario — `asci-v3` (39 tools)

Costo: **T0** determinístico (sin costo marginal) · **T1** scraping · **T2** IA de ASCI · **T2b** IA del cliente · **T3** terceros (Apollo) · **W** escritura de cupo.

### 3.1 Descubrimiento de empresas

| Tool | Qué hace | Qué **NO** permite | Scope / costo |
|---|---|---|---|
| `search_companies` | Un nombre → empresas rankeadas por evidencia, con `likelyCanonical` y `duplicateWarning` | No filtra por país ni industria · no devuelve señales por término · un nombre por llamada · `evidence.jobPostings` es el histórico de la entidad **sin ventana de fecha** y sin exigir señal detectada | `companies:read` · T0 |
| `search_companies_by_capability` | Búsqueda **inversa**: término → empresas. Dos pasos (`screening` → `detail`) | No acepta lista de nombres · máx 50 por página y techo práctico de ~200 paginando · máx 2 procesos / 20 productos · **no consolida homónimos** (cuenta por entidad) · `jobPostings` **no filtra por fecha** (ver §5.4) | `companies:read` · T0 |
| `screen_account_list` ⭐ | **Lista del cliente × términos** → una fila por nombre, cuatro estados. Consolida las entidades duplicadas del catálogo y separa `signalsOwn` de `signalsForTerms` | No resuelve la ambigüedad sola (devuelve candidatos) · no trae firmográficos · **máx 100 nombres** (medido: 100 difusos = 5,7 s contra el techo de 8 s) · acrónimos <4 letras solo matchean por nombre canónico exacto | `companies:read` · T0 |
| `recommend_accounts_for_value_proposition` | Prefiltra hasta 20 cuentas contra la documentación del workspace | Máx 20 · exige países ISO-2 · no explica el descarte | `recommendations:read` · T2b |

### 3.2 Evidencia de una cuenta

| Tool | Qué hace | Qué **NO** permite | Scope / costo |
|---|---|---|---|
| `get_company_profile` | Identidad + firmográficos + cobertura de señales | `employeesApollo: null` = no lo sabemos, no "empresa chica" | `companies:read` · T0 |
| `get_company_signals` | Señales de **perfiles y documentos** (excluye vacantes), fila por fila, con el aviso agregado de cuántas son de ex-empleados | Máx 100 · sin consolidación de alias · sin agrupar por término · no incluye vacantes | `signals:read` · T0 |
| `get_company_signal_summary` | Panorama consolidado. `compact` \| `evidence` \| `full` | Máx 100 señales / 30 implementaciones / 30 vacantes · **no filtra por fecha** y `activeCount` no distingue vacantes abiertas (§5.4) · `full` pesa ~15k tokens | `signals:read` · T0 |
| `get_account_evidence_detail` | Un término → fuentes con cita textual, fecha, link, persona y si sigue en la empresa | Máx 10 términos · con snapshot da la versión clasificada, sin snapshot la cruda (`source` lo declara) | `signals:read` · T0 |
| `get_account_intelligence` | Snapshot, scorecard, brief e icebreakers **ya materializados** | **Exige cuenta en el workspace** · no genera nada: si no hay research, no hay nada | `accounts:read` · T0 |

### 3.3 Ciclo de vida de cuentas

| Tool | Qué hace | Qué **NO** permite | Scope / costo |
|---|---|---|---|
| `list_saved_accounts` | Cuentas guardadas activas + cupo del plan | Máx 100 | `accounts:read` · T0 |
| `list_workspace_accounts` | Cuentas **investigadas** por el workspace | No es lo mismo que guardadas | `accounts:read` · T0 |
| `check_account_access` | Si una empresa está guardada + próxima acción | Una cuenta por llamada | `accounts:read` · T0 |
| `prepare_save_account` | Previsualiza el costo en cupo | No escribe | `accounts:read` · T0 |
| `save_account` | Guarda y **ocupa 1 lugar del plan** | Exige `userConfirmed: true` · el cupo es `followedCap` (60 en Silver) | `accounts:write` · **W** |
| `remove_workspace_account` | Quita y libera cupo | Exige `userConfirmed: true` · no borra inteligencia global | `accounts:write` · **W** |

### 3.4 Contactos

| Tool | Qué hace | Qué **NO** permite | Scope / costo |
|---|---|---|---|
| `recommend_contact_roles` | Cargos a apuntar, justificados por señales reales | Exige cuenta guardada · máx 10 títulos manuales | `signals:read` · T0 |
| `get_company_contacts` | Contactos que el workspace ya tiene, con frescura por campo | Exige cuenta guardada · **nunca** llama a Apollo | `accounts:read` · T0 |
| `prepare_contact_enrichment` | Preview del enrichment con `planHash`, **sin gastar créditos** | Máx 25 roles / 50 contactos · exige cuenta guardada · gateada como `server_managed` aunque no cueste nada (ver §5) | `contacts:write` · T0 |
| `run_contact_enrichment` | Ejecuta Apollo y **gasta créditos** | Solo acepta un `planHash` · exige `userConfirmed: true` · **no trae teléfono** (`phone_status: "not_requested"`) | `contacts:write` · **T3** |

### 3.5 Research

Dos caminos en paralelo para lo mismo, con pools de cupo **independientes**:

| Tool | Qué hace | Qué **NO** permite | Scope / costo |
|---|---|---|---|
| `run_account_research` | Research completo con el AI Gateway **de ASCI** | Máx 10 cuentas · atómico por lote (`all_or_nothing`) · exige cuentas guardadas · cooldown de 30 días | `research:run` · **T2**, pool `research_server` |
| `prepare_account_research` | Devuelve el prompt package para que **el cliente** lo ejecute con sus tokens | Máx 10 · **consume cupo igual que el server-managed** (pool `research_client`) · el cupo se cobra al preparar, aunque nunca se envíe | `research:prepare` · **T2b** |
| `submit_account_research_stage` | Valida y persiste una etapa (4 etapas) | Solo los `evidenceId` del package · exige `packageHash` vigente | `research:submit` · T2b |
| `prepare_/submit_company_news` | Noticias con ventana temporal, clasificadas expansión/contracción/neutro | 1 unidad del pool client-assisted por preparación | `research:*` · T2b |
| `prepare_/submit_company_success_cases` | Casos de éxito con guardrail de URL viva y mención real | Descarta lo que no pasa el guardrail | `research:*` · T2b |
| `refresh_prompt_package` | Reemite un package vencido **sin consumir cuota** | Tiene techo de refrescos | `accounts:read` · T0 |
| `get_research_status` / `get_client_research_status` | Estado de un batch / una ejecución | Del propio workspace | `accounts:read` · T0 |

### 3.6 Icebreakers

| Tool | Qué hace | Qué **NO** permite | Scope / costo |
|---|---|---|---|
| `generate_account_icebreaker` | Genera con el AI Gateway de ASCI | Exige cuenta en el workspace · **no hay modo sin IA** | `icebreakers:generate` · **T2**, pool `icebreaker_server` |
| `prepare_/submit_account_icebreaker` | Mismo resultado con tokens del cliente | Exige cuenta guardada | `icebreakers:*` · T2b |

### 3.7 Vacantes, documentos y medición

| Tool | Qué hace | Qué **NO** permite | Scope / costo |
|---|---|---|---|
| `scrape_company_job_postings` | Vacantes frescas de LinkedIn vía Apify, ingestadas al pipeline | Máx 200 filas · ventanas solo de 1/7/30 días · exige cuenta guardada · **consume cupo de research server** | `research:run` · **T1**, pool `research_server` |
| `create_document_draft` | Documento compartido desde texto, URL o carga temporal | Enlace de un solo uso, 15 min | `documents:write` · T2b |
| `get_document_text` | Texto completo paginado | Hay que leer todo antes de extraer | `documents:read` · T0 |
| `get_document_dictionaries` | Tecnologías, procesos e industrias + JSON Schema | — | `documents:read` · T0 |
| `confirm_document_analysis` | Persiste la extracción | Exige `userConfirmed` y citas literales | `documents:write` · T2b |
| `get_ai_usage` | Los **tres** medidores mensuales: research server, research cliente y créditos de Apollo, más tokens y costo verificado | No responde cuánto cuesta un lote concreto: para eso está `estimate_batch` | `usage:read` · T0 |
| `estimate_batch` ⭐ | Cotiza un lote entero y devuelve **un** `batchPlanHash`: lugares del plan, unidades de research, créditos de Apollo y costo en USD | Máx 200 cuentas · el hash vence en 1 h y queda ligado a esas cuentas y roles · **no reserva nada** · el costo en USD viene en null si no hay telemetría | `usage:read` · T0 |

---

## 4. Inventario — `explore` (8) y `profiles` (3)

### `explore` — embudo sobre la base cruda

`explore_start` → `explore_set_country` → `explore_set_industries` es un embudo con sesión: cada paso devuelve el corte siguiente para que el usuario acote antes de traer nombres. `explore_companies` hace lo mismo sin sesión, para re-consultas. `explore_company_people` baja al detalle de las personas de una empresa con la evidencia de qué término matcheó.

Las dos capas pagas son las mismas del server standard, con otro nombre: `explore_scrape_jobs` (Apify, T1, cupo de research) y `explore_prepare_decision_makers` / `explore_run_decision_makers` (Apollo, T3, `planHash` + `userConfirmed`).

**Qué NO permite:** no usa el diccionario, así que no hay `termHits` por producto ni desambiguación de familias · el vocabulario lo aporta el modelo · el match es literal por palabra completa sobre texto libre, no semántico.

### `profiles` — persona-first

`profiles_search` con `requirements` que se **intersecan** (cada requisito es una nube de sinónimos en OR). `profiles_countries` y `profiles_industries` son cortes de apoyo.

**Qué NO permite:** el match es literal, no semántico · por defecto mira solo el puesto **actual** (`includePast: true` suma historial, más lento) · las facetas miran el puesto actual, así que son aproximadas · no hay capa paga: es solo lectura.

---

## 5. Solapamientos y huecos

### 5.1 Solapamientos **intencionales** (no tocar)

- **`run_*` vs `prepare_*`/`submit_*`** — el mismo resultado por dos caminos de costo: tokens de ASCI o tokens del cliente. Es la decisión de producto más valiosa del MCP.
- **`prepare_*` → `planHash` → `run_*(userConfirmed)`** — el patrón de confirmación de Apollo. Es lo mejor diseñado que hay hoy y conviene replicarlo en cualquier tool futura que gaste dinero de terceros.
- **`search_companies_by_capability` vs `explore_companies`** — se parecen pero operan sobre capas distintas (clasificado vs crudo). La regla: si el término está en el diccionario, la primera; si no, la segunda.

### 5.2 Solapamientos **reales** (a resolver)

| Solapamiento | Problema | Propuesta |
|---|---|---|
| `get_company_signals` vs `get_company_signal_summary` | Se pisan en el 80%, pero **no** es un subconjunto estricto: `get_company_signals` excluye vacantes a propósito (`scope: "contact-signals-only"`) y es la **única** que devuelve el aviso agregado de ex-empleados ("N de M señales son de ex-empleados"). El panorama, que es el que se usa para decidir, no lo tiene | No deprecar. Subir `formerEmployeeWarning` al panorama —es el dato que evita construir un icebreaker sobre alguien que se fue— y dejar `get_company_signals` como corte explícito "solo perfiles, sin vacantes" |
| `list_saved_accounts` vs `list_workspace_accounts` vs `check_account_access` | Tres tools para responder "¿qué cuentas tengo y cuánto cupo me queda?". La diferencia guardadas/investigadas no es evidente por el nombre | Unificar en una con un parámetro `filter`, o renombrar a `list_followed_accounts` / `list_researched_accounts` |
| ~~`get_ai_usage` + `list_saved_accounts` + `prepare_contact_enrichment`~~ | ~~**Cuatro medidores en tres tools**~~ **RESUELTO** (24-ago-2026). Los créditos de Apollo ya salen en `get_ai_usage`, y `estimate_batch` responde "¿cuánto me cuesta este lote?" con los cuatro números juntos y una sola confirmación | — |
| `explore_prepare/run_decision_makers` vs `prepare/run_contact_enrichment` | **Dos implementaciones de Apollo** con contratos distintos, en dos servers. Un cambio de precio o de política de Apollo hay que hacerlo dos veces | Unificar sobre el mismo servicio, dejando dos fachadas si hace falta |
| `recommend_accounts_for_value_proposition` vs `screen_account_list` | Ambas devuelven "cuentas que te convienen", una desde documentación y otra desde una lista. Se van a pisar cuando el usuario tenga las dos cosas | Documentar la frontera: propuesta de valor → descubrimiento; lista del cliente → screening |

### 5.3 Huecos encontrados al inventariar

1. ~~**Nueve tools son inalcanzables con una API key `standard`.**~~ **ARREGLADO** (24-ago-2026). `SCOPES_BY_TYPE.standard` no incluía `accounts:write`, `contacts:write`, `documents:read/write` ni `recommendations:read`, así que con una key standard nueva no se podía ni guardar una cuenta. La causa de fondo era que el set de scopes estaba **duplicado**: uno en la creación de la key y otro en la validación de cada request, y solo se actualizó el primero. Ahora vive en `lib/v3/mcp-key-scopes.ts` como fuente única, las keys ya emitidas se completan en validación (sin migración de datos) y un test lee las tools del código para que el catálogo no vuelva a quedar viejo. Las keys **legacy** de solo lectura no se amplían: ver §6.2.

2. **`prepare_contact_enrichment` está gateada como si costara.** Pide `contacts:write` y `mode: "server_managed"` (`mcp-contact-enrichment.ts:141`), o sea que **un plan trial no puede ni ver el preview** de lo que le costaría. Un preview que no gasta créditos debería ser Tier 0.

3. ~~**No hay modo sin IA para el icebreaker.**~~ **RESUELTO** (24-ago-2026): `build_evidence_icebreaker` es T0, determinístico, agrega en vez de individualizar y se niega a escribir sobre evidencia de ex-empleados.

4. ~~**No hay export.**~~ **RESUELTO** (24-ago-2026): `create_export` devuelve un xlsx o csv por URL firmada, tomando un `screeningId` para que la tabla no viaje dos veces por la conversación.

5. **No hay teléfono.** `get_company_contacts` evalúa frescura de teléfono, pero el enrichment escribe `phone_status: "not_requested"`. El dato existe en el modelo y no hay camino para obtenerlo.

6. **El cupo del plan no distingue consultar de seguir.** `followedCap` cubre las dos cosas, así que un solo reporte de screening puede agotar el plan (42 cuentas de 60 en el caso real; 139 en el de Legrand).

### 5.4 Los conteos de vacantes son históricos (y `is_active` no significa nada)

Relevado el 25-ago-2026 contra el catálogo real, a partir de una diferencia que se veía en la
aplicación web: el listado de resultados marcaba 5 búsquedas para Ualá + AWS y el detalle mostraba 2.

**El criterio es deliberado y son dos cosas distintas**, pero hay que decirlo en cada superficie:

| Superficie | Qué cuenta |
|---|---|
| Listado de resultados y score de la web (`search_companies_by_*_v2`) | Vacantes con la señal, **todo el histórico** |
| Detalle de una empresa en la web (`get_company_drawer_data`) y workspace (`get_company_job_postings`) | Solo las de los **últimos 6 meses** |
| MCP: `search_companies`, `search_companies_by_capability`, `get_company_signal_summary`, `explore_*`, exports | **Todo el histórico**, sin ventana |

O sea que el MCP coincide con el listado de la web, y el que recorta es el detalle. Los números que
hay detrás, medidos sobre el catálogo:

- 43.052 vacantes en total, de las cuales **19.692 (46%) son de los últimos 6 meses**.
- De 45.135 pares (empresa, señal) con vacantes, **25.636 (57%) dan distinto** según qué criterio se
  aplique, y en 18.471 el corte de 6 meses deja el detalle en cero.
- Naranja X tiene 56 vacantes con señal de AWS y **una sola** es de este semestre.

**`is_active` no sirve para filtrar**: viene en `true` en las 43.052 filas del catálogo, incluida una
de 2023, porque el scraper lo escribe y nadie lo apaga. Ni `activeCount` de
`get_company_signal_summary` ni el `j.is_active` de `explore_search_companies` distinguen nada. Lo que
está abierto **hoy** se averigua con `scrape_company_job_postings` (o `explore_scrape_jobs`), que es
lo único que va a LinkedIn en el momento.

Por eso ninguna de estas tools puede presentar su conteo como "está contratando": la formulación
correcta es "vacantes con esta señal en el catálogo", y la fecha de cada una es parte de la respuesta.

---

## 6. Los dos perfiles

### 6.1 Qué los diferencia de verdad

La diferencia **no** es "uno puede más tools que el otro". Es **dónde se pone el freno**:

| | **Admin** (información on-demand) | **Standard** (workspace de cliente) |
|---|---|---|
| **Para qué** | Armar un informe que un cliente pidió, con vacantes y todos los costos adentro | Que un vendedor trabaje sus cuentas sin poder generar un gasto que nadie autorizó |
| **Freno principal** | **Presupuesto del lote**, autorizado una vez al principio | **Bookmarks** (`followedCap`): el cupo de cuentas es el cap de costo |
| **Confirmaciones** | Una por lote | Una por operación que gasta |
| **Cuenta guardada** | No hace falta: se trabaja sobre el catálogo global | Obligatoria para research, contactos y vacantes |
| **Apollo (T3)** | Autorizado por lote, contra presupuesto | Preview + confirmación explícita, **siempre** |
| **Quién lo usa** | El equipo de ASCI | El cliente |

El punto que hay que sostener: **"directo" no puede significar "silencioso".** El perfil admin no elimina el control, lo **mueve de la operación al lote**. Y el enforcement tiene que estar en la capa 2 (server), nunca en la capa 3 (prompt): un modelo se convence, un tope en la API no.

### 6.2 Perfil `standard` — el cap por bookmarks

Ya está casi entero, y es coherente: `followedCap` limita cuántas cuentas se pueden trabajar, y **todas** las tools que gastan exigen que la cuenta esté guardada. El cupo de cuentas **es** el cap de costo.

Lo que falta para cerrarlo:

1. ~~Arreglar los scopes de `standard`~~ — **hecho**. Una key standard ya alcanza las 39 tools de su MCP. Las keys legacy que guardaron los literales `"read"` / `"write"` **no** se completan por tipo a propósito: `accounts:write` corre en modo `read`, así que `allowedModes` no lo frenaría y una credencial que alguien limitó a solo lectura pasaría a poder ocupar lugares del plan.
2. **Separar consultar de seguir.** Leer el catálogo no debería ocupar un lugar del plan. Con `screen_account_list` y `detail:"evidence"` esto ya es cierto técnicamente (son T0 sin guard); falta que el modelo de precios lo refleje.
3. **`estimate_batch`** para que el aviso de costo sea una vez por lote y no 42 veces.
4. ~~**Tope de presupuesto en USD por workspace**~~ — **descartado por ahora.** Decisión de producto (24-ago-2026): no se ponen topes de consumo hasta medir el uso real. La contrapartida es que la telemetría tiene que ser fiable: `get_ai_usage` ahora declara el `scope` de cada bloque y expone `workspaceAi` (workspace, mes en curso), porque `verifiedAi` es de quien llama y de 7 días — y se venía leyendo como si fuera del workspace.

### 6.3 Perfil `admin` — qué hay que construir

Un perfil admin necesita moverse en **las tres capas**, y por eso no alcanza con una API key nueva:

**Capa 1 — scopes.** Agregar `admin` a `SCOPES_BY_TYPE` con todos los scopes y los tres `allowedModes`. Es lo fácil.

**Capa 2 — guards.** Los scopes **no** desactivan `guardSavedAccounts`, `requireSavedAccount` ni `checkResearchQuota`: son chequeos independientes. Hace falta un flag en el principal —`principal.unrestricted`, derivado del tipo de key y **verificado contra el server**, no enviado por el cliente— que esos guards consulten. Cambios acotados y localizados:
- `guardSavedAccounts` / `requireSavedAccount` → devuelven OK si `unrestricted`
- `checkResearchQuota` → sigue **midiendo y registrando**, pero no bloquea
- `reserveMcpUsage` → sigue **reservando y auditando** (hace falta para saber cuánto costó el informe), contra un presupuesto de lote en vez del cupo del plan

La regla que no se negocia: **admin no significa "sin medición", significa "sin bloqueo".** Todo se sigue registrando, porque el objetivo del perfil es justamente poder decir cuánto costó un informe.

**Capa 3 — prompt.** Las descripciones y las `instructions` son por server. Mientras las tools digan "confirmá con el usuario", el modelo va a preguntar aunque tenga permiso. Por eso el perfil admin debería ser **un server aparte** (`/api/v3/mcp/admin/[transport]`) que reusa las mismas funciones de `lib/v3` y solo cambia las descripciones y las instrucciones.

**Lo único que NO cambia entre perfiles:** `run_contact_enrichment` y cualquier tool futura de Tier 3 **nunca** se autoejecutan sin un `planHash` confirmado. En admin la confirmación es **por lote** —un `batchPlanHash` con el costo total— pero existe. El crédito de Apollo no vuelve.

### 6.4 Orden sugerido

| Paso | Qué | Depende de |
|---|---|---|
| 1 | ~~Arreglar scopes de `standard`~~ ✅ | — |
| 2 | ~~`estimate_batch` + `batchPlanHash` de lote~~ ✅ | — |
| 3 | ~~Presupuesto en USD por workspace~~ — **descartado por ahora**: medir antes de trabar | — |
| 4 | Flag `unrestricted` en los guards de capa 2 | 3 |
| 5 | Server `admin` con sus propias descripciones e `instructions` | 4 |
| 6 | ~~Export (`create_export`)~~ ✅ | — |

Los pasos 2, 3 y 6 son las Fases 2 y 3 del plan de ejecución directa (`docs/plan-mcp-ejecucion-directa.md`): el perfil admin **no es un proyecto paralelo**, es lo que queda habilitado cuando ese plan termina.
