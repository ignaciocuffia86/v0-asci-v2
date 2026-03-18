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

/**
 * POST /api/documents/process
 * Processes a document: extracts text, analyzes with AI, creates tags.
 * 
 * Body:
 *   - storagePath: string (for file uploads)
 *   - sourceUrl: string (for URL documents)
 *   - documentId: string + reprocess: true (for reprocessing)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  const body = await request.json()
  const adminClient = createAdminClient()

  try {
    // Find the document to process
    let document: any

    if (body.documentId) {
      // Find by document ID (primary method)
      const { data, error } = await supabase
        .from("user_documents")
        .select("*")
        .eq("id", body.documentId)
        .eq("user_id", user.id)
        .single()

      if (error || !data) {
        return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
      }
      document = data

      // If reprocessing, clear existing tags
      if (body.reprocess) {
        await supabase
          .from("document_tags")
          .delete()
          .eq("document_id", document.id)
          .eq("user_id", user.id)
      }
    } else if (body.storagePath) {
      // Fallback: find by storage path
      const { data, error } = await supabase
        .from("user_documents")
        .select("*")
        .eq("storage_path", body.storagePath)
        .eq("user_id", user.id)
        .single()

      if (error || !data) {
        return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
      }
      document = data

    } else if (body.sourceUrl) {
      // Fallback: find by source URL
      const { data, error } = await supabase
        .from("user_documents")
        .select("*")
        .eq("source_url", body.sourceUrl)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

      if (error || !data) {
        return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
      }
      document = data
    } else {
      return NextResponse.json({ error: "Parametros invalidos" }, { status: 400 })
    }

    console.log(`[v0] Processing document: ${document.id} (${document.type})`)

    // Update to processing
    await supabase
      .from("user_documents")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", document.id)

    // Step 1: Extract text
    let extractedText = ""

    if (document.type === "url") {
      extractedText = await extractTextFromUrl(document.source_url)
    } else {
      // Download file from Supabase Storage
      const { data: fileData, error: downloadError } = await adminClient.storage
        .from("user-documents")
        .download(document.storage_path)

      if (downloadError || !fileData) {
        throw new Error(`Failed to download file: ${downloadError?.message || "No data"}`)
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
          throw new Error(`Unsupported document type: ${document.type}`)
      }
    }

    if (!extractedText.trim()) {
      throw new Error("No se pudo extraer texto del documento")
    }

    console.log(`[v0] Extracted ${extractedText.length} chars from document ${document.id}`)

    // Save extracted text
    await supabase
      .from("user_documents")
      .update({ extracted_text: extractedText, updated_at: new Date().toISOString() })
      .eq("id", document.id)

    // Step 2: Analyze with Gemini
    const analysis = await analyzeDocument(extractedText)

    console.log(`[v0] Analysis complete: ${analysis.tags.length} tags found`)

    // Step 3: Save summary and key_results
    await supabase
      .from("user_documents")
      .update({
        ai_summary: analysis.summary,
        key_results: analysis.key_results,
        status: "ready",
        processing_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", document.id)

    // Step 4: Insert tags with master_industry_id mapping for industry tags
    if (analysis.tags.length > 0) {
      // Get industry mappings for industry tags
      const industryTagValues = analysis.tags
        .filter((t) => t.type === "industry")
        .map((t) => t.value.toLowerCase().trim())

      let industryMappings: Record<string, string> = {}
      
      if (industryTagValues.length > 0) {
        const { data: mappings } = await supabase
          .from("industry_mappings")
          .select("original_value, master_industry_id")
          .eq("source_type", "document")
          .in("original_value", industryTagValues.map(v => v.toLowerCase()))

        if (mappings) {
          industryMappings = mappings.reduce((acc, m) => {
            acc[m.original_value.toLowerCase()] = m.master_industry_id
            return acc
          }, {} as Record<string, string>)
        }
      }

      const tagRows = analysis.tags.map((tag) => ({
        document_id: document.id,
        user_id: user.id,
        tag_type: tag.type,
        tag_value: tag.value,
        tag_reference_id: tag.reference_id,
        confidence: tag.confidence,
        // Add master_industry_id for industry tags if mapping exists
        master_industry_id: tag.type === "industry" 
          ? industryMappings[tag.value.toLowerCase().trim()] || null
          : null,
      }))

      const { error: tagsError } = await supabase
        .from("document_tags")
        .insert(tagRows)

      if (tagsError) {
        console.error("[v0] Error inserting tags:", tagsError)
      }
    }

    console.log(`[v0] Document ${document.id} processed successfully`)

    return NextResponse.json({ success: true, documentId: document.id })

  } catch (err: any) {
    console.error(`[v0] Document processing error:`, err)

    // Try to update document status to error
    if (body.documentId || body.storagePath || body.sourceUrl) {
      try {
        let docId = body.documentId
        if (!docId) {
          const field = body.storagePath ? "storage_path" : "source_url"
          const value = body.storagePath || body.sourceUrl
          const { data } = await supabase
            .from("user_documents")
            .select("id")
            .eq(field, value)
            .eq("user_id", user.id)
            .single()
          docId = data?.id
        }
        if (docId) {
          await supabase
            .from("user_documents")
            .update({
              status: "error",
              processing_error: err.message?.slice(0, 500) || "Error desconocido",
              updated_at: new Date().toISOString(),
            })
            .eq("id", docId)
        }
      } catch {
        // ignore cleanup errors
      }
    }

    return NextResponse.json(
      { error: err.message || "Error processing document" },
      { status: 500 },
    )
  }
}
