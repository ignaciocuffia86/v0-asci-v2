import { listRecentImportsAction, listWorkspaceOptionsAction } from "@/app/actions/v3/account-imports"
import { AccountImportWizard } from "./_components/account-import-wizard"

export default async function AccountImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>
}) {
  // El guard de superadmin vive en el layout de /v3/admin; cada server action
  // que usa esta pantalla re-chequea el rol por su cuenta.
  const params = await searchParams
  const [{ workspaces, error }, { imports }] = await Promise.all([
    listWorkspaceOptionsAction(),
    listRecentImportsAction(),
  ])

  return (
    <div className="mx-auto max-w-5xl">
      <AccountImportWizard
        workspaces={workspaces}
        recentImports={imports}
        initialWorkspaceId={params.workspace ?? null}
        loadError={error}
      />
    </div>
  )
}
