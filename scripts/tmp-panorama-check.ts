/**
 * Verificación temporal: mide el peso real del panorama y prueba el drilldown
 * contra datos de producción. Se borra al terminar.
 */
import { buildInternalAccountSnapshot, getAccountEvidenceDetail } from "../lib/v3/services/internal-account-snapshot"
import { createAdminClient } from "../lib/supabase/admin"

const WORKSPACE = "c731ba5a-aeb1-4e36-8bd5-401135566ecd"
const COMPANY = "fd18c397-f503-4a9e-9039-4ad7fe09d403"

const kb = (value: unknown) => `${(JSON.stringify(value).length / 1024).toFixed(1)} KB`

async function main() {
  const admin = createAdminClient()
  const { data: company } = await admin
    .from("companies")
    .select("id,name,normalized_name,website,country,industry")
    .eq("id", COMPANY)
    .single()

  const snapshot = await buildInternalAccountSnapshot({
    workspaceId: WORKSPACE,
    company: company as never,
    researchJobId: null,
  })

  console.log(`\n=== PANORAMA: ${snapshot.company.name} ===`)
  console.log("coverage:", JSON.stringify(snapshot.coverage))
  if (snapshot.warnings.length) console.log("warnings:", snapshot.warnings)

  // El panorama que viaja al modelo: tags sin fuentes.
  const panorama = { technologies: snapshot.technologies, processes: snapshot.processes }
  const conFuentes = snapshot.technologies.some((t) => t.sources)
  console.log(`\npanorama (tags): ${kb(panorama)}  | ¿arrastra fuentes?: ${conFuentes}`)
  console.log(`payload viejo equivalente (con vacantes completas): ${kb({ ...panorama, jobPostings: snapshot.jobPostings })}`)

  console.log("\n--- Top tecnologias (nivel / menciones / ex-empleados) ---")
  for (const t of snapshot.technologies.slice(0, 8)) {
    console.log(`  ${t.evidenceLevel.padEnd(10)} ${String(t.count).padStart(4)}  ex:${String(t.formerEmployeeMentions).padStart(4)}  ${t.term}`)
  }

  console.log("\n--- Drilldown de la tecnologia top ---")
  const top = snapshot.technologies[0]
  if (top) {
    const detail = await getAccountEvidenceDetail({
      workspaceId: WORKSPACE,
      companyId: COMPANY,
      termIds: [top.termId],
    })
    const found = detail[0]
    if (!found) {
      console.log("  FALLO: no se persistio el detalle")
    } else {
      console.log(`  ${found.term} — ${found.evidenceLevel} — ${found.mentionCount} menciones, ${found.sources.length} fuentes`)
      for (const s of found.sources.slice(0, 3)) {
        const who = s.person
          ? `${s.person.fullName ?? "?"} [${s.person.isCurrentEmployee ? "actual" : "EX"}] ${s.person.linkedinUrl ?? "sin linkedin"}`
          : s.kind
        console.log(`    · ${s.evidenceLevel} | match="${s.matchedKeyword}" | ${who}`)
      }
      const conLinkedin = found.sources.filter((s) => s.person?.linkedinUrl).length
      console.log(`  fuentes con LinkedIn: ${conLinkedin}/${found.sources.length}`)
    }
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("ERROR:", error)
  process.exit(1)
})
