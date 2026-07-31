# MCP de ASCI v3 — Informe consolidado y plan de remediación

**Fecha:** 31-jul-2026
**Fuentes:** dos tests independientes, complementarios en cobertura.

| | Test A (harness v0) | Test B (Claude real) |
|---|---|---|
| Cliente | Harness que hace de cliente IA (`scripts/mcp-ux-harness.mjs`) | Claude en claude.ai |
| Entorno | Local, workspace Bigua (silver) | Producción `asci.bigua.lat`, silver |
| Cuenta | Techint / Grupo Arcor | Falabella |
| Cubrió | Descubrimiento, panorama, **noticias client-assisted**, guardrails de fuente, cuotas | Descubrimiento, **research completo 4 etapas**, scorecard, contactos, evidencia |
| Detalle | `docs/mcp-ux-test-cuentas.md` | `docs/mcp-ux-test-falabella-claude.md` |

Los dos tests no se pisan: A rompió el flujo de noticias (que B no tocó) y B recorrió el research completo (que A no tocó). Donde **sí** coinciden, la coincidencia es la señal más fuerte del informe.

---

## 1. Hallazgo principal: dos síntomas, un solo bug

Test B reportó que `search_companies("Falabella")` nunca devuelve Falabella (16.065 señales) y marca **Sodimac** como canónica. Test A reportó que `search_companies("Techint")` devuelve **5 canónicas distintas en 5 corridas** y nunca la real (726 señales).

Son el mismo defecto, en `lib/v3/mcp-read-tools.ts`:

```ts
.or(`name.ilike.%${normalized}%,website.ilike.%${normalized}%`)
.limit(Math.min(limit * 5, 100))   // ← trunca SIN ORDER BY
// ...después de truncar, recién acá rankea por señales
const ranked = counted.sort((a, b) => b.evidence.signals - a.evidence.signals || ...)
```

El ranking por evidencia es correcto, pero **se aplica después de que Postgres ya descartó filas arbitrariamente**. Sin `ORDER BY`, el motor devuelve las filas que le convienen y el conjunto cambia entre corridas. La entidad canónica real nunca entra al ranking si no cayó en ese recorte ciego.

La prueba numérica que confirma el mecanismo: `totalMatches` reportó **50** en el test B (que usó `limit: 10`) y **15** en el test A (que usó `limit: 3`). Ambos son exactamente `limit * 5`, no la cantidad real de coincidencias. En SQL directo, "Techint" tiene **240** matches, no 15.

Un solo fix resuelve cuatro síntomas: la no determinación, la canónica ausente, el `totalMatches` mentiroso y (con el criterio de nombre) el `likelyCanonical` falso. Es el mejor retorno del plan.

Efecto secundario de costo que ninguno de los dos tests midió: la función hace **2 count queries por candidato** (hasta 100 por búsqueda). Es un N+1 que conviene resolver en el mismo pase.

## 2. Coincidencias y hallazgos únicos

**Coincidieron (confianza alta):**
- Ranking/canónica de `search_companies` (§1).
- `get_account_panorama` citada en 4 lugares y **no registrada** entre las 36 tools; la real es `get_company_signal_summary`. Dos de esas citas son texto que el modelo lee en runtime.
- El patrón preview → confirmación explícita (`prepare_save_account` → `save_account` con `userConfirmed`) es bueno y hay que conservarlo.

**Solo test A (flujo de noticias):**
- El guardrail de URL viva **no filtra nada**: entró un dominio inexistente. Causa: `undici` pone `ENOTFOUND` en `err.cause.code`, pero el código lo busca en `err.message`, que solo dice `"fetch failed"`.
- Un duplicado tira error crudo de Postgres y **voltea el lote entero**.
- `submit_*` exige `idempotencyKey` que el prompt package no devuelve.
- La cuota se cobra al preparar, aunque nunca se envíe el resultado.
- Los topes por plan del pool client-assisted son planos: bronze, silver y gold tienen el mismo límite.

**Solo test B (flujo de research):**
- `prepare_account_research` recibe `companies: string[]` (nombres) y resuelve con su propio resolver: se guarda la cuenta A por id y el research exige la B. Confirmado en el schema.
- El package de `fit_scoring` pide `fitScore` sin incluir ICP ni propuesta de valor.
- Payloads que no entran en contexto: 155 KB en una respuesta; ~650 KB por research completo.
- `category` acepta cualquier string (`z.string().max(100)`), sin enum.
- Envelope de error inconsistente: algunos traen `nextAction`, otros un código pelado.
- Dos stores desincronizados en contactos y en evidencia.

## 3. Cómo se compone el daño

Las fallas no son independientes; se encadenan en el camino que hace un usuario nuevo:

1. Pregunta por una cuenta → **la búsqueda le ofrece la entidad equivocada** (§1).
2. Guarda esa entidad → **consume cupo real** del plan.
3. Pide research → **falla**, porque el resolver eligió otra entidad (C2).
4. Pide noticias → **se publican fuentes sin verificar**, con alcance global a todos los tenants (H1).

El resultado es que la promesa central del producto —"información con fuente, para decidir si vale la pena"— hoy no se sostiene: puede ser la empresa equivocada y con fuentes que nadie validó. Ambas fallas son de líneas contadas.

---

## 4. Plan de remediación

Ordenado por valor para el usuario sobre costo. Cada ola es entregable por separado.

### Ola 0 — Desbloquear el circuito (esfuerzo bajo, impacto muy alto)

Sin esto, el primer recorrido de un usuario falla o guarda datos falsos.

| # | Fix | Por qué primero | Alcance |
|---|---|---|---|
| 0.1 | **DNS en el guardrail de fuentes**: leer `err.cause.code` además de `err.message` | Es lo único que hoy **corrompe datos compartidos** entre tenants. Afecta noticias y casos de éxito por igual | 1 línea en `lib/ai-structurer.ts` + test de regresión |
| 0.2 | **Search: `ORDER BY` antes del recorte** + `likelyCanonical` exige coincidencia de nombre/dominio + `totalMatches` real | Un fix, cuatro síntomas (§1). Evita que se gaste cupo en la empresa equivocada | `searchCompanies` en `lib/v3/mcp-read-tools.ts` |
| 0.3 | **Aceptar `companyId` en research** (UUID en `companies[]` o `companyIds[]`) | El companyId ya es la moneda de las otras 35 tools; hoy el research es el único que resuelve por texto libre | Schema + `resolveCompany` |
| 0.4 | **Renombrar `get_account_panorama` → `get_company_signal_summary`** en las 4 referencias | El modelo llama una tool fantasma en el primer paso | Búsqueda y reemplazo |

Sugerencia de secuencia: 0.1 y 0.2 juntos (son los dos que rompen la confianza), después 0.3 y 0.4.

### Ola 1 — Ergonomía del agente (esfuerzo bajo/medio, impacto alto)

Cada error sin `nextAction` y cada KB de payload inútil es un turno extra y tokens del usuario.

| # | Fix | Nota de costo |
|---|---|---|
| 1.1 | **Envelope de error uniforme** `{error, message, nextAction, context}` | El patrón bueno ya existe en `get_company_contacts`; es propagarlo |
| 1.2 | **Dieta de payload**: truncar descripción de vacantes y pasar evidencia por referencia | Más barato de lo que parece: `company-signal-summary` **ya** trunca a 500 chars; el research manda la descripción completa. Es replicar el patrón existente. Esto baja el gasto de tokens del usuario, que es el argumento del client-assisted |
| 1.3 | **`workspaceContext`/ICP en `fit_scoring` y `account_brief`** | Casi gratis: `internal-account-snapshot.ts` ya llama `getWorkspaceFitProfile()`; solo hay que exponerlo en el package. Sin esto el fit score es inventado |
| 1.4 | **`idempotencyKey` en el package** y que un duplicado no voltee el lote | Dos fallas que hoy se ven como "error del servidor" en un flujo correcto |

### Ola 2 — Integridad y confianza (esfuerzo medio)

| # | Fix | Nota |
|---|---|---|
| 2.1 | **Enum cerrado de `category`** + publicar JSON Schema real | El server ya valida con zod; lo que se publica al cliente es informal. `confirm_document_analysis` ya lo hace bien |
| 2.2 | **Unificar stores** de contactos y de evidencia, con `source` por registro | Hoy el brief muestra 8 contactos y la tool de contactos dice 0 y sugiere gastar créditos |
| 2.3 | **Agregación de `evidenceLevel`** que no supere el máximo de sus fuentes | Contradice el propio systemPrompt y es el diferencial del producto |
| 2.4 | **Cuota**: cobrar al `submit` o liberar reservas abandonadas + topes por plan diferenciados | Hoy se paga por preparar aunque no se guarde nada |

### Ola 3 — Calidad de datos (esfuerzo medio/alto)

| # | Fix | Nota |
|---|---|---|
| 3.1 | Limpieza de clasificación cruda v2 (stoplist, dedupe, parser de `•`) | "Excel" y "equity" como procesos de negocio |
| 3.2 | Consolidación de grupos económicos (`groupId` curado) | Los 20–50 grupos más consultados cubren el grueso |

### Fuera de alcance de las olas

`prepare/submit_company_public_docs` para balances y reportes de sustentabilidad (spec en `docs/mcp-ux-test-cuentas.md`). Es funcionalidad nueva, no remediación: hoy es imposible porque `create_document_draft` no recibe `companyId`.

---

## 5. Qué sigue sin testear

News y success cases end-to-end **con el guardrail arreglado**, icebreakers, scraping de vacantes, enrichment de Apollo, `recommend_contact_roles`, `recommend_accounts_for_value_proposition`, flujo de documentos, path server-managed (`run_account_research`) y expiración (`CLIENT_PACKAGE_EXPIRED` → `refresh_prompt_package`).

Falta el número que justifica el client-assisted: **costo y latencia comparados contra `run_account_research`** sobre la misma cuenta. Requiere gastar cuota real del pool server-managed.

## 6. Verificación

El harness `scripts/mcp-ux-harness.mjs` corre por fases (`catalogo`, `schemas`, `descubrimiento`, `determinismo`, `panorama`, `preparar-noticias`, `submit-noticias`) y sirve como test de regresión de la Ola 0:

- `determinismo` debe pasar de "5 canónicas distintas" a "estable".
- `submit-noticias` debe pasar de "4 de 5 aceptadas" a "1 de 5", rechazando dominio inexistente y fuente ajena.

Nota operativa: las noticias y casos de éxito se publican **globales** a todo v3. Al testear conviene prefijar títulos con un marcador (`[TEST v0]`) para poder limpiarlos después.
