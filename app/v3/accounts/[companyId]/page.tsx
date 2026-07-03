import { notFound, redirect } from "next/navigation"
import { getOnboardingStatus } from "@/app/actions/v3/workspace"
import { getAccountDetail, getAccountSignals } from "@/app/actions/v3/accounts"
import { AccountDetailView } from "./_components/account-detail-view"

export const metadata = {
  title: "Detalle de cuenta | ASCI v3",
}

export default async function V3AccountDetailPage({
  params,
}: {
  params: Promise<{ companyId: string }>
}) {
  const { companyId } = await params
  const status = await getOnboardingStatus()

  if (status.status === "no_workspace") redirect("/v3/onboarding")
  if (status.status !== "active_member") redirect("/v3/onboarding")

  const [detail, signals] = await Promise.all([
    getAccountDetail(companyId),
    getAccountSignals(companyId).catch(() => null),
  ])
  if (!detail.company) notFound()

  return <AccountDetailView detail={detail} signals={signals} />
}
