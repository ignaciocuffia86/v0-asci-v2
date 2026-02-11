import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { generateGeminiContent } from "@/lib/ai-service"
import { prepareBriefContext, calculateContextHash } from "@/lib/brief/prepare-brief-context"
import { calculateFitScore } from "@/lib/brief/calculate-fit-score"
import { generateBriefPrompt } from "@/lib/brief/generate-brief-prompt"
import type { BriefMetadata } from "@/lib/brief/brief-types"

// Models to try in order (primary -> fallback)
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"]

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id: bookmarkId } = await params

  let forceRegenerate = false
  try {
    const body = await req.json()
    forceRegenerate = body.force === true
  } catch {
    // No body or invalid JSON, default to false
  }

  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    if (forceRegenerate) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

      if (profile?.role !== "superadmin") {
        return NextResponse.json({ error: "Solo superadmins pueden forzar regeneración" }, { status: 403 })
      }
      console.log(`[v0] Force regenerate requested by superadmin ${user.email}`)
    }

    // Get user email
    const userEmail = user.email || "usuario@asci.app"

    console.log(`[v0] Generating brief for bookmark ${bookmarkId}...`)

    // 1. Prepare context from all bookmark tabs
    const context = await prepareBriefContext({
      bookmarkId,
      userId: user.id,
      userEmail,
    })

    // 2. Calculate context hash for caching
    const contextHash = calculateContextHash(context)

    // 3. Check if we have a cached brief with the same context
    const { data: existingBrief } = await supabase
      .from("bookmark_summaries")
      .select("*")
      .eq("bookmark_id", bookmarkId)
      .maybeSingle()

    if (!forceRegenerate && existingBrief && existingBrief.context_hash === contextHash) {
      console.log(`[v0] Returning cached brief (context unchanged)`)
      return NextResponse.json({
        success: true,
        cached: true,
        summary: existingBrief,
      })
    }

    // 4. Calculate FIT score and detect risks
    const { score: fitScore, reasons: fitReasons, risks } = calculateFitScore(context)

    console.log(`[v0] FIT Score calculated: ${fitScore}/100`)
    console.log(`[v0] Top reasons: ${fitReasons.map((r) => r.reason).join(", ")}`)
    console.log(`[v0] Risks detected: ${risks.length}`)

    // 5. Generate prompt for Gemini
    const prompt = generateBriefPrompt(context)

    // 6. Call Gemini with fallback
    let summary = ""
    let modelUsed = ""

    for (const model of GEMINI_MODELS) {
      try {
        console.log(`[v0] Trying Gemini model: ${model}`)
        summary = await generateGeminiContent(prompt, model, 0.3, 0)
        modelUsed = model
        console.log(`[v0] Successfully generated with ${model}`)
        break
      } catch (error: any) {
        console.error(`[v0] Gemini ${model} failed:`, error.message)
        if (model === GEMINI_MODELS[GEMINI_MODELS.length - 1]) {
          throw new Error(`All Gemini models failed. Last error: ${error.message}`)
        }
      }
    }

    // 7. Convert markdown to basic HTML for editing
    const htmlContent = markdownToHtml(summary)

    // 8. Build metadata
    const metadata: BriefMetadata = {
      fitScore,
      fitReasons,
      risks,
      evidence: buildEvidence(context),
      sourcesSummary: {
        signalsCount: context.currentEmployees.length + context.alumni.length,
        currentEmployeesCount: context.currentEmployees.length,
        alumniCount: context.alumni.length,
        jobPostingsCount: context.jobPostings.length,
        newsCount: context.news.length,
        implementationsCount: context.implementations.length,
        prospectsCount: context.prospects.length,
      },
      contextHash,
      generatedAt: new Date().toISOString(),
      userEmail,
    }

    // 9. Save to database
    const newVersion = (existingBrief?.version || 0) + 1

    const { data: savedSummary, error: saveError } = await supabase
      .from("bookmark_summaries")
      .upsert(
        {
          bookmark_id: bookmarkId,
          summary,
          html_content: htmlContent,
          generated_at: new Date().toISOString(),
          version: newVersion,
          fit_score: fitScore,
          fit_reasons: fitReasons,
          risks,
          evidence: metadata.evidence,
          context_hash: contextHash,
          user_email: userEmail,
          metadata: {
            ...metadata,
            model_used: modelUsed,
            company_name: context.company.name,
            company_industry: context.company.industry,
            company_country: context.company.country,
          },
        },
        {
          onConflict: "bookmark_id",
        },
      )
      .select()
      .single()

    if (saveError) {
      console.error("[v0] Error saving brief:", saveError)
      return NextResponse.json({ error: "Error guardando brief" }, { status: 500 })
    }

    console.log(`[v0] Brief saved successfully (version ${newVersion})`)

    return NextResponse.json({
      success: true,
      cached: false,
      summary: savedSummary,
    })
  } catch (error: any) {
    console.error("[v0] Error generating brief:", error)
    return NextResponse.json({ error: error.message || "Error generando brief" }, { status: 500 })
  }
}

/**
 * Simple markdown to HTML converter for the brief
 */
function markdownToHtml(markdown: string): string {
  let html = markdown
    // Headers
    .replace(/^## (.*$)/gim, '<h2 class="text-lg font-semibold mt-6 mb-2">$1</h2>')
    .replace(/^### (.*$)/gim, '<h3 class="text-base font-medium mt-4 mb-2">$1</h3>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    // Lists
    .replace(/^- (.*$)/gim, '<li class="ml-4">$1</li>')
    .replace(/^(\d+)\. (.*$)/gim, '<li class="ml-4"><span class="font-medium">$1.</span> $2</li>')
    // Confidence badges
    .replace(
      /\[Confidence: ALTO\]/g,
      '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">ALTO</span>',
    )
    .replace(
      /\[Confidence: MEDIO\]/g,
      '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">MEDIO</span>',
    )
    .replace(
      /\[Confidence: BAJO\]/g,
      '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">BAJO</span>',
    )
    // Line breaks
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>")

  // Wrap in paragraph
  html = `<div class="prose prose-sm max-w-none">${html}</div>`

  return html
}

/**
 * Build evidence array from context
 */
function buildEvidence(context: any) {
  const evidence: any[] = []

  // Add contacts as evidence
  for (const c of context.currentEmployees.slice(0, 3)) {
    evidence.push({
      type: "contact",
      title: `${c.name} - ${c.role}`,
      snippet: c.keywords.join(", "),
      linkedinUrl: c.linkedinUrl,
      confidence: "high",
      source: "signals",
    })
  }

  // Add job postings as evidence
  for (const jp of context.jobPostings.slice(0, 2)) {
    evidence.push({
      type: "job_posting",
      title: jp.title,
      snippet: jp.snippet,
      sourceUrl: jp.applyUrl,
      confidence: "medium",
      source: "job_postings",
      date: jp.postedAt,
    })
  }

  // Add news as evidence
  for (const n of context.news.slice(0, 2)) {
    evidence.push({
      type: "news",
      title: n.title,
      snippet: n.summary,
      sourceUrl: n.sourceUrl,
      confidence: "low",
      source: "news",
      date: n.publishedAt,
    })
  }

  return evidence
}
