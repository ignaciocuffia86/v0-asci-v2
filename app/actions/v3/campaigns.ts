"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentWorkspace, requireWorkspaceEditor } from "@/lib/v3/workspace";

// Types
export type CampaignType = "monitorear" | "prospectar" | "descubrir";

export interface Campaign {
  id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  type: CampaignType;
  buyer_persona_text: string | null;
  country_filter: string[] | null;
  account_count: number;
  max_accounts: number;
  enable_tech_radar: boolean;
  enable_apollo: boolean;
  enable_email_agent: boolean;
  enable_signals_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface CampaignAccount {
  id: string;
  campaign_id: string;
  company_id: string;
  status: "whitelisted" | "blacklisted" | "pending_match";
  match_source: "csv_import" | "manual" | "asci_recommendation";
  prospection_status: "pending" | "in_progress" | "completed" | null;
  tech_radar_run_at: string | null;
  apollo_run_at: string | null;
  added_at: string;
  added_by: string;
  // Joined from companies
  company?: {
    id: string;
    name: string;
    domain: string | null;
    linkedin_url: string | null;
    industry: string | null;
    logo_url: string | null;
  };
}

// Feature flags por tipo de campana
const CAMPAIGN_TYPE_FLAGS: Record<
  CampaignType,
  {
    enable_tech_radar: boolean;
    enable_apollo: boolean;
    enable_email_agent: boolean;
    enable_signals_only: boolean;
  }
> = {
  monitorear: {
    enable_tech_radar: false,
    enable_apollo: false,
    enable_email_agent: false,
    enable_signals_only: true,
  },
  prospectar: {
    enable_tech_radar: true,
    enable_apollo: true,
    enable_email_agent: true,
    enable_signals_only: false,
  },
  descubrir: {
    enable_tech_radar: true,
    enable_apollo: true,
    enable_email_agent: true,
    enable_signals_only: false,
  },
};

// ============================================================
// CAMPAIGNS CRUD
// ============================================================

export async function createCampaign(data: {
  name: string;
  type: CampaignType;
  buyer_persona_text?: string;
  country_filter?: string[];
}): Promise<{ success: boolean; campaignId?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const workspace = await getCurrentWorkspace();
  if (!workspace) return { success: false, error: "No workspace found" };

  // Check permissions
  const canEdit = await requireWorkspaceEditor();
  if (!canEdit) return { success: false, error: "No permission to create campaigns" };

  // Get feature flags for this type
  const flags = CAMPAIGN_TYPE_FLAGS[data.type];

  const { data: campaign, error } = await supabase
    .schema("v3")
    .from("campaigns")
    .insert({
      workspace_id: workspace.id,
      created_by: user.id,
      name: data.name,
      type: data.type,
      buyer_persona_text: data.buyer_persona_text || null,
      country_filter: data.country_filter || null,
      ...flags,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Error creating campaign:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/v3/campaigns");
  return { success: true, campaignId: campaign.id };
}

export async function getCampaigns(): Promise<Campaign[]> {
  const supabase = await createClient();
  const workspace = await getCurrentWorkspace();
  if (!workspace) return [];

  const { data, error } = await supabase
    .schema("v3")
    .from("campaigns")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching campaigns:", error);
    return [];
  }

  return data as Campaign[];
}

export async function getCampaign(campaignId: string): Promise<Campaign | null> {
  const supabase = await createClient();
  const workspace = await getCurrentWorkspace();
  if (!workspace) return null;

  const { data, error } = await supabase
    .schema("v3")
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("workspace_id", workspace.id)
    .single();

  if (error) {
    console.error("Error fetching campaign:", error);
    return null;
  }

  return data as Campaign;
}

export async function updateCampaign(
  campaignId: string,
  data: {
    name?: string;
    buyer_persona_text?: string;
    country_filter?: string[];
  }
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const workspace = await getCurrentWorkspace();
  if (!workspace) return { success: false, error: "No workspace found" };

  const canEdit = await requireWorkspaceEditor();
  if (!canEdit) return { success: false, error: "No permission" };

  const { error } = await supabase
    .schema("v3")
    .from("campaigns")
    .update({
      ...data,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("Error updating campaign:", error);
    return { success: false, error: error.message };
  }

  revalidatePath(`/v3/campaigns/${campaignId}`);
  return { success: true };
}

export async function deleteCampaign(
  campaignId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const workspace = await getCurrentWorkspace();
  if (!workspace) return { success: false, error: "No workspace found" };

  const canEdit = await requireWorkspaceEditor();
  if (!canEdit) return { success: false, error: "No permission" };

  const { error } = await supabase
    .schema("v3")
    .from("campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("Error deleting campaign:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/v3/campaigns");
  return { success: true };
}

// ============================================================
// CAMPAIGN ACCOUNTS
// ============================================================

export async function getCampaignAccounts(campaignId: string): Promise<CampaignAccount[]> {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  // Primero obtener las cuentas de v3
  const { data: accounts, error } = await supabase
    .schema("v3")
    .from("campaign_accounts")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("added_at", { ascending: false });

  if (error || !accounts) {
    console.error("Error fetching campaign accounts:", error);
    return [];
  }

  // Luego obtener los datos de companies de public (usando admin para bypasear RLS)
  const companyIds = accounts.map((a) => a.company_id);
  if (companyIds.length === 0) return accounts as CampaignAccount[];

  const { data: companies } = await adminClient
    .from("companies")
    .select("id, name, website, linkedin_url, industry, logo_url")
    .in("id", companyIds);

  // Merge - map website to domain for UI consistency
  const companiesMap = new Map(companies?.map((c) => [c.id, { 
    id: c.id, 
    name: c.name, 
    domain: c.website, 
    linkedin_url: c.linkedin_url, 
    industry: c.industry,
    logo_url: c.logo_url
  }]) || []);
  return accounts.map((account) => ({
    ...account,
    company: companiesMap.get(account.company_id),
  })) as CampaignAccount[];
}

export async function addAccountToCampaign(
  campaignId: string,
  companyId: string,
  source: "manual" | "csv_import" | "asci_recommendation" = "manual"
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const workspace = await getCurrentWorkspace();
  if (!workspace) return { success: false, error: "No workspace found" };

  // Verificar que la campana existe y pertenece al workspace
  const campaign = await getCampaign(campaignId);
  if (!campaign) return { success: false, error: "Campaign not found" };

  // Verificar limite de cuentas (100 por workspace)
  const { count } = await supabase
    .schema("v3")
    .from("campaign_accounts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);

  // Verificar total del workspace
  const { data: allCampaigns } = await supabase
    .schema("v3")
    .from("campaigns")
    .select("id")
    .eq("workspace_id", workspace.id);

  if (allCampaigns) {
    const campaignIds = allCampaigns.map((c) => c.id);
    const { count: totalCount } = await supabase
      .schema("v3")
      .from("campaign_accounts")
      .select("id", { count: "exact", head: true })
      .in("campaign_id", campaignIds);

    if ((totalCount || 0) >= 100) {
      return {
        success: false,
        error: "Account limit reached (100 per workspace). Upgrade to add more.",
      };
    }
  }

  // Verificar que no este ya en la campana
  const { data: existing } = await supabase
    .schema("v3")
    .from("campaign_accounts")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("company_id", companyId)
    .single();

  if (existing) {
    return { success: false, error: "Account already in campaign" };
  }

  // Crear la cuenta
  const { error } = await supabase.schema("v3").from("campaign_accounts").insert({
    campaign_id: campaignId,
    company_id: companyId,
    status: "whitelisted",
    match_source: source,
    added_by: user.id,
  });

  if (error) {
    console.error("Error adding account to campaign:", error);
    return { success: false, error: error.message };
  }

  // Actualizar contador de la campana
  await supabase
    .schema("v3")
    .from("campaigns")
    .update({ account_count: (count || 0) + 1 })
    .eq("id", campaignId);

  revalidatePath(`/v3/campaigns/${campaignId}`);
  return { success: true };
}

export async function removeAccountFromCampaign(
  campaignId: string,
  accountId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const workspace = await getCurrentWorkspace();
  if (!workspace) return { success: false, error: "No workspace found" };

  const canEdit = await requireWorkspaceEditor();
  if (!canEdit) return { success: false, error: "No permission" };

  const { error } = await supabase
    .schema("v3")
    .from("campaign_accounts")
    .delete()
    .eq("id", accountId)
    .eq("campaign_id", campaignId);

  if (error) {
    console.error("Error removing account:", error);
    return { success: false, error: error.message };
  }

  // Actualizar contador
  const { count } = await supabase
    .schema("v3")
    .from("campaign_accounts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);

  await supabase
    .schema("v3")
    .from("campaigns")
    .update({ account_count: count || 0 })
    .eq("id", campaignId);

  revalidatePath(`/v3/campaigns/${campaignId}`);
  return { success: true };
}

export async function updateAccountStatus(
  accountId: string,
  status: "whitelisted" | "blacklisted"
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();

  const canEdit = await requireWorkspaceEditor();
  if (!canEdit) return { success: false, error: "No permission" };

  const { error } = await supabase
    .schema("v3")
    .from("campaign_accounts")
    .update({ status })
    .eq("id", accountId);

  if (error) {
    console.error("Error updating account status:", error);
    return { success: false, error: error.message };
  }

  revalidatePath("/v3/campaigns");
  return { success: true };
}

// ============================================================
// SEARCH COMPANIES (para agregar manualmente)
// ============================================================

export async function searchCompanies(
  query: string
): Promise<{ id: string; name: string; domain: string | null; industry: string | null; logo_url: string | null }[]> {
  if (!query || query.length < 2) return [];

  const adminClient = createAdminClient();

  // Buscar por nombre, website o normalized_name
  // Solo traer compañías con linkedin_url (tienen info normalizada/enriquecida)
  const { data, error } = await adminClient
    .from("companies")
    .select("id, name, website, industry, logo_url, linkedin_url")
    .or(`name.ilike.%${query}%,website.ilike.%${query}%,normalized_name.ilike.%${query}%`)
    .not("linkedin_url", "is", null)
    .order("name")
    .limit(20);

  if (error) {
    console.error("[v0] Error searching companies:", error);
    return [];
  }

  // Map website to domain for consistency with UI
  return (data || []).map(c => ({
    id: c.id,
    name: c.name,
    domain: c.website,
    industry: c.industry,
    logo_url: c.logo_url
  }));
}

// ============================================================
// WORKSPACE ACCOUNT STATS
// ============================================================

export async function getWorkspaceAccountStats(): Promise<{
  total: number;
  limit: number;
  remaining: number;
}> {
  const supabase = await createClient();
  const workspace = await getCurrentWorkspace();
  if (!workspace) return { total: 0, limit: 100, remaining: 100 };

  const { data: campaigns } = await supabase
    .schema("v3")
    .from("campaigns")
    .select("id")
    .eq("workspace_id", workspace.id);

  if (!campaigns || campaigns.length === 0) {
    return { total: 0, limit: 100, remaining: 100 };
  }

  const campaignIds = campaigns.map((c) => c.id);
  const { count } = await supabase
    .schema("v3")
    .from("campaign_accounts")
    .select("id", { count: "exact", head: true })
    .in("campaign_id", campaignIds);

  const total = count || 0;
  return { total, limit: 100, remaining: 100 - total };
}
