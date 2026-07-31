# MCP · Ronda de contactos y aislamiento multitenant

Test ejecutado con el harness haciendo de cliente IA (`scripts/mcp-ux-harness.mjs`),
sobre el MCP corriendo en local contra la base real. Fases nuevas: `contactos`,
`cross-tenant`, `cuota`, `costo-research`.

Todos los fixtures se crearon con prefijo `[TEST v0]` y se revocaron al final. La API
key real del usuario no se tocó.

## Cómo reproducir

```bash
node scripts/mcp-test-setup.mjs            # crea workspace B + 2 keys de prueba
COMPANY_ID=<uuid> node scripts/mcp-ux-harness.mjs contactos        # dry-run, no gasta
COMPANY_ID=<uuid> EJECUTAR=si ... contactos                        # gasta Apollo real
KEY_FILE=/tmp/asci-test-key-b ... cross-tenant                     # prueba de aislamiento
node scripts/mcp-ux-harness.mjs cuota                              # cuota + reclaims
node scripts/mcp-test-setup.mjs --cleanup  # revoca todo
```

Variables: `KEY_FILE` apunta a la key de otro workspace, `MAX_CHARS` desactiva el
truncado para auditar contenido, `EJECUTAR=si` habilita el gasto real.

## Hallazgo crítico: falta de aislamiento (fuga LATENTE)

`get_company_signal_summary` **no valida pertenencia de la cuenta al workspace**.

Evidencia: un workspace creado desde cero, que nunca siguió a Grupo Arcor, obtuvo 72 KB
de panorama incluyendo implementaciones con nombre de proveedor (`Axonier`,
`Kamay Ventures`, `Random ERP`).

Mecanismo, en dos capas que se suman:
1. `getCompanySignalSummary(companyId)` **no recibe `workspaceId`** — no podría filtrar
   ni queriendo.
2. Usa `createAdminClient()` (service_role), que saltea cualquier RLS.

`company_news`, `company_implementations` y `company_public_docs` **no tienen columna
`workspace_id`**. Sí tienen `user_id` y `ai_provider`, que son la vía para el backfill.

**Corrección importante sobre una afirmación previa:** esas filas de Arcor son
`ai_provider='parallel'` con `user_id` NULL, o sea las generó el research de **v2**, no
las subió Bigua. Hoy **no existe ninguna fila `client_mcp`**: el drilldown de v3 nunca
persistió nada en producción. Por eso la fuga de contenido de un tenant es **latente**,
no activa: se activa en cuanto un tenant corra el drilldown client-assisted. La
exposición presente es menor pero real: **36 filas con `user_id`** (7 implementaciones +
29 public_docs) son uploads atribuibles a un usuario y hoy las lee cualquier tenant.

Contraste que prueba que es un bug y no un diseño: `get_account_intelligence` sobre la
misma cuenta y la misma key **sí** corta, con `ACCOUNT_NOT_AVAILABLE_IN_WORKSPACE`.

Impacto: fuga de inteligencia competitiva entre clientes. El arreglo requiere migración
de esquema (agregar `workspace_id` a las tres tablas y decidir qué es global y qué es del
tenant), no alcanza con un filtro.

## Estado de la función de contactos

`APOLLO_API_KEY` no está configurada en el entorno, así que **la función de contactos es
inoperable**: `run_contact_enrichment` falla con `APOLLO_SEARCH_FAILED`. Lo bueno es que
el camino de fallo es limpio y libera la reserva completa (verificado: `reserved` a 0).

Lo que sí funciona:

- `recommend_contact_roles` analizó 400 señales y devolvió cargos con drivers.
- El dry-run de `prepare_contact_enrichment` da preview de costo sin gastar.

Detalles a mirar:

- Los cargos vienen **en inglés** (Apollo los indexa así), pero la tool aceptó sin
  objetar un cargo en español (`rejectedRoles: []`). Riesgo de búsqueda vacía silenciosa.
- `resolvedOrganization` vino con todos los campos en `null` y `warning: null`: se
  reservarían 10 créditos sin que nada avise que la organización no está resuelta.
- Teléfono confirmado como Fase 5 (`revealPhone: false` fijo).

## Arreglado en esta ronda

1. **Códigos de error estructurados colapsaban a `UNKNOWN_ERROR`.** `EnrichmentError`
   lleva el código en `.code` y deja en `message` solo la frase para el usuario, pero el
   envelope solo parseaba el patrón `"CODIGO:mensaje"` embebido en el string. Resultado:
   `RATE_LIMITED`, `APOLLO_SEARCH_FAILED` y compañía perdían su `nextAction`. Ahora el
   envelope prioriza `.code`. Verificado en runtime.

2. **`PLAN_QUOTA_EXCEEDED` mentía.** Rechazar una cuenta que ya está en seguimiento (y se
   refresca sola) devolvía ese código teniendo 10/30 de cuota disponible, así que el
   modelo le informaba al usuario que se había quedado sin cuota. Se agregó
   `ACCOUNT_AUTO_REFRESHED`, con `nextAction` que dice explícitamente que no reintente ni
   gaste, y que lea lo que ya hay. Verificado en runtime.

3. **Reservas de Apollo abandonadas fugaban cuota.** `prepare_contact_enrichment` reserva
   el peor caso (hasta 10 unidades) porque no sabe cuántas personas devolverá la búsqueda.
   Si el usuario nunca confirma el run, la reserva queda en `reserved` y
   `getMonthlyPoolUsage` la sigue contando para siempre, comiéndose el cupo mensual con
   previews que nunca se cobraron. Es el mismo patrón de fuga que el research
   client-assisted, en otro pool. Se agregó `reclaimAbandonedContactEnrichment`, que corre
   perezosamente desde `getMcpUsage` y hace doble chequeo contra `contact_enrichment_runs`
   antes de liberar. Verificado: una reserva colgada de 10 unidades pasó a `released`.

## Costo real del research server-managed (Test A)

Medido de punta a punta sobre Grupo Boldt (300 señales, cuenta nueva). La única fuente de
tokens y costo es `v3.ai_usage_log`; `v3.research_jobs` **no tiene ninguna columna de
costo**.

- **`run_account_research` es asíncrono.** Devuelve `batchId` en ~2s y sigue en background;
  tarda más de 15 minutos. Un OK inmediato NO significa research terminado — hay que
  seguir `research_jobs.status` y `current_step`. (El primer intento de medición confundió
  ese OK rápido con un run completo.)
- **Estructura del gasto.** Itera un paso por categoría de radar
  (`customer_service`, `cybersec_iam`, `devops_platform`, `jobs_skills`, `news_business`…).
  Cada paso hace **1 llamada a `claude-opus-4-5` con 80-130k tokens de input** más 1 a
  `gemini-2.5-flash`. El input gigante por paso domina el costo y escala con las señales
  de la cuenta.
- **Cifras.** A 63% de progreso: 10 llamadas, **$1.72 reportados**. Proyección por cuenta:
  **~$3 reportado / ~$5 real** (ver bug de precios). Es mucho más de lo que sugiere
  "1 unidad de cuota": la cuota cuenta cuentas, no dinero, así que el costo por unidad
  varía fuerte con el tamaño de la cuenta.

### Bug de precios: subreporte de ~1.67x (arreglado)

`MODEL_PRICING` en `lib/v3/usage.ts` usaba claves con **punto**
(`anthropic/claude-opus-4.5`) pero el AI Gateway emite el id con **guion**
(`anthropic/claude-opus-4-5`). Por esa única diferencia, toda llamada a Anthropic caía al
`DEFAULT_PRICING` de 3/15 en lugar de los 5/25 reales de Opus.

Verificado: la misma llamada (129.847 in / 2.770 out) pasa de **$0.431091 a $0.718485**.
El arreglo agrega `normalizeModelKey`, que compara sin separadores para que punto y guion
resuelvan al mismo precio. Gemini nunca estuvo afectado porque su id ya coincidía.

### Atribución de costo rota (no arreglado: es decisión de producto)

El insert de `logAiUsage` nunca escribe `research_job_id` ni `api_key_id`, aunque las
columnas existen: no se puede saber cuánto costó un job concreto ni imputar gasto a una
API key. Y **`generation_mode` viene de un DEFAULT de la base (`'server_managed'`)** que el
código nunca setea, así que el modo client-assisted también quedaría marcado como
`server_managed`. Hoy es imposible comparar el costo de los dos modos en el log — que era,
justamente, el objetivo original del Test A.

## Scopes de las API keys

- La key real de Claude tiene `accounts:read` pero **no `accounts:write`**, así que
  `save_account` falla con `MISSING_SCOPE` desde el chat. Hay que decidir si guardar
  cuentas debe poder hacerse desde ahí.
- `save_account` exige `userConfirmed: z.literal(true)`: guard explícito bien diseñado, el
  modelo no puede ocupar un lugar del plan sin confirmación del usuario.
- Las tools que gastan plata sí validan scope (`run_account_research` → `research:run`;
  las de contactos → `contacts:*`). **Ojo con el grep:** `requirePaidMcp` está en la línea
  siguiente al `server.tool(...)`, así que un grep de una sola línea da falsos negativos y
  hace parecer que no hay control. Sí lo hay.

## Trampas del entorno de test

Vale documentarlas porque cuestan horas:

- **`validateMcpRequest` exige una fila activa en `v3.workspace_members`** para el par
  (workspace de la key, `owner_user_id` de la key). Si falta, la auth corta antes de mirar
  scopes y `mcp-handler` responde un genérico **"No authorization provided"** que no dice
  nada del motivo real. El `owner_user_id` sale de la key: `v3.workspaces` no tiene esa
  columna.
- **`idempotencyKey` con `Date.now()` apila reservas**: cada dry-run reservaba otras 10
  unidades hasta disparar el límite de ventana del RPC. La key debe derivar de los
  argumentos, así el reintento es idempotente.
- **El sandbox se recicla y borra `/tmp`**: las keys de prueba se pierden y su valor en
  claro no se puede recuperar (la base guarda solo el hash). Conviene encadenar setup y
  uso en un mismo comando.
