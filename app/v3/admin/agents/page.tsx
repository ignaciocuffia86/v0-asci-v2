import { getAgentsData } from "@/app/actions/v3/admin-agents"
import { AgentsManager } from "./_components/agents-manager"

export default async function AdminAgentsPage() {
  // El guard de superadmin vive en el layout de /v3/admin
  const { agents, products, processes, error } = await getAgentsData()

  return (
    <div className="mx-auto max-w-4xl">
      <AgentsManager initialAgents={agents} products={products} processes={processes} loadError={error} />
    </div>
  )
}
