"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { getCurrentWorkspace, requireWorkspaceEditor } from "./workspace";
import { addAccountToCampaign } from "./campaigns";

// Types
export interface CsvImport {
  id: string;
  campaign_id: string;
  uploaded_by: string;
  filename: string;
  total_rows: number;
  status: "processing" | "pending_review" | "completed" | "failed";
  created_at: string;
}

export interface CsvImportRow {
  id: string;
  import_id: string;
  row_number: number;
  raw_company_name: string;
  raw_domain: string | null;
  normalized_name: string | null;
  normalized_domain: string | null;
  match_status: "auto_matched" | "needs_review" | "ambiguous" | "no_match" | "confirmed" | "ignored";
  matched_company_id: string | null;
  match_candidates: MatchCandidate[] | null;
  match_method: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  // Joined
  matched_company?: {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
  };
}

export interface MatchCandidate {
  company_id: string;
  name: string;
  domain: string | null;
  score: number;
  match_reason: string;
}

export interface CsvImportWithRows extends CsvImport {
  rows: CsvImportRow[];
}

// ============================================================
// NORMALIZATION FUNCTIONS
// ============================================================

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|sa|srl|corp|corporation|ltd|gmbh|limited|company|co|group)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, "")
    .replace(/\/.*$/, "")
    .trim();
}

// ============================================================
// FUZZY MATCHING
// ============================================================

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function fuzzyRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

function isNameSimilar(csvName: string, dbName: string): { similar: boolean; score: number } {
  const n1 = normalizeCompanyName(csvName);
  const n2 = normalizeCompanyName(dbName);

  // Exact match after normalization
  if (n1 === n2) return { similar: true, score: 1.0 };

  // Contains check
  if (n1.includes(n2) || n2.includes(n1)) return { similar: true, score: 0.95 };

  // Fuzzy ratio
  const ratio = fuzzyRatio(n1, n2);
  return { similar: ratio >= 0.85, score: ratio };
}

// ============================================================
// MATCHING ENGINE
// ============================================================

interface MatchResult {
  status: "auto_matched" | "needs_review" | "ambiguous" | "no_match";
  matched_company_id: string | null;
  candidates: MatchCandidate[];
  match_method: string | null;
}

async function matchCsvRow(
  rawName: string,
  rawDomain: string | null
): Promise<MatchResult> {
  const adminClient = createAdminClient();
  const normalizedName = normalizeCompanyName(rawName);
  const normalizedDomain = rawDomain ? normalizeDomain(rawDomain) : null;

  const candidates: MatchCandidate[] = [];

  // PASO 1: Si tenemos dominio, buscar match exacto por dominio
  if (normalizedDomain) {
    const { data: domainMatches } = await adminClient
      .from("companies")
      .select("id, name, domain, industry")
      .ilike("domain", `%${normalizedDomain}%`)
      .limit(10);

    if (domainMatches && domainMatches.length > 0) {
      for (const company of domainMatches) {
        const companyDomain = company.domain ? normalizeDomain(company.domain) : "";
        
        // Match exacto de dominio
        if (companyDomain === normalizedDomain) {
          const nameSimilarity = isNameSimilar(rawName, company.name);
          
          // Dominio exacto + nombre similar = auto_matched
          if (nameSimilarity.similar) {
            return {
              status: "auto_matched",
              matched_company_id: company.id,
              candidates: [{
                company_id: company.id,
                name: company.name,
                domain: company.domain,
                score: 1.0,
                match_reason: "domain_exact_name_similar",
              }],
              match_method: "domain_exact",
            };
          }
          
          // Dominio exacto pero nombre diferente = needs_review (podria ser rebrand)
          candidates.push({
            company_id: company.id,
            name: company.name,
            domain: company.domain,
            score: 0.8,
            match_reason: "domain_exact_name_different",
          });
        }
      }
    }
  }

  // PASO 2: Buscar por nombre
  const { data: nameMatches } = await adminClient
    .from("companies")
    .select("id, name, domain, industry")
    .ilike("name", `%${normalizedName.split(" ")[0]}%`) // Buscar por primera palabra
    .limit(30);

  if (nameMatches) {
    for (const company of nameMatches) {
      // Evitar duplicados
      if (candidates.some((c) => c.company_id === company.id)) continue;

      const nameSimilarity = isNameSimilar(rawName, company.name);
      
      if (nameSimilarity.similar) {
        candidates.push({
          company_id: company.id,
          name: company.name,
          domain: company.domain,
          score: nameSimilarity.score,
          match_reason: "name_fuzzy",
        });
      }
    }
  }

  // Ordenar por score
  candidates.sort((a, b) => b.score - a.score);

  // Determinar resultado
  if (candidates.length === 0) {
    return {
      status: "no_match",
      matched_company_id: null,
      candidates: [],
      match_method: null,
    };
  }

  if (candidates.length === 1 && candidates[0].score >= 0.95) {
    return {
      status: "auto_matched",
      matched_company_id: candidates[0].company_id,
      candidates: candidates.slice(0, 5),
      match_method: "name_high_confidence",
    };
  }

  if (candidates.length === 1) {
    return {
      status: "needs_review",
      matched_company_id: candidates[0].company_id,
      candidates: candidates.slice(0, 5),
      match_method: "name_single_match",
    };
  }

  // Multiples candidatos
  return {
    status: "ambiguous",
    matched_company_id: null,
    candidates: candidates.slice(0, 5),
    match_method: "multiple_candidates",
  };
}

// ============================================================
// CSV IMPORT ACTIONS
// ============================================================

export async function createCsvImport(
  campaignId: string,
  filename: string,
  rows: { company_name: string; domain?: string }[]
): Promise<{ success: boolean; importId?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const canEdit = await requireWorkspaceEditor();
  if (!canEdit) return { success: false, error: "No permission" };

  // Crear import
  const { data: importData, error: importError } = await supabase
    .schema("v3")
    .from("csv_imports")
    .insert({
      campaign_id: campaignId,
      uploaded_by: user.id,
      filename,
      total_rows: rows.length,
      status: "processing",
    })
    .select("id")
    .single();

  if (importError || !importData) {
    console.error("Error creating csv import:", importError);
    return { success: false, error: importError?.message || "Failed to create import" };
  }

  // Procesar cada fila
  const importRows = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const matchResult = await matchCsvRow(row.company_name, row.domain || null);

    importRows.push({
      import_id: importData.id,
      row_number: i + 1,
      raw_company_name: row.company_name,
      raw_domain: row.domain || null,
      normalized_name: normalizeCompanyName(row.company_name),
      normalized_domain: row.domain ? normalizeDomain(row.domain) : null,
      match_status: matchResult.status,
      matched_company_id: matchResult.matched_company_id,
      match_candidates: matchResult.candidates,
      match_method: matchResult.match_method,
    });
  }

  // Insertar filas
  const { error: rowsError } = await supabase
    .schema("v3")
    .from("csv_import_rows")
    .insert(importRows);

  if (rowsError) {
    console.error("Error inserting import rows:", rowsError);
    // Limpiar import
    await supabase.schema("v3").from("csv_imports").delete().eq("id", importData.id);
    return { success: false, error: rowsError.message };
  }

  // Actualizar status del import
  const hasUnresolved = importRows.some(
    (r) => r.match_status !== "auto_matched"
  );
  await supabase
    .schema("v3")
    .from("csv_imports")
    .update({ status: hasUnresolved ? "pending_review" : "completed" })
    .eq("id", importData.id);

  // Si todo fue auto_matched, crear las cuentas automaticamente
  if (!hasUnresolved) {
    for (const row of importRows) {
      if (row.matched_company_id) {
        await addAccountToCampaign(campaignId, row.matched_company_id, "csv_import");
      }
    }
  }

  revalidatePath(`/v3/campaigns/${campaignId}`);
  return { success: true, importId: importData.id };
}

export async function getCsvImportWithRows(importId: string): Promise<CsvImportWithRows | null> {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  // Get import
  const { data: importData, error: importError } = await supabase
    .schema("v3")
    .from("csv_imports")
    .select("*")
    .eq("id", importId)
    .single();

  if (importError || !importData) {
    console.error("Error fetching csv import:", importError);
    return null;
  }

  // Get rows
  const { data: rows, error: rowsError } = await supabase
    .schema("v3")
    .from("csv_import_rows")
    .select("*")
    .eq("import_id", importId)
    .order("row_number", { ascending: true });

  if (rowsError) {
    console.error("Error fetching import rows:", rowsError);
    return null;
  }

  // Get matched companies
  const matchedCompanyIds = rows
    ?.filter((r) => r.matched_company_id)
    .map((r) => r.matched_company_id) || [];

  let companiesMap = new Map();
  if (matchedCompanyIds.length > 0) {
    const { data: companies } = await adminClient
      .from("companies")
      .select("id, name, domain, industry")
      .in("id", matchedCompanyIds);

    companiesMap = new Map(companies?.map((c) => [c.id, c]) || []);
  }

  return {
    ...importData,
    rows: (rows || []).map((row) => ({
      ...row,
      matched_company: row.matched_company_id
        ? companiesMap.get(row.matched_company_id)
        : undefined,
    })),
  } as CsvImportWithRows;
}

export async function confirmCsvMatch(
  rowId: string,
  companyId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const canEdit = await requireWorkspaceEditor();
  if (!canEdit) return { success: false, error: "No permission" };

  // Obtener la fila y su import
  const { data: row } = await supabase
    .schema("v3")
    .from("csv_import_rows")
    .select("*, csv_imports!inner(campaign_id)")
    .eq("id", rowId)
    .single();

  if (!row) return { success: false, error: "Row not found" };

  // Actualizar la fila
  const { error } = await supabase
    .schema("v3")
    .from("csv_import_rows")
    .update({
      match_status: "confirmed",
      matched_company_id: companyId,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", rowId);

  if (error) {
    console.error("Error confirming match:", error);
    return { success: false, error: error.message };
  }

  // Crear la cuenta en la campana
  const campaignId = (row.csv_imports as { campaign_id: string }).campaign_id;
  await addAccountToCampaign(campaignId, companyId, "csv_import");

  // Verificar si el import esta completo
  await checkAndUpdateImportStatus(row.import_id);

  return { success: true };
}

export async function ignoreCsvRow(rowId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const canEdit = await requireWorkspaceEditor();
  if (!canEdit) return { success: false, error: "No permission" };

  const { data: row } = await supabase
    .schema("v3")
    .from("csv_import_rows")
    .select("import_id")
    .eq("id", rowId)
    .single();

  if (!row) return { success: false, error: "Row not found" };

  const { error } = await supabase
    .schema("v3")
    .from("csv_import_rows")
    .update({
      match_status: "ignored",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    })
    .eq("id", rowId);

  if (error) {
    console.error("Error ignoring row:", error);
    return { success: false, error: error.message };
  }

  await checkAndUpdateImportStatus(row.import_id);

  return { success: true };
}

async function checkAndUpdateImportStatus(importId: string): Promise<void> {
  const supabase = await createClient();

  // Verificar si todas las filas estan resueltas
  const { data: unresolvedRows } = await supabase
    .schema("v3")
    .from("csv_import_rows")
    .select("id")
    .eq("import_id", importId)
    .in("match_status", ["needs_review", "ambiguous", "no_match"]);

  if (!unresolvedRows || unresolvedRows.length === 0) {
    await supabase
      .schema("v3")
      .from("csv_imports")
      .update({ status: "completed" })
      .eq("id", importId);
  }
}

export async function getCsvImportsForCampaign(campaignId: string): Promise<CsvImport[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .schema("v3")
    .from("csv_imports")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching csv imports:", error);
    return [];
  }

  return data as CsvImport[];
}
