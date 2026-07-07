import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { AdminNav } from "./_components/admin-nav"

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Guard de superadmin a nivel de layout: protege todas las secciones /v3/admin/*
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login?next=/v3/admin")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "superadmin") {
    redirect("/v3")
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Panel de administración</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestión y reportería de uso de la plataforma. Solo super-admins.
        </p>
      </header>
      <AdminNav />
      <main className="mt-6">{children}</main>
    </div>
  )
}
