import { createClient } from "@/lib/supabase/server"

export interface RankedDocument {
  id: string
  title: string
  type: string
  ai_summary: string | null
  extracted_text: string | null
  score: number
  matchedTags: {
    type: "industry" | "technology" | "process"
    value: string
  }[]
}

interface BookmarkContext {
  companyIndustry: string | null
  filterSignalIds: string[]
}

/**
 * Rank user documents by relevance to a specific bookmark.
 * Scoring:
 * - Industry match: x3 weight
 * - Technology match: x2 weight
 * - Process match: x1 weight
 * Returns top 3 documents sorted by score descending.
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
    .select("document_id, tag_type, tag_value, tag_reference_id, confidence")
    .in("document_id", docIds)

  if (!allTags) return []

  // 3. Get signal names from dictionaries for comparison
  const signalNames: Set<string> = new Set()
  if (bookmarkContext.filterSignalIds.length > 0) {
    const [{ data: techProducts }, { data: bizProcesses }] = await Promise.all([
      supabase
        .from("dictionary_products")
        .select("id, name")
        .in("id", bookmarkContext.filterSignalIds),
      supabase
        .from("dictionary_processes")
        .select("id, name")
        .in("id", bookmarkContext.filterSignalIds),
    ])
    for (const p of techProducts || []) signalNames.add(p.name.toLowerCase())
    for (const p of bizProcesses || []) signalNames.add(p.name.toLowerCase())
  }

  // 4. Score each document
  const scoredDocs: RankedDocument[] = documents.map((doc) => {
    const docTags = allTags.filter((t) => t.document_id === doc.id)
    let score = 0
    const matchedTags: RankedDocument["matchedTags"] = []

    for (const tag of docTags) {
      const tagValueLower = tag.tag_value.toLowerCase()
      const tagConfidence = tag.confidence || 0.7

      if (tag.tag_type === "industry") {
        // Match against company industry
        if (
          bookmarkContext.companyIndustry &&
          tagValueLower.includes(bookmarkContext.companyIndustry.toLowerCase())
        ) {
          score += 3 * tagConfidence
          matchedTags.push({ type: "industry", value: tag.tag_value })
        }
      } else if (tag.tag_type === "technology") {
        // Match against bookmark signal IDs or signal names
        if (
          (tag.tag_reference_id &&
            bookmarkContext.filterSignalIds.includes(tag.tag_reference_id)) ||
          signalNames.has(tagValueLower)
        ) {
          score += 2 * tagConfidence
          matchedTags.push({ type: "technology", value: tag.tag_value })
        }
      } else if (tag.tag_type === "process") {
        // Match against bookmark signal IDs or signal names
        if (
          (tag.tag_reference_id &&
            bookmarkContext.filterSignalIds.includes(tag.tag_reference_id)) ||
          signalNames.has(tagValueLower)
        ) {
          score += 1 * tagConfidence
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
      matchedTags,
    }
  })

  // 5. Sort by score descending, return top 3
  return scoredDocs
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}
