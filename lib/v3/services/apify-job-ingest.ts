import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Ingesta de vacantes scrapeadas (Apify) reutilizando el ETL de v2.
 *
 * Decisión central: NO se inventa un pipeline paralelo. Las filas entran por
 * `import_batches` + `import_rows` y las procesa el mismo cron que ya procesa los
 * CSV, así que la normalización, el upsert de empresa, la deduplicación y la
 * generación de señales quedan en un solo lugar.
 *
 * Cuatro hallazgos de la verificación contra la base real moldearon este archivo:
 *
 * 1. `batch_type` NO puede ser un valor nuevo. `process_import_batch` despacha con
 *    IF 'contacts' / ELSIF 'job_postings' / ELSE 'Unknown batch type' + EXIT. Un
 *    tipo propio no procesaría ninguna fila y dejaría el batch en `processing`,
 *    que el cron re-toma en cada corrida: un bucle de errores. Se usa
 *    'job_postings' y la procedencia se marca en `filename`.
 * 2. La columna de datos es `row_data`, no `raw_data`, y es NOT NULL.
 * 3. El RPC ya entiende campos nativos de Apify (`companyName`, `jobUrl`,
 *    `postedTime`, `publishedAt`, `applyUrl`), así que no hace falta traducirlos.
 * 4. `upsert_company` matchea por `linkedin_url` y después por nombre normalizado.
 *    Si se dejara que el nombre lo ponga el scraper, una variante como "Arcor SA"
 *    crearía una empresa DUPLICADA en la tabla de producción de v2. Por eso se
 *    inyecta la identidad exacta de la empresa destino en cada fila.
 */

/** Tamaño de chunk del INSERT: el mismo que usa el upload de CSV de v2. */
const CHUNK_SIZE = 2000

/** Prefijo del filename. Es el marcador de procedencia y la clave para auditar. */
export const APIFY_FILENAME_PREFIX = "apify://"

export interface ApifyJobItem {
  [key: string]: unknown
}

export interface ApifyIngestResult {
  batchId: string | null
  companyId: string
  received: number
  queued: number
  skippedWithoutUrl: number
  skippedDuplicateInPayload: number
  filename: string
  warnings: string[]
}

/**
 * Extrae la URL de la vacante probando las mismas variantes que el RPC.
 *
 * Debe mantenerse alineada con el COALESCE de `process_job_batch_internal`: si acá
 * se aceptara una fila cuya URL el RPC no sabe leer, entraría con `job_url` NULL.
 */
function extractJobUrl(item: ApifyJobItem): string | null {
  const candidates = ["job_url", "applyUrl", "apply_url", "apply_link", "jobUrl", "url", "uniq_id"]
  for (const key of candidates) {
    const value = item[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

export async function ingestApifyJobPostings(params: {
  companyId: string
  userId: string
  runId: string
  items: ApifyJobItem[]
}): Promise<ApifyIngestResult> {
  const admin = createAdminClient()
  const warnings: string[] = []
  const filename = `${APIFY_FILENAME_PREFIX}${params.runId}`

  // Identidad canónica de la empresa destino. Es la salvaguarda contra duplicar
  // la empresa en v2: al pasar el linkedin_url y el nombre tal como están
  // guardados, `upsert_company` matchea la fila existente en vez de insertar otra.
  const { data: company, error: companyError } = await admin
    .from("companies")
    .select("id, name, linkedin_url, website, industry, country")
    .eq("id", params.companyId)
    .maybeSingle()

  if (companyError) throw new Error(`APIFY_INGEST_COMPANY_LOOKUP_FAILED:${companyError.message}`)
  if (!company) throw new Error("APIFY_INGEST_COMPANY_NOT_FOUND")

  // Filas sin URL: se descartan. El RPC inserta con ON CONFLICT (job_url), y en
  // Postgres un NULL no conflictúa con nada, así que una fila sin URL se volvería
  // a insertar en cada corrida y multiplicaría vacantes en una tabla de producción.
  const seen = new Set<string>()
  let skippedWithoutUrl = 0
  let skippedDuplicateInPayload = 0
  const rows: { batch_id: string; row_data: Record<string, unknown> }[] = []

  for (const item of params.items) {
    const jobUrl = extractJobUrl(item)
    if (!jobUrl) {
      skippedWithoutUrl++
      continue
    }
    // Deduplicación dentro del propio payload: un run puede devolver la misma
    // vacante dos veces. No sustituye a la del ETL (que resuelve contra lo ya
    // guardado), solo evita filas literalmente repetidas en el mismo batch.
    if (seen.has(jobUrl)) {
      skippedDuplicateInPayload++
      continue
    }
    seen.add(jobUrl)

    rows.push({
      batch_id: "",
      row_data: {
        ...item,
        // La identidad de la empresa se impone DESPUÉS del spread: si el scraper
        // trae su propia variante del nombre, no debe ganar.
        company_name: company.name,
        company_linkedin_url: company.linkedin_url,
        website: company.website,
        sector: company.industry,
        country: company.country,
        job_url: jobUrl,
        // Marca de procedencia a nivel fila: queda en job_postings.source_data,
        // porque el RPC guarda row_data completo ahí.
        _v3_source: "apify",
        _v3_run_id: params.runId,
      },
    })
  }

  if (skippedWithoutUrl > 0) {
    warnings.push(`${skippedWithoutUrl} vacantes sin URL fueron descartadas (no se pueden deduplicar).`)
  }
  if (skippedDuplicateInPayload > 0) {
    warnings.push(`${skippedDuplicateInPayload} vacantes repetidas dentro del mismo run fueron descartadas.`)
  }

  if (!rows.length) {
    // Sin filas no se crea batch: un batch vacío en `uploading` es basura que el
    // cron nunca mira y que ensucia el panel de /admin/processing.
    return {
      batchId: null,
      companyId: params.companyId,
      received: params.items.length,
      queued: 0,
      skippedWithoutUrl,
      skippedDuplicateInPayload,
      filename,
      warnings: [...warnings, "No quedaron vacantes utilizables: no se creó ningún batch."],
    }
  }

  // El batch nace en `uploading`, no en `pending`/`processing`. Es el fix de la
  // race condition histórica: el cron solo mira pending/processing, así que
  // mientras se insertan las filas el batch le es invisible y no puede marcarlo
  // `completed` por ver 0 filas pendientes.
  const { data: batch, error: batchError } = await admin
    .from("import_batches")
    .insert({
      user_id: params.userId,
      filename,
      batch_type: "job_postings",
      status: "uploading",
      total_rows: rows.length,
    })
    .select("id")
    .single()

  if (batchError) throw new Error(`APIFY_INGEST_BATCH_CREATE_FAILED:${batchError.message}`)

  let alreadyMarkedFailed = false

  try {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE).map((row) => ({ ...row, batch_id: batch.id }))
      const { error: rowsError } = await admin.from("import_rows").insert(chunk)
      if (rowsError) throw new Error(`APIFY_INGEST_ROWS_FAILED:${rowsError.message}`)
    }

    // finalize_batch_upload re-cuenta las filas en la base y solo entonces pasa el
    // batch a `pending`. Si el conteo no coincide con total_rows, lo marca
    // `failed`. Recién acá el batch se vuelve visible para el cron.
    const { data: finalized, error: finalizeError } = await admin.rpc("finalize_batch_upload", {
      p_batch_id: batch.id,
      p_total_rows: rows.length,
    })
    if (finalizeError) throw new Error(`APIFY_INGEST_FINALIZE_FAILED:${finalizeError.message}`)

    // El RPC devuelve {status:'pending'|'failed'}, no {success}. Si rechaza por
    // conteo inconsistente, YA dejó el batch en `failed` con el detalle exacto
    // ("expected N, found M"), así que se marca para no sobrescribir ese mensaje.
    const finalizedResult = finalized as { status?: string; expected?: number; found?: number } | null
    if (finalizedResult?.status === "failed") {
      alreadyMarkedFailed = true
      throw new Error(
        `APIFY_INGEST_FINALIZE_REJECTED:conteo inconsistente (esperadas ${finalizedResult.expected}, encontradas ${finalizedResult.found})`
      )
    }
  } catch (error) {
    // Un batch abandonado en `uploading` es invisible para el cron y queda colgado
    // para siempre. Marcarlo `failed` lo hace visible en /admin/processing.
    // Si finalize_batch_upload ya lo marcó, no se toca: su mensaje es más preciso.
    if (!alreadyMarkedFailed) {
      await admin
        .from("import_batches")
        .update({ status: "failed", error_message: error instanceof Error ? error.message : "Error desconocido" })
        .eq("id", batch.id)
    }
    throw error
  }

  return {
    batchId: batch.id,
    companyId: params.companyId,
    received: params.items.length,
    queued: rows.length,
    skippedWithoutUrl,
    skippedDuplicateInPayload,
    filename,
    warnings,
  }
}
