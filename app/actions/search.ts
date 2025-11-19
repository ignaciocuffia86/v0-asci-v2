"use server";

import { createClient } from "@/lib/supabase/server";

type SearchFilters = {
  technologies: string[];
  processes: string[];
  countries: string[]; // Changed from single country to array
  industry: string;
};

export async function searchCompanies(filters: SearchFilters) {
  const supabase = await createClient();

  // Build the query
  let query = supabase
    .from("companies")
    .select(`
      id,
      name,
      linkedin_url,
      website,
      industry,
      country,
      logo_url
    `);

  if (filters.countries.length > 0) {
    query = query.in('country', filters.countries);
  }
  
  // Apply optional industry filter
  if (filters.industry) {
    query = query.ilike("industry", `%${filters.industry}%`);
  }

  const { data: companies } = await query;

  if (!companies) return [];

  // For each company, count signals matching the filters
  const results = await Promise.all(
    companies.map(async (company) => {
      let signalQuery = supabase
        .from("signals")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id);

      // Filter by selected technologies or processes
      if (filters.technologies.length > 0 || filters.processes.length > 0) {
        const signalIds = [...filters.technologies, ...filters.processes];
        signalQuery = signalQuery.in("signal_id", signalIds);
      }

      const { count: signalCount } = await signalQuery;

      // Count unique contacts for this company
      const { count: contactCount } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("current_company_id", company.id);

      return {
        ...company,
        signal_count: signalCount || 0,
        contact_count: contactCount || 0,
      };
    })
  );

  // Filter out companies with 0 signals and sort by signal count
  return results
    .filter((r) => r.signal_count > 0)
    .sort((a, b) => b.signal_count - a.signal_count);
}
