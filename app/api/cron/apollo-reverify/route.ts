import { NextResponse } from "next/server"
import { assertCron } from "@/lib/cron-auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { apolloRequest } from "@/lib/apollo/client"
import { normalizePerson } from "@/lib/apollo/parsers"

export const dynamic = "force-dynamic"
export const maxDuration = 300 // 5 min

// Cron de re-verify: cada 24h re-enriquece una batch de contactos
// con last_verified_at > 90 días, y marca needs_review si:
//  - cambió de empresa (apollo.organization.domain != company.domain)
//  - email dejó de estar verified
//  - la persona ya no existe en Apollo
//
// Config: vercel.json cron "0 4 * * *" → /api/cron/apollo-reverify
export async function GET(request: Request) {
  const denied = assertCron(request)
  if (denied) return denied

  const supabase = createAdminClient()
  const batchSize = 50

  // Lee candidatos desde la vista
  const { data: candidates, error: candErr } = await supabase
    .from("apollo_reverify_candidates")
    .select("id, apollo_person_id, linkedin_url, email, role, last_verified_at, company_id")
    .limit(batchSize)

  if (candErr) {
    return NextResponse.json({ ok: false, error: candErr.message }, { status: 500 })
  }

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: "No candidates" })
  }

  let verified = 0
  let flagged = 0
  let errors = 0

  for (const c of candidates) {
    try {
      if (!c.apollo_person_id) {
        // No podemos reverificar sin apollo_id; marcamos needs_review
        await supabase
          .from("user_company_contacts")
          .update({
            needs_review: true,
            review_reason: "missing_apollo_id",
            last_verified_at: new Date().toISOString(),
          })
          .eq("id", c.id)
        flagged++
        continue
      }

      const matchResult = await apolloRequest<{ person: unknown }>({
        endpoint: "people/match",
        userId: null,
        companyId: c.company_id ?? null,
        requestBody: { id: c.apollo_person_id },
      })

      if (!matchResult.ok) {
        errors++
        continue
      }

      const person = normalizePerson(matchResult.data.person as Record<string, unknown>)
      if (!person) {
        await supabase
          .from("user_company_contacts")
          .update({
            needs_review: true,
            review_reason: "person_not_found",
            last_verified_at: new Date().toISOString(),
          })
          .eq("id", c.id)
        flagged++
        continue
      }

      // Detectar cambio de empresa: comparar organization_id contra el cache
      const { data: cacheEntry } = await supabase
        .from("apollo_contacts_cache")
        .select("organization_id, company_domain")
        .eq("apollo_id", c.apollo_person_id)
        .maybeSingle()

      const movedCompany =
        cacheEntry?.organization_id &&
        person.organizationId &&
        cacheEntry.organization_id !== person.organizationId

      const reviewReason = movedCompany ? "changed_company" : null

      await supabase
        .from("user_company_contacts")
        .update({
          role: person.title ?? c.role,
          email: person.email ?? c.email,
          email_status: person.emailStatus,
          last_verified_at: new Date().toISOString(),
          needs_review: !!reviewReason,
          review_reason: reviewReason,
        })
        .eq("id", c.id)

      verified++
    } catch (err) {
      console.error("[cron] reverify error for contact", c.id, err)
      errors++
    }
  }

  return NextResponse.json({
    ok: true,
    processed: candidates.length,
    verified,
    flagged,
    errors,
  })
}
