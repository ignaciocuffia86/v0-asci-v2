"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { runTechRadar as runTechRadarCore, type TechRadarRunResult } from "@/lib/tech-radar"
import { requireWorkspace, getWorkspaceContext } from "@/lib/v3/workspace"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TechRadarResult = {
  success: boolean
  accountId: string
  companyId: string
  companyName: string
  findings: TechRadarRunResult['findings']
  digest: string | null
  bundleStats: TechRadarRunResult['bundle_stats']
  aiProvider: string
  error?: string
}

export type TechRadarStatus = {
  accountId: string
  companyName: string
  lastRunAt: string | null
  status: 'pending' | 'running' | 'completed' | 'failed'
  findingsCount: number
}

// ---------------------------------------------------------------------------
// Run Tech Radar for a campaign account
// ---------------------------------------------------------------------------

export async function runTechRadarForAccount(
  campaignAccountId: string
): Promise<TechRadarResult> {
  const supabase = await createClient()
  const admin = createAdminClient()
  
  // Get user and verify access
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { 
      success: false, 
      accountId: campaignAccountId,
      companyId: '',
      companyName: '',
      findings: [],
      digest: null,
      bundleStats: [],
      aiProvider: 'none',
      error: 'Not authenticated' 
    }
  }
  
  // Get the campaign account with company data
  const { data: account, error: accountError } = await admin
    .schema('v3')
    .from('campaign_accounts')
    .select(`
      id,
      company_id,
      campaign_id,
      prospection_status,
      campaigns!inner (
        id,
        workspace_id,
        type
      )
    `)
    .eq('id', campaignAccountId)
    .single()
  
  if (accountError || !account) {
    return {
      success: false,
      accountId: campaignAccountId,
      companyId: '',
      companyName: '',
      findings: [],
      digest: null,
      bundleStats: [],
      aiProvider: 'none',
      error: 'Account not found'
    }
  }
  
  // Verify user has access to this workspace
  const campaignData = Array.isArray(account.campaigns) ? account.campaigns[0] : account.campaigns
  const workspaceId = (campaignData as { workspace_id: string })?.workspace_id
  try {
    const workspace = await requireWorkspace(user.id)
    if (workspace.id !== workspaceId) {
      throw new Error('Access denied')
    }
  } catch {
    return {
      success: false,
      accountId: campaignAccountId,
      companyId: '',
      companyName: '',
      findings: [],
      digest: null,
      bundleStats: [],
      aiProvider: 'none',
      error: 'Access denied'
    }
  }
  
  // Get company details from public.companies (v2)
  const { data: company, error: companyError } = await admin
    .from('companies')
    .select('id, name, domain, industry, linkedin_url, country')
    .eq('id', account.company_id)
    .single()
  
  if (companyError || !company) {
    return {
      success: false,
      accountId: campaignAccountId,
      companyId: account.company_id,
      companyName: '',
      findings: [],
      digest: null,
      bundleStats: [],
      aiProvider: 'none',
      error: 'Company not found'
    }
  }
  
  // Update status to running
  await admin
    .schema('v3')
    .from('campaign_accounts')
    .update({ prospection_status: 'in_progress' })
    .eq('id', campaignAccountId)
  
  try {
    // Get workspace value profile for keywords
    const { data: valueProfile } = await admin
      .schema('v3')
      .from('workspace_value_profiles')
      .select('target_technologies, target_processes')
      .eq('workspace_id', campaign.workspace_id)
      .single()
    
    // Extract keywords from value profile
    const keywords: string[] = []
    if (valueProfile) {
      const techs = valueProfile.target_technologies as string[] || []
      const procs = valueProfile.target_processes as string[] || []
      keywords.push(...techs.slice(0, 5), ...procs.slice(0, 5))
    }
    
    // Extract linkedin slug if available
    let linkedinSlug: string | null = null
    if (company.linkedin_url) {
      const match = company.linkedin_url.match(/linkedin\.com\/company\/([^/?]+)/)
      if (match) linkedinSlug = match[1]
    }
    
    // Run tech radar using v2 function
    const result = await runTechRadarCore({
      companyName: company.name,
      country: company.country || undefined,
      industry: company.industry || undefined,
      keywords: keywords.length > 0 ? keywords : undefined,
      linkedinSlug,
    })
    
    // Save findings to company_implementations (v2 cache)
    // This uses the existing v2 structure so the data is shared
    if (result.findings.length > 0) {
      for (const finding of result.findings) {
        await admin
          .from('company_implementations')
          .upsert({
            company_id: company.id,
            title: finding.title,
            summary: finding.summary,
            technology: finding.technology,
            provider_name: finding.provider_name,
            area: finding.area,
            results: finding.results,
            evidence_level: finding.evidence_level,
            evidence_detail: finding.evidence_detail,
            source_name: finding.source_name,
            source_url: finding.source_url,
            published_at: finding.published_at,
            micro_agent: finding.micro_agent,
            created_at: new Date().toISOString(),
          }, {
            onConflict: 'company_id,source_url',
            ignoreDuplicates: true,
          })
      }
    }
    
    // Update campaign account status and timestamp
    await admin
      .schema('v3')
      .from('campaign_accounts')
      .update({
        prospection_status: 'completed',
        tech_radar_run_at: new Date().toISOString(),
      })
      .eq('id', campaignAccountId)
    
    // Update digest with new implementations
    await admin
      .schema('v3')
      .from('campaign_account_digest')
      .upsert({
        campaign_account_id: campaignAccountId,
        last_fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'campaign_account_id',
      })
    
    return {
      success: true,
      accountId: campaignAccountId,
      companyId: company.id,
      companyName: company.name,
      findings: result.findings,
      digest: result.digest,
      bundleStats: result.bundle_stats,
      aiProvider: result.ai_provider,
    }
    
  } catch (error) {
    console.error('[v3] Tech radar error:', error)
    
    // Update status to failed
    await admin
      .schema('v3')
      .from('campaign_accounts')
      .update({ prospection_status: 'pending' })
      .eq('id', campaignAccountId)
    
    return {
      success: false,
      accountId: campaignAccountId,
      companyId: company.id,
      companyName: company.name,
      findings: [],
      digest: null,
      bundleStats: [],
      aiProvider: 'none',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ---------------------------------------------------------------------------
// Get Tech Radar status for multiple accounts
// ---------------------------------------------------------------------------

export async function getTechRadarStatus(
  campaignId: string
): Promise<TechRadarStatus[]> {
  const supabase = await createClient()
  const admin = createAdminClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  
  // Get accounts with their company names and implementation counts
  const { data: accounts, error } = await admin
    .schema('v3')
    .from('campaign_accounts')
    .select(`
      id,
      company_id,
      prospection_status,
      tech_radar_run_at
    `)
    .eq('campaign_id', campaignId)
    .eq('status', 'whitelisted')
  
  if (error || !accounts) return []
  
  // Get company names
  const companyIds = accounts.map(a => a.company_id)
  const { data: companies } = await admin
    .from('companies')
    .select('id, name')
    .in('id', companyIds)
  
  const companyMap = new Map(companies?.map(c => [c.id, c.name]) || [])
  
  // Get implementation counts per company
  const { data: implCounts } = await admin
    .from('company_implementations')
    .select('company_id')
    .in('company_id', companyIds)
  
  const countMap = new Map<string, number>()
  implCounts?.forEach(i => {
    countMap.set(i.company_id, (countMap.get(i.company_id) || 0) + 1)
  })
  
  return accounts.map(account => ({
    accountId: account.id,
    companyName: companyMap.get(account.company_id) || 'Unknown',
    lastRunAt: account.tech_radar_run_at,
    status: account.prospection_status || 'pending',
    findingsCount: countMap.get(account.company_id) || 0,
  }))
}

// ---------------------------------------------------------------------------
// Run Tech Radar for multiple accounts (batch)
// ---------------------------------------------------------------------------

export async function runTechRadarBatch(
  accountIds: string[]
): Promise<{ queued: number; errors: string[] }> {
  const errors: string[] = []
  let queued = 0
  
  // Process sequentially to avoid overwhelming APIs
  for (const accountId of accountIds.slice(0, 5)) { // Max 5 at a time
    try {
      const result = await runTechRadarForAccount(accountId)
      if (result.success) {
        queued++
      } else {
        errors.push(`${result.companyName || accountId}: ${result.error}`)
      }
    } catch (error) {
      errors.push(`${accountId}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
  
  return { queued, errors }
}
