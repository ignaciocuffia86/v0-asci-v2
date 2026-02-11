import * as cheerio from "cheerio"

/**
 * Extract text from a URL by fetching HTML and parsing with Cheerio
 */
export async function extractTextFromUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ASCIBot/1.0)",
      "Accept": "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)

  // Remove noise elements
  $("script, style, nav, footer, header, iframe, noscript, svg, form").remove()
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove()
  $(".cookie-banner, .popup, .modal, .ad, .advertisement").remove()

  // Extract meaningful content
  const contentSelectors = [
    "article",
    "main",
    '[role="main"]',
    ".content",
    ".post-content",
    ".entry-content",
    "#content",
  ]

  let text = ""
  for (const selector of contentSelectors) {
    const el = $(selector)
    if (el.length > 0) {
      text = el.text()
      break
    }
  }

  // Fallback to body
  if (!text.trim()) {
    text = $("body").text()
  }

  // Clean up whitespace
  return text
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 50000) // Limit to ~50k chars
}

/**
 * Extract text from a PDF buffer using pdf-parse
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default
  const data = await pdfParse(buffer)
  return data.text.trim().slice(0, 50000)
}

/**
 * Extract text from a DOCX buffer using mammoth
 */
export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth")
  const result = await mammoth.extractRawText({ buffer })
  return result.value.trim().slice(0, 50000)
}

/**
 * Extract text from a PPTX by sending the binary to Gemini
 * (Gemini supports multimodal inputs including documents)
 * Falls back to a basic text extraction approach
 */
export async function extractTextFromPptx(buffer: Buffer): Promise<string> {
  // Use Gemini to extract text from PPTX
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) throw new Error("Google API Key is missing for PPTX processing")

  const base64Data = buffer.toString("base64")

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                  data: base64Data,
                },
              },
              {
                text: "Extrae todo el texto de esta presentacion PowerPoint. Incluye titulos, cuerpo de texto, notas y cualquier texto visible en las diapositivas. Devuelve solo el texto extraido, sin comentarios adicionales.",
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.1 },
      }),
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini PPTX extraction failed: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error("Gemini returned empty response for PPTX extraction")
  }

  return data.candidates[0].content.parts[0].text.trim().slice(0, 50000)
}
