import ExcelJS from "exceljs"

export interface BookmarkExportData {
  company: {
    name: string
    country: string | null
    industry: string | null
    website: string | null
    linkedin_url: string | null
  }
  bookmark: {
    status: string
    priority: string | null
    notes: string | null
    search_context: any | null // JSONB
    created_at: string
  }
  strategy: {
    recommended_pitch: string | null
    sender_context_override: string | null
  } | null
  contacts_with_signals: {
    source?: "decision_makers" | "signals" // fallback cuando no hay DMs
    total_count: number
    exported_count: number
    truncated: boolean
    warning: string | null
    data: Array<{
      first_name: string
      last_name: string
      role: string | null
      email: string | null
      linkedin_url: string | null
      seniority: string | null
      is_current_employee?: boolean | null
      signal_count: number
      signals: Array<{
        signal_type: string
        signal_name: string
        snippet: string | null
        is_current_employee?: boolean | null
      }> | null
    }>
  }
  job_postings: Array<{
    title: string
    posting_url: string | null // DB column is 'posting_url', not 'url'
    location: string | null
    posted_at: string | null
    is_active: boolean
  }>
  news: Array<{
    title: string
    source_url: string | null // DB column is 'source_url', not 'url'
    published_at: string | null
    source_name: string | null // DB column is 'source_name', not 'source'
  }>
  implementations: Array<{
    technology: string | null // DB column is 'technology', not 'product_name'
    provider_name: string | null // DB column is 'provider_name', not 'vendor_name'
    area: string | null // DB column is 'area', not 'category'
    source_url: string | null
  }>
}

const HEADER_STYLE: Partial<ExcelJS.Style> = {
  font: { bold: true, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a1a2e" } },
  alignment: { horizontal: "left", vertical: "middle" },
}

function setColumnWidths(sheet: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((width, i) => {
    sheet.getColumn(i + 1).width = width
  })
}

function addHeaderRow(sheet: ExcelJS.Worksheet, headers: string[]) {
  const row = sheet.addRow(headers)
  row.eachCell((cell) => {
    cell.style = HEADER_STYLE
  })
  sheet.getRow(1).height = 24
}

function truncate(str: string | null | undefined, maxLen: number): string {
  if (!str) return ""
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str
}

export async function generateBookmarkExcel(
  data: BookmarkExportData,
  companyName: string
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "ASCI"
  workbook.created = new Date()

  // Sheet 1: Información General
  const infoSheet = workbook.addWorksheet("Info General")
  addHeaderRow(infoSheet, ["Campo", "Valor"])
  setColumnWidths(infoSheet, [25, 60])

  // Extract search context name if available
  const searchContextName = data.bookmark.search_context?.name || 
    (typeof data.bookmark.search_context === 'string' ? data.bookmark.search_context : "General")
  
  const infoRows = [
    ["Empresa", data.company.name],
    ["País", data.company.country || ""],
    ["Industria", data.company.industry || ""],
    ["Website", data.company.website || ""],
    ["LinkedIn", data.company.linkedin_url || ""],
    ["", ""],
    ["Estado Bookmark", data.bookmark.status],
    ["Prioridad", data.bookmark.priority || ""],
    ["Contexto de Búsqueda", searchContextName],
    ["Notas", truncate(data.bookmark.notes, 500)],
    ["Fecha Guardado", new Date(data.bookmark.created_at).toLocaleDateString("es-ES")],
    ["", ""],
    ["Playbook / Estrategia", truncate(data.strategy?.recommended_pitch, 1000) || "No generado"],
  ]
  infoRows.forEach((row) => infoSheet.addRow(row))

  // Sheet 2: Contactos con Señales
  const contactsSheet = workbook.addWorksheet("Contactos y Señales")
  addHeaderRow(contactsSheet, [
    "Nombre",
    "Apellido",
    "Rol",
    "Email",
    "LinkedIn",
    "Seniority",
    "Empleado Actual",
    "# Señales",
    "Señales (tipo: nombre)",
  ])
  setColumnWidths(contactsSheet, [15, 15, 30, 30, 40, 15, 16, 12, 60])

  // Add source note when contacts come from signals fallback
  if (data.contacts_with_signals.source === "signals") {
    const sourceRow = contactsSheet.addRow(["Fuente: señales detectadas (sin Decision Makers cargados)"])
    sourceRow.getCell(1).style = { font: { italic: true, color: { argb: "FF0066CC" } } }
    contactsSheet.mergeCells(sourceRow.number, 1, sourceRow.number, 9)
  }

  // Add warning if truncated
  if (data.contacts_with_signals.truncated) {
    const warningRow = contactsSheet.addRow([data.contacts_with_signals.warning || "Datos truncados"])
    warningRow.getCell(1).style = { font: { italic: true, color: { argb: "FFFF6600" } } }
    contactsSheet.mergeCells(warningRow.number, 1, warningRow.number, 9)
  }

  data.contacts_with_signals.data.forEach((contact) => {
    const signalsSummary = contact.signals
      ?.map((s) => `${s.signal_type}: ${s.signal_name}`)
      .join("; ") || ""
    contactsSheet.addRow([
      contact.first_name,
      contact.last_name,
      contact.role || "",
      contact.email || "",
      contact.linkedin_url || "",
      contact.seniority || "",
      contact.is_current_employee === true ? "Sí" : contact.is_current_employee === false ? "No (Alumni)" : "",
      contact.signal_count || 0,
      truncate(signalsSummary, 500),
    ])
  })

  // Sheet 3: Job Postings
  const jobSheet = workbook.addWorksheet("Job Postings")
  addHeaderRow(jobSheet, ["Título", "URL", "Ubicación", "Fecha", "Activo"])
  setColumnWidths(jobSheet, [40, 50, 25, 15, 12])

  data.job_postings.forEach((jp) => {
    jobSheet.addRow([
      jp.title,
      jp.posting_url || "",
      jp.location || "",
      jp.posted_at ? new Date(jp.posted_at).toLocaleDateString("es-ES") : "",
      jp.is_active ? "Sí" : "No",
    ])
  })

  // Sheet 4: Noticias
  const newsSheet = workbook.addWorksheet("Noticias")
  addHeaderRow(newsSheet, ["Título", "URL", "Fecha", "Fuente"])
  setColumnWidths(newsSheet, [50, 60, 15, 25])

  data.news.forEach((n) => {
    newsSheet.addRow([
      n.title,
      n.source_url || "",
      n.published_at ? new Date(n.published_at).toLocaleDateString("es-ES") : "",
      n.source_name || "",
    ])
  })

  // Sheet 5: Implementaciones
  const implSheet = workbook.addWorksheet("Implementaciones")
  addHeaderRow(implSheet, ["Tecnología", "Proveedor", "Área", "URL Fuente"])
  setColumnWidths(implSheet, [30, 25, 25, 50])

  data.implementations.forEach((impl) => {
    implSheet.addRow([
      impl.technology || "",
      impl.provider_name || "",
      impl.area || "",
      impl.source_url || "",
    ])
  })

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export async function generateBulkBookmarksExcel(
  bookmarks: Array<{ data: BookmarkExportData; companyName: string }>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "ASCI"
  workbook.created = new Date()

  // Summary sheet
  const summarySheet = workbook.addWorksheet("Resumen")
  addHeaderRow(summarySheet, [
    "Empresa",
    "País",
    "Industria",
    "Estado",
    "Prioridad",
    "# Contactos",
    "# Job Postings",
    "Playbook",
  ])
  setColumnWidths(summarySheet, [30, 15, 20, 15, 12, 15, 15, 60])

  bookmarks.forEach(({ data }) => {
    summarySheet.addRow([
      data.company.name,
      data.company.country || "",
      data.company.industry || "",
      data.bookmark.status,
      data.bookmark.priority || "",
      data.contacts_with_signals.total_count,
      data.job_postings.length,
      truncate(data.strategy?.recommended_pitch, 200) || "",
    ])
  })

  // All Contacts sheet (consolidated)
  const allContactsSheet = workbook.addWorksheet("Todos los Contactos")
  addHeaderRow(allContactsSheet, [
    "Empresa",
    "Nombre",
    "Apellido",
    "Rol",
    "Email",
    "LinkedIn",
    "Seniority",
    "# Señales",
  ])
  setColumnWidths(allContactsSheet, [25, 15, 15, 30, 30, 40, 15, 12])

  bookmarks.forEach(({ data }) => {
    data.contacts_with_signals.data.forEach((c) => {
      allContactsSheet.addRow([
        data.company.name,
        c.first_name,
        c.last_name,
        c.role || "",
        c.email || "",
        c.linkedin_url || "",
        c.seniority || "",
        c.signal_count || 0,
      ])
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
