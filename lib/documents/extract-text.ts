import * as cheerio from "cheerio"
import { generateGeminiContent } from "@/lib/ai-service"

/**
 * Extract text from a URL by fetching HTML and parsing with Cheerio.
 * Falls back to Gemini extraction if the page is a SPA with minimal text content.
 */
export async function extractTextFromUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)

  // Extract meta info before removing elements (useful for SPAs)
  const metaTitle = $("title").text().trim()
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || ""
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || ""
  const ogDescription = $('meta[property="og:description"]').attr("content")?.trim() || ""

  // Remove only non-content noise (keep nav/header/footer - landing pages have key info there)
  $("script, style, iframe, noscript, svg").remove()
  $(".cookie-banner, .popup, .modal, .ad, .advertisement").remove()

  // Prepend meta info as it often contains key terms not in the body
  const metaParts: string[] = []
  if (metaTitle) metaParts.push(`Titulo: ${metaTitle}`)
  if (ogTitle && ogTitle !== metaTitle) metaParts.push(`OG Titulo: ${ogTitle}`)
  if (metaDescription) metaParts.push(`Descripcion: ${metaDescription}`)
  if (ogDescription && ogDescription !== metaDescription) metaParts.push(`OG Descripcion: ${ogDescription}`)
  
  // Also extract alt texts from images (often mention technologies/products)
  const altTexts: string[] = []
  $("img[alt]").each((_, el) => {
    const alt = $(el).attr("alt")?.trim()
    if (alt && alt.length > 3) altTexts.push(alt)
  })
  if (altTexts.length > 0) metaParts.push(`Imagenes: ${altTexts.join(", ")}`)

  // Get ALL body text (not just specific selectors)
  let text = $("body").text()

  // Clean up whitespace and prepend meta info
  text = text
    .replace(/\s+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  
  // Combine meta info + body text for complete extraction
  if (metaParts.length > 0) {
    text = metaParts.join("\n") + "\n\n" + text
  }

  // Check if we got meaningful content (SPAs often return very little text)
  const MIN_USEFUL_CHARS = 100
  if (text.length < MIN_USEFUL_CHARS) {
    console.log(`[v0] URL text too short (${text.length} chars), trying Gemini extraction for: ${url}`)

    // Use meta info + raw HTML as context for Gemini
    const metaContext = [metaTitle, ogTitle, metaDescription, ogDescription].filter(Boolean).join(" | ")
    
    // Send the raw HTML (limited) to Gemini to interpret
    const rawHtml = html.slice(0, 30000)
    
    const geminiText = await generateGeminiContent(
      `Analiza el siguiente HTML de la pagina web ${url}. 
Esta pagina podria ser una Single Page Application (SPA) que renderiza con JavaScript.
Extrae TODO el contenido textual util que puedas encontrar en el HTML, incluyendo:
- Textos dentro de data attributes, JSON embedded, o script tags con contenido
- Meta tags y Open Graph tags
- Cualquier texto visible que encuentres

Informacion meta disponible: ${metaContext || "Ninguna"}

HTML:
${rawHtml}

Devuelve SOLO el texto extraido, organizado de manera coherente. Si realmente no hay contenido, indica "No se encontro contenido textual en esta pagina."`,
      "gemini-2.0-flash",
      0.1,
    )

    if (geminiText && geminiText.length > MIN_USEFUL_CHARS) {
      return geminiText.trim().slice(0, 50000)
    }

    // Last resort: use whatever meta info we have
    if (metaContext.length > 20) {
      return `Pagina web: ${url}\nTitulo: ${metaTitle || ogTitle}\nDescripcion: ${metaDescription || ogDescription}\n${text}`.trim()
    }
  }

  return text.slice(0, 50000)
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
