import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

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
  
  return <>{children}</>
}
