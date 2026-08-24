import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { resolveCapabilityTerms, type CapabilityTerm } from "./capability-search"
import { principalColumns, type McpPrincipal } from "@/lib/v3/mcp-usage"

// ═══════════════════════════════════════════════════════════════════════════
// Cruce de una LISTA DEL CLIENTE contra uno o varios términos.
//
// El MCP tenía las dos mitades y no la que las cruza: search_companies va de UN
// nombre a empresas, y search_companies_by_capability de UN término a empresas.
// El caso real —"de estas 61 cuentas de Chile, ¿cuáles tienen señales de Power
// BI?"— no era ninguna de las dos, y se resolvía bajando el universo entero
// paginando (9 llamadas, ~80k tokens) y matcheando a mano.
//
// Peor que el costo: para las cuentas SIN señales, la única forma de afirmar "no
// tiene" era inferir por ORDEN ALFABÉTICO que el nombre no aparecía entre dos
// vecinos de la lista. "Camanchaca no está entre Calixto y Cámara de Comercio,
// entonces tiene 0" no es una afirmación que se le pueda dar a un cliente.
//
// Es Tier 0: lee datos ya persistidos, no ejecuta IA, no consume cupo del plan y
// no exige que las cuentas estén guardadas.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tope duro de nombres por llamada. Mismo techo que la RPC.
 *
 * Bajó de 200 a 100 al medir contra producción: la prueba local sobre 300.000
 * empresas sintéticas daba 5,6 s para 200 nombres difusos, pero contra las
 * 514.269 reales eran ~26 s, muy por encima del techo de 8 s de PostgREST. Con
 * el umbral trigram en 0.45, 100 nombres TODOS difusos miden 5,7 s.
 */
export const MAX_ACCOUNTS_PER_CALL = 100

export type ScreenAccountInput = {
  name: string
  /** Dominio del cliente, si lo tiene. Es la prueba de identidad más fuerte. */
  domain?: string
}

/** Cuánto vive un screening guardado antes de que haya que rehacerlo. */
const SCREENING_TTL_HOURS = 72

export type ScreenAccountListParams = {
  accounts: ScreenAccountInput[]
  terms?: string[]
  countries?: string[]
  minSignals?: number
  matchThreshold?: number
  maxCandidates?: number
}

type ScreenRow = {
  input: string
  status: "matched" | "matched_ambiguous" | "matched_no_signal" | "no_match"
  companyId: string | null
  matchedName: string | null
  matchConfidence: number
  signalStrength: "solid" | "weak" | "none" | "not_evaluated"
  ambiguityReason: "multiple_candidates" | "low_confidence" | null
  [key: string]: unknown
}

type ScreenPayload = {
  rows: ScreenRow[]
  summary: Record<string, number>
  appliedFilters: Record<string, unknown>
}

/**
 * Normaliza y deduplica la lista de entrada.
 *
 * La deduplicación es por nombre normalizado y NO se hace en SQL a propósito: la
 * lista del cliente suele traer el mismo nombre escrito de dos formas, y quien
 * llama necesita que la respuesta tenga una fila por lo que él mandó. Acá se
 * colapsan los duplicados exactos (mismo texto) y nada más.
 */
export function prepareAccounts(accounts: ScreenAccountInput[]) {
  const seen = new Set<string>()
  const prepared: Array<{ input: string; domain: string | null }> = []
  for (const account of accounts) {
    const input = account.name?.trim()
    if (!input) continue
    const key = input.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    prepared.push({
      input,
      domain: account.domain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null,
    })
  }
  return prepared
}

export async function screenAccountList(params: ScreenAccountListParams, principal?: McpPrincipal) {
  const accounts = prepareAccounts(params.accounts)
  if (!accounts.length) throw new Error("SCREEN_LIST_EMPTY:La lista no tiene ningún nombre utilizable.")
  if (accounts.length > MAX_ACCOUNTS_PER_CALL) {
    throw new Error(
      `SCREEN_LIST_TOO_MANY:${accounts.length} nombres (máx ${MAX_ACCOUNTS_PER_CALL}). Partí la lista en lotes y llamá una vez por lote.`,
    )
  }

  const requestedTerms = (params.terms ?? []).filter((term) => term.trim())
  let matched: CapabilityTerm[] = []
  let unresolved: string[] = []

  if (requestedTerms.length) {
    const resolution = await resolveCapabilityTerms(requestedTerms)
    matched = resolution.matched
    unresolved = resolution.unresolved
    // Si NINGÚN término existe, el resultado sería una tabla entera de
    // "matched_no_signal" que se lee como "ninguna de tus cuentas tiene esto"
    // cuando lo que pasó es que el término no está en el diccionario. Son
    // conclusiones opuestas: mejor fallar.
    if (!matched.length) {
      throw new Error(
        `CAPABILITY_TERMS_UNRESOLVED:Ningún término coincide con el diccionario: ${unresolved.join(", ")}. ` +
          `Usá get_document_dictionaries para ver los términos disponibles.`,
      )
    }
  }

  const productIds = matched.filter((term) => term.kind === "product").map((term) => term.id)
  const processIds = matched.filter((term) => term.kind === "process").map((term) => term.id)

  const admin = createAdminClient()
  const { data, error } = await admin.schema("v3").rpc("screen_account_list", {
    p_accounts: accounts,
    p_product_ids: productIds.length ? productIds : null,
    p_process_ids: processIds.length ? processIds : null,
    p_countries: params.countries?.length ? params.countries : null,
    p_min_signals: params.minSignals ?? 2,
    p_max_candidates: params.maxCandidates ?? 5,
    p_match_threshold: params.matchThreshold ?? 0.75,
  })

  if (error) throw new Error(`SCREEN_LIST_FAILED:${error.message}`)

  const payload = data as ScreenPayload
  const ambiguous = payload.rows.filter((row) => row.status === "matched_ambiguous")

  // Se guarda el resultado para poder exportarlo por HANDLE. La alternativa era
  // que create_export recibiera las filas de vuelta, y eso hace viajar la tabla
  // dos veces por la conversación: justo el costo que el export viene a eliminar.
  // Guardar una lectura no consume cupo ni ocupa lugares del plan.
  let screeningId: string | null = null
  if (principal) {
    const cols = principalColumns(principal)
    const { data: saved } = await admin
      .schema("v3")
      .from("mcp_screenings")
      .insert({
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        api_key_id: cols.api_key_id,
        oauth_token_id: cols.oauth_token_id,
        params: {
          label: requestedTerms.join(" + ") || "reconciliacion",
          terms: requestedTerms,
          resolvedTerms: matched.map((term) => term.name),
          countries: params.countries ?? null,
          minSignals: params.minSignals ?? 2,
          matchThreshold: params.matchThreshold ?? 0.75,
          accounts: accounts.length,
        },
        rows: payload.rows,
        summary: payload.summary,
        row_count: payload.rows.length,
        expires_at: new Date(Date.now() + SCREENING_TTL_HOURS * 3600_000).toISOString(),
      })
      .select("id")
      .maybeSingle()
    screeningId = saved?.id ?? null
  }

  return {
    ...payload,
    // El handle para create_export. Si es null, el screening corrió pero no se
    // pudo guardar: el resultado sirve igual, solo que no se puede exportar.
    screeningId,
    resolvedTerms: matched,
    unresolvedTerms: unresolved,
    inputDeduped: params.accounts.length - accounts.length,
    nextStep: nextStepFor(payload, ambiguous.length),
    interpretationGuidance: [
      "UNA FILA POR NOMBRE QUE MANDASTE, en el mismo orden. Los cuatro estados NO son intercambiables:",
      "• matched — la empresa está en ASCI y tiene el término.",
      "• matched_no_signal — está en ASCI y NO tiene el término. Es un DESCARTE LEGÍTIMO, podés decirle al cliente que no tiene la señal.",
      "• no_match — la empresa NO está en ASCI. NO es lo mismo que el anterior: acá no sabemos nada, no afirmes que no tiene la tecnología.",
      "• matched_ambiguous — hay que confirmar con el usuario ANTES de usar la fila. `ambiguityReason` dice qué preguntar: \"multiple_candidates\" = elegir entre los `candidates`; \"low_confidence\" = confirmar que el único candidato es la empresa correcta.",
      "NUNCA presentes una fila matched_ambiguous como si fuera matched: atribuirle a un cliente la evidencia de un homónimo es el peor error posible de este reporte.",
      "`signalStrength` en \"weak\" significa menos señales que el mínimo pedido: una mención suelta en un solo perfil no es una oportunidad. Marcalo o filtralo, no lo mezcles con las sólidas.",
      "`signalsForTerms` es el total de la EMPRESA, sumando las entidades duplicadas que el catálogo tiene con el mismo nombre canónico. `signalsOwn` es solo de la entidad que se devuelve, y `duplicateEntities` dice cuántas se consolidaron. Si las dos cifras difieren, la cuenta está fragmentada: usá el total y mencionalo.",
      "Para la cita textual de una cuenta, seguí con get_company_signal_summary detail=\"evidence\" y el `term`: no consume cupo ni necesita research previo.",
      "Si el usuario quiere la tabla como archivo, NO la transcribas al chat: llamá create_export con el `screeningId` y pasale la URL firmada.",
    ].join("\n"),
  }
}

function nextStepFor(payload: ScreenPayload, ambiguousCount: number) {
  const noMatch = payload.summary.noMatch ?? 0
  const steps: string[] = []
  if (ambiguousCount) {
    steps.push(
      `${ambiguousCount} fila(s) quedaron ambiguas: mostrale al usuario el nombre que mandó y el candidato (o los candidatos) y pedile que confirme antes de incluirlas en el reporte.`,
    )
  }
  if (noMatch) {
    steps.push(
      `${noMatch} nombre(s) no están en el catálogo de ASCI. Si el usuario los necesita, se resuelven scrapeando la cuenta, no reintentando esta tool con otra escritura.`,
    )
  }
  steps.push(
    "Para las filas con señal, el siguiente paso barato es get_company_signal_summary con detail=\"evidence\" (Tier 0). Solo después de eso conviene evaluar research o enrichment, que sí consumen cupo.",
  )
  return steps.join(" ")
}
