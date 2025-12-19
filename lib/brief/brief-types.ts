// Tipos para el sistema de Brief Ejecutivo v2

export type ConfidenceLevel = "high" | "medium" | "low"

export interface BriefContact {
  id: string
  name: string
  role: string
  email: string | null
  emailStatus: string | null
  emailType: string | null // 'corporate' | 'personal'
  phone: string | null
  linkedinUrl: string | null
  photoUrl: string | null
  keywords: string[]
  isCurrent: boolean
  source: "signals" | "prospects" | "alumni"
  confidence: ConfidenceLevel
}

export interface BriefJobPosting {
  id: string
  title: string
  postedAt: string
  applyUrl: string | null
  detectedKeywords: string[]
  snippet: string | null
  isRecent: boolean
}

export interface BriefNews {
  id: string
  title: string
  summary: string | null
  sourceUrl: string | null
  sourceName: string | null
  publishedAt: string | null
  category: string | null
}

export interface BriefImplementation {
  id: string
  title: string
  providerName: string | null
  technology: string | null
  summary: string | null
  evidenceLevel: string | null
  sourceUrl: string | null
  publishedAt: string | null
}

export interface BriefProspect {
  id: string
  fullName: string
  role: string | null
  email: string | null
  emailStatus: string | null
  phone: string | null
  linkedinUrl: string | null
  photoUrl: string | null
  seniority: string | null
  isDecisionMaker: boolean
}

export interface FitReason {
  reason: string
  source: "signals" | "job_postings" | "news" | "implementations" | "prospects" | "strategy"
  confidence: ConfidenceLevel
  evidenceCount: number
  snippet?: string
}

export interface Risk {
  type: "incumbent_provider" | "missing_decision_makers" | "regulated_sector" | "incomplete_data" | "no_strategy"
  description: string
  confidence: ConfidenceLevel
  source: string
  mitigation?: string
}

export interface Evidence {
  type: "contact" | "job_posting" | "news" | "implementation"
  title: string
  snippet?: string
  sourceUrl?: string
  linkedinUrl?: string
  confidence: ConfidenceLevel
  source: "signals" | "job_postings" | "news" | "implementations" | "prospects"
  date?: string
}

export interface BriefContext {
  // Company info
  company: {
    id: string
    name: string
    industry: string | null
    country: string | null
    website: string | null
    description: string | null
  }

  // Search context (filtros usados al crear el bookmark)
  searchContext: {
    filterSignalIds: string[]
    signalNames: string[]
    filterType: "process" | "technology" | "general"
  }

  // Strategy (Tab Estrategia)
  strategy: {
    valueProposition: string | null
    targetSummary: string | null
  } | null

  // Contacts from Resumen (max 5)
  currentEmployees: BriefContact[]

  // Alumni (max 3)
  alumni: BriefContact[]

  // Job Postings (max 3)
  jobPostings: BriefJobPosting[]

  // News (max 3)
  news: BriefNews[]

  // Implementations (max 3)
  implementations: BriefImplementation[]

  // Prospects/Decision Makers (max 5)
  prospects: BriefProspect[]

  // User info
  userEmail: string
}

export interface BriefMetadata {
  fitScore: number
  fitReasons: FitReason[]
  risks: Risk[]
  evidence: Evidence[]
  sourcesSummary: {
    signalsCount: number
    currentEmployeesCount: number
    alumniCount: number
    jobPostingsCount: number
    newsCount: number
    implementationsCount: number
    prospectsCount: number
  }
  contextHash: string
  generatedAt: string
  userEmail: string
}

export interface GeneratedBrief {
  id: string
  bookmarkId: string
  summary: string
  htmlContent: string
  metadata: BriefMetadata
  version: number
  generatedAt: string
}

// Sectores regulados que requieren approach de compliance
export const REGULATED_SECTORS = [
  "gobierno",
  "government",
  "public sector",
  "sector público",
  "salud",
  "health",
  "healthcare",
  "finanzas",
  "finance",
  "banking",
  "banca",
  "seguros",
  "insurance",
  "farmacéutica",
  "pharmaceutical",
  "educación",
  "education",
  "energía",
  "energy",
  "utilities",
  "telecomunicaciones",
  "telecommunications",
  "defensa",
  "defense",
  "ong",
  "ngo",
  "non-profit",
]

// Títulos de C-Level y decision makers
export const DECISION_MAKER_TITLES = [
  "ceo",
  "cto",
  "cio",
  "cfo",
  "coo",
  "cmo",
  "cpo",
  "chief",
  "presidente",
  "president",
  "vp",
  "vice president",
  "vicepresidente",
  "director",
  "directora",
  "gerente general",
  "general manager",
  "head of",
  "jefe de",
  "líder de",
  "partner",
  "socio",
]

// Títulos de seniority medio-alto
export const SENIOR_TITLES = [
  "gerente",
  "manager",
  "sr",
  "senior",
  "lead",
  "líder",
  "principal",
  "architect",
  "arquitecto",
  "specialist",
  "especialista",
]
