export interface ExportProspect {
  first_name: string
  last_name: string
  role: string
  email: string
  email_status: string
  phone: string
  mobile_phone: string
  linkedin_url: string
  country: string
  seniority: string
  search_context: string
  company_name: string
  company_domain: string
}

interface RawProspect {
  id: string
  full_name: string
  first_name?: string
  last_name?: string
  role?: string
  headline?: string
  email?: string
  email_status?: string
  phone?: string
  mobile_phone?: string
  linkedin_url?: string
  profile_picture_url?: string
  seniority?: string
  city?: string
  country?: string
  source?: string
  is_decision_maker?: boolean
  created_at?: string
  status?: string
  search_context?: string
  job_titles_searched?: string[]
}

interface CompanyInfo {
  name: string
  website?: string
}

interface SearchContext {
  filterType?: "technology" | "process"
  filtersUsed?: {
    process?: string[]
    technology?: string[]
  }
  filterSignalIds?: string[]
}

/**
 * Formatea el search_context JSON a texto legible
 * Ejemplo: {"filterType":"technology","filtersUsed":{"technology":["SAP ERP"]}}
 * Resultado: "Tecnología: SAP ERP"
 */
function formatSearchContext(rawContext?: string): string {
  if (!rawContext) return ""
  
  try {
    const context: SearchContext = JSON.parse(rawContext)
    const filterType = context.filterType
    const filters = context.filtersUsed
    
    if (!filterType || !filters) return ""
    
    if (filterType === "technology" && filters.technology?.length) {
      return `Tecnología: ${filters.technology.join(", ")}`
    }
    
    if (filterType === "process" && filters.process?.length) {
      return `Proceso: ${filters.process.join(", ")}`
    }
    
    return ""
  } catch {
    // Si no es JSON válido, retornar vacío
    return ""
  }
}

/**
 * Transforma los prospectos raw al formato de exportación
 */
export function prepareProspectsForExport(
  prospects: RawProspect[],
  company: CompanyInfo
): ExportProspect[] {
  // Extraer dominio de la URL
  const extractDomain = (url?: string): string => {
    if (!url) return ""
    try {
      const domain = url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]
      return domain
    } catch {
      return url
    }
  }

  return prospects.map((p) => ({
    first_name: p.first_name || "",
    last_name: p.last_name || "",
    role: p.role || "",
    email: p.email || "",
    email_status: p.email_status || "",
    phone: p.phone || "",
    mobile_phone: p.mobile_phone || "",
    linkedin_url: p.linkedin_url || "",
    country: p.country || "",
    seniority: p.seniority || "",
    search_context: formatSearchContext(p.search_context),
    company_name: company.name,
    company_domain: extractDomain(company.website),
  }))
}

/**
 * Headers para los archivos de exportación
 */
const EXPORT_HEADERS: Record<keyof ExportProspect, string> = {
  first_name: "Nombre",
  last_name: "Apellido",
  role: "Cargo",
  email: "Email",
  email_status: "Estado Email",
  phone: "Teléfono",
  mobile_phone: "Celular",
  linkedin_url: "LinkedIn",
  country: "País",
  seniority: "Seniority",
  search_context: "Contexto de Búsqueda",
  company_name: "Empresa",
  company_domain: "Dominio",
}

/**
 * Genera nombre de archivo sanitizado
 */
function generateFilename(companyName: string, extension: string): string {
  const sanitized = companyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  const date = new Date().toISOString().split("T")[0]
  return `${sanitized}_prospectos_${date}.${extension}`
}

/**
 * Descarga un archivo blob
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Escapa valor para CSV - maneja null, undefined, y objetos
 */
function escapeCSV(value: unknown): string {
  // Convertir cualquier valor a string de forma segura
  let str: string
  if (value === null || value === undefined) {
    str = ""
  } else if (typeof value === "object") {
    str = JSON.stringify(value)
  } else {
    str = String(value)
  }
  
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Exporta prospectos a CSV
 */
export function exportToCSV(prospects: ExportProspect[], companyName: string): void {
  const headers = Object.values(EXPORT_HEADERS)
  const keys = Object.keys(EXPORT_HEADERS) as (keyof ExportProspect)[]

  const rows = prospects.map((p) =>
    keys.map((key) => escapeCSV(p[key] || "")).join(",")
  )

  const csvContent = [headers.join(","), ...rows].join("\n")
  // BOM para UTF-8 en Excel
  const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" })
  downloadBlob(blob, generateFilename(companyName, "csv"))
}

/**
 * Escapa valor para XML - maneja null, undefined, y objetos
 */
function escapeXML(value: unknown): string {
  // Convertir cualquier valor a string de forma segura
  let str: string
  if (value === null || value === undefined) {
    str = ""
  } else if (typeof value === "object") {
    str = JSON.stringify(value)
  } else {
    str = String(value)
  }
  
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/**
 * Exporta prospectos a Excel (formato XML SpreadsheetML compatible con Excel)
 */
export function exportToExcel(prospects: ExportProspect[], companyName: string): void {
  const headers = Object.values(EXPORT_HEADERS)
  const keys = Object.keys(EXPORT_HEADERS) as (keyof ExportProspect)[]

  // Crear filas de datos
  const headerRow = headers
    .map((h) => `<Cell><Data ss:Type="String">${escapeXML(h)}</Data></Cell>`)
    .join("")

  const dataRows = prospects
    .map((p) => {
      const cells = keys
        .map((key) => `<Cell><Data ss:Type="String">${escapeXML(p[key] || "")}</Data></Cell>`)
        .join("")
      return `<Row>${cells}</Row>`
    })
    .join("")

  // Crear XML de SpreadsheetML (formato nativo de Excel)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#E0E0E0" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Prospectos">
    <Table>
      <Row ss:StyleID="Header">${headerRow}</Row>
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`

  const blob = new Blob([xml], {
    type: "application/vnd.ms-excel;charset=utf-8",
  })
  downloadBlob(blob, generateFilename(companyName, "xls"))
}
