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
  
  // Obtener campaign_account del schema v3
  const { data: campaignAccount, error } = await adminClient
    .schema('v3')
    .from('campaign_accounts')
    .select('id, company_id, status, prospection_status, tech_radar_run_at, apollo_run_at, added_at')
    .eq('id', accountId)
    .eq('campaign_id', campaignId)
    .single()
  
  if (error || !campaignAccount) {
    console.error("[v0] Error fetching campaign account:", error)
    notFound()
  }
  
  // Obtener company del schema public
  const { data: company } = await adminClient
    .from('companies')
    .select('id, name, website, industry, linkedin_url, logo_url, description, employee_count, founded_year, headquarters')
    .eq('id', campaignAccount.company_id)
    .single()
  
  // Obtener digest con datos expandidos
  const digest = await getAccountDigest(accountId, true)
  
  // Obtener signals de v2 para esta company (user_company_signals y company_news)
  const [signalsResult, newsResult] = await Promise.all([
    adminClient
      .from('user_company_signals')
      .select('id, title, content, signal_type, created_at')
      .eq('company_id', campaignAccount.company_id)
      .order('created_at', { ascending: false })
      .limit(20),
    adminClient
      .from('company_news')
      .select('id, title, summary, source_url, published_at')
      .eq('company_id', campaignAccount.company_id)
      .order('published_at', { ascending: false })
      .limit(20)
  ])
  
  // Marcar como visto (fire and forget)
  markDigestAsSeen(accountId).catch(() => {})
  
  // Map website to domain for consistency
  const companyWithDomain = company ? {
    ...company,
    domain: company.website
  } : null
  
  return (
    <DigestView 
      campaignAccount={{
        ...campaignAccount,
        companies: companyWithDomain
      }}
      digest={digest}
      campaignId={campaignId}
      v2Signals={signalsResult.data || []}
      v2News={newsResult.data || []}
    />
  )
}
