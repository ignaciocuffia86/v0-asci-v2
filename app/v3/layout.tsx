import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { CommandPalette } from "@/components/v3/command-palette"
import { getCampaigns } from "@/app/actions/v3/campaigns"

export default async function V3Layout({
  children,
}: {
  children: React.ReactNode
}) {
  // Verificar autenticacion
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect("/auth/login?next=/v3")
  }
  
  // Obtener campanas para el Command Palette
  let campaigns: Array<{ id: string; name: string }> = []
  try {
    campaigns = await getCampaigns()
  } catch {
    // Si falla, continuamos sin campanas en el palette
  }
  
  // Aplicar v3-theme (dark mode warm charcoal) a todas las paginas de v3
  return (
    <div className="v3-theme min-h-screen bg-background text-foreground">
      {children}
      <CommandPalette campaigns={campaigns} />
    </div>
  )
}
