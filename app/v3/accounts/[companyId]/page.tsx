import { notFound, redirect } from "next/navigation"
import { getOnboardingStatus } from "@/app/actions/v3/workspace"
import { getAccountDetail, getAccountReportData, getAccountSignals } from "@/app/actions/v3/accounts"
import { listDecisionMakers } from "@/app/actions/v3/apollo"
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

  // La radiografía se arranca acá pero NO se espera: viaja como promesa hasta
  // la vista, que la consume dentro de un `Suspense`.
  //
  // Armarla son ~6 etapas de queries contra São Paulo y, la primera vez que se
  // abre una cuenta, además una llamada de IA para la narrativa. Esperarla en
  // el servidor dejaba al navegador congelado en la página anterior, porque sin
  // nada que enviar el router no cambia de pantalla.
  //
  // El `.catch` es parte del contrato: la promesa NUNCA rechaza. Si el informe
  // falla, `use()` recibe null y la cuenta se muestra igual — las secciones
  // determinísticas no dependen de él.
  const reportPromise = getAccountReportData(companyId).catch((error) => {
    console.error("[v3] No se pudo armar la radiografía:", error)
    return null
  })

  const [detail, signals, decisionMakers] = await Promise.all([
    getAccountDetail(companyId),
    getAccountSignals(companyId).catch(() => null),
    listDecisionMakers(companyId).catch(() => []),
  ])
  if (!detail.company) notFound()

  // Abrir el bookmark NO dispara búsquedas: la cara (los dos bundles de
  // noticias, ~US$0,20) sale una sola vez, al marcar la cuenta —
  // `followAccountAction`— y el cron mensual la refresca.
  return (
    <AccountDetailView
      detail={detail}
      signals={signals}
      reportPromise={reportPromise}
      decisionMakers={decisionMakers}
    />
  )
}
