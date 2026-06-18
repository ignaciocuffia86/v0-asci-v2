import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { generateContent } from "@/lib/v3/ai"
import { NextRequest, NextResponse } from "next/server"

export const maxDuration = 60

type UnmappedItem = { originalValue: string; sourceType: "company" | "document"; count: number }

/**
 * Suggest master_industry mappings for unmapped industry texts using AI.
 * - Superadmin only.
 * - Processes the top-N most frequent unmapped values (default 100).
 * - Maps each value to a canonical master_industries id (closed taxonomy) or skips it.
 * - Writes rules into industry_mappings with is_auto_mapped = true and propagates
 *   the mapping to companies / document_tags (only where master_industry_id is NULL).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "superadmin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const limit = Math.min(Math.max(Number(body?.limit) || 100, 1), 200)
  const source = (body?.source as string) || "all"

  const adminClient = createAdminClient()

  // 1. Collect unmapped industry texts (top-N by company/doc count)
  const unmapped: UnmappedItem[] = []
  if (source === "all" || source === "company") {
    const { data } = await adminClient.rpc("get_unmapped_company_industries")
    if (data) {
      unmapped.push(
        ...data.map((r: { industry: string; count: number }) => ({
          originalValue: r.industry,
          sourceType: "company" as const,
          count: r.count,
        })),
      )
    }
  }
  if (source === "all" || source === "document") {
    const { data } = await adminClient.rpc("get_unmapped_document_industries")
    if (data) {
      unmapped.push(
        ...data.map((r: { tag_value: string; count: number }) => ({
          originalValue: r.tag_value,
          sourceType: "document" as const,
          count: r.count,
        })),
      )
    }
  }

  unmapped.sort((a, b) => b.count - a.count)
  const batch = unmapped.slice(0, limit)

  if (batch.length === 0) {
    return NextResponse.json({ success: true, suggested: 0, applied: 0, skipped: 0, message: "No hay industrias sin mapear" })
  }

  // 2. Load the canonical master_industries taxonomy
  const { data: masterIndustries } = await adminClient
    .from("master_industries")
    .select("id, name_en, name_es")
    .order("display_order")

  const masters = (masterIndustries || []) as { id: string; name_en: string; name_es: string }[]
  const validIds = new Set(masters.map((m) => m.id))

  if (masters.length === 0) {
    return NextResponse.json({ error: "No hay industrias maestras configuradas" }, { status: 500 })
  }

  // 3. Ask the model to map each unmapped value to a canonical id (or null)
  const taxonomy = masters.map((m) => `- id: "${m.id}" | ${m.name_es} (${m.name_en})`).join("\n")
  const inputList = batch.map((u, i) => `${i + 1}. "${u.originalValue}"`).join("\n")

  const prompt = `Sos un clasificador de industrias. Tenes una TAXONOMIA CERRADA de industrias maestras y una lista de textos de industria sin clasificar (provienen de LinkedIn/Apollo).

Para cada texto de la lista, asignalo a la industria maestra MAS adecuada usando EXACTAMENTE su "id". Si ninguna industria maestra es un buen match, devolve master_industry_id = null para ese texto (no fuerces un match malo).

TAXONOMIA CERRADA DE INDUSTRIAS MAESTRAS (usa SOLO estos id):
${taxonomy}

TEXTOS A CLASIFICAR:
${inputList}

Responde en JSON estricto (sin markdown, sin backticks) con este formato:
{
  "mappings": [
    { "original_value": "texto exacto de la lista", "master_industry_id": "id_de_la_taxonomia_o_null" }
  ]
}
Incluye una entrada por cada texto de la lista, con el original_value EXACTO tal como aparece.`

  let parsed: { mappings?: { original_value?: string; master_industry_id?: string | null }[] }
  try {
    const responseText = await generateContent(prompt, { temperature: 0.1, maxOutputTokens: 8192 })
    const cleaned = responseText
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim()
    const jsonStart = cleaned.indexOf("{")
    const jsonEnd = cleaned.lastIndexOf("}")
    parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1))
  } catch (err: any) {
    console.error("[v0] industry suggest: failed to parse AI response:", err?.message)
    return NextResponse.json({ error: "No se pudo interpretar la respuesta de la IA" }, { status: 502 })
  }

  // 4. Build a lookup of suggestions keyed by normalized original value
  const suggestionByValue = new Map<string, string>()
  for (const m of parsed.mappings || []) {
    const ov = (m.original_value || "").trim()
    const mid = m.master_industry_id
    if (ov && mid && validIds.has(mid)) {
      suggestionByValue.set(ov.toLowerCase(), mid)
    }
  }

  // 5. Apply: upsert rules (is_auto_mapped) + propagate to companies / document_tags
  const rulesToUpsert: { original_value: string; source_type: string; master_industry_id: string; is_auto_mapped: boolean }[] = []
  const applied: { originalValue: string; sourceType: string; masterIndustryId: string }[] = []
  const skipped: string[] = []

  for (const item of batch) {
    const mid = suggestionByValue.get(item.originalValue.toLowerCase())
    if (!mid) {
      skipped.push(item.originalValue)
      continue
    }
    rulesToUpsert.push({
      original_value: item.originalValue,
      source_type: item.sourceType,
      master_industry_id: mid,
      is_auto_mapped: true,
    })
    applied.push({ originalValue: item.originalValue, sourceType: item.sourceType, masterIndustryId: mid })
  }

  if (rulesToUpsert.length > 0) {
    const { error: upsertError } = await adminClient
      .from("industry_mappings")
      .upsert(rulesToUpsert, { onConflict: "original_value,source_type" })

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }

    // Propagate only to rows that are still unmapped (never overwrite curated values).
    for (const a of applied) {
      if (a.sourceType === "company") {
        await adminClient
          .from("companies")
          .update({ master_industry_id: a.masterIndustryId })
          .is("master_industry_id", null)
          .ilike("industry", a.originalValue)
      } else {
        await adminClient
          .from("document_tags")
          .update({ master_industry_id: a.masterIndustryId })
          .eq("tag_type", "industry")
          .is("master_industry_id", null)
          .ilike("tag_value", a.originalValue)
      }
    }
  }

  return NextResponse.json({
    success: true,
    processed: batch.length,
    suggested: applied.length,
    applied: applied.length,
    skipped: skipped.length,
    skippedValues: skipped.slice(0, 20),
  })
}
