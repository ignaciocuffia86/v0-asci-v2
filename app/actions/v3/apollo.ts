"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/v3/workspace"
import { searchPeople, type SearchPeopleOpts } from "@/lib/apollo/search"
import { enrichMany, type EnrichedPerson } from "@/lib/apollo/enrich"
import { inferJobTitles } from "@/app/actions/apollo"
import { sanitizeTitleList } from "@/lib/apollo/title-validator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApolloSearchResult = {
  success: boolean
  accountId: string
  companyId: string
  companyName: string
  contacts: ApolloContact[]
  stats: {
    totalFound: number
    enriched: number
    saved: number
    fromCache: boolean
  }
  recommendedTitles?: string[]
  error?: string
}

export type ApolloContact = {
  id: string
  apolloId: string
  name: string
  firstName: string
  lastName: string
  title: string
  email: string | null
  phone: string | null
  linkedinUrl: string | null
  photoUrl: string | null
  seniority: string | null
  departments: string[]
}

export type JobTitleRecommendation = {
  titles: string[]
  reasoning: string
}

// ---------------------------------------------------------------------------
// Get recommended job titles for a campaign account
// ---------------------------------------------------------------------------

export async function getRecommendedJobTitles(
  campaignAccountId: string
): Promise<JobTitleRecommendation> {
  const supabase = await createClient()
  const admin = createAdminClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { titles: [], reasoning: 'Not authenticated' }
  }
  
  // Get the account and its campaign
  const { data: account, error: accountError } = await admin
    .schema('v3')
    .from('campaign_accounts')
    .select(`
      id,
      company_id,
      campaigns!inner (
        id,
        workspace_id,
        buyer_persona_id
      )
    `)
    .eq('id', campaignAccountId)
    .single()
  
  if (accountError || !account) {
    return { titles: [], reasoning: 'Account not found' }
  }
  
  // Extract campaign data safely
  const campaignData = Array.isArray(account.campaigns) ? account.campaigns[0] : account.campaigns
  const workspaceId = campaignData?.workspace_id as string
  const buyerPersonaId = campaignData?.buyer_persona_id as string | null
  
  if (!workspaceId) {
    return { titles: [], reasoning: 'Workspace not found' }
  }
  
  // Get workspace value profile
  const { data: valueProfile } = await admin
    .schema('v3')
    .from('workspace_value_profiles')
    .select('profile_summary, target_technologies, target_processes')
    .eq('workspace_id', workspaceId)
    .single()
  
  // Get company signals from v2 cache
  const { data: signals } = await admin
    .from('signals')
    .select('signal_type, dictionary_processes(name), dictionary_products(name)')
    .eq('company_id', account.company_id)
    .limit(20)
  
  const technologies: string[] = []
  const processes: string[] = []
  
  signals?.forEach(signal => {
    if (signal.signal_type === 'technology' && signal.dictionary_products) {
      const products = Array.isArray(signal.dictionary_products) 
        ? signal.dictionary_products 
        : [signal.dictionary_products]
      products.forEach((product: { name?: string }) => {
        if (product.name) technologies.push(product.name)
      })
    }
    if (signal.signal_type === 'process' && signal.dictionary_processes) {
      const procs = Array.isArray(signal.dictionary_processes) 
        ? signal.dictionary_processes 
        : [signal.dictionary_processes]
      procs.forEach((proc: { name?: string }) => {
        if (proc.name) processes.push(proc.name)
      })
    }
  })
  
  // Also check company_implementations for detected tech
  const { data: implementations } = await admin
    .from('company_implementations')
    .select('technology, provider_name')
    .eq('company_id', account.company_id)
    .not('technology', 'is', null)
    .limit(10)
  
  implementations?.forEach(impl => {
    if (impl.technology && !technologies.includes(impl.technology)) {
      technologies.push(impl.technology)
    }
    if (impl.provider_name && !technologies.includes(impl.provider_name)) {
      technologies.push(impl.provider_name)
    }
  })
  
  // First check if we have pre-configured job titles in v3.dictionary_job_titles
  const processNames = [...new Set(processes)]
  const techNames = [...new Set(technologies)]
  
  const { data: dictTitles } = await admin
    .schema('v3')
    .from('dictionary_job_titles')
    .select(`
      job_title,
      seniority,
      dictionary_processes!left (name),
      dictionary_products!left (name)
    `)
    .or(`process_id.not.is.null,product_id.not.is.null`)
    .limit(50)
  
  // Filter dictionary titles that match detected signals
  const matchedTitles: string[] = []
  dictTitles?.forEach(dt => {
    const processData = dt.dictionary_processes
    const productData = dt.dictionary_products
    
    const processName = Array.isArray(processData) 
      ? processData[0]?.name 
      : (processData as { name?: string } | null)?.name
    const productName = Array.isArray(productData) 
      ? productData[0]?.name 
      : (productData as { name?: string } | null)?.name
    
    if (processName && processNames.some(p => p.toLowerCase() === processName.toLowerCase())) {
      matchedTitles.push(dt.job_title)
    }
    if (productName && techNames.some(t => t.toLowerCase() === productName.toLowerCase())) {
      matchedTitles.push(dt.job_title)
    }
  })
  
  // If we have dictionary matches, use those
  if (matchedTitles.length >= 3) {
    const uniqueTitles = [...new Set(matchedTitles)].slice(0, 12)
    return {
      titles: uniqueTitles,
      reasoning: `Job titles basados en tecnologias detectadas: ${techNames.slice(0, 3).join(', ')}`,
    }
  }
  
  // Otherwise, infer using AI (reuse v2 function)
  const result = await inferJobTitles(
    technologies.slice(0, 10),
    processes.slice(0, 10),
    valueProfile ? {
      profileSummary: valueProfile.profile_summary || '',
      targetTechnologies: (valueProfile.target_technologies as string[]) || [],
      targetProcesses: (valueProfile.target_processes as string[]) || [],
    } : null
  )
  
  return {
    titles: result.jobTitles,
    reasoning: result.reasoning,
  }
}

// ---------------------------------------------------------------------------
// Search decision makers in Apollo
// ---------------------------------------------------------------------------

export async function searchDecisionMakers(
  campaignAccountId: string,
  jobTitles: string[],
  options?: {
    maxResults?: number
    country?: string
    seniorities?: string[]
  }
): Promise<ApolloSearchResult> {
  const supabase = await createClient()
  const admin = createAdminClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return {
      success: false,
      accountId: campaignAccountId,
      companyId: '',
      companyName: '',
      contacts: [],
      stats: { totalFound: 0, enriched: 0, saved: 0, fromCache: false },
      error: 'Not authenticated',
    }
  }
  
  // Sanitize job titles
  const sanitized = sanitizeTitleList(jobTitles)
  if (sanitized.accepted.length === 0) {
    return {
      success: false,
      accountId: campaignAccountId,
      companyId: '',
      companyName: '',
      contacts: [],
      stats: { totalFound: 0, enriched: 0, saved: 0, fromCache: false },
      error: 'No valid job titles provided',
    }
  }
  
  // Get the account and verify access
  const { data: account, error: accountError } = await admin
    .schema('v3')
    .from('campaign_accounts')
    .select(`
      id,
      company_id,
      campaigns!inner (
        id,
        workspace_id
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
      contacts: [],
      stats: { totalFound: 0, enriched: 0, saved: 0, fromCache: false },
      error: 'Account not found',
    }
  }
  
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
      companyId: account.company_id,
      companyName: '',
      contacts: [],
      stats: { totalFound: 0, enriched: 0, saved: 0, fromCache: false },
      error: 'Access denied',
    }
  }
  
  // Get company details
  const { data: company, error: companyError } = await admin
    .from('companies')
    .select('id, name, domain, linkedin_url, country')
    .eq('id', account.company_id)
    .single()
  
  if (companyError || !company) {
    return {
      success: false,
      accountId: campaignAccountId,
      companyId: account.company_id,
      companyName: '',
      contacts: [],
      stats: { totalFound: 0, enriched: 0, saved: 0, fromCache: false },
      error: 'Company not found',
    }
  }
  
  // First check cache for existing contacts
  const { data: cachedContacts } = await admin
    .from('apollo_contacts_cache')
    .select('*')
    .eq('company_id', company.id)
    .in('title', sanitized.accepted)
    .limit(options?.maxResults || 20)
  
  if (cachedContacts && cachedContacts.length >= 5) {
    // Return cached results
    return {
      success: true,
      accountId: campaignAccountId,
      companyId: company.id,
      companyName: company.name,
      contacts: cachedContacts.map(mapCachedContact),
      stats: {
        totalFound: cachedContacts.length,
        enriched: cachedContacts.length,
        saved: 0,
        fromCache: true,
      },
    }
  }
  
  // Search in Apollo
  const searchOpts: SearchPeopleOpts = {
    domain: company.domain || undefined,
    jobTitles: sanitized.accepted,
    maxResults: options?.maxResults || 20,
    country: options?.country || company.country || undefined,
    seniorities: options?.seniorities,
    userId: user.id,
    bookmarkId: null,  // v3 no usa bookmarks
    companyId: company.id,
  }
  
  const searchResult = await searchPeople(searchOpts)
  
  if (!searchResult.ok) {
    return {
      success: false,
      accountId: campaignAccountId,
      companyId: company.id,
      companyName: company.name,
      contacts: [],
      stats: { totalFound: 0, enriched: 0, saved: 0, fromCache: false },
      error: searchResult.error,
    }
  }
  
  if (searchResult.people.length === 0) {
    return {
      success: true,
      accountId: campaignAccountId,
      companyId: company.id,
      companyName: company.name,
      contacts: [],
      stats: { totalFound: 0, enriched: 0, saved: 0, fromCache: false },
    }
  }
  
  // Enrich contacts
  const enrichResult = await enrichMany(searchResult.people, {
    userId: user.id,
    bookmarkId: null,
    companyId: company.id,
  })
  
  // Save to cache
  const contactsToSave = enrichResult.map(person => ({
    apollo_id: person.apolloId,
    company_id: company.id,
    name: person.fullName || `${person.firstName || ''} ${person.lastName || ''}`.trim(),
    first_name: person.firstName || null,
    last_name: person.lastName || null,
    title: person.title || null,
    email: person.email || null,
    phone: person.mobilePhone || person.corporatePhone || null,
    linkedin_url: person.linkedinUrl || null,
    photo_url: person.photoUrl || null,
    seniority: person.seniority || null,
    departments: person.departments || null,
    enriched_at: new Date().toISOString(),
  }))
  
  if (contactsToSave.length > 0) {
    await admin
      .from('apollo_contacts_cache')
      .upsert(contactsToSave, {
        onConflict: 'apollo_id',
        ignoreDuplicates: false,
      })
  }
  
  // Update campaign account
  await admin
    .schema('v3')
    .from('campaign_accounts')
    .update({
      apollo_run_at: new Date().toISOString(),
    })
    .eq('id', campaignAccountId)
  
  return {
    success: true,
    accountId: campaignAccountId,
    companyId: company.id,
    companyName: company.name,
    contacts: enrichResult.map(mapEnrichedPerson),
    stats: {
      totalFound: searchResult.totalEntries,
      enriched: enrichResult.length,
      saved: contactsToSave.length,
      fromCache: false,
    },
  }
}

// ---------------------------------------------------------------------------
// Get cached contacts for an account
// ---------------------------------------------------------------------------

export async function getCachedContacts(
  companyId: string,
  limit: number = 20
): Promise<ApolloContact[]> {
  const admin = createAdminClient()
  
  const { data: contacts } = await admin
    .from('apollo_contacts_cache')
    .select('*')
    .eq('company_id', companyId)
    .order('enriched_at', { ascending: false })
    .limit(limit)
  
  return contacts?.map(mapCachedContact) || []
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapEnrichedPerson(person: EnrichedPerson): ApolloContact {
  return {
    id: person.apolloId || '',
    apolloId: person.apolloId || '',
    name: person.fullName || `${person.firstName || ''} ${person.lastName || ''}`.trim(),
    firstName: person.firstName || '',
    lastName: person.lastName || '',
    title: person.title || '',
    email: person.email || null,
    phone: person.mobilePhone || person.corporatePhone || null,
    linkedinUrl: person.linkedinUrl || null,
    photoUrl: person.photoUrl || null,
    seniority: person.seniority || null,
    departments: person.departments || null,
  }
}

function mapCachedContact(contact: {
  apollo_id: string
  name: string
  first_name: string
  last_name: string
  title: string
  email: string | null
  phone: string | null
  linkedin_url: string | null
  photo_url: string | null
  seniority: string | null
  departments: string[] | null
}): ApolloContact {
  return {
    id: contact.apollo_id,
    apolloId: contact.apollo_id,
    name: contact.name,
    firstName: contact.first_name,
    lastName: contact.last_name,
    title: contact.title,
    email: contact.email,
    phone: contact.phone,
    linkedinUrl: contact.linkedin_url,
    photoUrl: contact.photo_url,
    seniority: contact.seniority,
    departments: contact.departments || [],
  }
}
