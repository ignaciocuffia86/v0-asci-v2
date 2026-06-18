import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  extractTextFromPdf,
  extractTextFromDocx,
  extractTextFromPptx,
  extractTextFromUrl,
} from "@/lib/documents/extract-text"
import { analyzeDocumentV3 } from "@/lib/v3/ai"

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

    // Step 2: Load dictionaries and analyze with AI Gateway
    // Fetch dictionaries from v2 tables (shared).
    // Industries use the canonical master_industries taxonomy (id = slug, name = name_es)
    // so that document tags align with companies.master_industry_id for recommendation filtering.
    const [{ data: products }, { data: processes }, { data: masterIndustries }, { data: industryMappings }] =
      await Promise.all([
        adminClient.from("dictionary_products").select("id, name").limit(500),
        adminClient.from("dictionary_processes").select("id, name").limit(500),
        adminClient.from("master_industries").select("id, name_es").order("display_order"),
        // Curated alias -> master_industry_id rules for documents (same source of truth used by companies).
        adminClient
          .from("industry_mappings")
          .select("original_value, master_industry_id")
          .eq("source_type", "document")
          .not("master_industry_id", "is", null),
      ])

    const industries = (masterIndustries || []).map((i: any) => ({ id: i.id, name: i.name_es }))

    const analysis = await analyzeDocumentV3(extractedText, {
      technologies: (products || []) as { id: string; name: string }[],
      processes: (processes || []) as { id: string; name: string }[],
      industries: industries as { id: string; name: string }[],
      industryMappings: (industryMappings || []) as { original_value: string; master_industry_id: string }[],
    })

    console.log(`[v0] Analysis complete: ${analysis.tags.length} tags found`)

    // Update progress: analysis complete
    await adminClient
      .schema("v3")
      .from("workspace_documents")
      .update({ processing_progress: 80 })
      .eq("id", document.id)

    // Step 3: Save summary (stored as JSON so the UI can parse structured fields)
    await adminClient
      .schema("v3")
      .from("workspace_documents")
      .update({
        ai_summary: JSON.stringify({
          summary: analysis.summary,
          key_results: analysis.key_results,
          insights: analysis.insights,
          document_type: analysis.document_type,
        }),
        inferred_persona: analysis.persona,
        recommended_job_titles: analysis.recommended_job_titles,
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

    // Step 6: Consolidate auto-managed buyer persona from all docs in the workspace
    await upsertAutoBuyerPersona(adminClient, document.workspace_id)

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

/**
 * Consolida una persona AUTO-GESTIONADA por workspace a partir de las personas
 * y cargos inferidos en todos los documentos `ready`.
 *
 * - Hace upsert sobre la fila is_auto = true (índice único parcial por workspace).
 * - NUNCA toca las personas creadas manualmente por el usuario (is_auto = false).
 */
async function upsertAutoBuyerPersona(
  adminClient: ReturnType<typeof createAdminClient>,
  workspaceId: string
) {
  try {
    // Get persona + job title signals from all ready docs in the workspace
    const { data: docs } = await adminClient
      .schema("v3")
      .from("workspace_documents")
      .select("inferred_persona, recommended_job_titles")
      .eq("workspace_id", workspaceId)
      .eq("status", "ready")

    if (!docs || docs.length === 0) return

    const jobTitles = new Set<string>()
    const personaNames = new Set<string>()
    const pains = new Set<string>()
    const goals = new Set<string>()
    const targetIndustries = new Set<string>()
    const targetProcesses = new Set<string>()
    const targetSignals = new Set<string>()
    let buyerCount = 0
    let userCount = 0

    for (const doc of docs) {
      for (const t of (doc.recommended_job_titles as string[] | null) || []) {
        if (t && t.trim()) jobTitles.add(t.trim())
      }
      const persona = doc.inferred_persona as {
        name?: string
        type?: string
        pains?: string[]
        goals?: string[]
        target_company_profile?: { industries?: string[]; processes?: string[]; signals?: string[] }
      } | null
      if (persona && persona.name) {
        personaNames.add(persona.name.trim())
        if (persona.type === "user") userCount++
        else buyerCount++
        for (const p of persona.pains || []) if (p?.trim()) pains.add(p.trim())
        for (const g of persona.goals || []) if (g?.trim()) goals.add(g.trim())
        const tcp = persona.target_company_profile || {}
        for (const i of tcp.industries || []) if (i?.trim()) targetIndustries.add(i.trim())
        for (const p of tcp.processes || []) if (p?.trim()) targetProcesses.add(p.trim())
        for (const s of tcp.signals || []) if (s?.trim()) targetSignals.add(s.trim())
      }
    }

    // Nothing useful inferred yet
    if (jobTitles.size === 0 && personaNames.size === 0) return

    const dominantType = userCount > buyerCount ? "user" : "buyer"
    const descriptionParts: string[] = []
    if (personaNames.size > 0) {
      descriptionParts.push(`Perfiles a prospectar: ${Array.from(personaNames).slice(0, 6).join(", ")}.`)
    }
    if (targetIndustries.size > 0) {
      descriptionParts.push(`Industrias objetivo: ${Array.from(targetIndustries).slice(0, 6).join(", ")}.`)
    }
    if (targetProcesses.size > 0) {
      descriptionParts.push(`Procesos relevantes: ${Array.from(targetProcesses).slice(0, 6).join(", ")}.`)
    }
    if (pains.size > 0) {
      descriptionParts.push(`Dolores principales: ${Array.from(pains).slice(0, 5).join("; ")}.`)
    }
    if (goals.size > 0) {
      descriptionParts.push(`Objetivos: ${Array.from(goals).slice(0, 5).join("; ")}.`)
    }

    const description = JSON.stringify({
      type: dominantType,
      summary: descriptionParts.join(" "),
      persona_names: Array.from(personaNames).slice(0, 10),
      pains: Array.from(pains).slice(0, 10),
      goals: Array.from(goals).slice(0, 10),
      target_company_profile: {
        industries: Array.from(targetIndustries).slice(0, 10),
        processes: Array.from(targetProcesses).slice(0, 10),
        signals: Array.from(targetSignals).slice(0, 10),
      },
    })

    // Find existing auto persona for this workspace
    const { data: existing } = await adminClient
      .schema("v3")
      .from("buyer_personas")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("is_auto", true)
      .maybeSingle()

    const payload = {
      workspace_id: workspaceId,
      name: "Perfil sugerido (documentos)",
      description,
      recommended_job_titles: Array.from(jobTitles).slice(0, 15),
      is_auto: true,
      source: "auto_docs",
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      await adminClient
        .schema("v3")
        .from("buyer_personas")
        .update(payload)
        .eq("id", existing.id)
    } else {
      await adminClient
        .schema("v3")
        .from("buyer_personas")
        .insert(payload)
    }
  } catch (err) {
    console.error("[v0] Error consolidating auto buyer persona:", err)
  }
}
