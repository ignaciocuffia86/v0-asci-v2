import { listPrompts } from "@/app/actions/v3/admin-prompts"
import { PromptsManager } from "./_components/prompts-manager"

export default async function AdminPromptsPage() {
  // El guard de superadmin vive en el layout de /v3/admin
  const { prompts, error } = await listPrompts()

  return (
    <div className="mx-auto max-w-4xl">
      <PromptsManager initialPrompts={prompts} loadError={error} />
    </div>
  )
}
