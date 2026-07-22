import { createAdminClient } from "@/lib/supabase/admin"

const COUNTRY_ALIASES: Record<string, string[]> = {
  AR: ["argentina", "buenos aires", "cordoba", "córdoba", "rosario", "mendoza"],
  CL: ["chile", "santiago"], CO: ["colombia", "bogota", "bogotá", "medellin", "medellín"],
  MX: ["mexico", "méxico", "ciudad de mexico", "monterrey", "guadalajara"],
  PE: ["peru", "perú", "lima"], BR: ["brazil", "brasil", "sao paulo", "são paulo", "rio de janeiro"],
  UY: ["uruguay", "montevideo"], PY: ["paraguay", "asuncion", "asunción"], BO: ["bolivia", "la paz", "santa cruz"],
  EC: ["ecuador", "quito", "guayaquil"], US: ["united states", "usa", "u.s.", "san francisco", "new york", "miami", "california", "texas"],
  ES: ["spain", "españa", "madrid", "barcelona"],
}
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
const matchesCountry = (value: string | null, countries: string[]) => countries.some((iso) => (COUNTRY_ALIASES[iso] || []).some((alias) => normalize(value || "").includes(normalize(alias))))

export async function recommendAccountsForValueProposition(workspaceId: string, countries: string[], limit = 20) {
  const normalizedCountries = [...new Set(countries.map((value) => value.toUpperCase()))]
  if (!normalizedCountries.length || normalizedCountries.some((iso) => !COUNTRY_ALIASES[iso])) throw new Error(`COUNTRY_REQUIRED_OR_UNSUPPORTED:${Object.keys(COUNTRY_ALIASES).join(",")}`)
  const admin = createAdminClient()
  const [{ data: profile }, { data: tags }] = await Promise.all([
    admin.schema("v3").from("workspace_value_profiles").select("target_industries,target_technologies,target_processes").eq("workspace_id", workspaceId).maybeSingle(),
    admin.schema("v3").from("workspace_document_tags").select("tag_type,tag_value,confidence,document_id").eq("workspace_id", workspaceId),
  ])
  if (!profile) throw new Error("VALUE_PROFILE_NOT_FOUND")
  const technologies: string[] = ((profile.target_technologies as string[] | null) || []).map(normalize)
  const processes: string[] = ((profile.target_processes as string[] | null) || []).map(normalize)
  const industries: string[] = ((profile.target_industries as string[] | null) || []).map(normalize)
  const terms = [...new Set([...technologies, ...processes, ...industries])]
  if (!terms.length) throw new Error("VALUE_PROFILE_HAS_NO_TAGS")

  const [{ data: signalRows }, { data: implementations }, { data: jobs }] = await Promise.all([
    admin.from("signals").select("id,company_id,signal_type,signal_id,keyword_matched,snippet,job_posting_id,created_at").or(terms.slice(0, 60).map((term) => `keyword_matched.ilike.%${term.replace(/[%_,]/g, "")}%,snippet.ilike.%${term.replace(/[%_,]/g, "")}%`).join(",")).limit(4000),
    admin.from("company_implementations").select("id,company_id,product_name,product_category,evidence_snippet,source_url,last_seen_at").or(technologies.slice(0, 40).map((term) => `product_name.ilike.%${term.replace(/[%_,]/g, "")}%,product_category.ilike.%${term.replace(/[%_,]/g, "")}%`).join(",")).limit(2000),
    admin.from("job_postings").select("id,company_id,title,description,location,posted_date,url").or(terms.slice(0, 50).map((term) => `title.ilike.%${term.replace(/[%_,]/g, "")}%,description.ilike.%${term.replace(/[%_,]/g, "")}%`).join(",")).limit(2000),
  ])
  const companyIds = [...new Set([...(signalRows || []).map((row) => row.company_id), ...(implementations || []).map((row) => row.company_id), ...(jobs || []).map((row) => row.company_id)])]
  if (!companyIds.length) return { countries: normalizedCountries, candidates: [], coverage: { requested: limit, returned: 0 }, explanation: "No hay cuentas con evidencia suficiente para estos países y tags." }
  const { data: companies } = await admin.from("companies").select("id,name,website,country,industry").in("id", companyIds)
  const candidates = (companies || []).filter((company) => matchesCountry(company.country, normalizedCountries)).map((company) => {
    const signals = (signalRows || []).filter((row) => row.company_id === company.id).slice(0, 12)
    const impl = (implementations || []).filter((row) => row.company_id === company.id).slice(0, 8)
    const postings = (jobs || []).filter((row) => row.company_id === company.id).slice(0, 8)
    const industryMatch = industries.some((industry) => normalize(company.industry || "").includes(industry))
    const score = Math.min(100, signals.length * 8 + impl.length * 6 + postings.length * 2 + (industryMatch ? 12 : 0))
    return { company, prefilterScore: score, evidenceCounts: { signals: signals.length, implementations: impl.length, jobPostings: postings.length, industryMatch }, evidence: { signals, implementations: impl, jobPostings: postings }, interpretationGuidance: "Las señales pesan más; implementaciones son evidencia tecnológica; vacantes son indicios. Realiza el ranking fino con el contexto del usuario y cita evidencia." }
  }).filter((item) => item.prefilterScore > 0).sort((a, b) => b.prefilterScore - a.prefilterScore).slice(0, Math.min(limit, 20))
  return { countries: normalizedCountries, profile, profileEvidence: tags, candidates, coverage: { requested: Math.min(limit, 20), returned: candidates.length }, explanation: candidates.length < Math.min(limit, 20) ? "Se devolvieron menos cuentas porque no se completó con matches débiles. Sugiere ampliar países o tags." : "Top prefiltrado determinísticamente; Claude debe realizar la interpretación fina sin persistirla." }
}
