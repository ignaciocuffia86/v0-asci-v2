import { notFound, redirect } from "next/navigation"
import { getOnboardingStatus } from "@/app/actions/v3/workspace"
import { getAccountDetail, getAccountReportData, getAccountSignals } from "@/app/actions/v3/accounts"
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

  const [detail, signals, report] = await Promise.all([
    getAccountDetail(companyId),
    getAccountSignals(companyId).catch(() => null),
    // Si el informe falla (p.ej. la IA de la narrativa), la cuenta igual se
    // muestra: las secciones determinísticas no dependen de esto.
    getAccountReportData(companyId).catch((error) => {
      console.error("[v3] No se pudo armar la radiografía:", error)
      return null
    }),
  ])
  if (!detail.company) notFound()

  // Abrir el bookmark NO dispara búsquedas: la cara (los dos bundles de
  // noticias, ~US$0,20) sale una sola vez, al marcar la cuenta —
  // `followAccountAction`. Antes había un kick acá también, pensado como
  // auto-reparación, pero con el bundle caro convierte cada visita a una cuenta
  // vieja en un gasto potencial, y el refresco mensual ya lo cubre.
  return <AccountDetailView detail={detail} signals={signals} report={report} />
}
