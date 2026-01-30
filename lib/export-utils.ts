import * as XLSX from "xlsx"

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
    search_context: p.search_context || "",
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
 * Exporta prospectos a CSV
 */
export function exportToCSV(prospects: ExportProspect[], companyName: string): void {
  const headers = Object.values(EXPORT_HEADERS)
  const keys = Object.keys(EXPORT_HEADERS) as (keyof ExportProspect)[]

  // Crear filas con valores escapados para CSV
  const escapeCSV = (value: string): string => {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  const rows = prospects.map((p) =>
    keys.map((key) => escapeCSV(p[key] || "")).join(",")
  )

  const csvContent = [headers.join(","), ...rows].join("\n")
  const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" })
  downloadBlob(blob, generateFilename(companyName, "csv"))
}

/**
 * Exporta prospectos a Excel
 */
export function exportToExcel(prospects: ExportProspect[], companyName: string): void {
  const headers = Object.values(EXPORT_HEADERS)
  const keys = Object.keys(EXPORT_HEADERS) as (keyof ExportProspect)[]

  // Crear datos con headers
  const data = [
    headers,
    ...prospects.map((p) => keys.map((key) => p[key] || "")),
  ]

  // Crear workbook y worksheet
  const worksheet = XLSX.utils.aoa_to_sheet(data)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Prospectos")

  // Ajustar ancho de columnas
  const colWidths = keys.map((key) => {
    const maxLength = Math.max(
      EXPORT_HEADERS[key].length,
      ...prospects.map((p) => (p[key] || "").length)
    )
    return { wch: Math.min(maxLength + 2, 50) }
  })
  worksheet["!cols"] = colWidths

  // Generar y descargar
  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
  const blob = new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  downloadBlob(blob, generateFilename(companyName, "xlsx"))
}
