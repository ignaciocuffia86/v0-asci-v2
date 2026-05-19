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
 * POST /api/v3/documents/process
 * Processes a workspace document: extracts text, analyzes with AI, creates tags.
 * 
 * Reutiliza las funciones de extraccion y analisis de v2.
 * La diferencia es que trabaja con v3.workspace_documents y v3.workspace_document_tags
 * y descarga archivos desde Vercel Blob en lugar de Supabase Storage.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  const body = await request.json()
  const { documentId, reprocess } = body

  if (!documentId) {
    return NextResponse.json({ error: "documentId requerido" }, { status: 400 })
  }

  const adminClient = createAdminClient()

  try {
    // Find the document - must belong to a workspace the user is member of
    const { data: document, error: docError } = await adminClient
      .schema("v3")
      .from("workspace_documents")
      .select(`
        *,
        workspace:workspaces!workspace_id (
          id,
          domain
        )
      `)
      .eq("id", documentId)
      .single()

    if (docError || !document) {
      console.error("[v0] Document not found:", docError)
      return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
    }

    // Verify user has access to this workspace
    const { data: membership } = await adminClient
      .schema("v3")
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", document.workspace_id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single()

    if (!membership) {
      return NextResponse.json({ error: "Sin acceso al workspace" }, { status: 403 })
    }

    console.log(`[v0] Processing v3 document: ${document.id} (${document.type})`)

    // If reprocessing, clear existing tags
    if (reprocess) {
      await adminClient
        .schema("v3")
        .from("workspace_document_tags")
        .delete()
        .eq("document_id", document.id)
    }

    // Update status to processing
    await adminClient
      .schema("v3")
      .from("workspace_documents")
      .update({ 
        status: "processing",
        processing_progress: 10,
        updated_at: new Date().toISOString() 
      })
      .eq("id", document.id)

    // Step 1: Extract text (reutiliza funciones de v2)
    let extractedText = ""

    if (document.type === "url") {
      extractedText = await extractTextFromUrl(document.source_url)
    } else {
      // Download file from Vercel Blob (storage_path is the blob URL)
      if (!document.storage_path) {
        throw new Error("No storage path for document")
      }
      
      console.log(`[v0] Downloading from Vercel Blob: ${document.storage_path}`)
      const fileResponse = await fetch(document.storage_path)
      
      if (!fileResponse.ok) {
        throw new Error(`Failed to download file from Blob: ${fileResponse.status}`)
      }

      const buffer = Buffer.from(await fileResponse.arrayBuffer())

      // Update progress: file downloaded
      await adminClient
        .schema("v3")
        .from("workspace_documents")
        .update({ processing_progress: 30 })
        .eq("id", document.id)

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

    console.log(`[v0] Extracted ${extractedText.length} chars from v3 document ${document.id}`)

    // Update progress: text extracted
    await adminClient
      .schema("v3")
      .from("workspace_documents")
      .update({ 
        extracted_text: extractedText,
        processing_progress: 50,
        updated_at: new Date().toISOString() 
      })
      .eq("id", document.id)

    // Step 2: Analyze with Gemini (reutiliza funcion de v2)
    const analysis = await analyzeDocument(extractedText)

    console.log(`[v0] Analysis complete: ${analysis.tags.length} tags found`)

    // Update progress: analysis complete
    await adminClient
      .schema("v3")
      .from("workspace_documents")
      .update({ processing_progress: 80 })
      .eq("id", document.id)

    // Step 3: Save summary
    await adminClient
      .schema("v3")
      .from("workspace_documents")
      .update({
        ai_summary: analysis.summary,
        status: "ready",
        processing_progress: 100,
        processing_error: null,
        version: (document.version || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", document.id)

    // Step 4: Insert tags into v3.workspace_document_tags
    if (analysis.tags.length > 0) {
      const tagRows = analysis.tags.map((tag) => ({
        document_id: document.id,
        workspace_id: document.workspace_id,
        tag_type: tag.type,
        tag_value: tag.value,
        tag_reference_id: tag.reference_id || null,
        confidence: tag.confidence,
      }))

      const { error: tagsError } = await adminClient
        .schema("v3")
        .from("workspace_document_tags")
        .insert(tagRows)

      if (tagsError) {
        console.error("[v0] Error inserting v3 tags:", tagsError)
      }
    }

    // Step 5: Update workspace value profile
    await updateWorkspaceValueProfile(adminClient, document.workspace_id)

    console.log(`[v0] V3 Document ${document.id} processed successfully`)

    return NextResponse.json({ success: true, documentId: document.id })

  } catch (err: any) {
    console.error(`[v0] V3 Document processing error:`, err)

    // Update document status to error
    try {
      await adminClient
        .schema("v3")
        .from("workspace_documents")
        .update({
          status: "error",
          processing_progress: 0,
          processing_error: err.message?.slice(0, 500) || "Error desconocido",
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId)
    } catch {
      // ignore cleanup errors
    }

    return NextResponse.json(
      { error: err.message || "Error processing document" },
      { status: 500 },
    )
  }
}

/**
 * Actualiza el value profile del workspace consolidando todos los tags de documentos
 */
async function updateWorkspaceValueProfile(
  adminClient: ReturnType<typeof createAdminClient>,
  workspaceId: string
) {
  try {
    // Get all tags for this workspace
    const { data: allTags } = await adminClient
      .schema("v3")
      .from("workspace_document_tags")
      .select("tag_type, tag_value, confidence")
      .eq("workspace_id", workspaceId)
      .order("confidence", { ascending: false })

    if (!allTags || allTags.length === 0) return

    // Consolidate by type
    const industries = new Set<string>()
    const technologies = new Set<string>()
    const processes = new Set<string>()

    for (const tag of allTags) {
      if (tag.tag_type === "industry") industries.add(tag.tag_value)
      if (tag.tag_type === "technology") technologies.add(tag.tag_value)
      if (tag.tag_type === "process") processes.add(tag.tag_value)
    }

    // Upsert value profile
    await adminClient
      .schema("v3")
      .from("workspace_value_profiles")
      .upsert({
        workspace_id: workspaceId,
        target_industries: Array.from(industries),
        target_technologies: Array.from(technologies),
        target_processes: Array.from(processes),
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "workspace_id"
      })

  } catch (err) {
    console.error("[v0] Error updating workspace value profile:", err)
  }
}
