import { createMcpHandler, withMcpAuth } from "mcp-handler"
import { z } from "zod"
import { NextRequest } from "next/server"
import { validateMcpRequest, logMcpRequest } from "@/lib/v3/mcp-auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { listFollowedAccounts, followAccount } from "@/lib/v3/services/accounts"
import { getLatestScorecard } from "@/lib/v3/services/scoring"
import { getCompanyCachedContacts } from "@/lib/v3/services/contacts"
import { resolveCompany } from "@/lib/v3/services/company-resolver"
import {
  createResearchBatch,
  runResearchJob,
  getBatchStatus,
} from "@/lib/v3/services/research-pipeline"
import { generateIcebreaker, getIcebreakersForCompany } from "@/lib/v3/services/icebreakers"
import { getRadarFindings } from "@/lib/v3/services/radar"
import { after } from "next/server"

export const maxDuration = 120

// ─────────────────────────────────────────────────────────────
// MCP real (protocolo oficial, transporte Streamable HTTP).
// Auth: Bearer asci_<key> por workspace (v3.mcp_api_keys).
// Scopes: "read" (consultas) y "write" (ejecuciones costosas).
// ─────────────────────────────────────────────────────────────

type AuthInfo = {
  token: string
  clientId: string
  scopes: string[]
  extra: { workspaceId: string; keyId: string }
}

const handler = createMcpHandler(
  (server) => {
    // ── READ TOOLS ──────────────────────────────────────────

    server.tool(
      "search_accounts",
      "Busca empresas en el cache global de ASCI por nombre o dominio. Devuelve empresas conocidas con su ID, dominio y país.",
      { query: z.string().min(2).describe("Nombre o dominio de la empresa") },
      async ({ query }, extra) => {
        const auth = (extra as { authInfo?: AuthInfo }).authInfo
        if (!auth) throw new Error("Unauthorized")
        const resolved = await resolveCompany(query, auth.extra.workspaceId)
        return {
          content: [{ type: "text", text: JSON.stringify(resolved, null, 2) }],
        }
      },
    )

    server.tool(
      "list_followed_accounts",
      "Lista las cuentas seguidas del workspace con su score actual y última actualización.",
      {},
      async (_args, extra) => {
        const auth = (extra as { authInfo?: AuthInfo }).authInfo
        if (!auth) throw new Error("Unauthorized")
        const accounts = await listFollowedAccounts(auth.extra.workspaceId, auth.extra.keyId)
        return {
          content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }],
        }
      },
    )

    server.tool(
      "get_account_scorecard",
      "Obtiene el scorecard (score 0-100 con desglose por dimensión: fit PV, señales de compra, accesibilidad, timing) de una cuenta para este workspace.",
      { companyId: z.string().uuid().describe("ID de la empresa (public.companies)") },
      async ({ companyId }, extra) => {
        const auth = (extra as { authInfo?: AuthInfo }).authInfo
        if (!auth) throw new Error("Unauthorized")
        const scorecard = await getLatestScorecard(auth.extra.workspaceId, companyId)
        return {
          content: [
            {
              type: "text",
              text: scorecard
                ? JSON.stringify(scorecard, null, 2)
                : "No hay scorecard para esta cuenta. Ejecutá run_account_research primero.",
            },
          ],
        }
      },
    )

    server.tool(
      "get_account_signals",
      "Obtiene las señales detectadas de una cuenta (radar de noticias, tech-radar, interpretación de vacantes) desde el cache global.",
      {
        companyId: z.string().uuid().describe("ID de la empresa"),
        limit: z.number().int().min(1).max(50).default(20),
      },
      async ({ companyId, limit }, extra) => {
        const auth = (extra as { authInfo?: AuthInfo }).authInfo
        if (!auth) throw new Error("Unauthorized")
        const admin = createAdminClient()
        const { data } = await admin
          .from("radar_findings")
          .select(
            "id, radar_type, category, title, summary, url, source_name, source_date, evidence_level, confidence, detected_at",
          )
          .eq("company_id", companyId)
          .order("detected_at", { ascending: false })
          .limit(limit)
        return {
          content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
        }
      },
    )

    server.tool(
      "get_account_contacts",
      "Obtiene los contactos/decision makers cacheados de una cuenta (nombre, cargo, seniority, país, LinkedIn).",
      { companyId: z.string().uuid().describe("ID de la empresa") },
      async ({ companyId }, extra) => {
        const auth = (extra as { authInfo?: AuthInfo }).authInfo
        if (!auth) throw new Error("Unauthorized")
        const contacts = await getCompanyCachedContacts(companyId)
        return {
          content: [{ type: "text", text: JSON.stringify(contacts, null, 2) }],
        }
      },
    )

    server.tool(
      "get_account_overview",
      "Obtiene el estado completo de una cuenta seguida: radiografía, scorecard, señales recientes, contactos e icebreakers.",
      { companyId: z.string().uuid().describe("ID de la empresa") },
      async ({ companyId }, extra) => {
        const auth = (extra as { authInfo?: AuthInfo }).authInfo
        if (!auth) throw new Error("Unauthorized")
        const admin = createAdminClient()
        const [companyRes, scorecard, findings, contacts, icebreakers] = await Promise.all([
          admin
            .from("companies")
            .select("id, name, website, country, industry")
            .eq("id", companyId)
            .maybeSingle(),
          getLatestScorecard(auth.extra.workspaceId, companyId),
          getRadarFindings(companyId, { limit: 15 }),
          getCompanyCachedContacts(companyId),
          getIcebreakersForCompany(auth.extra.workspaceId, companyId),
        ])
        const overview = {
          company: companyRes.data,
          scorecard,
          signals: findings,
          contacts,
          icebreakers,
        }
        return {
          content: [{ type: "text", text: JSON.stringify(overview, null, 2) }],
        }
      },
    )

    server.tool(
      "get_research_status",
      "Consulta el estado de un lote de investigación lanzado con run_account_research (patrón async: poll hasta completed/failed).",
      { batchId: z.string().uuid().describe("ID del lote devuelto por run_account_research") },
      async ({ batchId }, extra) => {
        const auth = (extra as { authInfo?: AuthInfo }).authInfo
        if (!auth) throw new Error("Unauthorized")
        const status = await getBatchStatus(batchId, auth.extra.workspaceId)
        return {
          content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
        }
      },
    )

    // ── WRITE TOOLS (requieren scope "write") ───────────────

    server.tool(
      "run_account_research",
      "Lanza la investigación completa (radar Opus + diccionario + scorecard + icebreakers) para una o más empresas. Es asíncrono: devuelve un batchId para consultar con get_research_status. Requiere scope write. ADVERTENCIA: consume APIs pagas.",
      {
        companies: z
          .array(z.string().min(2))
          .min(1)
          .max(10)
          .describe("Nombres o dominios de empresas (máx 10 por llamada MCP)"),
        forceRefresh: z
          .boolean()
          .default(false)
          .describe("Re-investigar aunque el cache tenga menos de 30 días"),
      },
      async ({ companies, forceRefresh }, extra) => {
        const auth = (extra as { authInfo?: AuthInfo }).authInfo
        if (!auth) throw new Error("Unauthorized")
        if (!auth.scopes.includes("write")) {
          return {
            content: [
              {
                type: "text",
                text: "Esta API key no tiene scope 'write'. Pedile a un admin del workspace que genere una key con permisos de escritura.",
              },
            ],
            isError: true,
          }
        }
        const result = await createResearchBatch({
          workspaceId: auth.extra.workspaceId,
          userId: auth.extra.keyId,
          inputs: companies,
          forceRefresh,
        })
        if ("error" in result) {
          return {
            content: [{ type: "text", text: `Error: ${result.error}` }],
            isError: true,
          }
        }
        // Ejecutar los jobs en segundo plano tras responder
        const jobIds = result.jobs.map((j) => j.id)
        after(async () => {
          for (const jobId of jobIds) {
            try {
              await runResearchJob(jobId)
            } catch (e) {
              console.error("[v3][mcp] Error ejecutando research job:", e)
            }
          }
        })
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  batchId: result.batchId,
                  enqueued: result.jobs.length,
                  note: "Consultá el avance con get_research_status.",
                },
                null,
                2,
              ),
            },
          ],
        }
      },
    )

    server.tool(
      "follow_account",
      "Sigue una cuenta a nivel workspace: entra al ciclo de refresh mensual y digest por email. Requiere scope write.",
      { companyId: z.string().uuid().describe("ID de la empresa a seguir") },
      async ({ companyId }, extra) => {
        const auth = (extra as { authInfo?: AuthInfo }).authInfo
        if (!auth) throw new Error("Unauthorized")
        if (!auth.scopes.includes("write")) {
          return {
            content: [{ type: "text", text: "Esta API key no tiene scope 'write'." }],
            isError: true,
          }
        }
        const followed = await followAccount({
          workspaceId: auth.extra.workspaceId,
          companyId,
          userId: auth.extra.keyId,
        })
        return {
          content: [{ type: "text", text: JSON.stringify(followed, null, 2) }],
        }
      },
    )

    server.tool(
      "generate_icebreaker",
      "Genera un icebreaker regionalizado (español según país del contacto) para un contacto de una cuenta, anclado a las señales detectadas. Requiere scope write.",
      {
        companyId: z.string().uuid().describe("ID de la empresa"),
        contactName: z.string().min(2).describe("Nombre del contacto"),
        contactTitle: z.string().optional().describe("Cargo del contacto"),
        contactCountry: z.string().optional().describe("País del contacto (ej: Argentina, Chile)"),
        instruction: z.string().optional().describe("Instrucción adicional (ej: 'más corto, mencionar caso X')"),
      },
      async ({ companyId, contactName, contactTitle, contactCountry, instruction }, extra) => {
        const auth = (extra as { authInfo?: AuthInfo }).authInfo
        if (!auth) throw new Error("Unauthorized")
        if (!auth.scopes.includes("write")) {
          return {
            content: [{ type: "text", text: "Esta API key no tiene scope 'write'." }],
            isError: true,
          }
        }
        const admin = createAdminClient()
        const { data: company } = await admin
          .from("companies")
          .select("name")
          .eq("id", companyId)
          .maybeSingle()
        if (!company) {
          return {
            content: [{ type: "text", text: "Empresa no encontrada." }],
            isError: true,
          }
        }
        const icebreaker = await generateIcebreaker({
          workspaceId: auth.extra.workspaceId,
          companyId,
          companyName: company.name,
          contact: {
            apolloId: null,
            name: contactName,
            title: contactTitle ?? null,
            country: contactCountry ?? null,
          },
          createdBy: auth.extra.keyId,
        })
        return {
          content: [{ type: "text", text: JSON.stringify(icebreaker, null, 2) }],
        }
      },
    )
  },
  {
    serverInfo: { name: "asci-v3", version: "1.0.0" },
  },
  {
    basePath: "/api/v3/mcp/server",
    maxDuration: 120,
    verboseLogs: false,
  },
)

const authedHandler = withMcpAuth(
  handler,
  async (req: Request, bearerToken?: string) => {
    if (!bearerToken) return undefined
    const result = await validateMcpRequest(req as NextRequest)
    if (!result.success || !result.workspaceId || !result.keyId) return undefined
    // Log fire-and-forget para auditoría/rate limit
    logMcpRequest(result.keyId, "/api/v3/mcp/server", req.method, 200, 0)
    return {
      token: bearerToken,
      clientId: result.keyId,
      scopes: result.scopes ?? ["read"],
      extra: { workspaceId: result.workspaceId, keyId: result.keyId },
    }
  },
  { required: true },
)

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
