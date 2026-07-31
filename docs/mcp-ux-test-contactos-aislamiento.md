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

## Hallazgo crítico: fuga cross-tenant

`get_company_signal_summary` **no valida pertenencia de la cuenta al workspace**.

Evidencia: un workspace creado desde cero, que nunca siguió a Grupo Arcor, obtuvo 72 KB
de panorama incluyendo implementaciones con nombre de proveedor cargadas por el
workspace Bigua (`Axonier`, `Kamay Ventures`, `Random ERP`).

Causa raíz: `company_news`, `company_implementations` y `company_public_docs` **no tienen
columna `workspace_id`** — son globales a v3 — y `company-signal-summary.ts` las lee sin
ningún filtro de tenant.

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
