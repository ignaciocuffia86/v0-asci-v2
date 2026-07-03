import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { CommandPalette } from "@/components/v3/command-palette"

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
  
  // Aplicar v3-theme (dark mode warm charcoal) a todas las páginas de v3
  return (
    <div className="v3-theme min-h-screen bg-background text-foreground">
      {children}
      <CommandPalette />
    </div>
  )
}
