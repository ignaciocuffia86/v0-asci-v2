import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCampaigns } from "@/app/actions/v3/campaigns"
import { CampaignLayoutClient } from "./_components/campaign-layout-client"

export default async function CampaignLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id: campaignId } = await params
  
  // Verificar autenticacion
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect("/auth/login?next=/v3")
  }
  
  // Obtener campanas del workspace
  const { campaigns } = await getCampaigns()
  
  // Verificar que la campana existe
  const currentCampaign = campaigns?.find(c => c.id === campaignId)
  if (!currentCampaign) {
    redirect("/v3/campaigns")
  }
  
  return (
    <CampaignLayoutClient 
      campaigns={campaigns || []} 
      currentCampaignId={campaignId}
    >
      {children}
    </CampaignLayoutClient>
  )
}
