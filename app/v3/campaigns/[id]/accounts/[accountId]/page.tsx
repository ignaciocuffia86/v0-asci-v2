import { notFound } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { markDigestAsSeen } from "@/lib/v3/digest"
import { getCampaign } from "@/app/actions/v3/campaigns"
import { DigestView } from "./_components/digest-view"

interface AccountPageProps {
  params: Promise<{ id: string; accountId: string }>
}

export default async function AccountPage({ params }: AccountPageProps) {
  const { id: campaignId, accountId } = await params
  
  const adminClient = createAdminClient()
  
  // Primera ronda: obtener campaign y campaign_account
  const [campaign, accountResult] = await Promise.all([
    getCampaign(campaignId),
    adminClient
      .schema('v3')
      .from('campaign_accounts')
      .select('id, company_id, status, prospection_status, tech_radar_run_at, apollo_run_at, added_at')
      .eq('id', accountId)
      .eq('campaign_id', campaignId)
      .single()
  ])
  
  if (!campaign || accountResult.error || !accountResult.data) {
    console.error("[v0] Error fetching campaign or account:", accountResult.error)
    notFound()
  }
  
  const campaignAccount = accountResult.data
  const companyId = campaignAccount.company_id
  
  // Segunda ronda: obtener datos de la company y signals en paralelo
  const [companyResult, signalsResult, newsResult] = await Promise.all([
    adminClient
      .from('companies')
      .select('id, name, website, industry, linkedin_url, logo_url, description, employee_count, founded_year, headquarters')
      .eq('id', companyId)
      .single(),
    adminClient
      .from('user_company_signals')
      .select('id, title, content, signal_type, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(20),
    adminClient
      .from('company_news')
      .select('id, title, summary, source_url, published_at')
      .eq('company_id', companyId)
      .order('published_at', { ascending: false })
      .limit(20)
  ])
  
  // Debug: verificar qué pasa con la query de company
  if (companyResult.error) {
    console.error("[v0] Company query error for companyId:", companyId, "error:", companyResult.error)
  } else if (!companyResult.data) {
    console.error("[v0] Company not found for companyId:", companyId)
  }
  
  // Marcar como visto (fire and forget)
  markDigestAsSeen(accountId).catch(() => {})
  
  // Map website to domain for consistency
  const company = companyResult.data
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
      digest={null}
      campaignId={campaignId}
      campaignName={campaign.name}
      v2Signals={signalsResult.data || []}
      v2News={newsResult.data || []}
    />
  )
}
