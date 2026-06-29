# Agente de Prospección Automatizada (eve) — Diseño Funcional y Técnico

> Estado: **Diseño aprobado para documentar. Sin implementar todavía.**
> Proyecto: ASCI v3 (`asci-bot`). Convive con v2 en la misma DB Supabase, aislado por schema.
> Regla rectora: **nada de lo que haga el agente puede afectar a v2.**

---

## 1. Objetivo

Cada usuario tiene una lista de cuentas a prospectar. La plataforma ya genera
inteligencia por cuenta (semáforo, resumen, catálogo de ángulos, icebreakers,
análisis de jobs) y se conecta a Apollo.io para conseguir contactos de tomadores
de decisión. Queremos un **agente** que, apoyándose en esa información (noticias,
tech-radar, señales de la base, propuesta de valor del tenant), prospecte de
forma **semi-automática**: investiga, arma ángulos, recomienda contactos y
redacta el outreach, dejando todo en estado de **borrador para que el usuario
decida y envíe**.

## 2. Por qué eve

`eve` es el framework de agentes durables de Vercel. Encaja porque:

- **Se monta dentro del Next.js de v3** con `withEve()`: un solo deploy, mismo
  origen, misma sesión autenticada. No crea una app aparte → respeta el aislamiento de v3.
- **Durable** (corre sobre Workflow SDK): una corrida puede transmitir progreso,
  llamar subagentes/tools, **pausar para aprobación humana** y reanudar.
- **`schedules/`** para el trabajo recurrente/batch.
- **`connections/` + tools** para integrar Apollo y las funciones existentes.
- **Patrones multi-tenant nativos**: memoria, credenciales y aprobaciones
  *scoped* por identidad leída del `ctx.session.auth` (nunca del modelo).

## 3. Decisiones tomadas

| Decisión | Elección |
|---|---|
| Topología | **Único agente multi-tenant**, aislado por `workspace_id`/`userId` |
| Modo de operación | **Híbrido**: batch programado + chat on-demand embebido |
| Autonomía | **Solo borradores**: el usuario decide y envía (Apollo fetch y envío los dispara el usuario) |
| Estructura | **Root orquestador + subagentes especialistas** |
| Relación con batch | **Orquestador encima** de las funciones existentes (no reimplementa la IA) |
| Apollo | **Reusar `searchDecisionMakers`** como tool (no connection OpenAPI directa) |
| Canales | **Solo web**, embebido en la app v3 |
| Persistencia | **Tablas nuevas en schema v3** dedicadas al agente |

## 4. Arquitectura general

\`\`\`
┌───────────────────────── App v3 (Next.js) ─────────────────────────┐
│                                                                     │
│  Vista de Cuenta / Campaña                                          │
│   ├─ Panel "Agente de Prospección" (chat + estado de corrida)       │
│   └─ Bandeja de borradores (revisar / editar / aprobar / enviar)    │
│                                                                     │
│  withEve()  ── monta el runtime del agente en el mismo deploy       │
└───────────────────────────────────┬─────────────────────────────────┘
                                     │  ctx.session.auth = { workspaceId, userId, role }
                                     ▼
┌──────────────────────── eve runtime (durable) ─────────────────────┐
│  ROOT: orquestador-de-prospeccion                                   │
│    delega, junta resultados y deja todo en estado "para aprobación" │
│                                                                     │
│  ├─ subagent: investigador-de-cuenta                                │
│  │     tools → getAccountDigest, account-signals, tech-radar, news  │
│  │                                                                  │
│  ├─ subagent: estratega-de-angulos                                  │
│  │     tools → catálogo workspace_angles + propuesta de valor tenant│
│  │                                                                  │
│  ├─ subagent: contactos (Apollo)                                    │
│  │     tools → getRecommendedJobTitles, searchDecisionMakers*       │
│  │                                                                  │
│  └─ subagent: redactor-de-outreach                                  │
│        tools → plantillas tenant, icebreakers existentes            │
│                                                                     │
│  schedules/ → corrida batch al procesar/actualizar la cuenta        │
└─────────────────────────────────────────────────────────────────────┘
   * searchDecisionMakers (fetch real en Apollo) sólo se ejecuta cuando
     el USUARIO lo dispara desde la UI. El subagente sólo recomienda.
\`\`\`

## 5. Árbol de subagentes (responsabilidades)

El **root no hace el trabajo**: planifica, delega y consolida. Cada subagente
tiene contexto acotado y testeable por separado.

### 5.1 `investigador-de-cuenta`
- **Input**: `accountId`, `workspaceId`.
- **Hace**: reúne el contexto duro de la cuenta — `getAccountDigest`, señales
  de `public.signals` priorizadas por docs del tenant, tech-radar, noticias, jobs.
- **Output**: dossier estructurado (qué pasa en la cuenta, qué señales pesan).
- **No**: no inventa señales; sólo consume lo que ya está en la base.

### 5.2 `estratega-de-angulos`
- **Input**: dossier + catálogo de ángulos del workspace + propuesta de valor.
- **Hace**: cruza señales × ángulos → prioriza "por qué entrar" y con qué mensaje.
- **Output**: lista rankeada de ángulos con justificación trazable a la señal.

### 5.3 `contactos` (Apollo)
- **Input**: ángulos priorizados + perfil de cuenta.
- **Hace**: recomienda cargos/personas relevantes por ángulo vía
  `getRecommendedJobTitles`. **Propone** una búsqueda de Apollo.
- **Output**: recomendación de contactos a traer (cargos, seniority, función).
- **Límite de autonomía**: NO ejecuta `searchDecisionMakers` por su cuenta. Deja
  la acción lista para que el usuario la dispare desde la UI (consume API/crédito Apollo).

### 5.4 `redactor-de-outreach`
- **Input**: ángulo elegido + contacto + señal + plantillas/icebreakers del tenant.
- **Hace**: redacta email/icebreaker personalizado por contacto.
- **Output**: borrador de outreach (asunto + cuerpo + variables usadas), guardado
  en `v3.agent_outreach_drafts` con estado `draft`.

## 6. Tools (contratos, reusando código existente)

Todas las tools reciben `workspaceId`/`userId` **del contexto de sesión**, nunca
como argumento del modelo.

| Tool | Reusa | Lee/Escribe | Efecto externo |
|---|---|---|---|
| `getAccountContext` | `getAccountDigest` + account-signals | lee `public` / `v3` | no |
| `getRankedSignals` | lógica de señales priorizadas por docs tenant | lee | no |
| `listAngles` | catálogo `v3.workspace_angles` | lee | no |
| `recommendJobTitles` | `getRecommendedJobTitles` | lee | no |
| `searchDecisionMakers` | server action Apollo existente | lee+cachea | **sí (Apollo)** → solo disparo de usuario |
| `saveOutreachDraft` | nuevo | escribe `v3.agent_outreach_drafts` | no |

## 7. Persistencia (schema v3, tablas nuevas)

> Nombres tentativos; respetan que el agente no toque `campaign_account_digest`
> ni `public`. Confirmar nombres definitivos antes de migrar.

- **`v3.agent_runs`** — una corrida del agente sobre una cuenta.
  `id, workspace_id, account_id, triggered_by (user_id|schedule), status
  (running|awaiting_review|completed|failed), summary jsonb, created_at, updated_at`.
- **`v3.agent_outreach_drafts`** — borradores generados.
  `id, run_id, workspace_id, account_id, contact_ref jsonb, angle_id,
  signal_refs jsonb, subject, body, status (draft|approved|sent|discarded),
  created_at, updated_at`.
- **`v3.agent_run_steps`** (opcional, auditoría) — traza de subagente/tool por paso.

Aislamiento: toda query filtra por `workspace_id`. RLS v3 según el patrón
multitenant ya definido (admin/member, panel super-admin).

## 8. Flujos

### 8.1 Batch (al procesar/actualizar la cuenta)
1. `schedules/` o el pipeline ABM dispara una corrida para la cuenta.
2. Root → investigador → estratega → contactos (recomienda) → redactor.
3. Se crean `agent_run` (`awaiting_review`) + N `agent_outreach_drafts` (`draft`).
4. El usuario ve la corrida y los borradores en la bandeja.

### 8.2 Chat on-demand
1. Usuario abre el panel del agente en la vista de cuenta.
2. Pide algo ("prospectá esta cuenta", "dame otro ángulo", "reescribí más corto").
3. El agente responde transmitiendo progreso y actualiza/crea borradores.

### 8.3 Aprobación y envío (control humano)
1. Usuario revisa/edita un borrador.
2. **Trae contactos de Apollo** (dispara `searchDecisionMakers`) si hace falta.
3. Aprueba → estado `approved`. El **envío real lo hace el usuario** (la
   automatización de envío queda fuera de este alcance inicial).

## 9. Multi-tenant y seguridad

- Identidad (`workspaceId`, `userId`, `role`) se lee de `ctx.session.auth`, jamás
  de argumentos del modelo.
- Credenciales de Apollo: del entorno/connection, el modelo nunca las ve.
- Toda lectura/escritura *scoped* por `workspace_id` + RLS v3.
- Acciones con costo o efecto externo (Apollo, futuro envío) requieren disparo/
  aprobación humana.

## 10. Fuera de alcance (v1)

- Envío automático de emails (queda como acción manual del usuario).
- Canales Slack/email para el agente (sólo web por ahora).
- Un agente por usuario o por tenant (se usa único multi-tenant).
- Reemplazar la generación batch existente.

## 11. Preguntas abiertas para antes de implementar

1. **Disparo batch**: ¿lo encadenamos al pipeline ABM existente (cuando se
   regenera `campaign_account_digest`) o como `schedule` independiente?
2. **Granularidad de la corrida**: ¿por cuenta, o batch de cuentas seleccionadas?
3. **Plantillas de outreach**: ¿existen ya plantillas por tenant o las define el agente?
4. **Modelo/proveedor**: ¿qué modelo usamos (vía AI Gateway) y hay límite de costo por corrida?
5. **Nombre del agente**: proponer y confirmar (requisito del flujo de creación de eve).
6. **Nombres definitivos** de las tablas `v3.agent_*`.
