"use server"

import { revalidatePath } from "next/cache"
import { requireSuperadmin } from "@/lib/auth/require-superadmin"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  confirmAccountImport,
  createAccountImport,
  discardAccountImport,
  getAccountImport,
  getImportPreflight,
  listBookmarkTargetUsers,
  resolveImportRow,
  searchCompaniesForImport,
  type AccountImportRow,
  type AccountImportSummary,
  type BookmarkTargetUser,
  type ConfirmImportResult,
  type CreateImportResult,
  type ImportPreflight,
  type ImportRowCandidate,
} from "@/lib/v3/services/account-import"

// ═══════════════════════════════════════════════════════════
// Server actions del import masivo de cuentas (Fase 1: solo superadmin).
//
// El layout de /v3/admin solo gatea navegación: CADA action re-chequea el rol
// (ver el comentario de lib/auth/require-superadmin.ts). Cuando se habilite la
// Fase 2 (admin de workspace desde /v3/accounts), el guard de estas actions
// pasa a aceptar también requireWorkspaceAdmin con el workspace forzado al
// propio; la estructura ya separa guard de lógica para ese cambio.
// ═══════════════════════════════════════════════════════════

const ADMIN_PATH = "/v3/admin/account-imports"

/** Verifica que el import exista y devuelva su workspace (para guards futuros). */
async function getImportWorkspace(importId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .schema("v3")
    .from("account_imports")
    .select("workspace_id")
    .eq("id", importId)
    .maybeSingle()
  return data?.workspace_id ?? null
}

export interface WorkspaceOption {
  id: string
  name: string
  plan: string
  followedCount: number
}

/** Workspaces para el selector del wizard (liviano, sin emails de admins). */
export async function listWorkspaceOptionsAction(): Promise<{
  workspaces: WorkspaceOption[]
  error?: string
}> {
  const guard = await requireSuperadmin()
  if ("error" in guard) return { workspaces: [], error: guard.error }

  const admin = createAdminClient()
  const { data: workspaces, error } = await admin
    .schema("v3")
    .from("workspaces")
    .select("id, name, plan")
    .order("name", { ascending: true })
  if (error || !workspaces) return { workspaces: [], error: "Error al cargar los workspaces" }

  const { data: followed } = await admin
    .schema("v3")
    .from("followed_accounts")
    .select("workspace_id")
    .eq("is_active", true)
  const counts = new Map<string, number>()
  for (const f of followed ?? []) counts.set(f.workspace_id, (counts.get(f.workspace_id) ?? 0) + 1)

  return {
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      plan: (w as { plan?: string }).plan ?? "trial",
      followedCount: counts.get(w.id) ?? 0,
    })),
  }
}

export async function createAccountImportAction(input: {
  workspaceId: string
  blobUrl: string
  filename: string
}): Promise<CreateImportResult | { error: string }> {
  const guard = await requireSuperadmin()
  if ("error" in guard) return { error: guard.error }

  if (!input.workspaceId || !input.blobUrl || !input.filename) {
    return { error: "Faltan datos del archivo" }
  }

  // El blob es público pero el nombre lo generó nuestro upload; igual se
  // valida el host para no descargar URLs arbitrarias.
  let url: URL
  try {
    url = new URL(input.blobUrl)
  } catch {
    return { error: "URL de archivo inválida" }
  }
  if (!url.hostname.endsWith(".blob.vercel-storage.com")) {
    return { error: "El archivo debe venir del upload de ASCI" }
  }

  const response = await fetch(input.blobUrl)
  if (!response.ok) return { error: "No se pudo descargar el archivo subido" }
  const buffer = Buffer.from(await response.arrayBuffer())

  const result = await createAccountImport({
    workspaceId: input.workspaceId,
    createdBy: guard.userId,
    filename: input.filename,
    blobUrl: input.blobUrl,
    buffer,
  })
  if (!("error" in result)) revalidatePath(ADMIN_PATH)
  return result
}

export async function getAccountImportAction(importId: string): Promise<
  { summary: AccountImportSummary; rows: AccountImportRow[] } | { error: string }
> {
  const guard = await requireSuperadmin()
  if ("error" in guard) return { error: guard.error }
  const data = await getAccountImport(importId)
  return data ?? { error: "Import inexistente" }
}

export async function resolveImportRowAction(input: {
  importId: string
  rowId: string
  action: "confirm" | "create" | "ignore"
  companyId?: string
}): Promise<{ success: true; companyId?: string } | { error: string }> {
  const guard = await requireSuperadmin()
  if ("error" in guard) return { error: guard.error }
  const workspaceId = await getImportWorkspace(input.importId)
  if (!workspaceId) return { error: "Import inexistente" }
  return resolveImportRow({
    rowId: input.rowId,
    resolvedBy: guard.userId,
    action: input.action,
    companyId: input.companyId,
  })
}

export async function getImportPreflightAction(
  importId: string,
): Promise<ImportPreflight | { error: string }> {
  const guard = await requireSuperadmin()
  if ("error" in guard) return { error: guard.error }
  return getImportPreflight(importId)
}

export async function confirmAccountImportAction(input: {
  importId: string
  v2UserIds: string[]
}): Promise<ConfirmImportResult | { error: string }> {
  const guard = await requireSuperadmin()
  if ("error" in guard) return { error: guard.error }

  const result = await confirmAccountImport({
    importId: input.importId,
    userId: guard.userId,
    v2UserIds: input.v2UserIds ?? [],
  })
  if (!("error" in result)) {
    revalidatePath(ADMIN_PATH)
    revalidatePath("/v3/accounts")
  }
  return result
}

export async function discardAccountImportAction(importId: string): Promise<{ success: boolean; error?: string }> {
  const guard = await requireSuperadmin()
  if ("error" in guard) return { success: false, error: guard.error }
  const result = await discardAccountImport(importId)
  if (result.success) revalidatePath(ADMIN_PATH)
  return result
}

export async function listBookmarkTargetUsersAction(
  workspaceId: string,
): Promise<{ users: BookmarkTargetUser[]; error?: string }> {
  const guard = await requireSuperadmin()
  if ("error" in guard) return { users: [], error: guard.error }
  return { users: await listBookmarkTargetUsers(workspaceId) }
}

export async function searchCompaniesForImportAction(
  query: string,
): Promise<{ companies: ImportRowCandidate[] }> {
  const guard = await requireSuperadmin()
  if ("error" in guard) return { companies: [] }
  return { companies: await searchCompaniesForImport(query) }
}

/** Imports recientes para retomar una review interrumpida. */
export async function listRecentImportsAction(): Promise<{
  imports: Array<AccountImportSummary & { workspaceName: string }>
  error?: string
}> {
  const guard = await requireSuperadmin()
  if ("error" in guard) return { imports: [], error: guard.error }

  const admin = createAdminClient()
  const { data: imports } = await admin
    .schema("v3")
    .from("account_imports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20)
  if (!imports?.length) return { imports: [] }

  const wsIds = [...new Set(imports.map((i) => i.workspace_id))]
  const { data: workspaces } = await admin.schema("v3").from("workspaces").select("id, name").in("id", wsIds)
  const nameById = new Map((workspaces ?? []).map((w) => [w.id, w.name]))

  return {
    imports: imports.map((imp) => ({
      id: imp.id,
      workspaceId: imp.workspace_id,
      filename: imp.filename,
      status: imp.status,
      totalRows: imp.total_rows,
      followedRows: imp.followed_rows,
      createdCompanies: imp.created_companies,
      skippedRows: imp.skipped_rows,
      v2Bookmarks: imp.v2_bookmarks ?? null,
      errorMessage: imp.error_message ?? null,
      createdAt: imp.created_at,
      completedAt: imp.completed_at ?? null,
      workspaceName: nameById.get(imp.workspace_id) ?? "—",
    })),
  }
}
