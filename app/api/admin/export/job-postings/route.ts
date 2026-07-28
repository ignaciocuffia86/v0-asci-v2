import { createClient } from "@/lib/supabase/server"

/**
 * Export de jobpostings en streaming.
 *
 * Por qué un route handler y no una server action:
 * son 35k+ jobpostings y las descripciones suman ~105 MB. Traer todo a memoria
 * excedería el límite de payload de una server action. Acá se pagina en el
 * servidor y se va escribiendo el CSV al response, así el browser recibe la
 * descarga de forma incremental sin importar el volumen.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 300

const PAGE_SIZE = 2000
const HARD_ROW_CAP = 200_000 // cortafuegos contra un loop infinito

const COLUMNS = [
  { key: "title", header: "Titulo" },
  { key: "company_name", header: "Empresa" },
  { key: "country", header: "Pais" },
  { key: "industry", header: "Industria" },
  { key: "location", header: "Ubicacion" },
  { key: "posted_at", header: "Fecha de Posteo" },
  { key: "signal_count", header: "Cantidad de Senales" },
  { key: "signals_process", header: "Senales de Proceso" },
  { key: "signals_technology", header: "Senales de Tecnologia" },
  { key: "job_url", header: "URL del Aviso" },
  { key: "apply_url", header: "URL de Postulacion" },
] as const

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return ""
  const str = typeof value === "object" ? JSON.stringify(value) : String(value)
  // Excel rompe el CSV si el valor trae comas, comillas o saltos de linea.
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/** Fecha en formato YYYY-MM-DD para que Excel la interprete como fecha. */
function formatDate(value: unknown): string {
  if (!value) return ""
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10)
}

function parseList(raw: string | null): string[] | null {
  if (!raw) return null
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return items.length > 0 ? items : null
}

function parseText(raw: string | null): string | null {
  const t = raw?.trim()
  return t ? t : null
}

export async function GET(request: Request) {
  const supabase = await createClient()

  // Los route handlers NO heredan la proteccion del layout de /admin,
  // asi que replicamos el chequeo de superadmin explicitamente.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response("No autenticado", { status: 401 })
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

  if (profile?.role !== "superadmin") {
    return new Response("No autorizado", { status: 403 })
  }

  const { searchParams } = new URL(request.url)

  const signalTypeRaw = parseText(searchParams.get("signalType"))
  const signalType = signalTypeRaw === "process" || signalTypeRaw === "technology" ? signalTypeRaw : null

  const includeDescription = searchParams.get("includeDescription") === "true"

  const rpcParams = {
    p_signal_type: signalType,
    p_signal_names: parseList(searchParams.get("signalNames")),
    p_countries: parseList(searchParams.get("countries")),
    p_industries: parseList(searchParams.get("industries")),
    p_date_from: parseText(searchParams.get("dateFrom")),
    p_date_to: parseText(searchParams.get("dateTo")),
    p_location_query: parseText(searchParams.get("locationQuery")),
    p_title_query: parseText(searchParams.get("titleQuery")),
    p_only_with_signals: searchParams.get("onlyWithSignals") === "true",
  }

  const headers: string[] = COLUMNS.map((c) => c.header)
  if (includeDescription) headers.push("Descripcion")

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // BOM para que Excel abra el CSV en UTF-8 y respete los acentos.
      controller.enqueue(encoder.encode("\ufeff" + headers.join(",") + "\n"))

      let offset = 0
      let totalRows = 0

      try {
        while (true) {
          const { data, error } = await supabase.rpc("export_job_postings", {
            ...rpcParams,
            p_include_description: includeDescription,
            p_limit: PAGE_SIZE,
            p_offset: offset,
          })

          if (error) {
            console.error("[v0] Error en pagina de export (offset " + offset + "):", error.message)
            // El CSV ya empezo a descargarse, no se puede cambiar el status HTTP.
            // Se deja una marca visible al final para que el usuario sepa que esta incompleto.
            controller.enqueue(encoder.encode(`\n"ERROR: export incompleto - ${error.message}"\n`))
            break
          }

          const rows = data || []
          if (rows.length === 0) break

          let chunk = ""
          for (const row of rows) {
            const cells = COLUMNS.map((col) =>
              col.key === "posted_at" ? formatDate(row[col.key]) : escapeCSV(row[col.key]),
            )
            if (includeDescription) cells.push(escapeCSV(row.description))
            chunk += cells.join(",") + "\n"
          }
          controller.enqueue(encoder.encode(chunk))

          totalRows += rows.length
          offset += PAGE_SIZE

          if (rows.length < PAGE_SIZE) break
          if (totalRows >= HARD_ROW_CAP) {
            console.warn("[v0] Export alcanzo el tope de " + HARD_ROW_CAP + " filas")
            break
          }
        }
      } catch (err) {
        console.error("[v0] Error inesperado en export:", err)
        controller.enqueue(encoder.encode('\n"ERROR: export interrumpido"\n'))
      } finally {
        controller.close()
      }
    },
  })

  const dateStr = new Date().toISOString().slice(0, 10)

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jobpostings_export_${dateStr}.csv"`,
      "Cache-Control": "no-store",
      // Evita que un proxy intente bufferear todo el stream.
      "X-Accel-Buffering": "no",
    },
  })
}
