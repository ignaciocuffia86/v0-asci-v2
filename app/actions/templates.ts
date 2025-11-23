"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export interface IcebreakerTemplate {
  id: string
  name: string
  description: string | null
  prompt_template: string
  tone: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export async function getIcebreakerTemplates() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("icebreaker_templates")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Error fetching templates:", error)
    return []
  }

  return data as IcebreakerTemplate[]
}

export async function getActiveIcebreakerTemplates() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("icebreaker_templates")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true })

  if (error) {
    console.error("Error fetching active templates:", error)
    return []
  }

  return data as IcebreakerTemplate[]
}

export async function createIcebreakerTemplate(formData: {
  name: string
  description: string
  prompt_template: string
  tone: string
  is_active: boolean
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("No autenticado")
  }

  const { error } = await supabase.from("icebreaker_templates").insert({
    ...formData,
    created_by: user.id,
  })

  if (error) {
    console.error("Error creating template:", error)
    throw new Error("Error al crear template")
  }

  revalidatePath("/admin/templates")
  return { success: true }
}

export async function updateIcebreakerTemplate(
  id: string,
  formData: {
    name: string
    description: string
    prompt_template: string
    tone: string
    is_active: boolean
  },
) {
  const supabase = await createClient()

  const { error } = await supabase.from("icebreaker_templates").update(formData).eq("id", id)

  if (error) {
    console.error("Error updating template:", error)
    throw new Error("Error al actualizar template")
  }

  revalidatePath("/admin/templates")
  return { success: true }
}

export async function deleteIcebreakerTemplate(id: string) {
  const supabase = await createClient()

  const { error } = await supabase.from("icebreaker_templates").delete().eq("id", id)

  if (error) {
    console.error("Error deleting template:", error)
    throw new Error("Error al eliminar template")
  }

  revalidatePath("/admin/templates")
  return { success: true }
}

export async function toggleTemplateActive(id: string, isActive: boolean) {
  const supabase = await createClient()

  const { error } = await supabase.from("icebreaker_templates").update({ is_active: isActive }).eq("id", id)

  if (error) {
    console.error("Error toggling template:", error)
    throw new Error("Error al cambiar estado del template")
  }

  revalidatePath("/admin/templates")
  return { success: true }
}
