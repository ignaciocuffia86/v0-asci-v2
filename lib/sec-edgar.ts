/**
 * SEC EDGAR API Client
 * 
 * Provides functions to interact with SEC EDGAR API for fetching
 * company filings (10-K, 10-Q, 8-K) and CIK lookups.
 * 
 * Note: SEC requires a User-Agent header with contact info.
 */

const SEC_USER_AGENT = "ASCI Platform (contact@asci.com)"

export interface SECFiling {
  accessionNumber: string
  filingDate: string
  form: string // '10-K', '10-Q', '8-K', etc.
  fileUrl: string
  primaryDocument: string
  description?: string
}

export interface SECCompanyInfo {
  cik: string
  name: string
  ticker?: string
  exchange?: string
}

/**
 * Searches SEC EDGAR for a company by ticker symbol
 * Returns the CIK (Central Index Key) if found
 */
export async function getCIKByTicker(ticker: string): Promise<string | null> {
  try {
    // Use the company tickers JSON endpoint
    const response = await fetch(
      "https://www.sec.gov/files/company_tickers.json",
      {
        headers: {
          "User-Agent": SEC_USER_AGENT,
          "Accept": "application/json",
        },
        // Cache for 24 hours - this file doesn't change often
        next: { revalidate: 86400 },
      }
    )

    if (!response.ok) {
      console.error("[SEC EDGAR] Failed to fetch tickers:", response.status)
      return null
    }

    const data = await response.json()
    
    // Data format: { "0": { cik_str, ticker, title }, "1": {...}, ... }
    const tickerUpper = ticker.toUpperCase()
    
    for (const key of Object.keys(data)) {
      if (data[key].ticker === tickerUpper) {
        // CIK needs to be padded to 10 digits
        return String(data[key].cik_str).padStart(10, "0")
      }
    }

    return null
  } catch (error) {
    console.error("[SEC EDGAR] Error looking up ticker:", error)
    return null
  }
}

/**
 * Searches SEC EDGAR for a company by name
 * Returns company info including CIK if found
 * 
 * IMPORTANT: This is STRICT matching to avoid false positives.
 * Only returns a match if the company name is very similar.
 */
export async function searchSECByCompanyName(
  companyName: string
): Promise<SECCompanyInfo | null> {
  try {
    // Use the company tickers JSON and search by name
    const response = await fetch(
      "https://www.sec.gov/files/company_tickers.json",
      {
        headers: {
          "User-Agent": SEC_USER_AGENT,
          "Accept": "application/json",
        },
        next: { revalidate: 86400 },
      }
    )

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    const searchName = companyName.toLowerCase().trim()
    
    // Normalize search name - remove common suffixes
    const normalizedSearch = searchName
      .replace(/\s+(inc\.?|corp\.?|ltd\.?|llc\.?|s\.?a\.?|s\.?r\.?l\.?|plc\.?)$/i, "")
      .replace(/[,\.]/g, "")
      .trim()
    
    // First pass: Look for EXACT match (highest confidence)
    for (const key of Object.keys(data)) {
      const company = data[key]
      const title = (company.title || "").toLowerCase()
      const normalizedTitle = title
        .replace(/\s+(inc\.?|corp\.?|ltd\.?|llc\.?|s\.?a\.?|s\.?r\.?l\.?|plc\.?)$/i, "")
        .replace(/[,\.]/g, "")
        .trim()
      
      // Exact match after normalization
      if (normalizedTitle === normalizedSearch) {
        console.log(`[SEC EDGAR] Exact match found: "${company.title}" for "${companyName}"`)
        return {
          cik: String(company.cik_str).padStart(10, "0"),
          name: company.title,
          ticker: company.ticker,
        }
      }
    }
    
    // Second pass: Full word match (company name must START with search term or vice versa)
    // Only if search term is long enough (>5 chars) to avoid false positives
    if (normalizedSearch.length > 5) {
      for (const key of Object.keys(data)) {
        const company = data[key]
        const title = (company.title || "").toLowerCase()
        const normalizedTitle = title
          .replace(/\s+(inc\.?|corp\.?|ltd\.?|llc\.?|s\.?a\.?|s\.?r\.?l\.?|plc\.?)$/i, "")
          .replace(/[,\.]/g, "")
          .trim()
        
        // Check if one starts with the other AND they share significant overlap
        const startsWithMatch = normalizedTitle.startsWith(normalizedSearch) || 
                                normalizedSearch.startsWith(normalizedTitle)
        
        // Calculate similarity - must be > 80% similar to match
        const longerLen = Math.max(normalizedTitle.length, normalizedSearch.length)
        const shorterLen = Math.min(normalizedTitle.length, normalizedSearch.length)
        const similarity = shorterLen / longerLen
        
        if (startsWithMatch && similarity > 0.8) {
          console.log(`[SEC EDGAR] High-similarity match: "${company.title}" for "${companyName}" (${Math.round(similarity * 100)}%)`)
          return {
            cik: String(company.cik_str).padStart(10, "0"),
            name: company.title,
            ticker: company.ticker,
          }
        }
      }
    }

    // No match found - this is fine, many companies aren't in SEC
    console.log(`[SEC EDGAR] No match found for "${companyName}"`)
    return null
  } catch (error) {
    console.error("[SEC EDGAR] Error searching by company name:", error)
    return null
  }
}

/**
 * Fetches recent filings for a company by CIK
 * Filters by form types and date range
 */
export async function getCompanyFilings(
  cik: string,
  options: {
    forms?: string[]
    limit?: number
    afterDate?: Date
  } = {}
): Promise<SECFiling[]> {
  const { 
    forms = ["10-K", "10-Q", "8-K"], 
    limit = 20,
    afterDate 
  } = options

  try {
    const paddedCIK = cik.padStart(10, "0")
    
    const response = await fetch(
      `https://data.sec.gov/submissions/CIK${paddedCIK}.json`,
      {
        headers: {
          "User-Agent": SEC_USER_AGENT,
          "Accept": "application/json",
        },
        // Cache for 1 hour - filings update periodically
        next: { revalidate: 3600 },
      }
    )

    if (!response.ok) {
      console.error("[SEC EDGAR] Failed to fetch filings:", response.status)
      return []
    }

    const data = await response.json()
    const filings: SECFiling[] = []
    
    const recent = data.filings?.recent
    if (!recent || !recent.form) {
      return []
    }

    // Calculate 2 years ago if not provided
    const twoYearsAgo = afterDate || new Date()
    if (!afterDate) {
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
    }

    for (let i = 0; i < recent.form.length && filings.length < limit; i++) {
      const form = recent.form[i]
      const filingDate = new Date(recent.filingDate[i])
      
      // Check if form type matches and is within date range
      if (forms.includes(form) && filingDate >= twoYearsAgo) {
        const accessionNumber = recent.accessionNumber[i]
        const accessionNumberClean = accessionNumber.replace(/-/g, "")
        const primaryDoc = recent.primaryDocument[i]
        
        filings.push({
          accessionNumber,
          filingDate: recent.filingDate[i],
          form,
          primaryDocument: primaryDoc,
          description: recent.primaryDocDescription?.[i],
          fileUrl: `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumberClean}/${primaryDoc}`,
        })
      }
    }

    return filings
  } catch (error) {
    console.error("[SEC EDGAR] Error fetching filings:", error)
    return []
  }
}

/**
 * Gets the HTML version URL of a filing (preferred over PDF for parsing)
 */
export function getFilingHtmlUrl(
  cik: string,
  accessionNumber: string,
  primaryDocument: string
): string {
  const accessionNumberClean = accessionNumber.replace(/-/g, "")
  const cikClean = cik.replace(/^0+/, "") // Remove leading zeros
  
  // Try to get HTML version if primary is PDF
  let docName = primaryDocument
  if (docName.toLowerCase().endsWith(".pdf")) {
    docName = docName.replace(/\.pdf$/i, ".htm")
  }
  
  return `https://www.sec.gov/Archives/edgar/data/${cikClean}/${accessionNumberClean}/${docName}`
}

/**
 * Gets a direct link to the filing index page (useful for finding all documents)
 */
export function getFilingIndexUrl(
  cik: string,
  accessionNumber: string
): string {
  const accessionNumberClean = accessionNumber.replace(/-/g, "")
  const cikClean = cik.replace(/^0+/, "")
  
  return `https://www.sec.gov/Archives/edgar/data/${cikClean}/${accessionNumberClean}/`
}

/**
 * Maps SEC form types to our document types
 */
export function mapSECFormToDocumentType(form: string): string {
  const mapping: Record<string, string> = {
    "10-K": "10-K",
    "10-K/A": "10-K", // Amended
    "10-Q": "10-Q",
    "10-Q/A": "10-Q", // Amended
    "8-K": "8-K",
    "8-K/A": "8-K", // Amended
    "DEF 14A": "proxy", // Proxy statement
    "S-1": "ipo", // IPO registration
  }
  
  return mapping[form] || form
}

/**
 * Checks if a company is likely public based on SEC data
 */
export async function checkIfCompanyIsPublic(
  tickerOrName: string
): Promise<{ isPublic: boolean; cik?: string; ticker?: string; exchange?: string }> {
  // First try as ticker
  const cikFromTicker = await getCIKByTicker(tickerOrName)
  if (cikFromTicker) {
    return {
      isPublic: true,
      cik: cikFromTicker,
      ticker: tickerOrName.toUpperCase(),
    }
  }
  
  // Then try as company name
  const searchResult = await searchSECByCompanyName(tickerOrName)
  if (searchResult) {
    return {
      isPublic: true,
      cik: searchResult.cik,
      ticker: searchResult.ticker,
      exchange: searchResult.exchange,
    }
  }
  
  return { isPublic: false }
}
