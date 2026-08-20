import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { getWorkspaceFitProfile } from "./workspace-fit-profile"
import {
  MOVEMENTS_WINDOW_MONTHS,
  classifyMovementFocus,
  classifyMovementType,
  pickPhone,
  pickValidEmail,
  type MovementFocus,
  type MovementType,
  type PreviousPositionEntry,
} from "./personnel-movements-rules"

// ═══════════════════════════════════════════════════════════
// Movimientos de personal de una cuenta (Fase 7 de la radiografía).
//
// Lee public.contacts filtrando por current_position_started_on (la fecha de
// ingreso al puesto que el ETL captura desde la migración
// 20260820120000_contact_position_dates; el histórico se backfilleó desde las
// import_rows retenidas). Las definiciones de rotación/foco viven en
// personnel-movements-rules.ts (puras, con tests).
// ═══════════════════════════════════════════════════════════

export interface PersonnelMovement {
  contactId: string
  fullName: string
  title: string | null
  /** ISO date del ingreso al puesto actual. */
  startedOn: string
  type: MovementType
  focus: MovementFocus
  /** Términos de la propuesta que matchearon (el porqué del foco). */
  matchedTerms: string[]
  linkedinUrl: string | null
  /** Solo emails con estado "valid" en la base; null si no hay. */
  email: string | null
  phone: string | null
  phoneType: string | null
  country: string | null
}

export interface PersonnelMovementsSummary {
  movements: PersonnelMovement[]
  windowMonths: number
  counts: {
    total: number
    ingresosNuevos: number
    rotacionesInternas: number
    decisores: number
    perfilesObjetivo: number
  }
}

const EMPTY_COUNTS = {
  total: 0,
  ingresosNuevos: 0,
  rotacionesInternas: 0,
  decisores: 0,
  perfilesObjetivo: 0,
}

/**
 * Ingresos nuevos y rotaciones internas de la cuenta en la ventana, con foco
 * clasificado contra la propuesta de valor del workspace y contacto listo para
 * el informe (email `valid`, teléfono con tipo).
 */
export async function listPersonnelMovements(
  companyId: string,
  workspaceId: string,
  options: { windowMonths?: number; limit?: number } = {},
): Promise<PersonnelMovementsSummary> {
  const windowMonths = options.windowMonths ?? MOVEMENTS_WINDOW_MONTHS
  const limit = options.limit ?? 50
  const admin = createAdminClient()

  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - windowMonths)
  const cutoffIso = cutoff.toISOString().slice(0, 10)

  const [{ data: rows, error }, { data: company }, profile] = await Promise.all([
    admin
      .from("contacts")
      .select(
        "id, full_name, current_position_title, headline, current_position_started_on, previous_positions, linkedin_url, country, email1, email1_status, email2, email2_status, email3, email3_status, email4, email4_status, phone1, phone1_type, phone2, phone2_type",
      )
      .eq("current_company_id", companyId)
      .gte("current_position_started_on", cutoffIso)
      .order("current_position_started_on", { ascending: false })
      .limit(limit),
    admin.from("companies").select("name").eq("id", companyId).maybeSingle(),
    getWorkspaceFitProfile(workspaceId),
  ])

  if (error) {
    console.error("[v3] Error listando movimientos de personal:", error.message)
    return { movements: [], windowMonths, counts: { ...EMPTY_COUNTS } }
  }

  const focusProfile = {
    recommendedJobTitles: profile.recommendedJobTitles,
    targetTerms: [...profile.targetTechnologies, ...profile.targetProcesses],
  }
  const companyName = company?.name ?? null

  const movements: PersonnelMovement[] = (rows ?? []).map((row) => {
    const type = classifyMovementType(
      (row.previous_positions ?? null) as PreviousPositionEntry[] | null,
      companyId,
      companyName,
    )
    const { focus, matchedTerms } = classifyMovementFocus(
      row.current_position_title,
      row.headline,
      focusProfile,
    )
    const phone = pickPhone(row)
    return {
      contactId: row.id,
      fullName: row.full_name ?? "(sin nombre)",
      title: row.current_position_title ?? null,
      startedOn: row.current_position_started_on as string,
      type,
      focus,
      matchedTerms,
      linkedinUrl: row.linkedin_url?.startsWith("placeholder:") ? null : (row.linkedin_url ?? null),
      email: pickValidEmail(row),
      phone: phone?.phone ?? null,
      phoneType: phone?.type ?? null,
      country: row.country ?? null,
    }
  })

  return {
    movements,
    windowMonths,
    counts: {
      total: movements.length,
      ingresosNuevos: movements.filter((m) => m.type === "ingreso_nuevo").length,
      rotacionesInternas: movements.filter((m) => m.type === "rotacion_interna").length,
      decisores: movements.filter((m) => m.focus === "decisor").length,
      perfilesObjetivo: movements.filter((m) => m.focus === "perfil_objetivo").length,
    },
  }
}
