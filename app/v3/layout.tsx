import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/v3/workspace"
import { CommandPalette } from "@/components/v3/command-palette"
import { V3Navbar } from "@/components/v3/navbar"

export default async function V3Layout({
  children,
}: {
  children: React.ReactNode
}) {
  // Verificar autenticación
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect("/auth/login?next=/v3")
  }

  const [workspace, profileRes] = await Promise.all([
    getCurrentWorkspace(),
    supabase.from("profiles").select("role").eq("id", user.id).single(),
  ])
  const isSuperAdmin = profileRes.data?.role === "superadmin"
  
  // Aplicar v3-theme (dark mode warm charcoal) a todas las páginas de v3
  return (
    <div className="v3-theme min-h-screen bg-background text-foreground">
      <V3Navbar user={user} workspace={workspace} isSuperAdmin={isSuperAdmin} />
      {children}
      <CommandPalette isSuperAdmin={isSuperAdmin} />
    </div>
  )
}
