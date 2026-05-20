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
  
  // Verificar autenticación
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect("/auth/login?next=/v3")
  }
  
  // Obtener campañas del workspace
  const campaigns = await getCampaigns()
  
  // Verificar que la campaña existe
  const currentCampaign = campaigns?.find((c: any) => c.id === campaignId)
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
