# Plan — MCP `admin`: sin topes, con costo medido

Estado: **borrador para validar**. Nada de esto está implementado.

Objetivo: un perfil de MCP para el equipo de ASCI que pueda hacer enrichment y armar
bases sin que el `followedCap` ni el cupo mensual lo frenen, manteniendo confirmación
explícita solo donde el gasto es irreversible, y cerrando cada informe con **cuánto
costó de verdad**.

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

Esto es lo que pediste y es coherente con el riesgo: frenar cada scraping para cotizar
centavos es fricción sin beneficio; frenar el gasto de un crédito irreversible es la
única protección que existe. Lo que cambia en `admin` no es *si* hay confirmación de
Apollo, sino **cuántas**: una por lote en vez de una por cuenta.

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

**Riesgo y contención.** Una key `admin` gasta plata real sin tope. Propuesta: **no
es emitible desde el panel de API keys**. Se crea por script contra el workspace de
ASCI, y `keyTypeFromScopes` la reconoce por un scope marcador (`admin:unrestricted`),
igual que hoy distingue `explore` y `profiles`. Si una key así llega a un workspace de
cliente, el `followedCap` deja de ser el cap de costo y no queda ningún otro.

**Tests.** Que un principal normal siga bloqueado en los cuatro guards, y que
`unrestricted` no altere lo que se registra (mismo número de reservas y de filas de
log en ambos casos).

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

O sea: el 90% del trabajo de medición ya está hecho y nadie lo está leyendo junto.

### 4.2 Lo que falta para Apify (dos cosas chicas)

**1. Atribución.** `scrape_company_job_postings` recibe un `batchJobId` opcional que
se estampa en `metadata` de la reserva (`mcp_usage_reservations.metadata` ya es
`jsonb`, no hace falta migración). Sin esto, el costo de scraping solo se puede
reportar por workspace y mes, nunca por informe.

**2. El costo real.** `lib/v3/services/apify-client.ts:265` ya llama a
`GET /v2/actor-runs/{runId}` en cada poll y **descarta todo menos `status`**. La API de
Apify devuelve el consumo del run en ese mismo objeto.

> ⚠️ **A verificar antes de construir sobre esto.** No confirmé contra una corrida
> real que el campo venga en la respuesta de este actor y que esté poblado cuando el
> run termina. Si viene: el costo de Apify es **real**, no estimado, y es una línea de
> código. Si no viene: se reporta *corridas y filas ingestadas*, sin USD, y se dice
> explícitamente que el USD no lo tenemos — nunca un número inventado.
>
> Es la misma lección de las migraciones: probarlo contra lo real antes de darlo por
> bueno.

### 4.3 La tool

`get_cost_summary({ batchJobId? , from?, to? })` — Tier 0, sin cuota.

Devuelve, por concepto:

```
ai:      { costUsd, inputTokens, outputTokens, jobs }      ← real
apollo:  { credits, runs, contactsFound, cacheHits }        ← real (créditos)
apify:   { runs, rowsIngested, costUsd | null }             ← costUsd sujeto a 4.2
scope:   "batch" | "period"
```

Tres decisiones de forma:

- **Créditos y dólares NO se mezclan.** Apollo se reporta en créditos porque es lo que
  se gasta y lo que se mide; convertirlo a USD exige un precio por crédito que hoy no
  está en el código (ver §6). Sumar un número real con uno inventado da un total
  inventado.
- **`cacheHits` va aparte** porque es la diferencia entre "buscamos 40 contactos" y
  "pagamos 40 contactos".
- **Va en el server admin y en el standard.** Saber cuánto se consumió no es un
  privilegio; lo que cambia entre perfiles es el tope, no la visibilidad.

---

## 5. Fase C — El server `admin`

`/api/v3/mcp/admin/[transport]/route.ts`. Reusa **las mismas funciones** de `lib/v3`:
lo único propio son las descripciones y las `instructions`.

Qué cambia en el texto:

- Se saca "pedí confirmación al usuario" de todo lo que no sea Tier 3.
- Se saca "primero hay que guardar la cuenta" (en admin no aplica).
- Las `instructions` dicen el modelo de trabajo del perfil: se trabaja sobre el
  catálogo global, el gasto de Apollo se confirma **una vez por lote**, y al terminar
  se cierra con `get_cost_summary`.

Qué **no** cambia: `run_contact_enrichment` sigue exigiendo `planHash` confirmado.

**Lo que hay que decidir acá** (ver §6): en Fase 3 se dejó a Apollo **afuera** del
`batchPlanHash` a propósito. Para admin, "una confirmación por lote" significa que el
hash del lote **sí** autorice los créditos de Apollo. Es una diferencia deliberada
entre perfiles, no una inconsistencia — pero conviene decirlo en voz alta antes de
construirla.

---

## 6. Qué necesito de vos para cerrar esto

1. **Precio por crédito de Apollo.** Si me lo pasás, va a `plan-config.ts` y el
   resumen puede dar un total en USD. Si no, el resumen reporta créditos y lo dice.
2. **¿El `batchPlanHash` de admin autoriza Apollo?** (§5). Mi recomendación: sí, con
   el total de créditos a la vista en la confirmación. Es lo que pediste —"una
   confirmación con la cantidad a consumir"— y sigue habiendo una autorización
   explícita antes del gasto irreversible.
3. **¿La key admin se emite por script y no desde el panel?** Mi recomendación: sí.
4. **¿Un solo workspace admin o uno por cliente?** Un informe on-demand para un
   cliente, ¿se arma en el workspace de ASCI o en el del cliente? Cambia dónde quedan
   las cuentas guardadas y a quién se le atribuye el costo.

---

## 7. Orden y tamaño

| Fase | Qué | Depende de | Tamaño |
|---|---|---|---|
| A | Flag `unrestricted` en los 4 guards + tipo de key | — | Chico. 4 funciones, 1 tipo |
| B1 | Verificar el consumo real de un run de Apify | — | Una corrida |
| B2 | `get_cost_summary` + atribución por `batchJobId` | A, B1 | Medio |
| C | Server `admin` con sus descripciones | A | Medio: mucho texto, poca lógica |

Sin migraciones nuevas: `mcp_usage_reservations.metadata` ya es `jsonb` y la cadena de
atribución de IA y Apollo ya existe.
