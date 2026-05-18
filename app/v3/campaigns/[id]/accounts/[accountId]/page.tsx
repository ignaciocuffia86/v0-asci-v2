import { notFound } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAccountDigest, markDigestAsSeen } from "@/lib/v3/digest"
import { DigestView } from "./_components/digest-view"

interface AccountPageProps {
  params: Promise<{ id: string; accountId: string }>
}

export default async function AccountPage({ params }: AccountPageProps) {
  const { id: campaignId, accountId } = await params
  
  const adminClient = createAdminClient()
  
  // Obtener campaign_account con company
  const { data: campaignAccount, error } = await adminClient
    .from('v3.campaign_accounts')
    .select(`
      id,
      company_id,
      status,
      prospection_status,
      tech_radar_run_at,
      apollo_run_at,
      added_at,
      companies:company_id (
        id,
        name,
        domain,
        industry,
        linkedin_url,
        logo_url,
        description,
        employee_count,
        founded_year,
        headquarters
      )
    `)
    .eq('id', accountId)
    .eq('campaign_id', campaignId)
    .single()
  
  if (error || !campaignAccount) {
    notFound()
  }
  
  // Obtener digest con datos expandidos
  const digest = await getAccountDigest(accountId, true)
  
  // Marcar como visto (fire and forget)
  markDigestAsSeen(accountId).catch(() => {})
  
  return (
    <DigestView 
      campaignAccount={campaignAccount}
      digest={digest}
      campaignId={campaignId}
    />
  )
}
