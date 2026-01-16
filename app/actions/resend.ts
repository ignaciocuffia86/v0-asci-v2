"use server"

import { createClient } from "@/lib/supabase/server"

export async function syncUserToResend(userId: string) {
  const supabase = await createClient()

  try {
    // Obtener usuario de auth
    const {
      data: { user },
    } = await supabase.auth.admin.getUserById(userId)

    if (!user?.email) {
      throw new Error("Usuario no encontrado o sin email")
    }

    // Obtener perfil del usuario
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", userId).single()

    // Verificar si ya existe en resend_audiences
    const { data: existing } = await supabase.from("resend_audiences").select("*").eq("user_id", userId).single()

    // Preparar datos para Resend
    const resendData = {
      email: user.email,
      name: profile?.full_name || user.user_metadata?.full_name || "Usuario ASCI",
      unsubscribe_group_id: process.env.RESEND_UNSUBSCRIBE_GROUP_ID || "marketing",
    }

    // Crear o actualizar en resend_audiences
    const { error: upsertError } = await supabase.from("resend_audiences").upsert(
      {
        user_id: userId,
        email: user.email,
        full_name: resendData.name,
        sync_status: "synced",
        last_sync_at: new Date().toISOString(),
        error_message: null,
      },
      { onConflict: "user_id" },
    )

    if (upsertError) throw upsertError

    return { success: true, email: user.email }
  } catch (error) {
    console.error("[Resend Sync] Error:", error)

    // Registrar el error en la base de datos
    try {
      await supabase.from("resend_audiences").upsert(
        {
          user_id: userId,
          sync_status: "failed",
          error_message: error instanceof Error ? error.message : "Error desconocido",
        },
        { onConflict: "user_id" },
      )
    } catch {
      // Ignorar errores al registrar el fallo
    }

    return { success: false, error: error instanceof Error ? error.message : "Error al sincronizar" }
  }
}

export async function syncAllUsers() {
  const supabase = await createClient()

  try {
    // Obtener todos los usuarios (requiere admin)
    const { data: users, error } = await supabase.auth.admin.listUsers()

    if (error) throw error

    let successCount = 0
    let failCount = 0

    for (const user of users) {
      const result = await syncUserToResend(user.id)
      if (result.success) {
        successCount++
      } else {
        failCount++
      }
    }

    return { success: true, successCount, failCount }
  } catch (error) {
    console.error("[Resend Sync All] Error:", error)
    return { success: false, error: error instanceof Error ? error.message : "Error al sincronizar usuarios" }
  }
}
