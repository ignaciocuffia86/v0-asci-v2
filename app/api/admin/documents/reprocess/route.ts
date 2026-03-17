import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  extractTextFromPdf,
  extractTextFromDocx,
  extractTextFromPptx,
  extractTextFromUrl,
} from "@/lib/documents/extract-text"
import { analyzeDocument } from "@/lib/documents/analyze-document"

async function isAdmin(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single()
  return data?.role === "admin" || data?.role === "superadmin"
}

/**
 * POST /api/admin/documents/reprocess
 * Admin-only: reprocesses a single document by ID (any user's doc).
 * Body: { documentId: string }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !(await isAdmin(supabase, user.id))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  const { documentId } = await request.json()
  if (!documentId) {
    return NextResponse.json({ error: "documentId requerido" }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { data: document, error } = await adminClient
    .from("user_documents")
    .select("*")
    .eq("id", documentId)
    .single()

  if (error || !document) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
  }

  try {
    // Clear existing tags
    await adminClient.from("document_tags").delete().eq("document_id", documentId)

    // Mark as processing
    await adminClient
      .from("user_documents")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", documentId)

    // Extract text
    let extractedText = ""
    if (document.type === "url") {
      extractedText = await extractTextFromUrl(document.source_url)
    } else {
      const { data: fileData, error: downloadError } = await adminClient.storage
        .from("user-documents")
        .download(document.storage_path)

      if (downloadError || !fileData) {
        throw new Error(`Failed to download: ${downloadError?.message}`)
      }

      const buffer = Buffer.from(await fileData.arrayBuffer())
      switch (document.type) {
        case "pdf":
          extractedText = await extractTextFromPdf(buffer)
          break
        case "docx":
          extractedText = await extractTextFromDocx(buffer)
          break
        case "pptx":
          extractedText = await extractTextFromPptx(buffer)
          break
        default:
          throw new Error(`Unsupported type: ${document.type}`)
      }
    }

    if (!extractedText.trim()) throw new Error("No text extracted")

    const analysis = await analyzeDocument(extractedText)

    await adminClient
      .from("user_documents")
      .update({
        extracted_text: extractedText,
        ai_summary: analysis.summary,
        status: "ready",
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)

    // Re-insert tags with master_industry_id
    if (analysis.tags.length > 0) {
      const industryTagValues = analysis.tags
        .filter((t) => t.type === "industry")
        .map((t) => t.value.toLowerCase().trim())

      let industryMappings: Record<string, string> = {}
      if (industryTagValues.length > 0) {
        const { data: mappings } = await adminClient
          .from("industry_mappings")
          .select("original_value, master_industry_id")
          .eq("source_type", "document")
          .in("original_value", industryTagValues)

        if (mappings) {
          industryMappings = mappings.reduce(
            (acc, m) => {
              acc[m.original_value.toLowerCase()] = m.master_industry_id
              return acc
            },
            {} as Record<string, string>,
          )
        }
      }

      await adminClient.from("document_tags").insert(
        analysis.tags.map((tag) => ({
          document_id: documentId,
          user_id: document.user_id,
          tag_type: tag.type,
          tag_value: tag.value,
          tag_reference_id: tag.reference_id,
          confidence: tag.confidence,
          master_industry_id:
            tag.type === "industry"
              ? industryMappings[tag.value.toLowerCase().trim()] || null
              : null,
        })),
      )
    }

    return NextResponse.json({ success: true, tagsCount: analysis.tags.length })
  } catch (err: any) {
    await adminClient
      .from("user_documents")
      .update({
        status: "error",
        processing_error: err.message?.slice(0, 500) || "Error desconocido",
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)

    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * GET /api/admin/documents/reprocess
 * Returns all user_documents with their tag counts for the admin UI.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || !(await isAdmin(supabase, user.id))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  const adminClient = createAdminClient()

  const { data: docs } = await adminClient
    .from("user_documents")
    .select("id, title, type, status, ai_summary, created_at, user_id, processing_error")
    .order("created_at", { ascending: false })

  // Get tag counts per document using a raw aggregate to avoid Supabase's 1000-row default limit
  const { data: tagCounts } = await adminClient
    .rpc("get_document_tag_counts")

  const countMap: Record<string, number> = {}
  for (const t of tagCounts || []) {
    countMap[t.document_id] = t.tag_count
  }

  const result = (docs || []).map((d) => ({
    ...d,
    tag_count: countMap[d.id] || 0,
  }))

  return NextResponse.json({ documents: result })
}
