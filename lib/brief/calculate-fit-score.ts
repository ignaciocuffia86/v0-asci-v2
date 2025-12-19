import type { BriefContext, FitReason, Risk } from "./brief-types"
import { REGULATED_SECTORS, DECISION_MAKER_TITLES, SENIOR_TITLES } from "./brief-types"

interface FitScoreResult {
  score: number
  reasons: FitReason[]
  risks: Risk[]
}

/**
 * Calcula el FIT Score (0-100) basado en el contexto del bookmark
 *
 * Ponderación:
 * - Match de señales con búsqueda (40%)
 * - Contactos relevantes vs propuesta de valor (25%)
 * - Calidad de datos de contacto (20%)
 * - Recencia de señales (15%)
 */
export function calculateFitScore(context: BriefContext): FitScoreResult {
  let score = 0
  const reasons: FitReason[] = []
  const risks: Risk[] = []

  const { currentEmployees, alumni, jobPostings, news, implementations, prospects, strategy, searchContext, company } =
    context

  // 1. Match de señales con búsqueda (40 puntos max)
  const signalMatchScore = calculateSignalMatchScore(currentEmployees, alumni, searchContext.signalNames, reasons)
  score += Math.min(40, signalMatchScore)

  // 2. Contactos relevantes vs propuesta de valor (25 puntos max)
  const contactRelevanceScore = calculateContactRelevanceScore(
    currentEmployees,
    prospects,
    strategy?.valueProposition,
    searchContext.signalNames,
    reasons,
  )
  score += Math.min(25, contactRelevanceScore)

  // 3. Calidad de datos de contacto (20 puntos max)
  const dataQualityScore = calculateDataQualityScore(currentEmployees, prospects, reasons, risks)
  score += Math.min(20, dataQualityScore)

  // 4. Recencia de señales (15 puntos max)
  const recencyScore = calculateRecencyScore(jobPostings, news, reasons)
  score += Math.min(15, recencyScore)

  // Boosters: Noticias de inversión, expansión, etc.
  const boosterScore = calculateBoosterScore(news, implementations, reasons)
  if (boosterScore > 0) {
    score = Math.min(100, score + boosterScore)
  }

  // Detectar riesgos
  detectRisks(context, risks)

  // Verificar si falta estrategia definida
  if (!strategy?.valueProposition) {
    risks.push({
      type: "no_strategy",
      description: "Falta definir una propuesta de valor para la cuenta",
      confidence: "high",
      source: "strategy",
      mitigation: "Completa el tab de Estrategia con tu propuesta de valor",
    })
  }

  // Ordenar razones por evidencia y tomar top 3
  const topReasons = reasons.sort((a, b) => b.evidenceCount - a.evidenceCount).slice(0, 3)

  return {
    score: Math.round(score),
    reasons: topReasons,
    risks,
  }
}

function calculateSignalMatchScore(
  currentEmployees: BriefContext["currentEmployees"],
  alumni: BriefContext["alumni"],
  signalNames: string[],
  reasons: FitReason[],
): number {
  if (signalNames.length === 0) {
    // Búsqueda general, dar puntos por cantidad de señales
    const totalSignals = currentEmployees.length + alumni.length
    if (totalSignals > 0) {
      reasons.push({
        reason: `${totalSignals} personas con señales detectadas en la empresa`,
        source: "signals",
        confidence: "high",
        evidenceCount: totalSignals,
      })
    }
    return Math.min(40, totalSignals * 4)
  }

  // Contar personas que tienen keywords que matchean con la búsqueda
  let matchCount = 0
  const matchedKeywords = new Set<string>()

  for (const employee of currentEmployees) {
    for (const keyword of employee.keywords) {
      const keywordLower = keyword.toLowerCase()
      for (const signal of signalNames) {
        if (keywordLower.includes(signal.toLowerCase()) || signal.toLowerCase().includes(keywordLower)) {
          matchCount++
          matchedKeywords.add(keyword)
          break
        }
      }
    }
  }

  if (matchCount > 0) {
    reasons.push({
      reason: `${matchCount} personas nombran "${Array.from(matchedKeywords).slice(0, 3).join(", ")}" en su perfil`,
      source: "signals",
      confidence: "high",
      evidenceCount: matchCount,
    })
  }

  // Considerar también alumni
  const alumniCount = alumni.length
  if (alumniCount > 0) {
    reasons.push({
      reason: `${alumniCount} ex-empleados con experiencia en las señales buscadas (posibles referentes)`,
      source: "signals",
      confidence: "medium",
      evidenceCount: alumniCount,
    })
  }

  const totalMatches = matchCount + alumniCount * 0.5
  return totalMatches * 5
}

function calculateContactRelevanceScore(
  currentEmployees: BriefContext["currentEmployees"],
  prospects: BriefContext["prospects"],
  valueProposition: string | null | undefined,
  signalNames: string[],
  reasons: FitReason[],
): number {
  let score = 0

  // Analizar si los cargos de prospects/signals coinciden con la propuesta
  const allContacts = [
    ...currentEmployees.map((e) => ({ role: e.role, name: e.name })),
    ...prospects.map((p) => ({ role: p.role || "", name: p.fullName })),
  ]

  // Contar decision makers
  const decisionMakers = allContacts.filter((c) => {
    const roleLower = c.role.toLowerCase()
    return DECISION_MAKER_TITLES.some((title) => roleLower.includes(title))
  })

  if (decisionMakers.length > 0) {
    score += decisionMakers.length * 5
    reasons.push({
      reason: `${decisionMakers.length} tomadores de decisión identificados (${decisionMakers
        .slice(0, 2)
        .map((d) => d.name)
        .join(", ")})`,
      source: "prospects",
      confidence: "high",
      evidenceCount: decisionMakers.length,
    })
  }

  // Contar seniors
  const seniors = allContacts.filter((c) => {
    const roleLower = c.role.toLowerCase()
    return (
      SENIOR_TITLES.some((title) => roleLower.includes(title)) &&
      !DECISION_MAKER_TITLES.some((title) => roleLower.includes(title))
    )
  })

  if (seniors.length > 0) {
    score += seniors.length * 2
  }

  // Si hay propuesta de valor, analizar relevancia
  if (valueProposition && valueProposition.length > 20) {
    const propLower = valueProposition.toLowerCase()

    // Buscar keywords de la propuesta en los roles de contactos
    const relevantContacts = allContacts.filter((c) => {
      const roleLower = c.role.toLowerCase()
      // Extraer palabras clave de la propuesta (más de 4 caracteres)
      const propKeywords = propLower.split(/\s+/).filter((w) => w.length > 4)
      return propKeywords.some((kw) => roleLower.includes(kw))
    })

    if (relevantContacts.length > 0) {
      score += relevantContacts.length * 3
    }
  }

  return score
}

function calculateDataQualityScore(
  currentEmployees: BriefContext["currentEmployees"],
  prospects: BriefContext["prospects"],
  reasons: FitReason[],
  risks: Risk[],
): number {
  let score = 0

  const allContacts = [
    ...currentEmployees,
    ...prospects.map((p) => ({
      email: p.email,
      emailType: p.emailStatus === "verified" ? "corporate" : "personal",
      phone: p.phone,
      linkedinUrl: p.linkedinUrl,
    })),
  ]

  if (allContacts.length === 0) {
    risks.push({
      type: "incomplete_data",
      description: "No hay contactos con datos de contacto disponibles",
      confidence: "high",
      source: "contacts",
      mitigation: "Se recomienda buscar tomadores de decisión tanto dentro de ASCI como por fuera",
    })
    return 0
  }

  // Contar emails corporativos
  const corporateEmails = allContacts.filter(
    (c) => c.email && (c.emailType === "corporate" || c.emailType === "professional"),
  ).length

  // Contar cualquier email
  const anyEmail = allContacts.filter((c) => c.email).length

  // Contar teléfonos
  const withPhone = allContacts.filter((c) => c.phone).length

  // Contar LinkedIn
  const withLinkedIn = allContacts.filter((c) => c.linkedinUrl).length

  // Puntuar: email corporativo vale más
  score += corporateEmails * 4
  score += (anyEmail - corporateEmails) * 2
  score += withPhone * 2
  score += withLinkedIn * 1

  // Agregar razón si hay buena calidad de datos
  const completeness = (corporateEmails + anyEmail + withPhone) / (allContacts.length * 3)
  if (completeness > 0.5) {
    reasons.push({
      reason: `${anyEmail} contactos con email y ${withPhone} con teléfono disponible`,
      source: "prospects",
      confidence: "high",
      evidenceCount: anyEmail + withPhone,
    })
  } else if (completeness < 0.3) {
    risks.push({
      type: "incomplete_data",
      description: "Falta de datos de contacto en prospectos identificados",
      confidence: "medium",
      source: "prospects",
      mitigation: "Considerar enrichment de contactos o búsqueda adicional en Apollo",
    })
  }

  return score
}

function calculateRecencyScore(
  jobPostings: BriefContext["jobPostings"],
  news: BriefContext["news"],
  reasons: FitReason[],
): number {
  let score = 0
  const now = new Date()
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

  // Job postings recientes
  const recentJobPostings = jobPostings.filter((jp) => {
    if (!jp.postedAt) return false
    return new Date(jp.postedAt) > threeMonthsAgo
  })

  if (recentJobPostings.length > 0) {
    score += recentJobPostings.length * 3
    reasons.push({
      reason: `${recentJobPostings.length} posiciones abiertas mencionan las señales buscadas (últimos 3 meses)`,
      source: "job_postings",
      confidence: "medium",
      evidenceCount: recentJobPostings.length,
      snippet: recentJobPostings[0]?.title,
    })
  }

  // Noticias recientes
  const recentNews = news.filter((n) => {
    if (!n.publishedAt) return false
    return new Date(n.publishedAt) > threeMonthsAgo
  })

  if (recentNews.length > 0) {
    score += recentNews.length * 2
  }

  return score
}

function calculateBoosterScore(
  news: BriefContext["news"],
  implementations: BriefContext["implementations"],
  reasons: FitReason[],
): number {
  let boosterScore = 0

  // Categorías de noticias que son boosters
  const boosterCategories = ["inversion", "transformacion", "crecimiento", "alianzas"]

  const boosterNews = news.filter((n) => n.category && boosterCategories.includes(n.category.toLowerCase()))

  if (boosterNews.length > 0) {
    boosterScore += boosterNews.length * 3
    reasons.push({
      reason: `Noticias de ${boosterNews.map((n) => n.category).join(", ")} indican momento de inversión`,
      source: "news",
      confidence: "low",
      evidenceCount: boosterNews.length,
      snippet: boosterNews[0]?.title,
    })
  }

  // Implementaciones recientes también son boosters
  if (implementations.length > 0) {
    boosterScore += implementations.length * 2
  }

  return boosterScore
}

function detectRisks(context: BriefContext, risks: Risk[]): void {
  const { company, currentEmployees, prospects } = context

  // 1. Detectar sector regulado
  if (company.industry) {
    const industryLower = company.industry.toLowerCase()
    const isRegulated = REGULATED_SECTORS.some((sector) => industryLower.includes(sector))

    if (isRegulated) {
      risks.push({
        type: "regulated_sector",
        description: `Sector regulado (${company.industry}): posible burocracia o requisitos de compliance`,
        confidence: "high",
        source: "company",
        mitigation: "Recomendación: approach desde legales o demostrar seguridad/cumplimiento normativo primero",
      })
    }
  }

  // 2. Falta de decision makers
  const decisionMakerCount = prospects.filter((p) => p.isDecisionMaker).length
  const hasDecisionMakers =
    decisionMakerCount > 0 ||
    currentEmployees.some((e) => {
      const roleLower = e.role.toLowerCase()
      return DECISION_MAKER_TITLES.some((title) => roleLower.includes(title))
    })

  if (!hasDecisionMakers) {
    risks.push({
      type: "missing_decision_makers",
      description: "No se identificaron tomadores de decisión de nivel C-Level o directivo",
      confidence: "medium",
      source: "prospects",
      mitigation: "Se recomienda buscar tomadores de decisión tanto dentro de ASCI como por fuera",
    })
  }
}
