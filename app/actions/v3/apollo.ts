"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireWorkspaceMember } from "@/lib/v3/workspace"
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
  
  const campaign = account.campaigns as { workspace_id: string; buyer_persona_id: string | null }
  
  // Get workspace value profile
  const { data: valueProfile } = await admin
    .schema('v3')
    .from('workspace_value_profiles')
    .select('profile_summary, target_technologies, target_processes')
    .eq('workspace_id', campaign.workspace_id)
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
      const product = signal.dictionary_products as { name: string }
      if (product.name) technologies.push(product.name)
    }
    if (signal.signal_type === 'process' && signal.dictionary_processes) {
      const process = signal.dictionary_processes as { name: string }
      if (process.name) processes.push(process.name)
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
    const process = dt.dictionary_processes as { name: string } | null
    const product = dt.dictionary_products as { name: string } | null
    
    if (process && processNames.some(p => p.toLowerCase() === process.name?.toLowerCase())) {
      matchedTitles.push(dt.job_title)
    }
    if (product && techNames.some(t => t.toLowerCase() === product.name?.toLowerCase())) {
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
  
  const campaign = account.campaigns as { workspace_id: string }
  
  try {
    await requireWorkspaceMember(campaign.workspace_id)
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
  const apolloIds = searchResult.people.map(p => p.id)
  const enrichResult = await enrichMany(apolloIds, {
    userId: user.id,
    companyId: company.id,
  })
  
  // Save to cache
  const contactsToSave = enrichResult.enriched.map(person => ({
    apollo_id: person.id,
    company_id: company.id,
    name: person.name,
    first_name: person.firstName,
    last_name: person.lastName,
    title: person.title,
    email: person.email,
    phone: person.phone,
    linkedin_url: person.linkedinUrl,
    photo_url: person.photoUrl,
    seniority: person.seniority,
    departments: person.departments,
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
    contacts: enrichResult.enriched.map(mapEnrichedPerson),
    stats: {
      totalFound: searchResult.totalEntries,
      enriched: enrichResult.enriched.length,
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
    id: person.id,
    apolloId: person.id,
    name: person.name,
    firstName: person.firstName,
    lastName: person.lastName,
    title: person.title,
    email: person.email,
    phone: person.phone,
    linkedinUrl: person.linkedinUrl,
    photoUrl: person.photoUrl,
    seniority: person.seniority,
    departments: person.departments,
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
