import "server-only"

import Papa from "papaparse"
import ExcelJS from "exceljs"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveCompany } from "./company-resolver"
import { followAccount } from "./accounts"
import { checkFollowQuota } from "@/lib/v3/plans"
import {
  type CanonicalRow,
  detectHeaderMapping,
  linkedinCompanySlug,
  mapAndDedupeRows,
} from "./account-import-parse"
import { parseLinkedinCompanyId } from "./linkedin-company-id"

// ═══════════════════════════════════════════════════════════
// Carga masiva de cuentas por archivo (v3).
// Diseño: docs/feature-carga-masiva-cuentas-y-cron-jobpostings.md (Parte 1).
//
// Flujo: archivo → parseo/mapeo → cascada de matching → filas persistidas en
// v3.account_import_rows para la review → confirmación (followAccount por fila
// elegible, respetando followedCap) → puente opcional a bookmarks v2.
//
// Todo el acceso a datos va por service role; los guards de permisos viven en
// las server actions (app/actions/v3/account-imports.ts), no acá.
// ═══════════════════════════════════════════════════════════

export type ImportRowStatus =
  | "pending"
  | "matched"
  | "candidate"
  | "ambiguous"
  | "not_found"
  | "already_followed"
  | "error"

export type ImportRowResolution = "confirmed" | "created" | "ignored"

export interface ImportRowCandidate {
  companyId: string
  name: string
  website: string | null
  country: string | null
  confidence: number
}

export interface AccountImportRow {
  id: string
  rowNumber: number
  data: CanonicalRow
  matchStatus: ImportRowStatus
  matchedCompanyId: string | null
  matchedCompanyName: string | null
  matchScore: number | null
  matchReason: string | null
  candidates: ImportRowCandidate[]
  resolution: ImportRowResolution | null
  errorMessage: string | null
}

export interface AccountImportSummary {
  id: string
  workspaceId: string
  filename: string
  status: string
  totalRows: number
  followedRows: number
  createdCompanies: number
  skippedRows: number
  v2Bookmarks: V2BookmarkResult[] | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export interface V2BookmarkResult {
  userId: string
  email: string | null
  created: number
  alreadyExisted: number
  error: string | null
}

// ── Parseo de archivo ──────────────────────────────────────

interface ParsedFile {
  headers: string[]
  records: Array<Record<string, unknown>>
}

/** Convierte un valor de celda de exceljs a texto plano. */
function excelCellText(value: ExcelJS.CellValue): string {
  if (value == null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object") {
    // Hipervínculos (típico en columnas de LinkedIn pegadas desde el browser)
    if ("hyperlink" in value) return String(value.text ?? value.hyperlink ?? "")
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("")
    }
    if ("result" in value) return value.result == null ? "" : String(value.result)
    if ("text" in value) return String((value as { text: unknown }).text ?? "")
  }
  return ""
}

async function parseXlsx(buffer: Buffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) return { headers: [], records: [] }

  const headers: string[] = []
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = excelCellText(cell.value).trim()
  })

  const records: Array<Record<string, unknown>> = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const record: Record<string, unknown> = {}
    headers.forEach((header, index) => {
      if (!header) return
      record[header] = excelCellText(row.getCell(index + 1).value).trim()
    })
    records.push(record)
  })

  return { headers: headers.filter(Boolean), records }
}

function parseCsv(text: string): ParsedFile {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
  })
  return { headers: parsed.meta.fields ?? [], records: parsed.data }
}

export async function parseAccountImportFile(
  buffer: Buffer,
  filename: string,
): Promise<ParsedFile> {
  if (/\.xlsx?$/i.test(filename)) return parseXlsx(buffer)
  return parseCsv(buffer.toString("utf8"))
}

// ── Cascada de matching ────────────────────────────────────

interface MatchOutcome {
  status: ImportRowStatus
  companyId: string | null
  companyName: string | null
  score: number | null
  reason: string | null
  candidates: ImportRowCandidate[]
}

/**
 * Camino 1: match exacto por slug de LinkedIn.
 * El ilike trae slugs que CONTIENEN al buscado ("arcor" también trae
 * "arcor-sa"), así que la igualdad se decide comparando slugs extraídos.
 */
async function matchByLinkedinUrl(linkedinUrl: string): Promise<MatchOutcome | null> {
  const slug = linkedinCompanySlug(linkedinUrl)
  if (!slug) return null
  const admin = createAdminClient()
  const { data: rows } = await admin
    .from("companies")
    .select("id, name, linkedin_url")
    .ilike("linkedin_url", `%linkedin.com/company/${slug}%`)
    .limit(10)
  const match = (rows ?? []).find((row) => linkedinCompanySlug(row.linkedin_url) === slug)
  if (!match) return null
  return {
    status: "matched",
    companyId: match.id,
    companyName: match.name,
    score: 100,
    reason: "LinkedIn URL exacta",
    candidates: [],
  }
}

/** Caminos 2 y 3: resolver existente (dominio primero, después nombre). */
async function matchByResolver(row: CanonicalRow, workspaceId: string): Promise<MatchOutcome> {
  const inputs = [row.website, row.company_name].filter((v): v is string => Boolean(v))

  for (const input of inputs) {
    const resolution = await resolveCompany(input, workspaceId)
    if (resolution.companyId) {
      return {
        status: "matched",
        companyId: resolution.companyId,
        companyName: resolution.name,
        score: resolution.confidence ?? null,
        reason: resolution.resolutionReason ?? null,
        candidates: [],
      }
    }
    if (resolution.candidates.length > 0) {
      const candidates: ImportRowCandidate[] = resolution.candidates.map((c) => ({
        companyId: c.companyId,
        name: c.name,
        website: c.domain,
        country: c.country,
        confidence: c.confidence ?? 0,
      }))
      return {
        status: candidates.length === 1 ? "candidate" : "ambiguous",
        companyId: null,
        companyName: null,
        score: candidates[0].confidence,
        reason: resolution.resolutionReason ?? null,
        candidates: candidates.slice(0, 5),
      }
    }
  }

  return { status: "not_found", companyId: null, companyName: null, score: null, reason: null, candidates: [] }
}

async function matchRow(row: CanonicalRow, workspaceId: string): Promise<MatchOutcome> {
  try {
    if (row.linkedin_url) {
      const byUrl = await matchByLinkedinUrl(row.linkedin_url)
      if (byUrl) return byUrl
    }
    return await matchByResolver(row, workspaceId)
  } catch {
    return {
      status: "error",
      companyId: null,
      companyName: null,
      score: null,
      reason: null,
      candidates: [],
    }
  }
}

// ── Creación del import ────────────────────────────────────

const ROW_INSERT_CHUNK = 200
/** resolveCompany hace varias queries por fila; se limita el paralelismo. */
const MATCH_CONCURRENCY = 5

export interface CreateImportResult {
  importId: string
  totalRows: number
  skipped: Array<{ rowNumber: number; reason: string }>
  truncated: number
  counts: Record<ImportRowStatus, number>
}

export async function createAccountImport(params: {
  workspaceId: string
  createdBy: string
  filename: string
  blobUrl: string | null
  buffer: Buffer
}): Promise<CreateImportResult | { error: string }> {
  const admin = createAdminClient()

  const parsed = await parseAccountImportFile(params.buffer, params.filename)
  if (!parsed.records.length) return { error: "El archivo no tiene filas de datos" }

  const { mapping, missingRequired } = detectHeaderMapping(parsed.headers)
  if (missingRequired) {
    return {
      error:
        "No se encontró la columna de nombre de empresa. Usá el template (company_name) o headers como 'empresa' / 'nombre'.",
    }
  }

  const { rows, skipped, truncated } = mapAndDedupeRows(parsed.records, mapping)
  if (!rows.length) return { error: "Ninguna fila del archivo es válida" }

  const { data: importRow, error: importError } = await admin
    .schema("v3")
    .from("account_imports")
    .insert({
      workspace_id: params.workspaceId,
      created_by: params.createdBy,
      filename: params.filename,
      blob_url: params.blobUrl,
      status: "parsing",
      total_rows: rows.length,
    })
    .select("id")
    .single()

  if (importError || !importRow) {
    console.error("[v3] Error creando account_import:", importError?.message)
    return { error: "No se pudo crear el import" }
  }

  try {
    // Matching con paralelismo acotado, preservando el orden de filas
    const outcomes: MatchOutcome[] = new Array(rows.length)
    for (let i = 0; i < rows.length; i += MATCH_CONCURRENCY) {
      const slice = rows.slice(i, i + MATCH_CONCURRENCY)
      const results = await Promise.all(slice.map((row) => matchRow(row, params.workspaceId)))
      results.forEach((outcome, j) => {
        outcomes[i + j] = outcome
      })
    }

    // Las matcheadas que el workspace ya sigue se marcan en un solo query
    const matchedIds = [...new Set(outcomes.filter((o) => o.companyId).map((o) => o.companyId!))]
    const alreadyFollowed = new Set<string>()
    if (matchedIds.length) {
      const { data: followed } = await admin
        .schema("v3")
        .from("followed_accounts")
        .select("company_id")
        .eq("workspace_id", params.workspaceId)
        .eq("is_active", true)
        .in("company_id", matchedIds)
      for (const f of followed ?? []) alreadyFollowed.add(f.company_id)
    }

    const counts: Record<ImportRowStatus, number> = {
      pending: 0, matched: 0, candidate: 0, ambiguous: 0, not_found: 0, already_followed: 0, error: 0,
    }

    const rowRecords = rows.map((row, index) => {
      const outcome = outcomes[index]
      const status: ImportRowStatus =
        outcome.companyId && alreadyFollowed.has(outcome.companyId) ? "already_followed" : outcome.status
      counts[status]++
      return {
        import_id: importRow.id,
        row_number: index + 1,
        row_data: row,
        match_status: status,
        matched_company_id: outcome.companyId,
        match_score: outcome.score,
        match_reason: outcome.reason,
        candidates: outcome.candidates.length ? outcome.candidates : null,
      }
    })

    for (let i = 0; i < rowRecords.length; i += ROW_INSERT_CHUNK) {
      const { error: rowsError } = await admin
        .schema("v3")
        .from("account_import_rows")
        .insert(rowRecords.slice(i, i + ROW_INSERT_CHUNK))
      if (rowsError) throw new Error(rowsError.message)
    }

    await admin
      .schema("v3")
      .from("account_imports")
      .update({ status: "reviewing" })
      .eq("id", importRow.id)

    return { importId: importRow.id, totalRows: rows.length, skipped, truncated, counts }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    await admin
      .schema("v3")
      .from("account_imports")
      .update({ status: "failed", error_message: message })
      .eq("id", importRow.id)
    return { error: `Falló el matching del archivo: ${message}` }
  }
}

// ── Lectura para la review ─────────────────────────────────

export async function getAccountImport(importId: string): Promise<{
  summary: AccountImportSummary
  rows: AccountImportRow[]
} | null> {
  const admin = createAdminClient()

  const [{ data: imp }, { data: rows }] = await Promise.all([
    admin.schema("v3").from("account_imports").select("*").eq("id", importId).maybeSingle(),
    admin
      .schema("v3")
      .from("account_import_rows")
      .select("*")
      .eq("import_id", importId)
      .order("row_number", { ascending: true }),
  ])

  if (!imp) return null

  // Nombre de la empresa matcheada para mostrar en la review
  const companyIds = [...new Set((rows ?? []).map((r) => r.matched_company_id).filter(Boolean))] as string[]
  const nameById = new Map<string, string>()
  if (companyIds.length) {
    const { data: companies } = await admin.from("companies").select("id, name").in("id", companyIds)
    for (const c of companies ?? []) nameById.set(c.id, c.name)
  }

  return {
    summary: toSummary(imp),
    rows: (rows ?? []).map((r) => ({
      id: r.id,
      rowNumber: r.row_number,
      data: r.row_data as CanonicalRow,
      matchStatus: r.match_status as ImportRowStatus,
      matchedCompanyId: r.matched_company_id,
      matchedCompanyName: r.matched_company_id ? (nameById.get(r.matched_company_id) ?? null) : null,
      matchScore: r.match_score === null ? null : Number(r.match_score),
      matchReason: r.match_reason,
      candidates: (r.candidates as ImportRowCandidate[] | null) ?? [],
      resolution: r.resolution as ImportRowResolution | null,
      errorMessage: r.error_message,
    })),
  }
}

function toSummary(imp: Record<string, unknown>): AccountImportSummary {
  return {
    id: imp.id as string,
    workspaceId: imp.workspace_id as string,
    filename: imp.filename as string,
    status: imp.status as string,
    totalRows: imp.total_rows as number,
    followedRows: imp.followed_rows as number,
    createdCompanies: imp.created_companies as number,
    skippedRows: imp.skipped_rows as number,
    v2Bookmarks: (imp.v2_bookmarks as V2BookmarkResult[] | null) ?? null,
    errorMessage: (imp.error_message as string | null) ?? null,
    createdAt: imp.created_at as string,
    completedAt: (imp.completed_at as string | null) ?? null,
  }
}

/**
 * Aplica a la empresa el LinkedIn company ID que trajo el archivo (columna
 * opcional de la Fase 3), write-once: solo si la empresa no lo tiene ya. El
 * índice único parcial rechaza un ID que pertenezca a otra fila (duplicados
 * del catálogo); en ese caso se loguea y se sigue — el aprendizaje de la
 * ingesta lo resuelve por otra vía.
 */
async function applyFileLinkedinCompanyId(companyId: string, rowData: CanonicalRow): Promise<void> {
  const lid = parseLinkedinCompanyId(rowData.linkedin_company_id)
  if (lid === null) return
  const admin = createAdminClient()
  const { error } = await admin
    .from("companies")
    .update({ linkedin_company_id: lid })
    .eq("id", companyId)
    .is("linkedin_company_id", null)
  if (error) {
    console.warn(`[v3] No se pudo aplicar linkedin_company_id ${lid} del archivo a ${companyId}: ${error.message}`)
  }
}

// ── Resolución de filas en la review ───────────────────────

export async function resolveImportRow(params: {
  rowId: string
  resolvedBy: string
  action: "confirm" | "create" | "ignore"
  /** Para confirm: el company elegido (candidato o búsqueda manual). */
  companyId?: string
}): Promise<{ success: true; companyId?: string } | { error: string }> {
  const admin = createAdminClient()

  const { data: row } = await admin
    .schema("v3")
    .from("account_import_rows")
    .select("id, row_data, match_status")
    .eq("id", params.rowId)
    .maybeSingle()
  if (!row) return { error: "Fila inexistente" }

  if (params.action === "ignore") {
    await admin
      .schema("v3")
      .from("account_import_rows")
      .update({ resolution: "ignored", resolved_by: params.resolvedBy })
      .eq("id", params.rowId)
    return { success: true }
  }

  if (params.action === "confirm") {
    if (!params.companyId) return { error: "Falta el companyId a confirmar" }
    const { data: company } = await admin
      .from("companies")
      .select("id")
      .eq("id", params.companyId)
      .maybeSingle()
    if (!company) return { error: "La empresa elegida no existe" }
    await admin
      .schema("v3")
      .from("account_import_rows")
      .update({
        resolution: "confirmed",
        matched_company_id: params.companyId,
        resolved_by: params.resolvedBy,
      })
      .eq("id", params.rowId)
    await applyFileLinkedinCompanyId(params.companyId, row.row_data as CanonicalRow)
    return { success: true, companyId: params.companyId }
  }

  // create: pasa por upsert_company para no duplicar el catálogo global.
  // Exige linkedin_url o website (diseño 4.3): con nombre solo no se crea.
  const data = row.row_data as CanonicalRow
  if (!data.linkedin_url && !data.website) {
    return { error: "Para crear la empresa la fila necesita LinkedIn URL o website" }
  }
  const { data: companyId, error: upsertError } = await admin.rpc("upsert_company", {
    p_name: data.company_name,
    p_linkedin_url: data.linkedin_url,
    p_website: data.website,
    p_country: data.country,
  })
  if (upsertError || !companyId) {
    console.error("[v3] upsert_company falló en import:", upsertError?.message)
    return { error: "No se pudo crear la empresa" }
  }
  await admin
    .schema("v3")
    .from("account_import_rows")
    .update({
      resolution: "created",
      matched_company_id: companyId as string,
      resolved_by: params.resolvedBy,
    })
    .eq("id", params.rowId)
  await applyFileLinkedinCompanyId(companyId as string, data)
  // La empresa nueva con linkedin_url entra sola al cron de enriquecimiento
  // (v3-enrich-companies-linkedin selecciona companies nuevas con LinkedIn).
  return { success: true, companyId: companyId as string }
}

// ── Preflight de cuota ─────────────────────────────────────

/** Fila que participa del alta: confirmada/creada, o match directo sin tocar. */
function isEligible(row: { match_status: string; resolution: string | null }): boolean {
  if (row.resolution === "ignored") return false
  if (row.resolution === "confirmed" || row.resolution === "created") return true
  return row.match_status === "matched" && row.resolution === null
}

export interface ImportPreflight {
  totalRows: number
  eligibleRows: number
  newFollowCompanies: number
  alreadyFollowed: number
  pendingReview: number
  ignoredRows: number
  quotaUsed: number
  quotaCap: number
  quotaAvailable: number
  exceedsQuota: boolean
}

export async function getImportPreflight(importId: string): Promise<ImportPreflight | { error: string }> {
  const admin = createAdminClient()
  const { data: imp } = await admin
    .schema("v3")
    .from("account_imports")
    .select("id, workspace_id, total_rows")
    .eq("id", importId)
    .maybeSingle()
  if (!imp) return { error: "Import inexistente" }

  const { data: rows } = await admin
    .schema("v3")
    .from("account_import_rows")
    .select("match_status, resolution, matched_company_id")
    .eq("import_id", importId)
  const all = rows ?? []

  const eligible = all.filter(isEligible)
  const companyIds = [...new Set(eligible.map((r) => r.matched_company_id).filter(Boolean))] as string[]

  const followedNow = new Set<string>()
  if (companyIds.length) {
    const { data: followed } = await admin
      .schema("v3")
      .from("followed_accounts")
      .select("company_id")
      .eq("workspace_id", imp.workspace_id)
      .eq("is_active", true)
      .in("company_id", companyIds)
    for (const f of followed ?? []) followedNow.add(f.company_id)
  }

  const newFollowCompanies = companyIds.filter((id) => !followedNow.has(id)).length
  const quota = await checkFollowQuota(imp.workspace_id)
  const quotaAvailable = Math.max(0, quota.cap - quota.used)

  return {
    totalRows: imp.total_rows,
    eligibleRows: eligible.length,
    newFollowCompanies,
    alreadyFollowed:
      all.filter((r) => r.match_status === "already_followed" && r.resolution !== "ignored").length +
      followedNow.size,
    pendingReview: all.filter(
      (r) =>
        r.resolution === null &&
        (r.match_status === "candidate" || r.match_status === "ambiguous" || r.match_status === "not_found"),
    ).length,
    ignoredRows: all.filter((r) => r.resolution === "ignored").length,
    quotaUsed: quota.used,
    quotaCap: quota.cap,
    quotaAvailable,
    exceedsQuota: newFollowCompanies > quotaAvailable,
  }
}

// ── Confirmación ───────────────────────────────────────────

export interface ConfirmImportResult {
  followed: number
  alreadyFollowed: number
  createdCompanies: number
  skipped: number
  failed: number
  v2Bookmarks: V2BookmarkResult[]
}

export async function confirmAccountImport(params: {
  importId: string
  userId: string
  /** Usuarios destino del puente a bookmarks v2 (puede ser vacío). */
  v2UserIds: string[]
}): Promise<ConfirmImportResult | { error: string }> {
  const admin = createAdminClient()

  const { data: imp } = await admin
    .schema("v3")
    .from("account_imports")
    .select("id, workspace_id, status")
    .eq("id", params.importId)
    .maybeSingle()
  if (!imp) return { error: "Import inexistente" }
  if (imp.status !== "reviewing") return { error: `El import está en estado '${imp.status}', no se puede confirmar` }

  // Preflight DENTRO de la confirmación: la cuota pudo cambiar desde la review
  const preflight = await getImportPreflight(params.importId)
  if ("error" in preflight) return preflight
  if (preflight.exceedsQuota) {
    return {
      error:
        `El alta pedida (${preflight.newFollowCompanies} cuentas nuevas) excede el cupo disponible ` +
        `(${preflight.quotaAvailable} de ${preflight.quotaCap}). Ajustá el plan o ignorá filas y reintentá.`,
    }
  }

  await admin.schema("v3").from("account_imports").update({ status: "confirming" }).eq("id", params.importId)

  const { data: rows } = await admin
    .schema("v3")
    .from("account_import_rows")
    .select("id, match_status, resolution, matched_company_id, row_data")
    .eq("import_id", params.importId)
  const all = rows ?? []
  const eligible = all.filter(isEligible).filter((r) => r.matched_company_id)

  // followAccount es idempotente y por empresa; se agrupan filas por company
  const rowsByCompany = new Map<string, string[]>()
  const rowDataByCompany = new Map<string, CanonicalRow>()
  for (const row of eligible) {
    const list = rowsByCompany.get(row.matched_company_id as string) ?? []
    list.push(row.id)
    rowsByCompany.set(row.matched_company_id as string, list)
    if (!rowDataByCompany.has(row.matched_company_id as string)) {
      rowDataByCompany.set(row.matched_company_id as string, row.row_data as CanonicalRow)
    }
  }

  let followed = 0
  let failed = 0
  for (const [companyId, rowIds] of rowsByCompany) {
    const result = await followAccount({
      workspaceId: imp.workspace_id,
      companyId,
      userId: params.userId,
    })
    if ("error" in result) {
      failed += rowIds.length
      await admin
        .schema("v3")
        .from("account_import_rows")
        .update({ match_status: "error", error_message: result.error })
        .in("id", rowIds)
    } else {
      followed++
      // Los matched sin resolución explícita quedan confirmados por el alta
      await admin
        .schema("v3")
        .from("account_import_rows")
        .update({ resolution: "confirmed", resolved_by: params.userId })
        .in("id", rowIds)
        .is("resolution", null)
      // Columna opcional del archivo (Fase 3): write-once del ID numérico
      const rowData = rowDataByCompany.get(companyId)
      if (rowData) await applyFileLinkedinCompanyId(companyId, rowData)
    }
  }

  // Puente opcional a bookmarks v2 (diseño 4.7)
  const v2Bookmarks = params.v2UserIds.length
    ? await createBookmarksForUsers({
        userIds: params.v2UserIds,
        companyIds: [...rowsByCompany.keys()],
        searchContext: {
          source: "account_import",
          import_id: params.importId,
          workspace_id: imp.workspace_id,
        },
      })
    : []

  const createdCompanies = all.filter((r) => r.resolution === "created").length
  const skipped = all.length - eligible.length

  await admin
    .schema("v3")
    .from("account_imports")
    .update({
      status: "completed",
      followed_rows: followed,
      created_companies: createdCompanies,
      skipped_rows: skipped,
      v2_bookmarks: v2Bookmarks.length ? v2Bookmarks : null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", params.importId)

  return {
    followed,
    alreadyFollowed: preflight.alreadyFollowed,
    createdCompanies,
    skipped,
    failed,
    v2Bookmarks,
  }
}

export async function discardAccountImport(importId: string): Promise<{ success: boolean }> {
  const admin = createAdminClient()
  const { error } = await admin
    .schema("v3")
    .from("account_imports")
    .update({ status: "discarded" })
    .eq("id", importId)
    .in("status", ["parsing", "reviewing"])
  return { success: !error }
}

// ── Puente a bookmarks v2 ──────────────────────────────────

/**
 * Crea bookmarks v2 a nombre de OTROS usuarios vía la RPC create_bookmarks.
 *
 * No se puede reutilizar bookmarkCompanyBatch (app/actions/bookmarks.ts) tal
 * cual: esa action usa el cliente de sesión y la RLS de bookmarks solo permite
 * tocar los propios. Acá el actor (superadmin / admin de workspace, ya validado
 * por la action que llama) crea bookmarks para terceros, así que va por service
 * role. La RPC es idempotente por diseño: inserta de a una, saltea repetidas y
 * devuelve was_created por fila.
 */
export async function createBookmarksForUsers(params: {
  userIds: string[]
  companyIds: string[]
  searchContext: Record<string, unknown>
}): Promise<V2BookmarkResult[]> {
  const admin = createAdminClient()
  const results: V2BookmarkResult[] = []

  for (const userId of [...new Set(params.userIds)]) {
    let email: string | null = null
    try {
      const { data } = await admin.auth.admin.getUserById(userId)
      email = data?.user?.email ?? null
      if (!data?.user) {
        results.push({ userId, email: null, created: 0, alreadyExisted: 0, error: "Usuario inexistente" })
        continue
      }
    } catch {
      results.push({ userId, email: null, created: 0, alreadyExisted: 0, error: "Usuario inexistente" })
      continue
    }

    const { data, error } = await admin.rpc("create_bookmarks", {
      p_user_id: userId,
      p_company_ids: params.companyIds,
      p_search_context: params.searchContext,
    })

    if (error) {
      console.error("[v3] create_bookmarks falló para", userId, error.message)
      results.push({ userId, email, created: 0, alreadyExisted: 0, error: "No se pudieron crear los bookmarks" })
      continue
    }

    const rows = (data ?? []) as Array<{ was_created: boolean }>
    const created = rows.filter((r) => r.was_created).length
    results.push({ userId, email, created, alreadyExisted: rows.length - created, error: null })
  }

  return results
}

// ── Apoyo para la UI ───────────────────────────────────────

export interface BookmarkTargetUser {
  userId: string
  email: string | null
  fullName: string | null
  isWorkspaceMember: boolean
}

/**
 * Usuarios elegibles para el puente v2. Se listan TODOS los usuarios de la
 * plataforma (la base activa de v2 mayormente no es miembro de workspaces v3
 * todavía), marcando quiénes son miembros del workspace destino para que la UI
 * los ofrezca primero. El recorte por permiso (workspace admin solo ve a sus
 * miembros) lo hace la server action, no esta función.
 */
export async function listBookmarkTargetUsers(workspaceId: string): Promise<BookmarkTargetUser[]> {
  const admin = createAdminClient()

  const memberIds = new Set<string>()
  const { data: members } = await admin
    .schema("v3")
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
  for (const m of members ?? []) memberIds.add(m.user_id)

  const users: BookmarkTargetUser[] = []
  let page = 1
  const perPage = 200
  for (let i = 0; i < 5; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error || !data?.users?.length) break
    for (const u of data.users) {
      users.push({
        userId: u.id,
        email: u.email ?? null,
        fullName:
          (u.user_metadata?.full_name as string | undefined) ??
          (u.user_metadata?.name as string | undefined) ??
          null,
        isWorkspaceMember: memberIds.has(u.id),
      })
    }
    if (data.users.length < perPage) break
    page++
  }

  return users.sort((a, b) => {
    if (a.isWorkspaceMember !== b.isWorkspaceMember) return a.isWorkspaceMember ? -1 : 1
    return (a.email ?? "").localeCompare(b.email ?? "")
  })
}

/** Mini-búsqueda inline de empresas para la review ("Buscar manualmente"). */
export async function searchCompaniesForImport(query: string): Promise<ImportRowCandidate[]> {
  const trimmed = query.trim()
  if (trimmed.length < 3) return []
  const admin = createAdminClient()
  const { data } = await admin
    .from("companies")
    .select("id, name, website, country")
    .or(`name.ilike.%${trimmed}%,website.ilike.%${trimmed}%`)
    .limit(10)
  return (data ?? []).map((c) => ({
    companyId: c.id,
    name: c.name,
    website: c.website,
    country: c.country,
    confidence: 0,
  }))
}
