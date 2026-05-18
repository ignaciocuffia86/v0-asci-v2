"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentWorkspace, requireWorkspaceEditor } from "@/lib/v3/workspace"

// =============================================================================
// TYPES
// =============================================================================

export type WorkspaceDocument = {
  id: string
  workspace_id: string
  uploaded_by: string
  title: string
  type: "pdf" | "pptx" | "docx" | "url"
  source_url: string | null
  storage_path: string | null
  file_size: number | null
  status: "uploading" | "processing" | "ready" | "error"
  processing_error: string | null
  extracted_text: string | null
  ai_summary: string | null
  version: number
  created_at: string
  updated_at: string
  tags?: WorkspaceDocumentTag[]
}

export type WorkspaceDocumentTag = {
  id: string
  document_id: string
  workspace_id: string
  tag_type: "industry" | "technology" | "process"
  tag_value: string
  tag_reference_id: string | null
  confidence: number
  created_at: string
}

export type WorkspaceValueProfile = {
  id: string
  workspace_id: string
  profile_summary: string | null
  target_industries: string[]
  target_technologies: string[]
  target_processes: string[]
  raw_analysis: Record<string, unknown> | null
  generated_at: string | null
  created_at: string
  updated_at: string
}

// =============================================================================
// DOCUMENT CRUD
// =============================================================================

/**
 * Fetch all documents for the current workspace
 */
export async function getWorkspaceDocuments(): Promise<{ 
  data: WorkspaceDocument[] | null
  error: string | null 
}> {
  const supabase = await createClient()
  const workspace = await getCurrentWorkspace()
  
  if (!workspace) {
    return { data: null, error: "No hay workspace activo" }
  }

  const { data, error } = await supabase
    .from("v3.workspace_documents")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })

  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceDocument[], error: null }
}

/**
 * Fetch all documents with their tags
 */
export async function getWorkspaceDocumentsWithTags(): Promise<{ 
  data: WorkspaceDocument[] | null
  error: string | null 
}> {
  const supabase = await createClient()
  const workspace = await getCurrentWorkspace()
  
  if (!workspace) {
    return { data: null, error: "No hay workspace activo" }
  }

  const { data: docs, error: docsError } = await supabase
    .from("v3.workspace_documents")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })

  if (docsError) return { data: null, error: docsError.message }

  // Fetch all tags
  const { data: allTags } = await supabase
    .from("v3.workspace_document_tags")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("confidence", { ascending: false })

  // Group tags by document_id
  const tagsByDoc = (allTags || []).reduce((acc, tag) => {
    if (!acc[tag.document_id]) acc[tag.document_id] = []
    acc[tag.document_id].push(tag)
    return acc
  }, {} as Record<string, WorkspaceDocumentTag[]>)

  const docsWithTags = (docs || []).map((doc) => ({
    ...doc,
    tags: tagsByDoc[doc.id] || [],
  }))

  return { data: docsWithTags as WorkspaceDocument[], error: null }
}

/**
 * Get a single document with its tags
 */
export async function getDocumentWithTags(documentId: string): Promise<{ 
  data: WorkspaceDocument | null
  error: string | null 
}> {
  const supabase = await createClient()
  const workspace = await getCurrentWorkspace()
  
  if (!workspace) {
    return { data: null, error: "No hay workspace activo" }
  }

  const { data: doc, error: docError } = await supabase
    .from("v3.workspace_documents")
    .select("*")
    .eq("id", documentId)
    .eq("workspace_id", workspace.id)
    .single()

  if (docError) return { data: null, error: docError.message }

  const { data: tags } = await supabase
    .from("v3.workspace_document_tags")
    .select("*")
    .eq("document_id", documentId)
    .eq("workspace_id", workspace.id)
    .order("confidence", { ascending: false })

  return { data: { ...doc, tags: tags || [] } as WorkspaceDocument, error: null }
}

/**
 * Create a document record
 * Storage path format: workspaces/{workspace_id}/{doc_id}/{filename}
 */
export async function createWorkspaceDocument(params: {
  title: string
  type: "pdf" | "pptx" | "docx" | "url"
  source_url?: string
  storage_path?: string
  file_size?: number
}): Promise<{ data: WorkspaceDocument | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { data: null, error: "No autenticado" }
  }

  // Require editor or admin role
  let workspace
  try {
    workspace = await requireWorkspaceEditor()
  } catch {
    return { data: null, error: "Sin permisos para subir documentos" }
  }

  if (!workspace) {
    return { data: null, error: "No hay workspace activo" }
  }

  // Check for duplicates
  if (params.type === "url" && params.source_url) {
    const { data: existing } = await supabase
      .from("v3.workspace_documents")
      .select("id, title")
      .eq("workspace_id", workspace.id)
      .eq("source_url", params.source_url)
      .limit(1)
      .maybeSingle()

    if (existing) {
      return { data: null, error: `Esta URL ya fue cargada como "${existing.title}".` }
    }
  } else if (params.type !== "url") {
    const { data: existing } = await supabase
      .from("v3.workspace_documents")
      .select("id, title")
      .eq("workspace_id", workspace.id)
      .eq("title", params.title)
      .eq("type", params.type)
      .limit(1)
      .maybeSingle()

    if (existing) {
      return { 
        data: null, 
        error: `Ya existe un documento "${existing.title}" con el mismo nombre.` 
      }
    }
  }

  const { data, error } = await supabase
    .from("v3.workspace_documents")
    .insert({
      workspace_id: workspace.id,
      uploaded_by: user.id,
      title: params.title,
      type: params.type,
      source_url: params.source_url || null,
      storage_path: params.storage_path || null,
      file_size: params.file_size || null,
      status: "processing",
    })
    .select()
    .single()

  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceDocument, error: null }
}

/**
 * Delete a document and its storage file
 */
export async function deleteWorkspaceDocument(documentId: string): Promise<{ 
  success: boolean
  error: string | null 
}> {
  const supabase = await createClient()
  
  let workspace
  try {
    workspace = await requireWorkspaceEditor()
  } catch {
    return { success: false, error: "Sin permisos" }
  }

  if (!workspace) {
    return { success: false, error: "No hay workspace activo" }
  }

  // Get doc to find storage path
  const { data: doc } = await supabase
    .from("v3.workspace_documents")
    .select("storage_path")
    .eq("id", documentId)
    .eq("workspace_id", workspace.id)
    .single()

  // Delete from storage if file exists
  if (doc?.storage_path) {
    const adminClient = createAdminClient()
    await adminClient.storage.from("workspace-documents").remove([doc.storage_path])
  }

  // Delete document (tags cascade via FK)
  const { error } = await supabase
    .from("v3.workspace_documents")
    .delete()
    .eq("id", documentId)
    .eq("workspace_id", workspace.id)

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * Get signed URL for document preview
 */
export async function getDocumentPreviewUrl(documentId: string): Promise<{ 
  url: string | null
  error: string | null 
}> {
  const supabase = await createClient()
  const workspace = await getCurrentWorkspace()
  
  if (!workspace) {
    return { url: null, error: "No hay workspace activo" }
  }

  const { data: doc } = await supabase
    .from("v3.workspace_documents")
    .select("storage_path, source_url, type")
    .eq("id", documentId)
    .eq("workspace_id", workspace.id)
    .single()

  if (!doc) return { url: null, error: "Documento no encontrado" }

  // For URLs, return the source URL directly
  if (doc.type === "url" && doc.source_url) {
    return { url: doc.source_url, error: null }
  }

  // For files, generate a signed URL (valid for 1 hour)
  if (doc.storage_path) {
    const adminClient = createAdminClient()
    const { data, error } = await adminClient.storage
      .from("workspace-documents")
      .createSignedUrl(doc.storage_path, 3600)

    if (error) return { url: null, error: error.message }
    return { url: data.signedUrl, error: null }
  }

  return { url: null, error: "Sin archivo asociado" }
}

// =============================================================================
// VALUE PROFILE
// =============================================================================

/**
 * Get the workspace's value profile
 */
export async function getWorkspaceValueProfile(): Promise<{ 
  data: WorkspaceValueProfile | null
  error: string | null 
}> {
  const supabase = await createClient()
  const workspace = await getCurrentWorkspace()
  
  if (!workspace) {
    return { data: null, error: "No hay workspace activo" }
  }

  const { data, error } = await supabase
    .from("v3.workspace_value_profiles")
    .select("*")
    .eq("workspace_id", workspace.id)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: data as WorkspaceValueProfile | null, error: null }
}

// =============================================================================
// DOCUMENT COUNT CHECK (for onboarding)
// =============================================================================

/**
 * Check if workspace has at least one processed document
 */
export async function hasProcessedDocuments(): Promise<boolean> {
  const supabase = await createClient()
  const workspace = await getCurrentWorkspace()
  
  if (!workspace) return false

  const { count } = await supabase
    .from("v3.workspace_documents")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id)
    .eq("status", "ready")

  return (count || 0) > 0
}

/**
 * Get document stats for workspace
 */
export async function getDocumentStats(): Promise<{
  total: number
  ready: number
  processing: number
  error: number
}> {
  const supabase = await createClient()
  const workspace = await getCurrentWorkspace()
  
  if (!workspace) {
    return { total: 0, ready: 0, processing: 0, error: 0 }
  }

  const { data } = await supabase
    .from("v3.workspace_documents")
    .select("status")
    .eq("workspace_id", workspace.id)

  const docs = data || []
  
  return {
    total: docs.length,
    ready: docs.filter(d => d.status === "ready").length,
    processing: docs.filter(d => d.status === "processing" || d.status === "uploading").length,
    error: docs.filter(d => d.status === "error").length,
  }
}
