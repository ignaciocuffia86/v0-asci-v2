import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

export const LEGACY_SIGNAL_ADAPTER_VERSION = "legacy-signals-v2"

/**
 * Persona de la que se desprende una señal.
 *
 * Cuando la evidencia viene de un perfil hay que poder mostrar de quién se está
 * infiriendo: sin el LinkedIn, una afirmación como "usan SAP" es incomprobable
 * para el vendedor y no la puede citar en una conversación.
 */
export interface SignalPerson {
  contactId: string
  fullName: string | null
  title: string | null
  linkedinUrl: string | null
  /**
   * `false` = ex-empleado. Es determinante: la señal prueba que la persona
   * trabajó con esa tecnología, no que la cuenta la use HOY. Hay que rotularlo
   * distinto y no presentarlo como evidencia vigente.
   */
  isCurrentEmployee: boolean
}

export interface CanonicalLegacySignal {
  id: string
  companyId: string
  type: string
  keyword: string | null
  snippet: string | null
  sourceField: string | null
  sourceUrl: string | null
  contactId: string | null
  jobPostingId: string | null
  /** Perfil de origen, cuando la señal se desprende de una persona. */
  person: SignalPerson | null
  occurredAt: string
  createdAt: string
}

export interface LegacySignalResult {
  status: "ready" | "empty" | "failed"
  signals: CanonicalLegacySignal[]
  total: number
  latestAt: string | null
  warning: string | null
}

export async function getLegacySignals(companyId: string, limit = 200): Promise<LegacySignalResult> {
  const admin = createAdminClient()
  // El join a contacts trae el LinkedIn en la misma consulta. En esta base el
  // 76% de las señales vienen de perfiles y todas tienen linkedin_url, así que
  // resolverlo acá evita N+1 en el armado de evidencia.
  const { data, error, count } = await admin
    .from("signals")
    .select(
      `id, company_id, signal_type, keyword_matched, snippet, source_field, source_url,
       contact_id, job_posting_id, job_posted_at, created_at, is_current_employee,
       contacts:contact_id ( id, full_name, first_name, last_name, current_position_title, headline, linkedin_url )`,
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[v3] Error leyendo señales legacy", { companyId, code: error.code, message: error.message })
    return {
      status: "failed",
      signals: [],
      total: 0,
      latestAt: null,
      warning: "La fuente de señales internas no pudo consultarse; no significa que la cuenta no tenga señales.",
    }
  }

  const signals: CanonicalLegacySignal[] = (data ?? []).map((row) => {
    // El embed de Supabase puede venir como objeto o como array de uno.
    const raw = row as Record<string, unknown>
    const joined = raw.contacts
    const contact = (Array.isArray(joined) ? joined[0] : joined) as
      | {
          id: string
          full_name: string | null
          first_name: string | null
          last_name: string | null
          current_position_title: string | null
          headline: string | null
          linkedin_url: string | null
        }
      | null
      | undefined

    const person: SignalPerson | null = contact
      ? {
          contactId: contact.id,
          fullName:
            contact.full_name ??
            [contact.first_name, contact.last_name].filter(Boolean).join(" ") ??
            null,
          title: contact.current_position_title ?? contact.headline ?? null,
          linkedinUrl: contact.linkedin_url,
          // Default conservador: si el flag no está seteado, no afirmamos que la
          // persona siga en la empresa.
          isCurrentEmployee: raw.is_current_employee === true,
        }
      : null

    return {
      id: row.id,
      companyId: row.company_id,
      type: row.signal_type,
      keyword: row.keyword_matched,
      snippet: row.snippet,
      sourceField: row.source_field,
      sourceUrl: row.source_url,
      contactId: row.contact_id,
      jobPostingId: row.job_posting_id,
      person,
      occurredAt: row.job_posted_at ?? row.created_at,
      createdAt: row.created_at,
    }
  })

  return {
    status: signals.length > 0 ? "ready" : "empty",
    signals,
    total: count ?? signals.length,
    latestAt: signals[0]?.occurredAt ?? null,
    warning: null,
  }
}
