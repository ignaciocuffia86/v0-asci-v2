/**
 * Utility function to find dictionary matches for detected technologies
 * Uses fuzzy matching to handle variations like "AWS" vs "Amazon Web Services"
 */
export function findDictionaryMatch(
  technology: string,
  dictionary: string[]
): string | null {
  if (!technology || !dictionary || dictionary.length === 0) {
    return null
  }

  const techLower = technology.toLowerCase().trim()

  // Exact match first (highest confidence)
  const exactMatch = dictionary.find((d) => d.toLowerCase() === techLower)
  if (exactMatch) return exactMatch

  // Partial match - if tech appears at start of dictionary entry or vice versa
  const partialMatches = dictionary.filter((d) => {
    const dLower = d.toLowerCase()
    return (
      dLower.includes(techLower) ||
      techLower.includes(dLower) ||
      dLower.startsWith(techLower.split(" ")[0]) ||
      techLower.startsWith(dLower.split(" ")[0])
    )
  })

  if (partialMatches.length > 0) {
    // Return longest match (most specific)
    return partialMatches.sort((a, b) => b.length - a.length)[0]
  }

  // Abbreviation matching (e.g., "AWS" -> "Amazon Web Services")
  const abbrev = technology
    .toUpperCase()
    .replace(/\s+/g, "")
    .slice(0, 4)
  if (abbrev.length >= 2) {
    const abbrevMatch = dictionary.find(
      (d) =>
        d.toUpperCase().replace(/\s+/g, "").startsWith(abbrev) ||
        d
          .split(" ")
          .map((w) => w[0])
          .join("")
          .toUpperCase() === abbrev
    )
    if (abbrevMatch) return abbrevMatch
  }

  return null
}

/**
 * Batch lookup for multiple technologies against dictionary
 */
export function batchFindDictionaryMatches(
  technologies: string[],
  dictionary: string[]
): Map<string, string | null> {
  const results = new Map<string, string | null>()
  for (const tech of technologies) {
    results.set(tech, findDictionaryMatch(tech, dictionary))
  }
  return results
}
