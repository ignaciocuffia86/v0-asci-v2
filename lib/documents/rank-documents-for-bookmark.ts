import { createClient } from "@/lib/supabase/server"

export interface RankedDocument {
  id: string
  title: string
  type: string
  ai_summary: string | null
  extracted_text: string | null
  score: number
  isRecommended: boolean
  matchedTags: {
    type: "industry" | "technology" | "process"
    value: string
  }[]
}

interface BookmarkContext {
  companyIndustry: string | null
  companyMasterIndustryId: string | null
  // Explicit signals from the bookmark filter (e.g. user searched by "SAS Viya Platform")
  filterSignalIds: string[]
  // Inferred signals from the company's own signal profile (used when bookmark is general)
  inferredSignalIds?: string[]
}

// Score thresholds
const SCORE_RECOMMENDED_THRESHOLD = 1.5

/**
 * Rank user documents by relevance to a specific bookmark.
 * Scoring per tag match (weighted by confidence):
 * - Industry (master match):     +3.0  explicit / +1.5 inferred
 * - Industry (string fallback):  +1.5  explicit / +0.75 inferred
 * - Technology (ref_id match):   +2.0  explicit / +1.0 inferred
 * - Technology (string match):   +0.8  explicit / +0.4 inferred
 * - Process (ref_id match):      +1.0  explicit / +0.5 inferred
 * - Process (string match):      +0.4  explicit / +0.2 inferred
 *
 * isRecommended = score >= SCORE_RECOMMENDED_THRESHOLD
 * Returns ALL documents sorted by score descending (caller decides how many to use).
 */
export async function rankDocumentsForBookmark(
  userId: string,
  bookmarkContext: BookmarkContext
): Promise<RankedDocument[]> {
  const supabase = await createClient()

  // 1. Get all user documents that are ready
  const { data: documents } = await supabase
    .from("user_documents")
    .select("id, title, type, ai_summary, extracted_text")
    .eq("user_id", userId)
    .eq("status", "ready")

  if (!documents || documents.length === 0) return []

  // 2. Get all tags for these documents
  const docIds = documents.map((d) => d.id)
  const { data: allTags } = await supabase
    .from("document_tags")
    .select("document_id, tag_type, tag_value, tag_reference_id, confidence, master_industry_id")
    .in("document_id", docIds)

  if (!allTags) return []

  // 3. Build signal name sets for string-based fallback matching
  const explicitSignalNames = new Set<string>()
  const inferredSignalNames = new Set<string>()

  const allSignalIdsToFetch = [
    ...new Set([
      ...(bookmarkContext.filterSignalIds || []),
      ...(bookmarkContext.inferredSignalIds || []),
    ]),
  ]

  if (allSignalIdsToFetch.length > 0) {
    const [{ data: techProducts }, { data: bizProcesses }] = await Promise.all([
      supabase.from("dictionary_products").select("id, name").in("id", allSignalIdsToFetch),
      supabase.from("dictionary_processes").select("id, name").in("id", allSignalIdsToFetch),
    ])

    const explicitSet = new Set(bookmarkContext.filterSignalIds)
    const inferredSet = new Set(bookmarkContext.inferredSignalIds || [])

    for (const p of techProducts || []) {
      if (explicitSet.has(p.id)) explicitSignalNames.add(p.name.toLowerCase())
      if (inferredSet.has(p.id)) inferredSignalNames.add(p.name.toLowerCase())
    }
    for (const p of bizProcesses || []) {
      if (explicitSet.has(p.id)) explicitSignalNames.add(p.name.toLowerCase())
      if (inferredSet.has(p.id)) inferredSignalNames.add(p.name.toLowerCase())
    }
  }

  const hasExplicitSignals = (bookmarkContext.filterSignalIds || []).length > 0
  const hasInferredSignals = (bookmarkContext.inferredSignalIds || []).length > 0

  // 4. Score each document
  const scoredDocs: RankedDocument[] = documents.map((doc) => {
    const docTags = allTags.filter((t) => t.document_id === doc.id)
    let score = 0
    const matchedTags: RankedDocument["matchedTags"] = []

    for (const tag of docTags) {
      const tagValueLower = tag.tag_value.toLowerCase()
      const conf = tag.confidence || 0.7

      if (tag.tag_type === "industry") {
        // Master industry match (exact normalized match)
        if (
          tag.master_industry_id &&
          bookmarkContext.companyMasterIndustryId &&
          tag.master_industry_id === bookmarkContext.companyMasterIndustryId
        ) {
          score += 3.0 * conf
          matchedTags.push({ type: "industry", value: tag.tag_value })
        }
        // String fallback (when master_industry_id not available on company)
        else if (
          !tag.master_industry_id &&
          bookmarkContext.companyIndustry &&
          tagValueLower.includes(bookmarkContext.companyIndustry.toLowerCase())
        ) {
          score += 1.5 * conf
          matchedTags.push({ type: "industry", value: tag.tag_value })
        }
      } else if (tag.tag_type === "technology") {
        // Explicit signal match (ref_id or name)
        if (
          hasExplicitSignals &&
          (
            (tag.tag_reference_id && bookmarkContext.filterSignalIds.includes(tag.tag_reference_id)) ||
            explicitSignalNames.has(tagValueLower)
          )
        ) {
          score += (tag.tag_reference_id && bookmarkContext.filterSignalIds.includes(tag.tag_reference_id))
            ? 2.0 * conf
            : 0.8 * conf
          matchedTags.push({ type: "technology", value: tag.tag_value })
        }
        // Inferred signal match (company's own signals, lower weight)
        else if (
          hasInferredSignals &&
          (
            (tag.tag_reference_id && (bookmarkContext.inferredSignalIds || []).includes(tag.tag_reference_id)) ||
            inferredSignalNames.has(tagValueLower)
          )
        ) {
          score += (tag.tag_reference_id && (bookmarkContext.inferredSignalIds || []).includes(tag.tag_reference_id))
            ? 1.0 * conf
            : 0.4 * conf
          matchedTags.push({ type: "technology", value: tag.tag_value })
        }
      } else if (tag.tag_type === "process") {
        // Explicit signal match
        if (
          hasExplicitSignals &&
          (
            (tag.tag_reference_id && bookmarkContext.filterSignalIds.includes(tag.tag_reference_id)) ||
            explicitSignalNames.has(tagValueLower)
          )
        ) {
          score += (tag.tag_reference_id && bookmarkContext.filterSignalIds.includes(tag.tag_reference_id))
            ? 1.0 * conf
            : 0.4 * conf
          matchedTags.push({ type: "process", value: tag.tag_value })
        }
        // Inferred signal match
        else if (
          hasInferredSignals &&
          (
            (tag.tag_reference_id && (bookmarkContext.inferredSignalIds || []).includes(tag.tag_reference_id)) ||
            inferredSignalNames.has(tagValueLower)
          )
        ) {
          score += (tag.tag_reference_id && (bookmarkContext.inferredSignalIds || []).includes(tag.tag_reference_id))
            ? 0.5 * conf
            : 0.2 * conf
          matchedTags.push({ type: "process", value: tag.tag_value })
        }
      }
    }

    return {
      id: doc.id,
      title: doc.title,
      type: doc.type,
      ai_summary: doc.ai_summary,
      extracted_text: doc.extracted_text,
      score,
      isRecommended: score >= SCORE_RECOMMENDED_THRESHOLD,
      matchedTags,
    }
  })

  // 5. Sort by score descending, return ALL (caller slices as needed)
  return scoredDocs.sort((a, b) => b.score - a.score)
}
