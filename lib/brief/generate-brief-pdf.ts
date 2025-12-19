import { jsPDF } from "jspdf"

interface FitReason {
  reason: string
  source: string
  confidence: string
  evidenceCount: number
}

interface Risk {
  type: string
  description: string
  mitigation?: string
}

interface BriefPdfData {
  companyName: string
  companyIndustry?: string
  companyCountry?: string
  companyLogoUrl?: string
  companyWebsite?: string
  fitScore: number
  fitReasons: FitReason[]
  risks: Risk[]
  htmlContent: string
  sourcesSummary: {
    currentEmployeesCount: number
    alumniCount: number
    jobPostingsCount: number
    newsCount: number
    implementationsCount: number
    prospectsCount: number
  }
  generatedAt: string
  userEmail: string
  version: number
}

const BIGUA_LOGO_URL = "/logo.png"

// Colors
const COLORS = {
  primary: [37, 99, 235] as [number, number, number], // Blue
  primaryDark: [30, 64, 175] as [number, number, number], // Dark blue
  success: [34, 197, 94] as [number, number, number], // Green
  warning: [234, 179, 8] as [number, number, number], // Yellow
  danger: [239, 68, 68] as [number, number, number], // Red
  textDark: [30, 41, 59] as [number, number, number], // Slate 800
  textMuted: [100, 116, 139] as [number, number, number], // Slate 500
  textLight: [148, 163, 184] as [number, number, number], // Slate 400
  bgLight: [248, 250, 252] as [number, number, number], // Slate 50
  bgGreen: [240, 253, 244] as [number, number, number], // Green 50
  bgYellow: [254, 252, 232] as [number, number, number], // Yellow 50
  white: [255, 255, 255] as [number, number, number],
  border: [226, 232, 240] as [number, number, number], // Slate 200
}

/**
 * Genera un PDF del Brief Ejecutivo con branding profesional
 * Formato A4, máximo 2 páginas
 */
export async function generateBriefPdf(data: BriefPdfData): Promise<void> {
  const {
    companyName,
    companyIndustry,
    companyCountry,
    companyLogoUrl,
    companyWebsite,
    fitScore,
    fitReasons,
    risks,
    htmlContent,
    sourcesSummary,
    generatedAt,
    userEmail,
    version,
  } = data

  // Create PDF
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  })

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 15
  const contentWidth = pageWidth - margin * 2
  let yPosition = margin

  // Load images
  let biguaLogoDataUrl: string | null = null
  let companyLogoDataUrl: string | null = null

  try {
    biguaLogoDataUrl = await loadImageAsDataUrl(BIGUA_LOGO_URL)
  } catch (e) {
    console.warn("[v0] Could not load Bigua logo:", e)
  }

  if (companyLogoUrl) {
    try {
      companyLogoDataUrl = await loadImageAsDataUrl(companyLogoUrl)
    } catch (e) {
      console.warn("[v0] Could not load company logo:", e)
    }
  }

  // Helper: Check if new page needed
  const addNewPageIfNeeded = (requiredSpace: number): boolean => {
    if (yPosition + requiredSpace > pageHeight - 25) {
      doc.addPage()
      yPosition = margin
      addPageHeader()
      return true
    }
    return false
  }

  // Helper: Add page header (for pages 2+)
  const addPageHeader = () => {
    // Light header bar
    doc.setFillColor(...COLORS.bgLight)
    doc.rect(0, 0, pageWidth, 12, "F")

    // Company name
    doc.setFontSize(8)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(...COLORS.textMuted)
    doc.text(`Brief Ejecutivo: ${companyName}`, margin, 8)

    // Bigua logo small on right
    if (biguaLogoDataUrl) {
      try {
        doc.addImage(biguaLogoDataUrl, "PNG", pageWidth - margin - 12, 2, 10, 10)
      } catch (e) {
        console.warn("[v0] Could not add Bigua logo to page header")
      }
    }

    yPosition = 18
  }

  // ===== PAGE 1: HEADER =====

  // Company logo circle on the left
  const logoSize = 18
  const logoX = margin
  const logoY = margin

  // Draw circle background for company logo
  doc.setFillColor(...COLORS.bgLight)
  doc.circle(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 + 2, "F")
  doc.setDrawColor(...COLORS.border)
  doc.setLineWidth(0.5)
  doc.circle(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 + 2, "S")

  if (companyLogoDataUrl) {
    try {
      doc.addImage(companyLogoDataUrl, "PNG", logoX + 1, logoY + 1, logoSize - 2, logoSize - 2)
    } catch (e) {
      // Fallback to initial
      drawCompanyInitial(doc, companyName, logoX, logoY, logoSize)
    }
  } else {
    // Draw company initial as placeholder
    drawCompanyInitial(doc, companyName, logoX, logoY, logoSize)
  }

  // Bigua logo on the right (smaller, professional)
  if (biguaLogoDataUrl) {
    try {
      const biguaLogoSize = 14
      doc.addImage(biguaLogoDataUrl, "PNG", pageWidth - margin - biguaLogoSize, margin, biguaLogoSize, biguaLogoSize)
    } catch (e) {
      console.warn("[v0] Could not add Bigua logo to header")
    }
  }

  // Company name and details
  const textStartX = logoX + logoSize + 8

  doc.setFontSize(16)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...COLORS.textDark)
  doc.text("Brief Ejecutivo", textStartX, margin + 6)

  doc.setFontSize(12)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...COLORS.primary)
  doc.text(companyName, textStartX, margin + 12)

  // Metadata line
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.textMuted)
  const metaParts = [companyIndustry, companyCountry].filter(Boolean)
  if (metaParts.length > 0) {
    doc.text(metaParts.join(" | "), textStartX, margin + 17)
  }

  if (companyWebsite) {
    doc.setTextColor(...COLORS.primary)
    doc.text(companyWebsite, textStartX, margin + 21)
  }

  // Date and version on right side below Bigua logo
  const formattedDate = new Date(generatedAt).toLocaleDateString("es-ES", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
  doc.setFontSize(7)
  doc.setTextColor(...COLORS.textLight)
  doc.text(`Generado: ${formattedDate}`, pageWidth - margin, margin + 18, { align: "right" })
  doc.text(`Versión ${version}`, pageWidth - margin, margin + 22, { align: "right" })

  // Separator line
  yPosition = margin + 28
  doc.setDrawColor(...COLORS.border)
  doc.setLineWidth(0.3)
  doc.line(margin, yPosition, pageWidth - margin, yPosition)

  yPosition += 6

  // ===== FIT SCORE SECTION =====
  const fitScoreColor = fitScore >= 70 ? COLORS.success : fitScore >= 40 ? COLORS.warning : COLORS.danger

  // FIT Score box
  doc.setFillColor(...COLORS.bgLight)
  doc.roundedRect(margin, yPosition, contentWidth, 22, 3, 3, "F")

  // Score label and value
  doc.setFontSize(9)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...COLORS.textMuted)
  doc.text("FIT SCORE", margin + 6, yPosition + 6)

  doc.setFontSize(28)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...fitScoreColor)
  doc.text(`${fitScore}`, margin + 6, yPosition + 17)

  doc.setFontSize(12)
  doc.setTextColor(...COLORS.textLight)
  doc.text("/100", margin + 25, yPosition + 17)

  // Progress bar
  const barWidth = 60
  const barHeight = 6
  const barX = margin + 45
  const barY = yPosition + 12

  // Background
  doc.setFillColor(...COLORS.border)
  doc.roundedRect(barX, barY, barWidth, barHeight, 2, 2, "F")

  // Fill
  doc.setFillColor(...fitScoreColor)
  const fillWidth = (fitScore / 100) * barWidth
  doc.roundedRect(barX, barY, fillWidth, barHeight, 2, 2, "F")

  // Sources summary on the right
  doc.setFontSize(7)
  doc.setTextColor(...COLORS.textMuted)
  const totalSources =
    sourcesSummary.currentEmployeesCount +
    sourcesSummary.alumniCount +
    sourcesSummary.jobPostingsCount +
    sourcesSummary.prospectsCount
  doc.text(`Basado en ${totalSources} fuentes:`, pageWidth - margin - 4, yPosition + 6, { align: "right" })
  doc.setFontSize(6)
  doc.text(
    `${sourcesSummary.currentEmployeesCount} contactos | ${sourcesSummary.alumniCount} alumni`,
    pageWidth - margin - 4,
    yPosition + 11,
    { align: "right" },
  )
  doc.text(
    `${sourcesSummary.jobPostingsCount} posiciones | ${sourcesSummary.prospectsCount} prospectos`,
    pageWidth - margin - 4,
    yPosition + 15,
    { align: "right" },
  )

  yPosition += 28

  // ===== TOP 3 REASONS =====
  if (fitReasons.length > 0) {
    // Section header with accent bar
    doc.setFillColor(...COLORS.success)
    doc.rect(margin, yPosition, 3, 6, "F")

    doc.setFontSize(10)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(...COLORS.textDark)
    doc.text("Top Razones de FIT", margin + 6, yPosition + 4)
    yPosition += 10

    // Reasons list
    for (let i = 0; i < Math.min(fitReasons.length, 3); i++) {
      const reason = fitReasons[i]

      // Confidence badge
      const confidenceText = reason.confidence === "high" ? "ALTO" : reason.confidence === "medium" ? "MEDIO" : "BAJO"
      const confidenceColor =
        reason.confidence === "high" ? COLORS.success : reason.confidence === "medium" ? COLORS.warning : COLORS.danger

      doc.setFontSize(8)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(...COLORS.textDark)
      doc.text(`${i + 1}.`, margin + 2, yPosition)

      doc.setFont("helvetica", "normal")
      const reasonLines = doc.splitTextToSize(reason.reason, contentWidth - 30)
      doc.text(reasonLines[0], margin + 8, yPosition)

      // Badge
      doc.setFillColor(...confidenceColor)
      const badgeX = pageWidth - margin - 12
      doc.roundedRect(badgeX, yPosition - 3, 12, 4, 1, 1, "F")
      doc.setFontSize(5)
      doc.setTextColor(...COLORS.white)
      doc.text(confidenceText, badgeX + 6, yPosition, { align: "center" })

      yPosition += 6

      // Additional lines if text wraps
      if (reasonLines.length > 1) {
        doc.setFontSize(8)
        doc.setTextColor(...COLORS.textMuted)
        for (let j = 1; j < reasonLines.length; j++) {
          doc.text(reasonLines[j], margin + 8, yPosition)
          yPosition += 4
        }
      }
    }
    yPosition += 4
  }

  // ===== RISKS =====
  if (risks.length > 0) {
    // Section header with accent bar
    doc.setFillColor(...COLORS.warning)
    doc.rect(margin, yPosition, 3, 6, "F")

    doc.setFontSize(10)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(...COLORS.textDark)
    doc.text("Riesgos y Bloqueos", margin + 6, yPosition + 4)
    yPosition += 10

    for (const risk of risks) {
      doc.setFontSize(8)
      doc.setFont("helvetica", "normal")
      doc.setTextColor(...COLORS.textDark)

      const riskLines = doc.splitTextToSize(`• ${risk.description}`, contentWidth - 4)
      for (const line of riskLines) {
        doc.text(line, margin + 2, yPosition)
        yPosition += 4
      }

      if (risk.mitigation) {
        doc.setFontSize(7)
        doc.setTextColor(...COLORS.textMuted)
        doc.setFont("helvetica", "italic")
        const mitLines = doc.splitTextToSize(`→ ${risk.mitigation}`, contentWidth - 10)
        for (const line of mitLines) {
          doc.text(line, margin + 6, yPosition)
          yPosition += 3.5
        }
      }
      yPosition += 2
    }
    yPosition += 4
  }

  // ===== SEPARATOR =====
  doc.setDrawColor(...COLORS.border)
  doc.setLineWidth(0.2)
  doc.line(margin, yPosition, pageWidth - margin, yPosition)
  yPosition += 6

  // ===== MAIN CONTENT =====
  const sections = parseHtmlContent(htmlContent)

  for (const section of sections) {
    if (section.type === "heading") {
      addNewPageIfNeeded(15)

      // Section header with blue accent
      doc.setFillColor(...COLORS.primary)
      doc.rect(margin, yPosition, 3, 5, "F")

      doc.setFontSize(10)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(...COLORS.primaryDark)
      doc.text(section.text.toUpperCase(), margin + 6, yPosition + 4)
      yPosition += 10
    } else if (section.type === "subheading") {
      addNewPageIfNeeded(10)

      doc.setFontSize(9)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(...COLORS.textDark)
      doc.text(section.text, margin + 2, yPosition)
      yPosition += 6
    } else if (section.type === "listItem") {
      // List items with bullet
      doc.setFontSize(8)
      doc.setFont("helvetica", "normal")
      doc.setTextColor(...COLORS.textMuted)

      const lines = doc.splitTextToSize(section.text, contentWidth - 10)
      for (let i = 0; i < lines.length; i++) {
        addNewPageIfNeeded(5)
        if (i === 0) {
          doc.text("•", margin + 4, yPosition)
          doc.text(lines[i], margin + 8, yPosition)
        } else {
          doc.text(lines[i], margin + 8, yPosition)
        }
        yPosition += 4
      }
      yPosition += 1
    } else {
      // Paragraph text
      if (!section.text.trim()) continue

      doc.setFontSize(8)
      doc.setFont("helvetica", "normal")
      doc.setTextColor(...COLORS.textMuted)

      const lines = doc.splitTextToSize(section.text, contentWidth - 4)
      for (const line of lines) {
        addNewPageIfNeeded(5)
        doc.text(line, margin + 2, yPosition)
        yPosition += 4
      }
      yPosition += 3
    }
  }

  // ===== FOOTER on each page =====
  const pageCount = doc.internal.pages.length - 1
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)

    // Footer line
    doc.setDrawColor(...COLORS.border)
    doc.setLineWidth(0.2)
    doc.line(margin, pageHeight - 15, pageWidth - margin, pageHeight - 15)

    // Footer text
    doc.setFontSize(6)
    doc.setTextColor(...COLORS.textLight)
    doc.text(`Generado por ASCI | bigua.lat`, margin, pageHeight - 10)
    doc.text(`${userEmail}`, pageWidth / 2, pageHeight - 10, { align: "center" })
    doc.text(`Página ${i} de ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: "right" })
  }

  // Download
  const safeCompanyName = companyName.replace(/[^a-z0-9]/gi, "_").substring(0, 30)
  const filename = `Brief_${safeCompanyName}_v${version}.pdf`
  doc.save(filename)
}

/**
 * Draw company initial as placeholder when logo is not available
 */
function drawCompanyInitial(doc: jsPDF, companyName: string, logoX: number, logoY: number, logoSize: number) {
  doc.setFontSize(14)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(...COLORS.primary)
  const initial = companyName.charAt(0).toUpperCase()
  doc.text(initial, logoX + logoSize / 2, logoY + logoSize / 2 + 2, { align: "center" })
}

/**
 * Load image as data URL for cross-origin support
 */
async function loadImageAsDataUrl(url: string): Promise<string> {
  try {
    // Si es una URL relativa, convertir a absoluta
    const absoluteUrl = url.startsWith("http") ? url : `${window.location.origin}${url}`

    const response = await fetch(absoluteUrl, {
      mode: "cors",
      credentials: "omit",
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`)
    }

    const blob = await response.blob()

    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result)
        } else {
          reject(new Error("Failed to convert blob to data URL"))
        }
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch (error) {
    console.warn("[v0] Error loading image:", url, error)
    throw error
  }
}

/**
 * Parse HTML content into sections for PDF - REWRITTEN for proper parsing
 */
function parseHtmlContent(
  html: string,
): Array<{ type: "heading" | "subheading" | "paragraph" | "listItem"; text: string }> {
  const sections: Array<{ type: "heading" | "subheading" | "paragraph" | "listItem"; text: string }> = []

  if (!html || typeof html !== "string") {
    return sections
  }

  // Create a temporary DOM element to parse HTML properly
  const tempDiv = document.createElement("div")
  tempDiv.innerHTML = html

  // Helper function to clean text
  const cleanText = (text: string): string => {
    return text
      .replace(/\s+/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim()
  }

  // Recursive function to process nodes
  const processNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = cleanText(node.textContent || "")
      if (text) {
        sections.push({ type: "paragraph", text })
      }
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return

    const element = node as Element
    const tagName = element.tagName.toLowerCase()

    switch (tagName) {
      case "h1":
      case "h2":
        const h2Text = cleanText(element.textContent || "")
        if (h2Text) {
          sections.push({ type: "heading", text: h2Text })
        }
        break

      case "h3":
      case "h4":
        const h3Text = cleanText(element.textContent || "")
        if (h3Text) {
          sections.push({ type: "subheading", text: h3Text })
        }
        break

      case "li":
        const liText = cleanText(element.textContent || "")
        if (liText) {
          sections.push({ type: "listItem", text: liText })
        }
        break

      case "p":
        const pText = cleanText(element.textContent || "")
        if (pText) {
          sections.push({ type: "paragraph", text: pText })
        }
        break

      case "ul":
      case "ol":
        // Process list items
        element.childNodes.forEach((child) => {
          if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toLowerCase() === "li") {
            const itemText = cleanText(child.textContent || "")
            if (itemText) {
              sections.push({ type: "listItem", text: itemText })
            }
          }
        })
        break

      case "br":
        // Ignore line breaks
        break

      case "strong":
      case "b":
      case "em":
      case "i":
      case "a":
      case "span":
        // For inline elements, extract text as paragraph
        const inlineText = cleanText(element.textContent || "")
        if (inlineText) {
          sections.push({ type: "paragraph", text: inlineText })
        }
        break

      case "div":
      case "section":
      case "article":
      default:
        // For container elements, process children
        element.childNodes.forEach((child) => processNode(child))
        break
    }
  }

  // Process all top-level nodes
  tempDiv.childNodes.forEach((node) => processNode(node))

  // Merge consecutive paragraphs and clean up
  const mergedSections: Array<{ type: "heading" | "subheading" | "paragraph" | "listItem"; text: string }> = []

  for (let i = 0; i < sections.length; i++) {
    const current = sections[i]

    // Skip empty sections
    if (!current.text.trim()) continue

    // If this is a paragraph and the previous was also a paragraph (not after a heading), merge them
    if (
      current.type === "paragraph" &&
      mergedSections.length > 0 &&
      mergedSections[mergedSections.length - 1].type === "paragraph"
    ) {
      // Only merge if they seem to be part of the same paragraph (short texts)
      const lastSection = mergedSections[mergedSections.length - 1]
      if (lastSection.text.length < 100 && current.text.length < 100) {
        lastSection.text = `${lastSection.text} ${current.text}`
        continue
      }
    }

    mergedSections.push({ ...current })
  }

  return mergedSections
}
