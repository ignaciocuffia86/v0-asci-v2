import { after } from "next/server"
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

  // Informe incremental (Fase 8): al abrir el bookmark se busca lo que falta.
  // Corre DESPUÉS de responder la página, así que no agrega latencia; la guarda
  // de frescura (30 días) y la marca previa al gasto viven en el runner, así
  // que abrir la cuenta diez veces en un día cuesta diez consultas baratas.
  after(async () => {
    const { scrapeCompanyNews } = await import("@/lib/v3/services/news-scrape-runner")
    await scrapeCompanyNews(companyId).catch((error) => {
      console.warn("[v3] Kick de noticias al abrir la cuenta falló:", error instanceof Error ? error.message : error)
    })
  })

  return <AccountDetailView detail={detail} signals={signals} report={report} />
}
