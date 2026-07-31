# Evaluación del re-test v2 + plan de olas

**Fecha:** 31-jul-2026 · **Entrada:** `docs/mcp-ux-test-falabella-claude.md` (v1) + re-test v2
**Estado:** verificado contra código y base de producción antes de priorizar.

---

## 1. Veredicto: nueva Ola 1.5, no meterlo en Ola 2

Los hallazgos nuevos (N6–N11) **no son de la misma naturaleza** que la Ola 2 original
(integridad de datos, stores desincronizados, calidad). Son casi todos **ergonomía del
contrato con el cliente IA**: mensajes, nombres, localización de errores. Comparten causa
raíz con la Ola 1 (que quedó sin hacer) y son de esfuerzo bajo.

Meterlos en Ola 2 los mezclaría con trabajo de media/alta complejidad y los retrasaría sin
razón. Se propone **Ola 1.5**: todo lo barato que mejora la confiabilidad percibida, más los
dos ítems de Ola 1 que siguen pendientes y son los de mayor impacto (A1 payloads, A2 ICP).

---

## 2. Correcciones al informe v2 (verificadas)

Dos hallazgos están mal atribuidos. Importa porque cambian la prioridad.

### N7 NO es un bug de facturación → son pools separados por diseño

Verificado en código:

- `monthlyResearchCount` (`lib/v3/plans.ts:177`) cuenta `v3.research_jobs` filtrando
  `source = "user"`. El research **server-managed** escribe ahí.
- El client-assisted **no toca `research_jobs`**: reserva en `v3.mcp_usage_reservations`
  con `pool = "research_client"`.

Son dos contadores distintos a propósito: el server-managed gasta AI Gateway de ASCI, el
client-assisted gasta los tokens del cliente. Que `monthlyResearch.used` quede clavado es
**correcto**. Lo que está mal es el **nombre y la descripción de las tools**, que dicen
"consume 1 unidad de cuota de research" sin aclarar cuál.

→ Reclasificado: de "posible bug de facturación (Medio)" a **fix de naming//doc (Bajo
esfuerzo, Alto valor de confianza)**. No hay plata mal contada.

**Pero sí hay un bug real cerca**, detectado en el test anterior y todavía abierto: la reserva
se **cobra al preparar**, incluso si el cliente nunca envía el resultado. Una ejecución
abandonada consume igual. Eso sí es plata perdida y va en Ola 1.5.

### N6 `hasWebsite: true` con `website: ""` es MI bug, del script 426

En `scripts/426_v3_search_companies_ranked.sql:121`:

```sql
'hasWebsite', r.website IS NOT NULL
```

Un string vacío `''` **no es NULL**, así que da `true`. Lo introduje yo al mover el ranking a
SQL; antes en TypeScript era `Boolean(company.website)`, que sí da `false` con `''`.
Fix de una línea: `r.website IS NOT NULL AND btrim(r.website) <> ''`, y usar el mismo
predicado en el `ORDER BY` para que el desempate sea coherente.

---

## 3. Respuesta a la pregunta de fondo: ¿los uploads quedan públicos?

**Sí, y es por diseño.** Verificado en la base:

| Tabla | Schema | ¿Tiene `workspace_id`? |
|---|---|---|
| `company_news` | `public` | **No** |
| `company_implementations` (casos de éxito) | `public` | **No** |
| `company_public_docs` | `public` | **No** |
| `v3.account_contacts` | `v3` | Sí |

Las tres tablas de upload son **globales**: no tienen scope de tenant. Lo que sube el tenant A
queda disponible para el tenant B. Los contactos, en cambio, sí están aislados por workspace.

**Hay trazabilidad** (esto es bueno): `company_news` tiene `sourced_by_workspace`, `source`,
`user_id`, `requested_by` y `verified_at`. Si un tenant carga basura, se puede rastrear y
revertir.

**El matiz que importa:** las políticas RLS de `SELECT` son
`"Anyone can view news for bookmarked companies"` → exigen `bookmarks.user_id = auth.uid()`.
Es decir:

- El **MCP de v3 lee con `service_role`, que saltea RLS** → ve todo, de cualquier tenant. ✅
  Es el comportamiento que buscás.
- Un usuario de la **UI de v2** solo ve la noticia si él tiene bookmarkeada esa empresa.
  No es un bug, pero significa que "público" aplica a v3, no automáticamente a la UI de v2.

**Consecuencia directa:** esto es exactamente por qué el guardrail de fuentes era crítico. Con
el bug de DNS, un tenant podía publicar una fuente inexistente y **contaminaba a todos los
demás**. Ya está arreglado, pero conviene tenerlo presente: el pipeline de escritura de estas
tres tablas es una superficie compartida, no un sandbox por tenant.

---

## 4. Estado del flujo de tomadores de decisión (ya existe casi todo)

No hay que construirlo: **las 4 tools ya están implementadas** y el diseño de UX coincide con
lo pedido.

| Tool | Qué hace | Costo |
|---|---|---|
| `recommend_contact_roles` | Propone cargos **justificados por señales reales** (tecnologías, procesos, implementaciones, vacantes) + tasa de éxito histórica en Apollo. Acepta `additionalTitles` para que el usuario sume cargos manuales, marcados `user_input`. | Gratis |
| `get_company_contacts` | Lo que el workspace ya tiene, con frescura por campo y cobertura vs. cargos recomendados. | Gratis, nunca llama a Apollo |
| `prepare_contact_enrichment` | Previsualiza: cargos validados, máximo de contactos, **costo en créditos**, cupo restante, `planHash` y `likelyCacheHit`. | Gratis |
| `run_contact_enrichment` | Ejecuta. Solo acepta un `planHash` de la preview, que congela cargos y máximo. | **Gasta créditos** |

Cubre lo que pediste: propuesta proactiva de cargos, posibilidad de sumar cargos, y salida a
Apollo con confirmación explícita de costo antes de gastar.

### El gap real: teléfonos y emails personales no están implementados

En `lib/v3/services/mcp-contact-enrichment.ts:275`:

```ts
revealPhone: false, // Fase 3 es solo email. El teléfono llega en Fase 5.
```

- `v3.account_contacts` tiene solo **metadata** de teléfono (`phone_status`,
  `phone_requested_at`, `phone_last_verified_at`), con default `"not_requested"`.
  **No guarda el número.**
- El valor sí existe en `public.apollo_contacts_cache` (`phone`, `mobile_phone`), pero
  `contact-provider.ts` **no lo selecciona**: trae `email, email_status, linkedin_url`.
- **Email personal vs. corporativo**: v2 tiene `contacts.email1..4` con `email1_type`, que
  podría distinguirlos, pero el provider de v3 expone un solo `email` sin tipo.

→ Pedir "correos corporativos, personales y teléfonos" hoy **devuelve solo email sin
distinción de tipo**. Los teléfonos son una fase declarada como pendiente, no un bug.

---

## 5. Test pendiente de documentar: costos de research + persistencia de uploads

Lo que **todavía no está medido** y hace falta para decidir con números:

### 5.1 Costo comparado del research
- Correr `run_account_research` (server-managed) sobre una cuenta y leer el costo real de
  `v3.ai_usage_log` (`logAiUsage` ya registra tokens y precio).
- Contrastar contra el client-assisted: mismo research, costo 0 para ASCI, ~620 KB de payload
  para el cliente.
- **Cuesta cuota real del pool server-managed del workspace.** Requiere OK explícito.

### 5.2 Persistencia y visibilidad cruzada de los 3 uploads
Por cada tipo (`noticias`, `tech radar`, `casos de éxito`):
1. Submit desde el cliente IA con fuentes **verificables reales**.
2. Confirmar fila en la tabla `public.*` con `sourced_by_workspace` correcto.
3. Confirmar que aparece en `get_account_intelligence` del **mismo** workspace.
4. Confirmar que aparece consultando desde **otro** workspace (la prueba de "público").
5. Verificar que el guardrail de DNS ya arreglado rechaza la fuente falsa.

### 5.3 Flujo completo de tomadores de decisión
1. `recommend_contact_roles` → revisar que los cargos estén justificados por señales.
2. Sumar un cargo manual y confirmar que sale marcado `user_input`.
3. `get_company_contacts` → medir cobertura previa.
4. `prepare_contact_enrichment` → registrar costo estimado y `likelyCacheHit`.
5. `run_contact_enrichment` → **gasta créditos de Apollo**. Requiere OK explícito.
6. Verificar qué campos vuelven de verdad (esperado: email sí, teléfono no).

---

## 6. Backlog propuesto

### Ola 1.5 — barato, sube confianza (recomendada para ahora)
| # | Fix | Origen | Esfuerzo |
|---|---|---|---|
| 1 | `hasWebsite` coherente con `website` vacío | N6 (mío, script 426) | Trivial |
| 2 | Cuota: no cobrar el `prepare` abandonado; renombrar a `monthlyServerResearch` y documentar los dos pools en `get_ai_usage` | N7 + hallazgo previo | Bajo |
| 3 | Localización de errores de validación: `path` + índice + id ofensor | N10 | Bajo |
| 4 | Envelope de error uniforme con `nextAction` (el patrón bueno ya existe en `get_company_contacts`) | M1 | Bajo |
| 5 | Enum de `category` + fin del descarte silencioso (`{accepted, dropped:[{index,reason}]}`) | A3/N8 | Bajo |
| 6 | ICP/`workspaceContext` en `fit_scoring` (el dato ya se carga en `internal-account-snapshot.ts`) | A2 | Bajo |
| 7 | Replay idempotente: misma key + mismo payload → respuesta original | N9 | Bajo |
| 8 | Envelope final del pipeline con `companyId` + `nextAction` | v1 | Trivial |

### Ola 2 — integridad y datos
| # | Fix | Origen | Esfuerzo |
|---|---|---|---|
| 9 | Dieta de payloads: evidencia por referencia, extractos de vacantes, delta entre etapas | A1 | Medio |
| 10 | `get_account_evidence_detail`: fallback a señales v2 + distinguir "término inexistente" de "sin snapshot" | M2 | Medio |
| 11 | Unificar stores de contactos (brief muestra 8, tool devuelve 0) | M4 | Medio |
| 12 | Regla de agregación de `evidenceLevel` + explicar `snapshot.status: "partial"` | M3 | Bajo |
| 13 | Precisión del matching ampliado en queries cortas ("SAP", "Sur") | N11 | Bajo |

### Ola 3 — funcionalidad nueva
| # | Fix | Esfuerzo |
|---|---|---|
| 14 | Teléfonos (Fase 5): `revealPhone`, guardar el número, exponerlo en el provider | Medio |
| 15 | Distinguir email corporativo de personal (`email_type` en el provider) | Bajo |
