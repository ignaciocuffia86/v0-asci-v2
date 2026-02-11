"use server"

import { createClient } from "@/lib/supabase/server"

export type UserDocument = {
  id: string
  user_id: string
  title: string
  type: "pdf" | "pptx" | "docx" | "url"
  source_url: string | null
  storage_path: string | null
  file_size: number | null
  status: "uploading" | "processing" | "ready" | "error"
  processing_error: string | null
  extracted_text: string | null
  ai_summary: string | null
  created_at: string
  updated_at: string
  tags?: DocumentTag[]
}

export type DocumentTag = {
  id: string
  document_id: string
  user_id: string
  tag_type: "industry" | "technology" | "process"
  tag_value: string
  tag_reference_id: string | null
  confidence: number
  created_at: string
}

export type UserValueProfile = {
  id: string
  user_id: string
  profile_summary: string | null
  target_industries: string[]
  target_technologies: string[]
  target_processes: string[]
  raw_analysis: Record<string, unknown> | null
  generated_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Fetch all documents for the current user
 */
export async function getUserDocuments(): Promise<{ data: UserDocument[] | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: "No autenticado" }

  const { data, error } = await supabase
    .from("user_documents")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  if (error) return { data: null, error: error.message }
  return { data: data as UserDocument[], error: null }
}

/**
 * Fetch a single document with its tags
 */
export async function getDocumentWithTags(documentId: string): Promise<{ data: UserDocument | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: "No autenticado" }

  const { data: doc, error: docError } = await supabase
    .from("user_documents")
    .select("*")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .single()

  if (docError) return { data: null, error: docError.message }

  const { data: tags } = await supabase
    .from("document_tags")
    .select("*")
    .eq("document_id", documentId)
    .eq("user_id", user.id)
    .order("confidence", { ascending: false })

  return { data: { ...doc, tags: tags || [] } as UserDocument, error: null }
}

/**
 * Create a document record (file upload happens client-side to Supabase Storage)
 */
export async function createDocument(params: {
  title: string
  type: "pdf" | "pptx" | "docx" | "url"
  source_url?: string
  storage_path?: string
  file_size?: number
}): Promise<{ data: UserDocument | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: "No autenticado" }

  const { data, error } = await supabase
    .from("user_documents")
    .insert({
      user_id: user.id,
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
  return { data: data as UserDocument, error: null }
}

/**
 * Delete a document and its associated tags & storage file
 */
export async function deleteDocument(documentId: string): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "No autenticado" }

  // Get doc to find storage path
  const { data: doc } = await supabase
    .from("user_documents")
    .select("storage_path")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .single()

  // Delete from storage if file exists
  if (doc?.storage_path) {
    await supabase.storage.from("user-documents").remove([doc.storage_path])
  }

  // Tags cascade-delete via FK. Delete the document.
  const { error } = await supabase
    .from("user_documents")
    .delete()
    .eq("id", documentId)
    .eq("user_id", user.id)

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * Add a manual tag to a document
 */
export async function addDocumentTag(params: {
  document_id: string
  tag_type: "industry" | "technology" | "process"
  tag_value: string
  tag_reference_id?: string
}): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "No autenticado" }

  const { error } = await supabase
    .from("document_tags")
    .insert({
      document_id: params.document_id,
      user_id: user.id,
      tag_type: params.tag_type,
      tag_value: params.tag_value,
      tag_reference_id: params.tag_reference_id || null,
      confidence: 1.0, // manual tags have full confidence
    })

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * Remove a tag from a document
 */
export async function removeDocumentTag(tagId: string): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "No autenticado" }

  const { error } = await supabase
    .from("document_tags")
    .delete()
    .eq("id", tagId)
    .eq("user_id", user.id)

  if (error) return { success: false, error: error.message }
  return { success: true, error: null }
}

/**
 * Get the user's value profile
 */
export async function getUserValueProfile(): Promise<{ data: UserValueProfile | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: "No autenticado" }

  const { data, error } = await supabase
    .from("user_value_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  return { data: data as UserValueProfile | null, error: null }
}

/**
 * Get all tags for a user (across all documents)
 */
export async function getUserTags(): Promise<{ data: DocumentTag[] | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { data: null, error: "No autenticado" }

  const { data, error } = await supabase
    .from("document_tags")
    .select("*")
    .eq("user_id", user.id)
    .order("tag_type")
    .order("confidence", { ascending: false })

  if (error) return { data: null, error: error.message }
  return { data: data as DocumentTag[], error: null }
}
