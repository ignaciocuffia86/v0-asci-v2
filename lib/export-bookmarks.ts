import ExcelJS from "exceljs"

export interface BookmarkExportData {
  company: {
    name: string
    country: string | null
    industry: string | null
    website: string | null
    linkedin_url: string | null
    employee_count: number | null
  }
  bookmark: {
    status: string
    priority: string | null
    notes: string | null
    search_context: string | null
    created_at: string
  }
  strategy: {
    recommended_pitch: string | null
    sender_context_override: string | null
  } | null
  employees_with_signals: Array<{
    first_name: string
    last_name: string
    position: string | null
    email: string | null
    linkedin_url: string | null
    signal_count: number
    signals: Array<{
      signal_type: string
      signal_name: string
      source: string | null
      snippet: string | null
    }> | null
  }>
  job_postings: Array<{
    title: string
    url: string | null
    location: string | null
    posted_at: string | null
    is_active: boolean
    signals: Array<{
      signal_type: string
      signal_name: string
    }> | null
  }>
  prospects: Array<{
    first_name: string
    last_name: string
    headline: string | null
    email: string | null
    email_status: string | null
    linkedin_url: string | null
    phone: string | null
    seniority: string | null
    is_decision_maker: boolean | null
    departments: string[] | null
  }>
  news: Array<{
    title: string
    url: string | null
    published_at: string | null
    source: string | null
  }>
  implementations: Array<{
    product_name: string
    vendor_name: string | null
    category: string | null
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

  const infoRows = [
    ["Empresa", data.company.name],
    ["País", data.company.country || ""],
    ["Industria", data.company.industry || ""],
    ["Website", data.company.website || ""],
    ["LinkedIn", data.company.linkedin_url || ""],
    ["Empleados", data.company.employee_count?.toString() || ""],
    ["", ""],
    ["Estado Bookmark", data.bookmark.status],
    ["Prioridad", data.bookmark.priority || ""],
    ["Contexto de Búsqueda", data.bookmark.search_context || ""],
    ["Notas", truncate(data.bookmark.notes, 500)],
    ["Fecha Guardado", new Date(data.bookmark.created_at).toLocaleDateString("es-ES")],
    ["", ""],
    ["Playbook / Estrategia", truncate(data.strategy?.recommended_pitch, 1000) || "No generado"],
  ]
  infoRows.forEach((row) => infoSheet.addRow(row))

  // Sheet 2: Empleados con Señales
  const empSheet = workbook.addWorksheet("Empleados y Señales")
  addHeaderRow(empSheet, [
    "Nombre",
    "Apellido",
    "Cargo",
    "Email",
    "LinkedIn",
    "# Señales",
    "Señales (tipo: nombre)",
  ])
  setColumnWidths(empSheet, [15, 15, 30, 30, 40, 12, 60])

  data.employees_with_signals.forEach((emp) => {
    const signalsSummary = emp.signals
      ?.map((s) => `${s.signal_type}: ${s.signal_name}`)
      .join("; ") || ""
    empSheet.addRow([
      emp.first_name,
      emp.last_name,
      emp.position || "",
      emp.email || "",
      emp.linkedin_url || "",
      emp.signal_count || 0,
      truncate(signalsSummary, 500),
    ])
  })

  // Sheet 3: Job Postings
  const jobSheet = workbook.addWorksheet("Job Postings")
  addHeaderRow(jobSheet, ["Título", "URL", "Ubicación", "Fecha", "Señales"])
  setColumnWidths(jobSheet, [40, 50, 25, 15, 50])

  data.job_postings.forEach((jp) => {
    const signalsSummary = jp.signals?.map((s) => s.signal_name).join(", ") || ""
    jobSheet.addRow([
      jp.title,
      jp.url || "",
      jp.location || "",
      jp.posted_at ? new Date(jp.posted_at).toLocaleDateString("es-ES") : "",
      signalsSummary,
    ])
  })

  // Sheet 4: Prospectos
  const prospSheet = workbook.addWorksheet("Prospectos Apollo")
  addHeaderRow(prospSheet, [
    "Nombre",
    "Apellido",
    "Cargo",
    "Email",
    "Estado Email",
    "LinkedIn",
    "Teléfono",
    "Seniority",
    "Decision Maker",
    "Departamentos",
  ])
  setColumnWidths(prospSheet, [15, 15, 35, 30, 15, 40, 18, 15, 15, 30])

  data.prospects.forEach((p) => {
    prospSheet.addRow([
      p.first_name,
      p.last_name,
      p.headline || "",
      p.email || "",
      p.email_status || "",
      p.linkedin_url || "",
      p.phone || "",
      p.seniority || "",
      p.is_decision_maker ? "Sí" : "No",
      p.departments?.join(", ") || "",
    ])
  })

  // Sheet 5: Noticias
  const newsSheet = workbook.addWorksheet("Noticias")
  addHeaderRow(newsSheet, ["Título", "URL", "Fecha", "Fuente"])
  setColumnWidths(newsSheet, [50, 60, 15, 20])

  data.news.forEach((n) => {
    newsSheet.addRow([
      n.title,
      n.url || "",
      n.published_at ? new Date(n.published_at).toLocaleDateString("es-ES") : "",
      n.source || "",
    ])
  })

  // Sheet 6: Implementaciones
  const implSheet = workbook.addWorksheet("Implementaciones")
  addHeaderRow(implSheet, ["Producto", "Vendor", "Categoría", "URL Fuente"])
  setColumnWidths(implSheet, [30, 25, 25, 50])

  data.implementations.forEach((impl) => {
    implSheet.addRow([
      impl.product_name,
      impl.vendor_name || "",
      impl.category || "",
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
    "# Empleados c/ Señales",
    "# Job Postings",
    "# Prospectos",
    "Playbook",
  ])
  setColumnWidths(summarySheet, [30, 15, 20, 15, 12, 20, 15, 15, 60])

  bookmarks.forEach(({ data }) => {
    summarySheet.addRow([
      data.company.name,
      data.company.country || "",
      data.company.industry || "",
      data.bookmark.status,
      data.bookmark.priority || "",
      data.employees_with_signals.length,
      data.job_postings.length,
      data.prospects.length,
      truncate(data.strategy?.recommended_pitch, 200) || "",
    ])
  })

  // All Prospects sheet (consolidated)
  const allProspectsSheet = workbook.addWorksheet("Todos los Prospectos")
  addHeaderRow(allProspectsSheet, [
    "Empresa",
    "Nombre",
    "Apellido",
    "Cargo",
    "Email",
    "LinkedIn",
    "Decision Maker",
  ])
  setColumnWidths(allProspectsSheet, [25, 15, 15, 35, 30, 40, 15])

  bookmarks.forEach(({ data }) => {
    data.prospects.forEach((p) => {
      allProspectsSheet.addRow([
        data.company.name,
        p.first_name,
        p.last_name,
        p.headline || "",
        p.email || "",
        p.linkedin_url || "",
        p.is_decision_maker ? "Sí" : "No",
      ])
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
