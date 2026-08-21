"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireWorkspaceMember } from "@/lib/v3/workspace"
import { requireRequestUser } from "@/lib/v3/request-auth"
import {
  searchDecisionMakers,
  type ApolloSearchOptions,
  type ApolloSearchStats,
} from "@/lib/shared/apollo-decision-makers"

// ═══════════════════════════════════════════════════════════
// Búsqueda de decisores desde el bookmark de v3.
//
// El flujo de Apollo es el MISMO que usa v2 (lib/shared/apollo-decision-makers):
// resolución de organización, cache por query_hash, enriquecimiento y dedupe.
// Acá sólo está lo propio de v3: autorizar por workspace y devolver la lista
// para refrescar la sección sin recargar.
//
// `bookmarkId` va en null: es una columna de v2 y en v3 no hay fila equivalente.
// La tabla la acepta nullable, y la atribución de v3 es por workspace + usuario.
// ═══════════════════════════════════════════════════════════

export interface DecisionMaker {
  id: string
  fullName: string
  title: string | null
  seniority: string | null
  email: string | null
  emailStatus: string | null
  phone: string | null
  linkedinUrl: string | null
  city: string | null
  country: string | null
  photoUrl: string | null
  createdAt: string
}

async function getAuthContext() {
  const user = await requireRequestUser()
  const workspace = await requireWorkspaceMember(user.id)
  return { userId: user.id, workspaceId: workspace.id }
}

/**
 * Decisores ya guardados de una cuenta. Se leen los del usuario porque así es
 * como v2 los guarda (`user_company_contacts` es por usuario, no por
 * workspace) y la instrucción fue mantener ese modelo.
 */
export async function listDecisionMakers(companyId: string): Promise<DecisionMaker[]> {
  const { userId } = await getAuthContext()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from("user_company_contacts")
    .select(
      "id, full_name, role, seniority, email, email_status, phone, mobile_phone, linkedin_url, city, country, profile_picture_url, created_at",
    )
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("is_decision_maker", true)
    .neq("status", "removed")
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) {
    console.error("[v3] Error listando decisores:", error.message)
    return []
  }

  return (data ?? []).map((c) => ({
    id: c.id,
    fullName: c.full_name ?? "Sin nombre",
    title: c.role ?? null,
    seniority: c.seniority ?? null,
    email: c.email ?? null,
    emailStatus: c.email_status ?? null,
    // El móvil primero: es el canal útil para una primera conversación.
    phone: c.mobile_phone ?? c.phone ?? null,
    linkedinUrl: c.linkedin_url ?? null,
    city: c.city ?? null,
    country: c.country ?? null,
    photoUrl: c.profile_picture_url ?? null,
    createdAt: c.created_at as string,
  }))
}

export async function searchDecisionMakersAction(
  companyId: string,
  jobTitles: string[],
  countryFilter: string | null,
  options: ApolloSearchOptions = {},
): Promise<{ success: boolean; count: number; error?: string; stats?: ApolloSearchStats; contacts: DecisionMaker[] }> {
  const { userId } = await getAuthContext()

  const result = await searchDecisionMakers({
    companyId,
    userId,
    bookmarkId: null,
    searchContext: null,
    jobTitles,
    countryFilter,
    options,
  })

  // La lista se devuelve SIEMPRE, también cuando la búsqueda falla: si Apollo
  // no respondió, el usuario tiene que seguir viendo los decisores que ya tenía
  // en vez de una sección vacía.
  const contacts = await listDecisionMakers(companyId)

  if (result.success) revalidatePath(`/v3/accounts/${companyId}`)

  return { ...result, contacts }
}
