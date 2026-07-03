import { after } from "next/server"
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type InferUITools,
  type UIDataTypes,
  type UIMessage,
} from "ai"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/v3/workspace"
import {
  LIMITS,
  MODELS,
  resolveCompany,
  createResearchBatch,
  runResearchJob,
  getBatchStatus,
  followAccount,
  unfollowAccount,
  listFollowedAccounts,
  getLatestScorecard,
  getRadarFindings,
  generateIcebreaker,
  getCompanyCachedContacts,
} from "@/lib/v3/services"

export const maxDuration = 300

// ═══════════════════════════════════════════════════════════
// Chat orquestador v3 (cuenta-céntrico)
// El modelo decide qué tool usar; la UI renderiza los outputs de
// cada tool con componentes estructurados (tabla de lote, scorecard,
// contactos, icebreakers).
// ═══════════════════════════════════════════════════════════

function buildTools(ctx: { workspaceId: string; userId: string; conversationId: string | null }) {
  const resolveCompanies = tool({
    description:
      "Resuelve una lista de empresas (nombres o dominios) contra la base. Devuelve para cada una: si existe, si su research está fresco (cache <30 días), si ya se sigue, y candidatos si es ambigua. Usar SIEMPRE antes de iniciar un research.",
    inputSchema: z.object({
      inputs: z.array(z.string()).max(LIMITS.MAX_BATCH_SIZE).describe("Nombres o dominios de empresas"),
    }),
    execute: async ({ inputs }) => {
      const resolutions = await Promise.all(
        inputs.slice(0, LIMITS.MAX_BATCH_SIZE).map((i) => resolveCompany(i, ctx.workspaceId))
      )
      return { resolutions }
    },
  })

  const startResearch = tool({
    description:
      "Inicia el research de un lote de cuentas (máx 25). Crea los jobs y los ejecuta en segundo plano. Si una cuenta tiene cache fresco no re-investiga salvo forceRefresh. Devuelve el batchId para seguir el progreso.",
    inputSchema: z.object({
      inputs: z.array(z.string()).max(LIMITS.MAX_BATCH_SIZE),
      forceRefresh: z.boolean().default(false).describe("true solo si el usuario pide explícitamente re-investigar"),
    }),
    execute: async ({ inputs, forceRefresh }) => {
      const result = await createResearchBatch({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        inputs,
        forceRefresh,
      })
      if ("error" in result) return { error: result.error }

      // Ejecutar jobs en segundo plano tras responder (secuencial)
      const jobIds = result.jobs.map((j) => j.id)
      after(async () => {
        for (const jobId of jobIds) {
          try {
            await runResearchJob(jobId)
          } catch (err) {
            console.error("[v3] Error ejecutando job en background:", err)
          }
        }
      })

      return {
        batchId: result.batchId,
        jobs: result.jobs.map((j) => ({ id: j.id, companyInput: j.company_input, status: j.status })),
      }
    },
  })

  const checkBatchStatus = tool({
    description: "Consulta el estado de un lote de research en curso (progreso por cuenta).",
    inputSchema: z.object({ batchId: z.string() }),
    execute: async ({ batchId }) => {
      const jobs = await getBatchStatus(batchId, ctx.workspaceId)
      return {
        batchId,
        jobs: jobs.map((j) => ({
          id: j.id,
          companyInput: j.company_input,
          companyId: j.company_id,
          status: j.status,
          currentStep: j.current_step,
          progress: j.progress,
          error: j.error,
        })),
      }
    },
  })

  const getAccountOverview = tool({
    description:
      "Devuelve el resumen de una cuenta ya investigada: scorecard (score 0-100 con sub-scores y rationale) y hallazgos principales del radar. Usar cuando el usuario pregunta por una cuenta específica o al terminar un research.",
    inputSchema: z.object({ companyId: z.string().describe("UUID de la empresa") }),
    execute: async ({ companyId }) => {
      const admin = createAdminClient()
      const [companyRes, scorecard, findings] = await Promise.all([
        admin.from("companies").select("id, name, website, country, industry").eq("id", companyId).maybeSingle(),
        getLatestScorecard(ctx.workspaceId, companyId),
        getRadarFindings(companyId, { limit: 15 }),
      ])
      return {
        company: companyRes.data,
        scorecard: scorecard
          ? {
              score: scorecard.score,
              fit: scorecard.fit_score,
              buyingSignals: scorecard.buying_signals_score,
              accessibility: scorecard.accessibility_score,
              timing: scorecard.timing_score,
              rationale: scorecard.rationale,
            }
          : null,
        findings: findings.map((f) => ({
          title: f.title,
          summary: f.summary,
          category: f.category,
          radarType: f.radar_type,
          evidenceLevel: f.evidence_level,
          url: f.url,
          sourceName: f.source_name,
          sourceDate: f.source_date,
        })),
      }
    },
  })

  const followAccounts = tool({
    description: "Sigue una o más cuentas para el workspace (entra al refresh mensual y digest por email).",
    inputSchema: z.object({ companyIds: z.array(z.string()).max(LIMITS.MAX_BATCH_SIZE) }),
    execute: async ({ companyIds }) => {
      const results = await Promise.all(
        companyIds.map(async (companyId) => {
          const r = await followAccount({ workspaceId: ctx.workspaceId, companyId, userId: ctx.userId })
          return { companyId, success: !("error" in r) }
        })
      )
      return { results }
    },
  })

  const unfollowAccountTool = tool({
    description: "Deja de seguir una cuenta del workspace.",
    inputSchema: z.object({ companyId: z.string() }),
    execute: async ({ companyId }) => {
      return unfollowAccount({ workspaceId: ctx.workspaceId, companyId, userId: ctx.userId })
    },
  })

  const listFollowed = tool({
    description: "Lista las cuentas que el workspace sigue, con su último score.",
    inputSchema: z.object({}),
    execute: async () => {
      const accounts = await listFollowedAccounts(ctx.workspaceId, ctx.userId)
      return {
        accounts: accounts.map((a) => ({
          companyId: a.company_id,
          name: a.company?.name ?? "—",
          country: a.company?.country ?? null,
          industry: a.company?.industry ?? null,
          score: a.latestScore,
          followedAt: a.created_at,
        })),
      }
    },
  })

  const suggestContacts = tool({
    description:
      "Sugiere contactos de una cuenta desde el cache de Apollo (nombre, cargo, seniority, país). Usar antes de generar icebreakers.",
    inputSchema: z.object({ companyId: z.string() }),
    execute: async ({ companyId }) => {
      const contacts = await getCompanyCachedContacts(companyId)
      return {
        contacts: contacts.slice(0, LIMITS.MAX_CONTACTS * 2).map((c) => ({
          apolloId: c.apolloId,
          name: c.fullName,
          title: c.title,
          seniority: c.seniority,
          country: c.country,
          linkedinUrl: c.linkedinUrl,
        })),
      }
    },
  })

  const generateIcebreakers = tool({
    description:
      "Genera un icebreaker de cold outreach para un contacto de una cuenta, regionalizado por país y basado en la evidencia del research. Llamar una vez por contacto.",
    inputSchema: z.object({
      companyId: z.string(),
      companyName: z.string(),
      contactName: z.string(),
      contactTitle: z.string().nullable().default(null),
      contactCountry: z.string().nullable().default(null),
      contactApolloId: z.string().nullable().default(null),
      regenerateFromId: z.string().nullable().default(null).describe("ID del icebreaker anterior si es regeneración"),
      instruction: z.string().nullable().default(null).describe("Instrucción del usuario para la regeneración"),
    }),
    execute: async (input) => {
      const icebreaker = await generateIcebreaker({
        workspaceId: ctx.workspaceId,
        companyId: input.companyId,
        companyName: input.companyName,
        contact: {
          apolloId: input.contactApolloId,
          name: input.contactName,
          title: input.contactTitle,
          country: input.contactCountry,
        },
        createdBy: ctx.userId,
        regenerateFrom:
          input.regenerateFromId && input.instruction
            ? { icebreakerId: input.regenerateFromId, instruction: input.instruction }
            : null,
      })
      if (!icebreaker) return { error: "No se pudo generar el icebreaker" }
      return {
        icebreakerId: icebreaker.id,
        content: icebreaker.content,
        register: icebreaker.language_register,
        version: icebreaker.version,
        contactName: icebreaker.contact_name,
        companyId: input.companyId,
        companyName: input.companyName,
        contactTitle: input.contactTitle,
        contactCountry: input.contactCountry,
      }
    },
  })

  return {
    resolveCompanies,
    startResearch,
    checkBatchStatus,
    getAccountOverview,
    followAccounts,
    unfollowAccount: unfollowAccountTool,
    listFollowed,
    suggestContacts,
    generateIcebreakers,
  } as const
}

export type V3ChatTools = InferUITools<ReturnType<typeof buildTools>>
export type V3ChatMessage = UIMessage<never, UIDataTypes, V3ChatTools>

const SYSTEM_PROMPT = `Sos el asistente de prospección B2B de ASCI. Ayudás a equipos de venta de tecnología a investigar cuentas, priorizarlas y preparar el primer contacto.

CAPACIDADES (vía tools):
1. Investigar cuentas: resolvé primero con resolveCompanies, después startResearch (máx 25 por lote). Si una empresa es ambigua, mostrá los candidatos y pedí al usuario que elija ANTES de investigar. Si el cache está fresco avisá que usás datos existentes (salvo que pidan refresh).
2. Ver una cuenta: getAccountOverview devuelve scorecard y hallazgos.
3. Seguir cuentas: followAccounts / unfollowAccount / listFollowed. Después de un research exitoso, ofrecé seguir las cuentas con mejor score.
4. Contactos e icebreakers: suggestContacts primero, después generateIcebreakers por contacto elegido. Si el usuario pide cambiar un icebreaker, regenerá con regenerateFromId + instruction.

REGLAS:
- Respondé en español (registro neutro; adaptate si el usuario usa voseo).
- Los outputs de las tools se renderizan como componentes visuales: NO repitas su contenido en texto, solo agregá contexto breve y el próximo paso sugerido.
- Cuando inicies un research con startResearch, avisá que corre en segundo plano y que el progreso se ve en la tarjeta del lote. NO llames checkBatchStatus en loop: la UI hace polling sola.
- Nunca inventes datos de empresas: todo sale de las tools.
- Si el usuario pega una lista larga de empresas (líneas, comas), interpretala como lote.
- Sé conciso y accionable, sin relleno.`

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response("Unauthorized", { status: 401 })

  let workspace
  try {
    workspace = await requireWorkspace(user.id)
  } catch {
    return new Response("Workspace required", { status: 403 })
  }

  const body = await req.json()
  const messages: V3ChatMessage[] = body.messages ?? []
  const conversationId: string | null = body.conversationId ?? null
  const admin = createAdminClient()

  // Verificar propiedad de la conversación (si viene)
  if (conversationId) {
    const { data: conv } = await admin
      .schema("v3")
      .from("chat_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .maybeSingle()
    if (!conv) return new Response("Conversation not found", { status: 404 })
  }

  const tools = buildTools({ workspaceId: workspace.id, userId: user.id, conversationId })

  const result = streamText({
    model: MODELS.CHAT,
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(8),
    temperature: 0.3,
  })

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[v3] Error en el stream del chat:", message)
      if (/credit|billing|payment|quota|insufficient/i.test(message)) {
        return "El AI Gateway no tiene créditos disponibles. Cargá créditos en tu cuenta de Vercel (AI Gateway) y volvé a intentar."
      }
      return `Error del modelo: ${message}`
    },
    onFinish: async ({ messages: finalMessages }) => {
      if (!conversationId) return
      try {
        // Persistir solo los mensajes nuevos (los que no están guardados)
        const { data: saved } = await admin
          .schema("v3")
          .from("chat_messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", conversationId)

        // Estrategia simple y robusta: reemplazar el historial completo de la
        // conversación con el estado final (los mensajes incluyen tool outputs).
        await admin.schema("v3").from("chat_messages").delete().eq("conversation_id", conversationId)
        const rows = finalMessages.map((m) => ({
          conversation_id: conversationId,
          role: m.role,
          parts: m.parts ?? [],
        }))
        if (rows.length > 0) {
          await admin.schema("v3").from("chat_messages").insert(rows)
        }
        await admin
          .schema("v3")
          .from("chat_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)
        void saved
      } catch (err) {
        console.error("[v3] Error persistiendo mensajes del chat:", err)
      }
    },
  })
}
