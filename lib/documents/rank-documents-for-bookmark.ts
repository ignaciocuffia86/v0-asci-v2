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
  // For GENERAL bookmarks: map of signal_id → how many signals the company has for that product/process.
  // This allows scoring to be proportional: a doc matching Oracle DB (756 signals) scores
  // much higher than one matching Vue.js (10 signals).
  companySignalCounts?: Record<string, number>
}

// Score thresholds
// Filtered: at least one explicit signal match needed (score >= 1.0 * conf ~= 0.7+)
const SCORE_RECOMMENDED_THRESHOLD_FILTERED = 0.7
// General: at least 1 raw signal count (any match is meaningful)
const SCORE_RECOMMENDED_THRESHOLD_GENERAL = 1

/**
 * Rank user documents by relevance to a specific bookmark.
 *
 * FILTERED bookmarks (filterSignalIds present):
 *   Scoring per tag match (weighted by confidence):
 *   - Technology/Process (ref_id match): +2.0 * conf
 *   - Technology/Process (string match): +0.8 * conf
 *   - Industry (master match):           +3.0 * conf
 *   - Industry (string fallback):        +1.5 * conf
 *
 * GENERAL bookmarks (companySignalCounts present):
 *   - Technology/Process (ref_id match): score += signalCount (proportional to company signal volume)
 *     e.g. Oracle DB (756 signals) → +756, Vue.js (10) → +10
 *   - Industry (master match):           +30 flat (normalised base)
 *   - Industry (string fallback):        +15 flat
 *
 * isRecommended = score >= threshold (different per mode)
 * Returns ALL documents sorted by score descending.
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

  // 3. Build signal name set for string-based fallback matching (filtered bookmarks only)
  const explicitSignalNames = new Set<string>()

  if ((bookmarkContext.filterSignalIds || []).length > 0) {
    const [{ data: techProducts }, { data: bizProcesses }] = await Promise.all([
      supabase.from("dictionary_products").select("id, name").in("id", bookmarkContext.filterSignalIds),
      supabase.from("dictionary_processes").select("id, name").in("id", bookmarkContext.filterSignalIds),
    ])
    for (const p of techProducts || []) explicitSignalNames.add(p.name.toLowerCase())
    for (const p of bizProcesses || []) explicitSignalNames.add(p.name.toLowerCase())
  }

  const hasExplicitSignals = (bookmarkContext.filterSignalIds || []).length > 0
  const hasGeneralSignals =
    !hasExplicitSignals &&
    bookmarkContext.companySignalCounts != null &&
    Object.keys(bookmarkContext.companySignalCounts).length > 0
  const companySignalCounts = bookmarkContext.companySignalCounts ?? {}

  // 4. Score each document
  const scoredDocs: RankedDocument[] = documents.map((doc) => {
    const docTags = allTags.filter((t) => t.document_id === doc.id)
    let score = 0
    const matchedTags: RankedDocument["matchedTags"] = []
    // Avoid double-counting same signal_id for the same doc
    const seenSignalRefs = new Set<string>()

    for (const tag of docTags) {
      const tagValueLower = tag.tag_value.toLowerCase()
      const conf = tag.confidence || 0.7

      if (tag.tag_type === "industry") {
        // Master industry exact match
        if (
          tag.master_industry_id &&
          bookmarkContext.companyMasterIndustryId &&
          tag.master_industry_id === bookmarkContext.companyMasterIndustryId
        ) {
          score += hasExplicitSignals ? 3.0 * conf : 30
          matchedTags.push({ type: "industry", value: tag.tag_value })
        }
        // String fallback when master_industry_id not available on company
        else if (
          bookmarkContext.companyIndustry &&
          (tagValueLower.includes(bookmarkContext.companyIndustry.toLowerCase()) ||
            bookmarkContext.companyIndustry.toLowerCase().includes(tagValueLower))
        ) {
          score += hasExplicitSignals ? 1.5 * conf : 15
          matchedTags.push({ type: "industry", value: tag.tag_value })
        }
      } else if (tag.tag_type === "technology" || tag.tag_type === "process") {
        if (hasExplicitSignals) {
          // FILTERED mode: binary match on explicit filterSignalIds
          const refMatch =
            tag.tag_reference_id &&
            bookmarkContext.filterSignalIds.includes(tag.tag_reference_id)
          const nameMatch =
            !refMatch && explicitSignalNames.has(tagValueLower)

          if (refMatch) {
            score += 2.0 * conf
            matchedTags.push({ type: tag.tag_type, value: tag.tag_value })
          } else if (nameMatch) {
            score += 0.8 * conf
            matchedTags.push({ type: tag.tag_type, value: tag.tag_value })
          }
        } else if (hasGeneralSignals && tag.tag_reference_id) {
          // GENERAL mode: weighted by company signal count for that product/process
          const signalCount = companySignalCounts[tag.tag_reference_id]
          if (signalCount && signalCount > 0 && !seenSignalRefs.has(tag.tag_reference_id)) {
            score += signalCount
            seenSignalRefs.add(tag.tag_reference_id)
            matchedTags.push({ type: tag.tag_type, value: tag.tag_value })
          }
        }
      }
    }

    const threshold = hasExplicitSignals
      ? SCORE_RECOMMENDED_THRESHOLD_FILTERED
      : SCORE_RECOMMENDED_THRESHOLD_GENERAL

    return {
      id: doc.id,
      title: doc.title,
      type: doc.type,
      ai_summary: doc.ai_summary,
      extracted_text: doc.extracted_text,
      score,
      isRecommended: score >= threshold,
      matchedTags,
    }
  })

  // 5. Sort by score descending, return ALL (caller slices as needed)
  return scoredDocs.sort((a, b) => b.score - a.score)
}
