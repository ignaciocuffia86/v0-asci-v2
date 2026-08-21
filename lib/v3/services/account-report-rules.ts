// Reglas PURAS de la radiografía comercial (Fase 9, diseño sección H).
//
// Sin "server-only" para poder testearlas: acá vive el criterio de "¿esta
// cuenta se aborda o no?" y las lecturas de cada fila del scorecard. Son las
// decisiones del informe, así que tienen tests y una sola definición.

/** Estado de abordaje de la cuenta. Reemplaza al score 0-100 en la vista. */
export type AccountStatus = "abordar" | "seguir_de_cerca" | "sin_senal"

export const STATUS_LABEL: Record<AccountStatus, string> = {
  abordar: "ABORDAR",
  seguir_de_cerca: "SEGUIR DE CERCA",
  sin_senal: "SIN SEÑAL",
}

export const STATUS_EMOJI: Record<AccountStatus, string> = {
  abordar: "🟢",
  seguir_de_cerca: "🟡",
  sin_senal: "🔴",
}

/** Días dentro de los cuales una contracción sigue pesando. */
export const CONTRACTION_WINDOW_DAYS = 60

export interface AccountStatusFacts {
  /** Noticias con relevancia 'propuesta' dentro de la ventana. */
  newsWithProposalSignal: number
  /** Noticias con relevancia 'negocio' dentro de la ventana. */
  newsWithBusinessSignal: number
  /** Vacantes activas (30d) que mencionan algo de la propuesta de valor. */
  jobsWithProposalSignal: number
  /** Movimientos de personal en la ventana de 6 meses. */
  personnelMovements: number
  /** Fecha de la contracción más reciente, si hubo. */
  latestContractionAt: string | null
}

export interface AccountStatusResult {
  status: AccountStatus
  /** Una línea explicando el estado, sin IA. */
  reason: string
  /** true si una contracción reciente bajó el estado un nivel. */
  loweredByContraction: boolean
}

/** Baja un nivel: abordar → seguir, seguir → sin señal. */
function lowerOneLevel(status: AccountStatus): AccountStatus {
  if (status === "abordar") return "seguir_de_cerca"
  if (status === "seguir_de_cerca") return "sin_senal"
  return "sin_senal"
}

/**
 * Semáforo por EVIDENCIA ACCIONABLE (decisión H.2):
 *
 *  🟢 abordar        → hay señal directa de lo que vendés (noticia 'propuesta'
 *                      o aviso con señal de la propuesta).
 *  🟡 seguir de cerca→ hay movimiento en la cuenta (personal o noticias de
 *                      negocio) pero ninguna señal directa todavía.
 *  🔴 sin señal      → nada en ninguna ventana.
 *
 * Una contracción reciente BAJA un nivel: una cuenta que frena el CAPEX no se
 * aborda igual aunque matchee la propuesta.
 */
export function computeAccountStatus(
  facts: AccountStatusFacts,
  now: number = Date.now(),
): AccountStatusResult {
  let status: AccountStatus
  let reason: string

  if (facts.newsWithProposalSignal > 0 || facts.jobsWithProposalSignal > 0) {
    status = "abordar"
    const partes: string[] = []
    if (facts.jobsWithProposalSignal > 0) {
      partes.push(
        `${facts.jobsWithProposalSignal} aviso${facts.jobsWithProposalSignal === 1 ? "" : "s"} con señal de tu propuesta`,
      )
    }
    if (facts.newsWithProposalSignal > 0) {
      partes.push(
        `${facts.newsWithProposalSignal} noticia${facts.newsWithProposalSignal === 1 ? "" : "s"} directamente relacionada${facts.newsWithProposalSignal === 1 ? "" : "s"}`,
      )
    }
    reason = `Señal directa: ${partes.join(" y ")}.`
  } else if (facts.personnelMovements > 0 || facts.newsWithBusinessSignal > 0) {
    status = "seguir_de_cerca"
    const partes: string[] = []
    if (facts.personnelMovements > 0) {
      partes.push(`${facts.personnelMovements} movimiento${facts.personnelMovements === 1 ? "" : "s"} de personal`)
    }
    if (facts.newsWithBusinessSignal > 0) {
      partes.push(`${facts.newsWithBusinessSignal} noticia${facts.newsWithBusinessSignal === 1 ? "" : "s"} de negocio`)
    }
    reason = `Hay movimiento (${partes.join(", ")}) pero ninguna señal directa de tu propuesta todavía.`
  } else {
    status = "sin_senal"
    reason = "Sin señales en las ventanas analizadas."
  }

  let loweredByContraction = false
  if (facts.latestContractionAt && status !== "sin_senal") {
    const ms = new Date(facts.latestContractionAt).getTime()
    if (!Number.isNaN(ms)) {
      const ageDays = (now - ms) / (24 * 60 * 60 * 1000)
      if (ageDays >= 0 && ageDays <= CONTRACTION_WINDOW_DAYS) {
        status = lowerOneLevel(status)
        loweredByContraction = true
        reason += " Atención: hay señales de contracción recientes que frenan el timing."
      }
    }
  }

  return { status, reason, loweredByContraction }
}

// ─── Scorecard operativo: fuente × volumen × lectura (H.3) ───────────
//
// Las lecturas son texto fijo por rango, NO generadas por IA: son las mismas
// frases del informe manual y no vale gastar tokens en algo que es una tabla
// de verdad.

export interface ScorecardRow {
  source: string
  volume: number
  reading: string
}

export interface ScorecardFacts {
  movementsTotal: number
  movementsNew: number
  movementsInternal: number
  decisionMakers: number
  targetProfiles: number
  jobsWithSignal: number
  jobsTotal: number
  newsProposal: number
  newsBusiness: number
  hasVendorProfile: boolean
}

export function buildScorecardRows(f: ScorecardFacts): ScorecardRow[] {
  const perfilLectura = !f.hasVendorProfile
    ? "Sin propuesta de valor cargada: no se puede evaluar el foco"
    : f.targetProfiles === 0
      ? "Sin perfiles del foco en la ventana"
      : f.targetProfiles === 1
        ? "Un perfil del foco recién incorporado"
        : "Hay equipo del foco moviéndose: interlocutor técnico disponible"

  return [
    {
      source: "Movimientos de personal (6 meses)",
      volume: f.movementsTotal,
      reading:
        f.movementsTotal === 0
          ? "Sin movimientos registrados en la ventana"
          // "rotación" pierde la tilde en plural ("rotaciones"), así que no
          // alcanza con concatenar el sufijo: se elige la palabra entera.
          : `${f.movementsNew} ingreso${f.movementsNew === 1 ? "" : "s"} nuevo${f.movementsNew === 1 ? "" : "s"} y ${f.movementsInternal} ${f.movementsInternal === 1 ? "rotación interna" : "rotaciones internas"}`,
    },
    {
      source: "Perfiles de interés según tu propuesta",
      volume: f.targetProfiles,
      reading: perfilLectura,
    },
    {
      source: "Decisores y compras",
      volume: f.decisionMakers,
      reading:
        f.decisionMakers === 0
          ? "Sin decisores nuevos identificados"
          : "Hay poder de decisión o de compra recién llegado al rol",
    },
    {
      source: "Avisos laborales con señal",
      volume: f.jobsWithSignal,
      reading:
        f.jobsTotal === 0
          ? "Sin avisos en el scrape del período"
          : f.jobsWithSignal === 0
            ? `${f.jobsTotal} avisos activos, ninguno menciona lo que vendés`
            : `${f.jobsWithSignal} de ${f.jobsTotal} avisos mencionan lo que vendés`,
    },
    {
      source: "Noticias con señal",
      volume: f.newsProposal + f.newsBusiness,
      reading:
        f.newsProposal > 0
          ? `${f.newsProposal} noticia${f.newsProposal === 1 ? "" : "s"} ligada${f.newsProposal === 1 ? "" : "s"} a tu propuesta`
          : f.newsBusiness > 0
            ? "Solo contexto de negocio, sin proyecto concreto que atacar"
            : "Sin señal pública en la ventana",
    },
  ]
}

/**
 * Huella de los insumos del informe (H.5).
 *
 * Los textos generados (resumen, ángulos, riesgos) se rehacen SOLO cuando esto
 * cambia: entraron vacantes o noticias nuevas, o cambió la propuesta de valor.
 * Abrir la cuenta cien veces con los mismos datos no cuesta nada.
 */
export function buildInputsFingerprint(parts: {
  profileVersion: string | null
  lastJobScrapeAt: string | null
  lastNewsScrapeAt: string | null
  jobsTotal: number
  jobsWithSignal: number
  newsTotal: number
  movementsTotal: number
}): string {
  return [
    parts.profileVersion ?? "no-profile",
    parts.lastJobScrapeAt ?? "no-jobs",
    parts.lastNewsScrapeAt ?? "no-news",
    parts.jobsTotal,
    parts.jobsWithSignal,
    parts.newsTotal,
    parts.movementsTotal,
  ].join("|")
}
