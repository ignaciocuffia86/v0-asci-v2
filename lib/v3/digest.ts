'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  getCompanyNews,
  getCompanyImplementations,
  getCompanySignals,
  getCompanyCachedContacts,
  type CompanyNews,
  type CompanyImplementation,
  type Signal,
  type ApolloContact
} from './cache-reader'

// ═══════════════════════════════════════════════════════════
// DIGEST GENERATOR
// Genera y actualiza el digest para campaign_accounts
// ═══════════════════════════════════════════════════════════

export interface CampaignAccountDigest {
  id: string
  campaign_account_id: string
  news_ids: string[]
  implementation_ids: string[]
  contact_ids: string[]
  buyer_persona_id: string | null
  signal_types_matched: string[]
  recommended_job_titles: string[]
  last_fetched_at: string | null
  new_items_count: number
  last_user_seen_at: string | null
  updated_at: string
  
  // Datos expandidos (no en DB, calculados)
  news?: CompanyNews[]
  implementations?: CompanyImplementation[]
  signals?: Signal[]
  contacts?: ApolloContact[]
  company?: any
}

/**
 * Genera o actualiza el digest de una cuenta en una campana
 */
export async function generateAccountDigest(
  campaignAccountId: string
): Promise<CampaignAccountDigest | null> {
  const adminClient = createAdminClient()
  
  // 1. Obtener el campaign_account con su company
  const { data: campaignAccount, error: caError } = await adminClient
    .schema('v3')
    .from('campaign_accounts')
    .select(`
      id,
      company_id,
      campaign_id,
      status,
      campaigns:campaign_id (
        id,
        buyer_persona_id,
        workspace_id
      )
    `)
    .eq('id', campaignAccountId)
    .single()
  
  if (caError || !campaignAccount) {
    console.error('Error fetching campaign account:', caError)
    return null
  }
  
  const companyId = campaignAccount.company_id
  const buyerPersonaId = (campaignAccount.campaigns as any)?.buyer_persona_id || null
  const workspaceId = (campaignAccount.campaigns as any)?.workspace_id
  
  // 2. Obtener datos del cache global
  const [news, implementations, signals, contacts] = await Promise.all([
    getCompanyNews(companyId),
    getCompanyImplementations(companyId),
    getCompanySignals(companyId),
    getCompanyCachedContacts(companyId)
  ])
  
  // 3. Obtener job titles recomendados si hay buyer persona o value profile
  let recommendedJobTitles: string[] = []
  if (workspaceId) {
    recommendedJobTitles = await getRecommendedJobTitles(workspaceId, buyerPersonaId)
  }
  
  // 4. Determinar signal types encontrados
  const signalTypesMatched = [...new Set(signals.map(s => s.signal_type))]
  
  // 5. Buscar digest existente
  const { data: existingDigest } = await adminClient
    .schema('v3')
    .from('campaign_account_digest')
    .select('*')
    .eq('campaign_account_id', campaignAccountId)
    .single()
  
  // 6. Calcular nuevos items si hay digest previo
  let newItemsCount = 0
  if (existingDigest?.last_user_seen_at) {
    const lastSeen = new Date(existingDigest.last_user_seen_at)
    newItemsCount = news.filter(n => new Date(n.created_at) > lastSeen).length +
                   implementations.filter(i => new Date(i.created_at) > lastSeen).length
  } else {
    newItemsCount = news.length + implementations.length
  }
  
  // 7. Crear o actualizar digest
  const digestData = {
    campaign_account_id: campaignAccountId,
    news_ids: news.map(n => n.id),
    implementation_ids: implementations.map(i => i.id),
    contact_ids: contacts.map(c => c.id),
    buyer_persona_id: buyerPersonaId,
    signal_types_matched: signalTypesMatched,
    recommended_job_titles: recommendedJobTitles,
    last_fetched_at: new Date().toISOString(),
    new_items_count: newItemsCount,
    updated_at: new Date().toISOString()
  }
  
  const { data: digest, error: upsertError } = await adminClient
    .schema('v3')
    .from('campaign_account_digest')
    .upsert(digestData, { onConflict: 'campaign_account_id' })
    .select()
    .single()
  
  if (upsertError) {
    console.error('Error upserting digest:', upsertError)
    return null
  }
  
  // 8. Retornar digest con datos expandidos
  return {
    ...digest,
    news,
    implementations,
    signals,
    contacts
  }
}

/**
 * Obtiene el digest de una cuenta con datos expandidos
 */
export async function getAccountDigest(
  campaignAccountId: string,
  includeData: boolean = true
): Promise<CampaignAccountDigest | null> {
  const adminClient = createAdminClient()
  
  // 1. Buscar digest existente
  const { data: digest, error } = await adminClient
    .schema('v3')
    .from('campaign_account_digest')
    .select('*')
    .eq('campaign_account_id', campaignAccountId)
    .single()
  
  if (error || !digest) {
    // Si no existe, generarlo
    return generateAccountDigest(campaignAccountId)
  }
  
  if (!includeData) {
    return digest
  }
  
  // 2. Obtener company_id del campaign_account
  const { data: campaignAccount } = await adminClient
    .schema('v3')
    .from('campaign_accounts')
    .select('company_id')
    .eq('id', campaignAccountId)
    .single()
  
  if (!campaignAccount) {
    return digest
  }
  
  // 3. Obtener datos expandidos
  const [news, implementations, signals, contacts, companyData] = await Promise.all([
    getCompanyNews(campaignAccount.company_id),
    getCompanyImplementations(campaignAccount.company_id),
    getCompanySignals(campaignAccount.company_id),
    getCompanyCachedContacts(campaignAccount.company_id),
    adminClient.from('companies').select('*').eq('id', campaignAccount.company_id).single()
  ])
  
  return {
    ...digest,
    news,
    implementations,
    signals,
    contacts,
    company: companyData.data
  }
}

/**
 * Marca el digest como visto por el usuario
 */
export async function markDigestAsSeen(campaignAccountId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return
  
  const adminClient = createAdminClient()
  
  await adminClient
    .schema('v3')
    .from('campaign_account_digest')
    .update({
      last_user_seen_at: new Date().toISOString(),
      new_items_count: 0
    })
    .eq('campaign_account_id', campaignAccountId)
}

/**
 * Obtiene job titles recomendados basado en el workspace value profile
 */
export async function getRecommendedJobTitles(
  workspaceId: string,
  buyerPersonaId?: string | null
): Promise<string[]> {
  const adminClient = createAdminClient()
  
  // 1. Si hay buyer persona especifico, usar sus job titles
  if (buyerPersonaId) {
    const { data: persona } = await adminClient
      .schema('v3')
      .from('buyer_personas')
      .select('recommended_job_titles')
      .eq('id', buyerPersonaId)
      .single()
    
    if (persona?.recommended_job_titles?.length) {
      return persona.recommended_job_titles
    }
  }
  
  // 2. Obtener workspace value profile
  const { data: valueProfile } = await adminClient
    .schema('v3')
    .from('workspace_value_profiles')
    .select('target_processes, target_technologies')
    .eq('workspace_id', workspaceId)
    .single()
  
  if (!valueProfile) {
    return getDefaultJobTitles()
  }
  
  // 3. Buscar job titles asociados a los procesos/tecnologias
  const processIds = (valueProfile.target_processes as any[] || [])
    .filter((p: any) => p.id)
    .map((p: any) => p.id)
  
  const technologyIds = (valueProfile.target_technologies as any[] || [])
    .filter((t: any) => t.id)
    .map((t: any) => t.id)
  
  const { data: jobTitles } = await adminClient
    .schema('v3')
    .from('dictionary_job_titles')
    .select('job_title')
    .or(`process_id.in.(${processIds.join(',')}),product_id.in.(${technologyIds.join(',')})`)
  
  if (jobTitles?.length) {
    const uniqueTitles = [...new Set(jobTitles.map(jt => jt.job_title))]
    return uniqueTitles.slice(0, 10)
  }
  
  return getDefaultJobTitles()
}

/**
 * Job titles por defecto cuando no hay perfil configurado
 */
function getDefaultJobTitles(): string[] {
  return [
    'CTO',
    'VP Engineering',
    'Director of Engineering',
    'Head of IT',
    'VP Technology'
  ]
}

/**
 * Obtiene todas las cuentas de una campana con su digest resumido
 */
export async function getCampaignAccountsWithDigest(campaignId: string): Promise<any[]> {
  const adminClient = createAdminClient()
  
  // Get campaign accounts from v3 schema
  const { data: accounts, error: accountsError } = await adminClient
    .schema('v3')
    .from('campaign_accounts')
    .select('id, company_id, status, prospection_status, tech_radar_run_at, apollo_run_at, added_at')
    .eq('campaign_id', campaignId)
    .eq('status', 'whitelisted')
    .order('added_at', { ascending: false })
  
  if (accountsError || !accounts) {
    console.error('Error fetching campaign accounts:', accountsError)
    return []
  }
  
  if (accounts.length === 0) return []
  
  // Get company data from public schema
  const companyIds = accounts.map(a => a.company_id)
  const { data: companies } = await adminClient
    .from('companies')
    .select('id, name, website, industry, linkedin_url, logo_url')
    .in('id', companyIds)
  
  const companiesMap = new Map(companies?.map(c => [c.id, {
    id: c.id,
    name: c.name,
    domain: c.website,
    industry: c.industry,
    linkedin_url: c.linkedin_url,
    logo_url: c.logo_url
  }]) || [])
  
  // Get digest data from v3 schema
  const accountIds = accounts.map(a => a.id)
  const { data: digests } = await adminClient
    .schema('v3')
    .from('campaign_account_digest')
    .select('campaign_account_id, id, new_items_count, last_user_seen_at, signal_types_matched, contact_ids')
    .in('campaign_account_id', accountIds)
  
  const digestsMap = new Map(digests?.map(d => [d.campaign_account_id, d]) || [])
  
  // Merge all data
  return accounts.map(account => ({
    ...account,
    companies: companiesMap.get(account.company_id) || null,
    digest: digestsMap.get(account.id) ? [digestsMap.get(account.id)] : null
  }))
}
