import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { PromptsManager } from "./_components/prompts-manager"

export default async function AdminPromptsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

  if (profile?.role !== "superadmin") {
    redirect("/")
  }

  const { data: prompts } = await supabase.from("admin_prompts").select("*").order("prompt_key")

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Gestión de Prompts</h1>
        <p className="text-muted-foreground mt-2">
          Administra los prompts que se usan para investigación con IA (Perplexity)
        </p>
      </div>

      <PromptsManager initialPrompts={prompts || []} />
    </div>
  )
}
