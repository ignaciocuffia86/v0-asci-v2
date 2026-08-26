# Plan — MCP `admin`: sin topes, con costo medido

Estado: **validado, sin implementar.** Las cuatro decisiones abiertas se cerraron el
25-ago-2026 y están en §6.

Objetivo: un perfil de MCP para el equipo de ASCI que pueda hacer enrichment y armar
bases sin que el `followedCap` ni el cupo mensual lo frenen, manteniendo confirmación
explícita solo donde el gasto es irreversible, y cerrando cada informe con **cuánto
costó de verdad, y quién lo gastó**.

Punto de partida: `docs/mcp-inventario-y-perfiles.md` §6.3, que ya diagnosticó por qué
una API key con más scopes no alcanza. Este documento es el cómo.

---

## 1. La decisión que ordena todo el plan

Hay dos gastos externos y **no se tratan igual**, porque no son iguales:

| | Apify (vacantes) | Apollo (contactos) |
|---|---|---|
| Qué se gasta | Cómputo de un actor, centavos por corrida | **Créditos** de un pool comprado |
| ¿Se recupera? | No aplica: no hay stock que se agote | **No.** El crédito gastado no vuelve |
| Si sale mal | Se vuelve a correr | Se perdió el crédito igual |
| **Control** | **Ninguno previo. Se mide después** | **Confirmación previa, siempre** |

Es coherente con el riesgo: frenar cada scraping para cotizar centavos es fricción sin
beneficio; frenar el gasto de un crédito irreversible es la única protección que
existe. Lo que cambia en `admin` no es *si* hay confirmación de Apollo, sino
**cuántas**: una por lote en vez de una por cuenta.

**La regla que no se negocia:** `admin` no significa "sin medición", significa "sin
bloqueo". Todo se sigue reservando y registrando. Si se saca el registro, se pierde
justo lo que hace vendible un informe on-demand: poder decir cuánto costó.

---

## 2. Por qué no alcanza con una key nueva

El control vive en tres capas independientes (§2 del inventario). Los topes que
molestan están casi todos en la **capa 2**, que no se entera de los scopes:

| Capa | Dónde | Qué hay que tocar |
|---|---|---|
| 1. Scope | `lib/v3/mcp-key-scopes.ts`, `lib/v3/mcp-usage.ts:requirePaidMcp` | Agregar el tipo `admin`. Es lo fácil |
| 2. **Guards de cuenta y cuota** | `mcp-account-lifecycle.ts`, `plans.ts`, `mcp-read-tools.ts` | **Acá está el trabajo real** |
| 3. Prompt | Descripciones e `instructions` del server | Server aparte: son por server, no por key |

La capa 3 no es enforcement (un modelo se convence), pero **sí** decide el
comportamiento: mientras las 43 descripciones digan "pedí confirmación al usuario", el
modelo va a preguntar 42 veces aunque tenga permiso para no hacerlo. Por eso `admin`
tiene que ser un server propio, no un flag en el server actual.

---

## 3. Fase A — El flag `unrestricted`

**Qué es.** Un booleano en `McpPrincipal`, derivado **en el server** del tipo de la
credencial (`lib/v3/mcp-auth.ts`, donde ya se arma el principal). Nunca llega del
cliente: si lo mandara quien llama, cualquier key sería admin.

**Dónde se consulta.** Cuatro puntos, todos existentes:

| Función | Archivo | Con `unrestricted` |
|---|---|---|
| `requireSavedAccount` | `lib/v3/mcp-account-lifecycle.ts:45` | Devuelve `state:"saved"` sin exigir bookmark (sigue validando que la empresa exista) |
| `guardSavedAccounts` | `lib/v3/mcp-account-lifecycle.ts:116` | Devuelve `null` (no bloquea) |
| `assertWorkspaceAccount` | `lib/v3/mcp-read-tools.ts:264` | No lanza |
| `checkResearchQuota` | `lib/v3/plans.ts:146` | **Sigue calculando y devolviendo los números**; `allowed` pasa a `true` |

`reserveMcpUsage` **no se toca**: sigue reservando, con la misma idempotencia. Lo que
cambia es que el tope contra el que compara deja de aplicar para este principal.

**Lo que NO desactiva `unrestricted`:**

- El circuito `prepare_contact_enrichment` → `planHash` → `run_contact_enrichment`.
- La validación de que la empresa exista en el catálogo (un `companyId` inventado
  sigue fallando).
- El registro: reservas, `ai_usage_log`, `mcp_request_logs`.

### 3.1 Emisión de la key: desde el panel, con dos llaves

La key `admin` se crea desde el panel de API keys, como las otras tres, para que el
equipo la administre sin tocar la base. Eso **abre una superficie que hoy no existe**
—una credencial sin topes emitible por UI— así que la contención tiene que ser
explícita. Dos condiciones, ambas obligatorias en `generateApiKey`:

1. **Quien la emite es `superadmin` global.** Ya existe: `isGlobalSuperAdmin`
   (`lib/v3/api-key-access.ts:13`, lee `profiles.role`). El `canManage` del workspace
   **no alcanza**: cualquier admin de un workspace de cliente lo tiene.
2. **El workspace destino es el de ASCI.** Un `admin` en un workspace de cliente
   destruye el único cap que ese workspace tiene, que es `followedCap`.

Lo bueno: **una key por usuario sale gratis.** `generateApiKey` ya rechaza una segunda
key activa del mismo tipo para el mismo `owner_user_id` (`app/actions/v3/api-keys.ts`,
el chequeo de `alreadyHasType`). Agregar `admin` al tipo hace que cada admin tenga la
suya y que el desagregado por usuario funcione solo: `mcp_usage_reservations`,
`ai_usage_log` y `mcp_request_logs` ya guardan `user_id` y `api_key_id`.

**Tests.** Un principal normal sigue bloqueado en los cuatro guards; un admin de
workspace que no es superadmin **no** puede emitir una key `admin`; y `unrestricted`
no altera lo que se registra (mismo número de reservas y de filas de log).

---

## 4. Fase B — El resumen de costo, después del gasto

Esta es la parte que reemplaza a la cotización previa de Apify.

### 4.1 La cadena de atribución ya existe (casi)

Para poder decir "este informe costó X" hace falta poder atribuir cada gasto a un lote.
Revisando las tablas, dos de los tres caminos **ya están**:

| Gasto | Cómo se ata al lote | ¿Existe? |
|---|---|---|
| **IA** (research, icebreakers) | `mcp_batch_job_items.research_job_id` → `ai_usage_log.research_job_id` → `cost_usd` | ✅ Sí. Y el `cost_usd` es **real**, del AI Gateway |
| **Apollo** | `mcp_batch_job_items.enrichment_plan_hash` → `contact_enrichment_runs.plan_hash` → `credits_spent` | ✅ Sí. `credits_spent` ya se registra por corrida, con `cache_hit` aparte |
| **Apify** | — | ❌ **Falta**. El scraping es una tool suelta: no sabe de qué lote es parte |

O sea: el grueso de la medición ya está registrado y nadie lo está leyendo junto.

### 4.2 Lo que falta para Apify (dos cosas chicas)

**1. Atribución.** `scrape_company_job_postings` recibe un `batchJobId` opcional que
se estampa en `metadata` de la reserva (`mcp_usage_reservations.metadata` ya es
`jsonb`, no hace falta migración). Sin esto, el costo de scraping solo se puede
reportar por workspace y mes, nunca por informe.

**2. El costo real.** `lib/v3/services/apify-client.ts:265` ya llama a
`GET /v2/actor-runs/{runId}` en cada poll y **descarta todo menos `status`**. La API de
Apify devuelve el consumo del run en ese mismo objeto.

> ⚠️ **A verificar antes de construir sobre esto.** No está confirmado contra una
> corrida real que el campo venga en la respuesta de este actor y que esté poblado
> cuando el run termina. Si viene: el costo de Apify es **real**, no estimado, y es una
> línea de código. Si no viene: se reporta *corridas y filas ingestadas*, sin USD, y se
> dice explícitamente que el USD no lo tenemos — nunca un número inventado.
>
> Es la misma lección de las migraciones: probarlo contra lo real antes de darlo por
> bueno.

### 4.3 La tool

`get_cost_summary({ batchJobId? , from?, to?, groupBy? })` — Tier 0, sin cuota.
`groupBy: "user" | "key"` es lo que hace útil el desagregado que motivó una key por
persona (§6.3).

Devuelve, por concepto:

```
ai:      { costUsd, inputTokens, outputTokens, jobs }         ← real, del AI Gateway
apollo:  { credits: {emails, phones, firmographics}, costUsd,
           runs, contactsFound, cacheHits }                   ← estimado hasta §8.3
apify:   { runs, rowsIngested, costUsd | null }               ← costUsd sujeto a 4.2
totalUsd
scope:   "batch" | "period"
by:      [{ userId, name, ...los mismos conceptos }]          ← si hay groupBy
```

Tres decisiones de forma:

- **Cada número dice de qué calidad es.** El de IA es medido (AI Gateway). El de
  Apollo es **estimado** mientras no se cierre §8.3, y va rotulado como tal. El de
  Apify es medido o `null`, nunca inventado. `totalUsd` suma lo disponible y declara
  qué quedó afuera: un total que mezcla un número medido con uno supuesto sin decirlo
  es un número inventado.
- **`cacheHits` va aparte** porque es la diferencia entre "buscamos 40 contactos" y
  "pagamos 40 contactos".
- **Va en el server admin y en el standard.** Saber cuánto se consumió no es un
  privilegio; lo que cambia entre perfiles es el tope, no la visibilidad.

---

## 5. Fase C — El server `admin` ✅ (26-ago-2026)

`/api/v3/mcp/admin/[transport]/route.ts`. Reusa **las mismas funciones** de `lib/v3`:
lo único propio son las descripciones y las `instructions`.

**Cómo quedó, y por qué.** Las 44 registraciones se extrajeron a
`lib/v3/mcp-server-tools.ts` y las comparten los dos perfiles. Duplicarlas para
cambiar nueve frases habría sido exactamente el bug de los scopes —dos copias, una
se actualiza, la otra queda vieja— así que las diferencias van en una lista corta de
reglas `find`/`replace` (`ADMIN_DESCRIPTION_RULES`) aplicadas por un proxy sobre
`server.tool`, el mismo mecanismo que ya usaba `withToolAudit`.

Una descripción admin escrita aparte también se desincroniza en silencio; una regla
`find` no puede: si alguien reescribe la frase standard, la regla deja de aplicar y
**el test falla**. El desfasaje se vuelve ruidoso en vez de invisible.

Se tocan dos cosas y ninguna más: *"la cuenta tiene que estar guardada"* (en admin es
falso) y *"pedí confirmación porque consume cupo"* (en admin no hay cupo). Apollo y lo
destructivo conservan su confirmación entera, y hay un test que lo fija.

**El acceso lo cierra el handshake**: una credencial sin el marcador `unrestricted` se
rechaza en `/api/v3/mcp/admin`. Conocer la URL no alcanza.

Qué cambia en el texto:

- Se saca "pedí confirmación al usuario" de todo lo que no sea Tier 3.
- Se saca "primero hay que guardar la cuenta" (en admin no aplica).
- Las `instructions` dicen el modelo de trabajo del perfil: se trabaja sobre el
  catálogo global, el gasto de Apollo se confirma **una vez por lote**, y al terminar
  se cierra con `get_cost_summary`.

Qué **no** cambia: `run_contact_enrichment` sigue exigiendo `planHash` confirmado.

**El `batchPlanHash` de admin sí autoriza Apollo** (§6.2). Es una diferencia
deliberada con el perfil standard, donde en Fase 3 se dejó a Apollo **afuera** del hash
a propósito: ahí la confirmación es por cuenta. En admin, la confirmación del lote
muestra el total de créditos y su equivalente en USD, y ese hash autoriza el gasto.
Sigue habiendo una autorización explícita antes de tocar un crédito irreversible;
lo que se elimina son las 42 repeticiones, no el consentimiento.

---

## 6. Decisiones tomadas (25-ago-2026)

### 6.1 Precio de Apollo: 1.000 créditos = US$ 10

**US$ 0,01 por crédito.** Pero el crédito **no es la unidad de consumo**: Apollo cobra
distinto según el endpoint y según el dato que devuelve. La tabla real está en §8, y
obliga a corregir tres cosas de cómo contamos hoy.

### 6.2 El `batchPlanHash` de admin autoriza Apollo: **sí**

Con el total de créditos y su equivalente en USD a la vista en la confirmación. Ver §5.

### 6.3 La key se emite desde el panel, **una por usuario**

Para que el equipo la administre entre todos los admins y para tener el desagregado de
gasto por persona. Las dos llaves de contención (superadmin global + workspace de ASCI)
y por qué el límite de una por usuario ya existe, en §3.1. El desagregado es lo que
justifica `groupBy` en `get_cost_summary` (§4.3).

### 6.4 Los informes on-demand se arman en el workspace admin

**Cuál es**: el de **Bigua** (`c731ba5a-aeb1-4e36-8bd5-401135566ecd`), que es de
testing y puede resetearse. Plan silver, así que `allowsApiKeys` pasa; sus dos
miembros —los únicos que entran con `@bigua.lat`— ya son `superadmin` global, o sea
que las dos llaves de §3.1 dan.

**Es la excepción a las reglas, y está declarada en un solo lugar**:
`lib/v3/admin-workspace.ts`. Ahí se lista qué deja de aplicar y qué sigue aplicando.
Una excepción repartida en cinco archivos es una excepción que nadie puede auditar.

Consecuencias:

- Las cuentas que el lote guarde quedan en el workspace admin, no en el del cliente.
  `saved_by_job` (que ya existe en `mcp_batch_job_items`) permite revertirlas sin tocar
  las que ya estaban.
- Todo el gasto se atribuye a ASCI, que es lo correcto: el crédito lo paga ASCI.
- El `followedCap` **deja de ser un cap** —eso es lo que hace `unrestricted`—, así que
  ese workspace no puede usarse a la vez como workspace de trabajo con topes.
- **El cron mensual lo saltea.** Ver §9.

---

## 7. Orden y tamaño

| Fase | Qué | Depende de | Tamaño |
|---|---|---|---|
| A | ~~Flag `unrestricted` + tipo de key + emisión gateada + excepción del workspace~~ ✅ | — | Hecho |
| B0 | Tabla de costos de Apollo + desglose por tipo de crédito (§8) | — | Chico + 1 migración |
| B1 | Verificar el consumo real de un run de Apify | — | Una corrida |
| B2 | ~~`get_cost_summary` (con `groupBy`) + atribución por `batchJobId`~~ ✅ | A | Hecho. El USD de Apify queda en `null` hasta B1 |
| C | ~~Server `admin` con sus descripciones e `instructions`~~ ✅ | A | Hecho |

**Una migración**, que el borrador no preveía: `contact_enrichment_runs.credits_spent`
es un `integer` suelto y no puede representar "3 emails + 2 teléfonos" (§8.2). La
cadena de atribución de IA y Apollo, en cambio, ya existe, y
`mcp_usage_reservations.metadata` ya es `jsonb`.

---

## 9. Fase A — lo que apareció al implementarla (25-ago-2026)

Tres cosas que el plan escrito no tenía:

**1. `checkFollowQuota` era un quinto guard.** El plan listaba cuatro. Pero
`followedCap` frena `save_account` y, con él, `create_batch_job` — o sea, justo el
"armar bases sin tanto límite" que motivó el perfil. Ahora también acepta
`unrestricted`, con el mismo criterio: mide igual, no bloquea.

**2. `check_account_access` habría mentido.** Devuelve el `SavedAccountGuard` tal cual,
y con `unrestricted` el guard vale `"saved"` aunque nadie haya guardado la cuenta —
tiene que valer eso para dejar pasar. Se agregó `actuallySaved`: `state` es la decisión
del guard, `actuallySaved` es el hecho. Una tool cuyo trabajo es responder "¿está
guardada?" no puede contestar que sí porque el guard la dejó pasar.

**3. El cron mensual habría cobrado para siempre.** `v3-refresh-accounts` re-investiga
TODA cuenta seguida activa de un plan pago. Un informe admin puede guardar cientos de
cuentas para armar una base: sin exclusión, cada una entraba al ciclo mensual y gastaba
IA todos los meses, sin que nadie lo decidiera. El `followedCap` contenía eso **por
accidente** —60 cuentas es poco— y `unrestricted` lo levanta. El cron ahora saltea el
workspace admin y lo loguea. Es la razón por la que existe `lib/v3/admin-workspace.ts`.

**4. El cupo mensual de Apollo NO se tocó, a propósito.** `getContactEnrichmentLimits`
+ `getMonthlyPoolUsage` frenan el enrichment al llegar a las unidades del plan
(`mcp-contact-enrichment.ts:265`). Es un tope, y por la regla del perfil debería
liberarse — pero es además el único techo del gasto irreversible.

**Sigue sin tocarse después de la Fase C, y conviene ser preciso sobre por qué.** El
server admin le *dice* al modelo que confirme Apollo una vez por lote, pero eso es
prompt, no enforcement: el `batchPlanHash` de `create_batch_job` **todavía no
autoriza créditos de Apollo** (la Fase 3 lo dejó afuera a propósito, §5). Liberar el
cupo mensual ahora dejaría un perfil sin techo de Apollo y con una autorización que
solo existe como texto — y la regla del proyecto es que un tope que importa vive en
la capa 2, nunca en la 3.

**Hecho el 26-ago-2026, y las dos cosas juntas como correspondía.** El
`batchPlanHash` ahora autoriza un presupuesto de créditos
(`enrichment_credits_authorized`, calculado en el server desde el plan congelado), y
`prepare_contact_enrichment` con `batchJobId` cobra contra ese presupuesto en vez de
contra el cupo mensual. El techo se movió del mes calendario al lote que alguien
cotizó y confirmó.

Dos cosas que el diseño obligó a resolver y no eran obvias:

- **Sin `batchJobId` no cambia nada**: sigue rigiendo el cupo mensual, para todos los
  perfiles. Es lo que impide que quede un camino al gasto sin ningún techo — que era
  exactamente el riesgo de liberar el cupo a secas.
- **Para una credencial CON topes, el presupuesto del lote se recorta al cupo mensual
  que le queda.** Sin ese recorte, cotizar 60 cuentas × 10 contactos habría autorizado
  600 créditos en un plan de 150: el presupuesto del lote se convertía en la forma de
  saltear el cupo. El techo del lote reemplaza al mensual **solo donde no hay tope que
  respetar**.

---

## 8. La tabla de costos de Apollo (25-ago-2026)

Precio base: **1.000 créditos = US$ 10 → US$ 0,01 por crédito**.

### 8.1 Lo que consume nuestro código

Solo estos cuatro endpoints se llaman desde el repo. El resto de la tabla de Apollo
(waterfall, CRM/CSV enrichment, AI research) es de la UI y hoy no nos toca.

| Endpoint | Dónde | Costo publicado | US$ |
|---|---|---|---|
| `mixed_people/search` | `lib/apollo/search.ts:89` | **No está en la tabla** (ver 8.3) | ? |
| `people/match` | `lib/apollo/enrich.ts:49` | 1 créd / email net-new · 1 créd / dato firmográfico o demográfico exportado · **5 créd / teléfono net-new** | 0,01 · 0,01 · **0,05** |
| `organizations/enrich` | `lib/apollo/organizations.ts:129` | 1 créd / resultado | 0,01 |
| `organizations/bulk_enrich` | `lib/apollo/bulk-organizations.ts:96` | 1 créd / empresa (máx. 10 por página) | 0,01 |

Para referencia, dos que **no** usamos y podrían tentar: `organizations/{id}/job_postings`
cuesta 1 créd por resultado —o sea que las vacantes por Apollo se pagan por fila,
mientras que por Apify se paga la corrida— y `news_articles/search`, 1 créd por página.

### 8.2 Tres correcciones a cómo contamos hoy

**1. El teléfono cuesta 5×, no "un poco más".** Un email es 1 crédito (US$ 0,01) y un
teléfono son 5 (US$ 0,05). Eso le pone número al `includePhone` con costo diferencial
que la Fase 4 del otro plan dejó anotado sin cuantificar: no es un detalle de UI, es
quintuplicar el costo por contacto.

**2. `people/match` cobra por DATO, no por contacto.** Nuestro código hace
`creditsSpent = contacts.length` (`mcp-contact-enrichment.ts:477`) y
`creditsEstimated: revealEmail ? 1 : 0` (`enrich.ts:55`): asume 1 crédito por persona.
Según la tabla, una sola llamada puede cobrar 1 por el email **más** 1 por los datos
firmográficos/demográficos exportados **más** 5 si aparece un teléfono. Con el
`revealEmail: true` de hoy la cuenta puede ya estar corta.

**3. Hace falta desglose por tipo.** `contact_enrichment_runs.credits_spent` es un
`integer`: no puede representar "3 emails + 2 teléfonos", y sin eso no se puede
valorizar una corrida cuando los tipos cuestan distinto. Migración: pasar a un `jsonb`
con el desglose (`{emails, phones, firmographics}`) conservando el entero como total,
o columnas separadas. El total en USD sale de multiplicar cada tipo por su precio.

### 8.3 Dos cosas a verificar contra el ledger de Apollo, antes de dar un número por bueno

Las dos son de la misma clase: **una suposición nuestra que la tabla no confirma.**

- **`mixed_people/search` no figura en la tabla publicada.** La documentación lista
  `/mixed_people/api_search` como gratuito y `/mixed_companies/search` a 1 crédito por
  página; el que llamamos no está, y Apollo advierte que los endpoints no documentados
  **también pueden cobrar**. Lo bookeamos como `creditsEstimated: 0` y la búsqueda
  **pagina en un loop**, así que si cobra por página el costo silencioso escala con el
  tamaño de la búsqueda.
- **Si la cuenta tiene Waterfall Enrichment activo**, un email pasa de 1 crédito a
  2–10 y un teléfono de 5 a 5–20. Nuestra estimación quedaría corta hasta 10×.

La prueba es la misma para las dos y no requiere escribir código: **comparar el
consumo real que reporta Apollo para un día contra la suma de nuestros
`creditsEstimated` de ese día.** Si coinciden, el modelo es correcto; si no, la
diferencia dice cuál de las dos hipótesis es.

Hasta entonces, `get_cost_summary` tiene que rotular el costo de Apollo como
**estimado**, no como real. Es la misma regla que aplicamos a Apify: un número medido y
uno supuesto no se suman sin decirlo.
