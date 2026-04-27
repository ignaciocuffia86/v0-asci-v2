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
    linkedin_url: string | null
    // Slots de email con tipo (corporativo/personal) y status de validacion
    email1: string | null
    email1_type: string | null
    email1_status: string | null
    email2: string | null
    email2_type: string | null
    email2_status: string | null
    // Slots de telefono con tipo y status
    phone1: string | null
    phone1_type: string | null
    phone1_status: string | null
    phone2: string | null
    phone2_type: string | null
    phone2_status: string | null
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
    // Apollo separa mobile (revealed) y office phone (directo). Los exponemos
    // separados para que el usuario pueda preferir el movil si lo tiene.
    mobile_phone: string | null
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
  // Mostramos cada slot de email y telefono por separado (con su tipo y validez)
  // para que el usuario pueda priorizar/filtrar en Excel.
  const empSheet = workbook.addWorksheet("Empleados y Señales")
  addHeaderRow(empSheet, [
    "Nombre",
    "Apellido",
    "Cargo",
    "Email 1",
    "Tipo Email 1",
    "Estado Email 1",
    "Email 2",
    "Tipo Email 2",
    "Estado Email 2",
    "Teléfono 1",
    "Tipo Teléfono 1",
    "Estado Teléfono 1",
    "Teléfono 2",
    "Tipo Teléfono 2",
    "Estado Teléfono 2",
    "LinkedIn",
    "# Señales",
    "Señales (tipo: nombre)",
  ])
  setColumnWidths(empSheet, [
    15, 15, 30,
    30, 14, 14, 30, 14, 14,
    18, 14, 14, 18, 14, 14,
    40, 12, 60,
  ])

  data.employees_with_signals.forEach((emp) => {
    const signalsSummary = emp.signals
      ?.map((s) => `${s.signal_type}: ${s.signal_name}`)
      .join("; ") || ""
    empSheet.addRow([
      emp.first_name,
      emp.last_name,
      emp.position || "",
      emp.email1 || "",
      emp.email1_type || "",
      emp.email1_status || "",
      emp.email2 || "",
      emp.email2_type || "",
      emp.email2_status || "",
      emp.phone1 || "",
      emp.phone1_type || "",
      emp.phone1_status || "",
      emp.phone2 || "",
      emp.phone2_type || "",
      emp.phone2_status || "",
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
    // Priorizamos mobile (revealed phone) sobre el office phone
    const bestPhone = p.mobile_phone || p.phone || ""
    prospSheet.addRow([
      p.first_name,
      p.last_name,
      p.headline || "",
      p.email || "",
      p.email_status || "",
      p.linkedin_url || "",
      bestPhone,
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

// `generateBulkBookmarksExcel` fue removido junto con el endpoint de bulk export.
// El export ahora es siempre por bookmark individual y requiere un filtro de
// señales aplicado para evitar descargar data masiva sin criterio.
