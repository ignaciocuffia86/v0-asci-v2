'use server'

import { createAdminClient } from '@/lib/supabase/admin'

// ═══════════════════════════════════════════════════════════
// CACHE READER
// Lee el cache global de v2 usando service_role (bypasea RLS)
// ═══════════════════════════════════════════════════════════

export interface CompanyNews {
  id: string
  company_id: string
  title: string
  summary: string
  content: string | null
  source_url: string
  source_name: string | null
  published_at: string | null
  sentiment: string | null
  relevance_score: number | null
  categories: string[] | null
  created_at: string
}

export interface CompanyImplementation {
  id: string
  company_id: string
  technology_name: string
  technology_category: string | null
  description: string | null
  source_url: string
  confidence_score: number | null
  evidence_type: string | null
  detected_at: string
  created_at: string
}

export interface Signal {
  id: string
  contact_id: string | null
  company_id: string | null
  signal_type: string
  signal_id: string
  signal_name: string | null
  detected_at: string
  context: any
}

export interface ApolloContact {
  id: string
  apollo_person_id: string
  company_id: string | null
  first_name: string
  last_name: string
  full_name: string
  title: string | null
  email: string | null
  linkedin_url: string | null
  phone: string | null
  seniority: string | null
  departments: string[] | null
  photo_url: string | null
  created_at: string
  updated_at: string
}

/**
 * Obtiene noticias de una empresa del cache global
 * Usa service_role para bypassear RLS
 */
export async function getCompanyNews(companyId: string): Promise<CompanyNews[]> {
  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from('company_news')
    .select('*')
    .eq('company_id', companyId)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(50)
  
  if (error) {
    console.error('Error fetching company news:', error)
    return []
  }
  
  return data || []
}

/**
 * Obtiene implementaciones tecnologicas de una empresa del cache global
 * Usa service_role para bypassear RLS
 */
export async function getCompanyImplementations(companyId: string): Promise<CompanyImplementation[]> {
  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from('company_implementations')
    .select('*')
    .eq('company_id', companyId)
    .order('detected_at', { ascending: false, nullsFirst: false })
    .limit(50)
  
  if (error) {
    console.error('Error fetching company implementations:', error)
    return []
  }
  
  return data || []
}

/**
 * Obtiene senales de una empresa
 */
export async function getCompanySignals(companyId: string): Promise<Signal[]> {
  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from('signals')
    .select('*')
    .eq('company_id', companyId)
    .order('detected_at', { ascending: false })
    .limit(100)
  
  if (error) {
    console.error('Error fetching signals:', error)
    return []
  }
  
  return data || []
}

/**
 * Obtiene contactos del cache de Apollo para una empresa
 */
export async function getCompanyCachedContacts(companyId: string): Promise<ApolloContact[]> {
  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from('apollo_contacts_cache')
    .select('*')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false })
    .limit(50)
  
  if (error) {
    console.error('Error fetching apollo contacts cache:', error)
    return []
  }
  
  return data || []
}

/**
 * Obtiene job postings de una empresa
 */
export async function getCompanyJobPostings(companyId: string): Promise<any[]> {
  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from('job_postings')
    .select('*')
    .eq('company_id', companyId)
    .order('posted_at', { ascending: false, nullsFirst: false })
    .limit(30)
  
  if (error) {
    console.error('Error fetching job postings:', error)
    return []
  }
  
  return data || []
}

/**
 * Obtiene datos completos de una empresa
 */
export async function getCompanyData(companyId: string): Promise<{
  company: any | null
  news: CompanyNews[]
  implementations: CompanyImplementation[]
  signals: Signal[]
  contacts: ApolloContact[]
  jobPostings: any[]
}> {
  const supabase = createAdminClient()
  
  // Fetch company data
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single()
  
  // Fetch all related data in parallel
  const [news, implementations, signals, contacts, jobPostings] = await Promise.all([
    getCompanyNews(companyId),
    getCompanyImplementations(companyId),
    getCompanySignals(companyId),
    getCompanyCachedContacts(companyId),
    getCompanyJobPostings(companyId)
  ])
  
  return {
    company,
    news,
    implementations,
    signals,
    contacts,
    jobPostings
  }
}
