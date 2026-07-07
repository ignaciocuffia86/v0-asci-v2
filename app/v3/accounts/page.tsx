import { redirect } from "next/navigation"
import { getOnboardingStatus } from "@/app/actions/v3/workspace"
import { getFollowedAccounts, getRecentlyResearchedAccounts } from "@/app/actions/v3/accounts"
import { AccountsView } from "./_components/accounts-view"

export const metadata = {
  title: "Cuentas seguidas | ASCI v3",
}

export default async function V3AccountsPage() {
  const status = await getOnboardingStatus()

  if (status.status === "no_workspace") redirect("/v3/onboarding")
  if (status.status !== "active_member") redirect("/v3/onboarding")

  const [accounts, researched] = await Promise.all([
    getFollowedAccounts(),
    getRecentlyResearchedAccounts().catch(() => []),
  ])

  return <AccountsView accounts={accounts} researched={researched} />
}
