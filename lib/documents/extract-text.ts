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
      "gemini-2.5-flash",
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
 * Extract text from a PDF buffer using pdf-parse.
 * Falls back to Gemini vision extraction for designed/graphical PDFs
 * where pdf-parse fails to capture meaningful content.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default
  const data = await pdfParse(buffer)
  const parsedText = data.text.trim()

  // If pdf-parse extracted enough text, use it
  const MIN_PDF_CHARS = 1000
  if (parsedText.length >= MIN_PDF_CHARS) {
    return parsedText.slice(0, 50000)
  }

  // For designed PDFs (brochures, case studies, etc.) where pdf-parse
  // extracts very little text, use Gemini to read the PDF visually
  console.log(`[v0] PDF text too short (${parsedText.length} chars), using Gemini visual extraction`)

  try {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) throw new Error("Google API Key is missing for PDF fallback")

    const base64Data = buffer.toString("base64")

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: "application/pdf",
                    data: base64Data,
                  },
                },
                {
                  text: `Extrae TODO el contenido textual de este documento PDF. 
Este documento puede ser un brochure, caso de exito, propuesta comercial o presentacion con diseno grafico.
Incluye ABSOLUTAMENTE TODO el texto visible: titulos, subtitulos, cuerpo, datos en tablas, cifras, nombres de empresas, 
metricas, citas, pie de pagina, textos en graficos o diagramas.
Respeta el orden de lectura logico del documento.
Devuelve SOLO el texto extraido, sin comentarios adicionales tuyos.`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } },
        }),
      },
    )

    if (!response.ok) {
      throw new Error(`Gemini PDF extraction failed: ${response.status}`)
    }

    const responseData = await response.json()
    const geminiText = responseData.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    if (geminiText && geminiText.length > parsedText.length) {
      console.log(`[v0] Gemini extracted ${geminiText.length} chars vs pdf-parse ${parsedText.length} chars`)
      return geminiText.slice(0, 50000)
    }
  } catch (error) {
    console.error("[v0] Gemini PDF fallback failed:", error)
  }

  // Return whatever pdf-parse got as last resort
  return parsedText.slice(0, 50000)
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
 * Extract text from a PPTX file.
 * PPTX is a ZIP archive containing XML files. We extract text from:
 * - slide*.xml files (main slide content)
 * - notesSlide*.xml files (speaker notes)
 */
export async function extractTextFromPptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default
  const zip = await JSZip.loadAsync(buffer)

  const textParts: string[] = []

  // Get all slide and notes files, sorted by number
  const slideFiles = Object.keys(zip.files)
    .filter((name) => name.match(/ppt\/slides\/slide\d+\.xml$/))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] || "0")
      const numB = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] || "0")
      return numA - numB
    })

  const notesFiles = Object.keys(zip.files)
    .filter((name) => name.match(/ppt\/notesSlides\/notesSlide\d+\.xml$/))
    .sort((a, b) => {
      const numA = parseInt(a.match(/notesSlide(\d+)\.xml$/)?.[1] || "0")
      const numB = parseInt(b.match(/notesSlide(\d+)\.xml$/)?.[1] || "0")
      return numA - numB
    })

  // Extract text from slides
  for (let i = 0; i < slideFiles.length; i++) {
    const slideFile = slideFiles[i]
    const slideXml = await zip.files[slideFile].async("text")
    const slideText = extractTextFromPptxXml(slideXml)

    if (slideText.trim()) {
      textParts.push(`--- Slide ${i + 1} ---`)
      textParts.push(slideText)
    }

    // Check for corresponding notes
    const notesFile = notesFiles.find((n) => n.includes(`notesSlide${i + 1}.xml`))
    if (notesFile) {
      const notesXml = await zip.files[notesFile].async("text")
      const notesText = extractTextFromPptxXml(notesXml)
      if (notesText.trim()) {
        textParts.push(`[Notas: ${notesText}]`)
      }
    }
  }

  const extractedText = textParts.join("\n").trim()

  if (!extractedText || extractedText.length < 50) {
    throw new Error("No se pudo extraer texto significativo del PPTX")
  }

  return extractedText.slice(0, 50000)
}

/**
 * Helper to extract text from PPTX XML content.
 * Looks for <a:t> tags which contain the actual text in Office Open XML.
 */
function extractTextFromPptxXml(xml: string): string {
  // Match all <a:t>...</a:t> tags (text content in OOXML)
  const textMatches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || []
  
  const texts = textMatches
    .map((match) => {
      const inner = match.replace(/<a:t[^>]*>/, "").replace(/<\/a:t>/, "")
      return inner.trim()
    })
    .filter((t) => t.length > 0)

  // Join with spaces, collapse multiple spaces
  return texts.join(" ").replace(/\s+/g, " ").trim()
}
