import { createClient } from "@/lib/supabase/server"
import type {
  BriefContext,
  BriefContact,
  BriefJobPosting,
  BriefNews,
  BriefImplementation,
  BriefProspect,
} from "./brief-types"
import crypto from "crypto"

interface PrepareContextOptions {
  bookmarkId: string
  userId: string
  userEmail: string
}

/**
 * Prepara todo el contexto necesario para generar el brief ejecutivo
 * Recopila datos de todos los tabs del bookmark con límites definidos:
 * - Contactos Resumen: max 5
 * - Alumni: max 3
 * - Job Postings: max 3
 * - Noticias: max 3
 * - Implementaciones: max 3
 * - Prospectos: max 5
 */
export async function prepareBriefContext(options: PrepareContextOptions): Promise<BriefContext> {
  const { bookmarkId, userId, userEmail } = options
  const supabase = await createClient()

  // 1. Fetch bookmark data
  const { data: bookmark, error: bookmarkError } = await supabase
    .from("bookmarks")
    .select("*")
    .eq("id", bookmarkId)
    .eq("user_id", userId)
    .single()

  if (bookmarkError || !bookmark) {
    throw new Error("Bookmark no encontrado")
  }

  // 2. Fetch company data
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("*")
    .eq("id", bookmark.company_id)
    .single()

  if (companyError || !company) {
    throw new Error("Empresa no encontrada")
  }

  const searchContext = bookmark.search_context || {}
  const filterSignalIds: string[] = searchContext.filterSignalIds || []

  // 3. Fetch all related data in parallel
  const [
    { data: news },
    { data: implementations },
    { data: jobPostingsRaw },
    { data: prospects },
    { data: strategy },
    signalsResult,
  ] = await Promise.all([
    // Noticias (max 3)
    supabase
      .from("company_news")
      .select("id, title, summary, source_url, source_name, published_at, category")
      .eq("company_id", company.id)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(3),

    // Implementaciones (max 3)
    supabase
      .from("company_implementations")
      .select("id, title, summary, provider_name, technology, evidence_level, source_url, published_at")
      .eq("company_id", company.id)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(3),

    // Job Postings con RPC para obtener keywords detectadas (max 3)
    supabase.rpc("get_company_job_postings", {
      p_company_id: company.id,
      p_signal_ids: filterSignalIds.length > 0 ? filterSignalIds : null,
      p_limit: 3,
    }),

    // Prospectos/Decision Makers (max 5)
    supabase
      .from("user_company_contacts")
      .select(
        "id, full_name, role, email, email_status, phone, mobile_phone, linkedin_url, profile_picture_url, seniority, is_decision_maker",
      )
      .eq("bookmark_id", bookmarkId)
      .eq("user_id", userId)
      .eq("is_decision_maker", true)
      .limit(5),

    // Estrategia
    supabase
      .from("user_company_strategies")
      .select("target_summary, sender_context_override")
      .eq("bookmark_id", bookmarkId)
      .eq("user_id", userId)
      .maybeSingle(),

    // Señales de contactos
    fetchContactSignals(supabase, company.id, filterSignalIds),
  ])

  // 4. Get signal names for context
  const signalNames = await getSignalNames(supabase, filterSignalIds)

  // 5. Transform data to BriefContext format
  const briefNews: BriefNews[] = (news || []).map((n) => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    sourceUrl: n.source_url,
    sourceName: n.source_name,
    publishedAt: n.published_at,
    category: n.category,
  }))

  const briefImplementations: BriefImplementation[] = (implementations || []).map((i) => ({
    id: i.id,
    title: i.title,
    providerName: i.provider_name,
    technology: i.technology,
    summary: i.summary,
    evidenceLevel: i.evidence_level,
    sourceUrl: i.source_url,
    publishedAt: i.published_at,
  }))

  const briefJobPostings: BriefJobPosting[] = (jobPostingsRaw || []).slice(0, 3).map((jp: any) => ({
    id: jp.id,
    title: jp.title,
    postedAt: jp.posted_at,
    applyUrl: jp.apply_url,
    detectedKeywords: (jp.detected_keywords || []).map((kw: any) => kw.signal_name || kw.keyword),
    snippet: jp.description?.substring(0, 200) || null,
    isRecent: jp.is_recent || false,
  }))

  const briefProspects: BriefProspect[] = (prospects || []).map((p) => ({
    id: p.id,
    fullName: p.full_name,
    role: p.role,
    email: p.email,
    emailStatus: p.email_status,
    phone: p.mobile_phone || p.phone,
    linkedinUrl: p.linkedin_url,
    photoUrl: p.profile_picture_url,
    seniority: p.seniority,
    isDecisionMaker: p.is_decision_maker || false,
  }))

  // 6. Separate current employees and alumni, apply scoring and limits
  const { currentEmployees, alumni } = scoreAndSortContacts(signalsResult, filterSignalIds)

  // 7. Determine filter type
  let filterType: "process" | "technology" | "general" = "general"
  if (filterSignalIds.length > 0) {
    // Check if mostly processes or technologies
    const techCount = signalsResult.filter((s: any) => s.signalType === "technology").length
    const procCount = signalsResult.filter((s: any) => s.signalType === "process").length
    filterType = techCount > procCount ? "technology" : "process"
  }

  return {
    company: {
      id: company.id,
      name: company.name,
      industry: company.industry,
      country: company.country,
      website: company.website,
      description: company.description,
    },
    searchContext: {
      filterSignalIds,
      signalNames,
      filterType,
    },
    strategy: strategy
      ? {
          valueProposition: strategy.sender_context_override,
          targetSummary: strategy.target_summary,
        }
      : null,
    currentEmployees: currentEmployees.slice(0, 5), // Max 5
    alumni: alumni.slice(0, 3), // Max 3
    jobPostings: briefJobPostings,
    news: briefNews,
    implementations: briefImplementations,
    prospects: briefProspects,
    userEmail,
  }
}

/**
 * Fetch signals from contacts with full data
 */
async function fetchContactSignals(supabase: any, companyId: string, filterSignalIds: string[]) {
  let signalsQuery = supabase
    .from("signals")
    .select(`
      id,
      signal_type,
      keyword_matched,
      is_current_employee,
      signal_id,
      contacts!inner (
        id,
        full_name,
        current_position_title,
        profile_picture_url,
        linkedin_url,
        email1,
        email1_status,
        email1_type,
        email2,
        email2_status,
        email2_type,
        phone1,
        phone1_type,
        phone2
      )
    `)
    .eq("company_id", companyId)

  if (filterSignalIds.length > 0) {
    signalsQuery = signalsQuery.in("signal_id", filterSignalIds)
  }

  const { data: signalsData } = await signalsQuery.limit(100)

  if (!signalsData || signalsData.length === 0) {
    return []
  }

  // Get signal names from dictionary
  const techSignalIds = [
    ...new Set(
      signalsData
        .filter((s: any) => s.signal_type === "technology")
        .map((s: any) => s.signal_id)
        .filter(Boolean),
    ),
  ]
  const processSignalIds = [
    ...new Set(
      signalsData
        .filter((s: any) => s.signal_type === "process")
        .map((s: any) => s.signal_id)
        .filter(Boolean),
    ),
  ]

  const productMap = new Map<string, string>()
  const processMap = new Map<string, string>()

  if (techSignalIds.length > 0) {
    const { data: products } = await supabase.from("dictionary_products").select("id, name").in("id", techSignalIds)
    for (const p of products || []) {
      productMap.set(p.id, p.name)
    }
  }

  if (processSignalIds.length > 0) {
    const { data: processes } = await supabase
      .from("dictionary_processes")
      .select("id, name")
      .in("id", processSignalIds)
    for (const p of processes || []) {
      processMap.set(p.id, p.name)
    }
  }

  // Group by contact
  const contactsMap = new Map<string, any>()

  for (const signal of signalsData) {
    const contact = signal.contacts as any
    if (!contact?.id) continue

    if (!contactsMap.has(contact.id)) {
      // Determine best email (corporate > personal > any)
      let bestEmail = null
      let emailStatus = null
      let emailType = null

      if (contact.email1) {
        bestEmail = contact.email1
        emailStatus = contact.email1_status
        emailType = contact.email1_type
      }
      if (!bestEmail && contact.email2) {
        bestEmail = contact.email2
        emailStatus = contact.email2_status
        emailType = contact.email2_type
      }

      // Prioritize corporate email
      if (contact.email1_type === "professional" || contact.email1_type === "corporate") {
        bestEmail = contact.email1
        emailStatus = contact.email1_status
        emailType = "corporate"
      } else if (contact.email2_type === "professional" || contact.email2_type === "corporate") {
        bestEmail = contact.email2
        emailStatus = contact.email2_status
        emailType = "corporate"
      }

      contactsMap.set(contact.id, {
        id: contact.id,
        name: contact.full_name || "Sin nombre",
        role: contact.current_position_title || "",
        email: bestEmail,
        emailStatus,
        emailType,
        phone: contact.phone1 || contact.phone2 || null,
        linkedinUrl: contact.linkedin_url,
        photoUrl: contact.profile_picture_url,
        keywords: [],
        isCurrent: signal.is_current_employee,
        signalType: signal.signal_type,
      })
    }

    const existing = contactsMap.get(contact.id)!
    if (signal.is_current_employee) {
      existing.isCurrent = true
    }

    let keywordName =
      signal.signal_type === "technology" ? productMap.get(signal.signal_id) : processMap.get(signal.signal_id)

    if (!keywordName) keywordName = signal.keyword_matched

    if (keywordName && !existing.keywords.includes(keywordName)) {
      existing.keywords.push(keywordName)
    }
  }

  return Array.from(contactsMap.values())
}

/**
 * Get signal names from dictionary tables
 */
async function getSignalNames(supabase: any, filterSignalIds: string[]): Promise<string[]> {
  if (filterSignalIds.length === 0) return []

  const [{ data: products }, { data: processes }] = await Promise.all([
    supabase.from("dictionary_products").select("name").in("id", filterSignalIds),
    supabase.from("dictionary_processes").select("name").in("id", filterSignalIds),
  ])

  return [...(products || []).map((p: any) => p.name), ...(processes || []).map((p: any) => p.name)]
}

/**
 * Score and sort contacts by relevance:
 * - Signal match count
 * - Seniority (C-Level, Director, Manager)
 * - Data completeness (corporate email > personal email > phone > linkedin)
 */
function scoreAndSortContacts(
  contacts: any[],
  filterSignalIds: string[],
): {
  currentEmployees: BriefContact[]
  alumni: BriefContact[]
} {
  const seniorityKeywords = {
    clevel: ["ceo", "cto", "cio", "cfo", "coo", "cmo", "chief", "presidente", "president"],
    director: ["director", "directora", "vp", "vice president", "vicepresidente", "head of", "jefe de"],
    manager: ["gerente", "manager", "lead", "líder"],
    senior: ["sr", "senior", "principal"],
  }

  const scoredContacts = contacts.map((contact) => {
    let score = 0

    // Signal match score (more keywords = higher score)
    score += contact.keywords.length * 10

    // Seniority score
    const roleLower = (contact.role || "").toLowerCase()
    if (seniorityKeywords.clevel.some((kw) => roleLower.includes(kw))) {
      score += 40
    } else if (seniorityKeywords.director.some((kw) => roleLower.includes(kw))) {
      score += 30
    } else if (seniorityKeywords.manager.some((kw) => roleLower.includes(kw))) {
      score += 20
    } else if (seniorityKeywords.senior.some((kw) => roleLower.includes(kw))) {
      score += 10
    }

    // Data completeness score
    if (contact.emailType === "corporate") {
      score += 15
    } else if (contact.email) {
      score += 8
    }
    if (contact.phone) score += 5
    if (contact.linkedinUrl) score += 3

    return {
      ...contact,
      score,
      confidence: contact.emailType === "corporate" || contact.keywords.length >= 2 ? "high" : "medium",
      source: contact.isCurrent ? "signals" : "alumni",
    } as BriefContact & { score: number }
  })

  // Sort by score descending
  scoredContacts.sort((a, b) => b.score - a.score)

  // Separate current and alumni
  const currentEmployees = scoredContacts.filter((c) => c.isCurrent).map(({ score, ...rest }) => rest as BriefContact)

  const alumni = scoredContacts
    .filter((c) => !c.isCurrent)
    .map(({ score, ...rest }) => ({ ...rest, source: "alumni" as const }) as BriefContact)

  return { currentEmployees, alumni }
}

/**
 * Calculate context hash for caching
 */
export function calculateContextHash(context: BriefContext): string {
  const relevantData = {
    companyId: context.company.id,
    signalIds: context.searchContext.filterSignalIds.sort(),
    currentEmployeesIds: context.currentEmployees.map((c) => c.id).sort(),
    alumniIds: context.alumni.map((c) => c.id).sort(),
    jobPostingsIds: context.jobPostings.map((jp) => jp.id).sort(),
    newsIds: context.news.map((n) => n.id).sort(),
    implementationsIds: context.implementations.map((i) => i.id).sort(),
    prospectsIds: context.prospects.map((p) => p.id).sort(),
    strategyHash: context.strategy?.valueProposition?.substring(0, 100) || "",
  }

  return crypto.createHash("sha256").update(JSON.stringify(relevantData)).digest("hex")
}
