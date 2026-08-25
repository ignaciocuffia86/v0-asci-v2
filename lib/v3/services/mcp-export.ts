import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { principalColumns, type McpPrincipal } from "@/lib/v3/mcp-usage"

// ═══════════════════════════════════════════════════════════════════════════
// Export: el entregable deja de viajar por la conversación.
//
// Hasta ahora ninguna de las 50 tools devolvía un archivo, así que un reporte de
// 61 cuentas —o de 139— se transportaba como texto en el chat. La guidance del
// MCP incluso decía que había que "acotar hasta un recorte que entre en la
// conversación", o sea: achicar el entregable para que quepa en el canal.
//
// Acá el canal deja de ser la conversación. Lo único que vuelve al modelo es una
// URL firmada.
// ═══════════════════════════════════════════════════════════════════════════

const BUCKET = "workspace-exports"
/** Vigencia del enlace. Mismo criterio que el diseño original: 24 h. */
const SIGNED_URL_TTL_SECONDS = 24 * 60 * 60
/** Cuánto vive el archivo antes de que la limpieza lo pueda borrar. */
const FILE_TTL_DAYS = 7

export type ScreeningRow = {
  input: string
  status: string
  companyId: string | null
  matchedName: string | null
  matchConfidence: number
  domain: string | null
  country: string | null
  industry: string | null
  signalsForTerms: number
  signalsOwn: number
  duplicateEntities: number
  signalStrength: string
  ambiguityReason: string | null
  candidateCount: number
  termHits?: Array<{ term: string; signals: number; fromCurrentEmployees?: number; latestAt?: string | null }>
}

/**
 * Columnas de la planilla, en el orden en que un vendedor las lee.
 *
 * Función pura y exportada para poder testear el mapeo sin generar un xlsx ni
 * tocar la base. El orden NO es cosmético: `status` y `signalStrength` van
 * primero porque son los dos campos que deciden si la fila se trabaja o se
 * descarta, y `evidencia` va antes que los datos firmográficos porque es lo que
 * justifica el contacto.
 */
export const SCREENING_COLUMNS: Array<{ header: string; width: number; get: (row: ScreeningRow) => string | number }> = [
  { header: "Nombre en tu lista", width: 34, get: (r) => r.input },
  { header: "Estado", width: 20, get: (r) => statusLabel(r.status) },
  { header: "Fuerza de la señal", width: 18, get: (r) => strengthLabel(r.signalStrength) },
  { header: "Señales (empresa)", width: 18, get: (r) => r.signalsForTerms },
  { header: "Evidencia", width: 46, get: (r) => termsLabel(r.termHits) },
  { header: "Empresa en ASCI", width: 34, get: (r) => r.matchedName ?? "" },
  { header: "Confianza del match", width: 18, get: (r) => r.matchConfidence },
  { header: "A confirmar", width: 26, get: (r) => ambiguityLabel(r.ambiguityReason, r.candidateCount) },
  { header: "País", width: 16, get: (r) => r.country ?? "" },
  { header: "Industria", width: 26, get: (r) => r.industry ?? "" },
  { header: "Dominio", width: 30, get: (r) => r.domain ?? "" },
  { header: "Señales (solo esta entidad)", width: 24, get: (r) => r.signalsOwn },
  { header: "Entidades consolidadas", width: 22, get: (r) => r.duplicateEntities },
  { header: "companyId", width: 38, get: (r) => r.companyId ?? "" },
]

/**
 * Los estados se escriben en castellano y completos.
 *
 * En el JSON `matched_no_signal` y `no_match` son inequívocos; en una planilla
 * que va a leer un vendedor —o el cliente— no lo son, y confundirlos invierte la
 * decisión comercial: uno es un descarte legítimo y el otro una cuenta que no
 * tenemos. Vale gastar la columna en decirlo entero.
 */
export function statusLabel(status: string): string {
  switch (status) {
    case "matched":
      return "Tiene la señal"
    case "matched_no_signal":
      return "Está en ASCI, sin la señal"
    case "matched_ambiguous":
      return "Hay que confirmar cuál es"
    case "no_match":
      return "No está en ASCI"
    default:
      return status
  }
}

export function strengthLabel(strength: string): string {
  switch (strength) {
    case "solid":
      return "Sólida"
    case "weak":
      return "Débil (1 mención)"
    case "none":
      return "Sin señal"
    case "not_evaluated":
      return "No evaluada"
    default:
      return strength
  }
}

export function ambiguityLabel(reason: string | null, candidateCount: number): string {
  if (!reason) return ""
  if (reason === "multiple_candidates") return `Elegir entre ${candidateCount} candidatas`
  if (reason === "low_confidence") return "Confirmar que es la empresa correcta"
  return reason
}

export function termsLabel(hits: ScreeningRow["termHits"]): string {
  if (!hits?.length) return ""
  return hits
    .map((hit) => {
      const current = hit.fromCurrentEmployees
      const detail = current === undefined ? `${hit.signals}` : `${hit.signals}, ${current} de empleados actuales`
      return `${hit.term} (${detail})`
    })
    .join(" · ")
}

/** Nombre del archivo. Sin caracteres que rompan una descarga en Windows. */
export function exportFileName(prefix: string, stamp: string, format: "xlsx" | "csv"): string {
  const safe = prefix
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60)
  return `${safe || "export"}-${stamp}.${format}`
}

export function buildCsv(rows: ScreeningRow[]): string {
  const escape = (value: string | number) => {
    const text = String(value ?? "")
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const header = SCREENING_COLUMNS.map((column) => escape(column.header)).join(",")
  const body = rows.map((row) => SCREENING_COLUMNS.map((column) => escape(column.get(row))).join(","))
  return [header, ...body].join("\n")
}

async function buildXlsx(rows: ScreeningRow[], params: Record<string, unknown>): Promise<Buffer> {
  // exceljs se carga BAJO DEMANDA y no con un import de módulo.
  //
  // Este archivo lo importa la ruta del MCP, que es la más pesada del repo: 44
  // tools en un solo bundle. Con el import estático, una librería de planillas
  // —que arrastra jszip y su propio stack de streams— entra al grafo de módulos
  // de las 44, cuando la usa UNA. El import dinámico la deja fuera del bundle
  // hasta que alguien pide un xlsx de verdad.
  const ExcelJS = (await import("exceljs")).default
  const workbook = new ExcelJS.Workbook()
  workbook.created = new Date()

  const sheet = workbook.addWorksheet("Screening")
  sheet.columns = SCREENING_COLUMNS.map((column) => ({ header: column.header, width: column.width }))
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  for (const row of rows) sheet.addRow(SCREENING_COLUMNS.map((column) => column.get(row)))
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: SCREENING_COLUMNS.length } }

  // Hoja de método. Un reporte que un cliente va a leer tiene que poder explicar
  // de dónde salió cada número: con qué términos se buscó, qué país se filtró y
  // qué umbral se usó. Sin esto la planilla es un conjunto de afirmaciones sin
  // respaldo, que es exactamente lo que el screening manual producía.
  const method = workbook.addWorksheet("Método")
  method.columns = [{ header: "Parámetro", width: 30 }, { header: "Valor", width: 70 }]
  method.getRow(1).font = { bold: true }
  for (const [key, value] of Object.entries(params)) {
    method.addRow([key, Array.isArray(value) ? value.join(", ") : String(value ?? "")])
  }
  method.addRow([
    "Cómo leer los estados",
    '"Está en ASCI, sin la señal" es un descarte legítimo. "No está en ASCI" NO afirma nada sobre esa empresa: no la tenemos.',
  ])

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function createScreeningExport(
  principal: McpPrincipal,
  params: { screeningId: string; format?: "xlsx" | "csv" },
) {
  const admin = createAdminClient()
  const format = params.format ?? "xlsx"

  const { data: screening, error } = await admin
    .schema("v3")
    .from("mcp_screenings")
    .select("id, params, rows, summary, row_count, expires_at")
    .eq("id", params.screeningId)
    .eq("workspace_id", principal.workspaceId)
    .maybeSingle()

  if (error) throw new Error(`EXPORT_SOURCE_READ_FAILED:${error.message}`)
  if (!screening) {
    throw new Error(
      "SCREENING_NOT_FOUND:Ese screeningId no existe en este workspace. Volvé a correr screen_account_list: la respuesta trae el screeningId nuevo.",
    )
  }
  if (new Date(screening.expires_at) < new Date()) {
    throw new Error(
      "SCREENING_EXPIRED:El screening venció. Volvé a correr screen_account_list, que no consume cupo, y exportá con el screeningId nuevo.",
    )
  }

  const rows = (screening.rows ?? []) as ScreeningRow[]
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-")
  const sourceParams = (screening.params ?? {}) as Record<string, unknown>
  const fileName = exportFileName(String(sourceParams.label ?? "screening"), stamp, format)
  const storagePath = `${principal.workspaceId}/${screening.id}/${fileName}`

  const body =
    format === "csv" ? Buffer.from(buildCsv(rows), "utf8") : await buildXlsx(rows, sourceParams)

  const contentType =
    format === "csv"
      ? "text/csv"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, body, { contentType, upsert: true })
  if (uploadError) throw new Error(`EXPORT_UPLOAD_FAILED:${uploadError.message}`)

  const { data: signed, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (signError || !signed) throw new Error(`EXPORT_SIGN_FAILED:${signError?.message ?? "sin URL"}`)

  const cols = principalColumns(principal)
  await admin.schema("v3").from("mcp_exports").insert({
    workspace_id: principal.workspaceId,
    user_id: principal.userId,
    api_key_id: cols.api_key_id,
    oauth_token_id: cols.oauth_token_id,
    source_kind: "screening",
    source_id: screening.id,
    format,
    storage_path: storagePath,
    row_count: rows.length,
    byte_size: body.byteLength,
  expires_at: new Date(Date.now() + FILE_TTL_DAYS * 86400000).toISOString(),
  })

  return {
    url: signed.signedUrl,
    fileName,
    format,
    rowCount: rows.length,
    byteSize: body.byteLength,
    urlExpiresInHours: SIGNED_URL_TTL_SECONDS / 3600,
    summary: screening.summary,
    interpretationGuidance: [
      `El archivo tiene ${rows.length} fila(s), una por cada nombre de la lista original, más una hoja "Método" con los parámetros de la búsqueda.`,
      "PASALE LA URL AL USUARIO TAL CUAL. No transcribas la tabla al chat: el archivo existe justamente para que los datos no viajen por la conversación.",
      `El enlace vence en ${SIGNED_URL_TTL_SECONDS / 3600} horas. Si vence, volvé a llamar create_export con el mismo screeningId: no cuesta nada.`,
      "El archivo lleva la lista de cuentas de un cliente: es un enlace privado y firmado, no lo publiques.",
    ].join("\n"),
  }
}
