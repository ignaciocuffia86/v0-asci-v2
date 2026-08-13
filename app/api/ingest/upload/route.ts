import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/auth/require-superadmin"
import { del } from "@vercel/blob"
import Papa from "papaparse"

export const maxDuration = 300

const BATCH_TYPES = {
  contacts: {
    requiredHeaders: ["person_linkedin_url", "full_name", "company_name", "current_position"],
  },
  job_postings: {
    requiredHeaders: ["title", "companyUrl"],
  },
} as const

type BatchType = keyof typeof BATCH_TYPES

function formatContactRow(row: any) {
  return {
    company_name: row.company_name,
    company_linkedin_url: row.company_linkedin_url,
    company_website: row.company_website,
    company_industry: row.company_industry,
    company_country: row.company_country,
    company_logo_url: row.company_logo_url,
    company_description: row.company_description,
    linkedin_url: row.person_linkedin_url,
    first_name: row.first_name,
    last_name: row.last_name,
    full_name: row.full_name,
    headline: row.headline,
    about: row.about,
    current_position: row.current_position,
    current_position_description: row.current_position_description,
    current_position_started_at: row.current_position_started_on,
    country: row.person_country,
    profile_picture_url: row.person_image_url,
    email1: row.email1,
    email1_type: row.email1_type,
    email1_status: row.email1_status,
    email2: row.email2,
    email2_type: row.email2_type,
    email2_status: row.email2_status,
    email3: row.email3,
    email3_type: row.email3_type,
    email3_status: row.email3_status,
    email4: row.email4,
    email4_type: row.email4_type,
    email4_status: row.email4_status,
    phone1: row.phone1,
    phone1_type: row.phone1_type,
    phone1_status: row.phone1_status,
    phone2: row.phone2,
    phone2_type: row.phone2_type,
    phone2_status: row.phone2_status,
    previous_company_1: row.previous_company_1,
    previous_position_1: row.previous_position_1,
    previous_position_1_description: row.previous_position_1_description,
    previous_position_1_started_at: row.previous_position_1_started_on,
    previous_position_1_ended_at: row.previous_position_1_ended_on,
    previous_company_2: row.previous_company_2,
    previous_position_2: row.previous_position_2,
    previous_position_2_description: row.previous_position_2_description,
    previous_position_2_started_at: row.previous_position_2_started_on,
    previous_position_2_ended_at: row.previous_position_2_ended_on,
    previous_company_3: row.previous_company_3,
    previous_position_3: row.previous_position_3,
    previous_position_3_description: row.previous_position_3_description,
    previous_position_3_started_at: row.previous_position_3_started_on,
    previous_position_3_ended_at: row.previous_position_3_ended_on,
    previous_company_4: row.previous_company_4,
    previous_position_4: row.previous_position_4,
    previous_position_4_description: row.previous_position_4_description,
    previous_position_4_started_at: row.previous_position_4_started_on,
    previous_position_4_ended_at: row.previous_position_4_ended_on,
    previous_company_5: row.previous_company_5,
    previous_position_5: row.previous_position_5,
    previous_position_5_description: row.previous_position_5_description,
    previous_position_5_started_at: row.previous_position_5_started_on,
    previous_position_5_ended_at: row.previous_position_5_ended_on,
    previous_company_6: row.previous_company_6,
    previous_position_6: row.previous_position_6,
    previous_position_6_description: row.previous_position_6_description,
    previous_position_6_started_at: row.previous_position_6_started_on,
    previous_position_6_ended_at: row.previous_position_6_ended_on,
  }
}

function formatJobPostingRow(row: any) {
  const { html_job_description, job_description, description, ...leanOriginal } = row
  return {
    company_linkedin_url: row.company_linkedin_url || row.companyUrl,
    company_name: row.company_name || row.companyName,
    title: row.title || row.job_title,
    description: row.description || row.job_description || row.html_job_description,
    location: row.location || `${row.city || ""}, ${row.state || ""}, ${row.country || ""}`.trim(),
    applyUrl: row.applyUrl || row.apply_url || row.apply_link,
    posting_url: row.jobUrl || row.url || row.uniq_id,
    posted_at: row.postedTime || row.post_date || row.publishedAt,
    salary_from: row.inferred_salary_from,
    salary_to: row.inferred_salary_to,
    salary_currency: row.inferred_salary_currency,
    job_type: row.job_type || row.contractType,
    experience_level: row.experienceLevel || row.inferred_seniority_level,
    work_mode: row.work_mode || row.workType || row.inferred_work_mode,
    department: row.inferred_department_name,
    skills: row.inferred_skills,
    applications_count: row.applicationsCount,
    _original: leanOriginal,
  }
}

export async function POST(request: Request) {
  // 1. Only superadmins may ingest (A1 hardening): this route uses the service
  // role to bulk-insert into public.contacts (superadmin-write by RLS), so the
  // endpoint must enforce the same bar instead of accepting any authenticated user.
  const auth = await requireSuperadmin()
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 403 })
  }

  // 2. Parse the JSON body (contains blobUrl, filename, batchType)
  let body: { blobUrl: string; filename: string; batchType: BatchType }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const { blobUrl, filename, batchType } = body

  if (!blobUrl || !filename) {
    return NextResponse.json({ error: "Falta blobUrl o filename" }, { status: 400 })
  }

  if (!BATCH_TYPES[batchType]) {
    return NextResponse.json({ error: "Tipo de batch inválido" }, { status: 400 })
  }

  // 3. Use service role for bulk inserts (bypasses RLS)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Hoisted so the catch-all handler can fail the batch instead of leaving it
  // stranded in "uploading" forever.
  let createdBatchId: string | null = null

  try {
    // 4. Download CSV from Blob
    const csvResponse = await fetch(blobUrl)
    if (!csvResponse.ok) {
      return NextResponse.json({ error: "No se pudo descargar el archivo desde Blob" }, { status: 500 })
    }
    const csvText = await csvResponse.text()

    // 5. Parse CSV server-side
    const parseResult = await new Promise<Papa.ParseResult<any>>((resolve, reject) => {
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: resolve,
        error: reject,
      })
    })

    const rows = parseResult.data
    const totalRows = rows.length
    const headers = parseResult.meta.fields || []

    // 6. Validate headers
    const requiredHeaders: readonly string[] = BATCH_TYPES[batchType].requiredHeaders
    const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h))

    if (missingHeaders.length > 0) {
      // Clean up blob since validation failed
      await del(blobUrl).catch(() => {})
      return NextResponse.json(
        { error: `Faltan columnas requeridas: ${missingHeaders.join(", ")}` },
        { status: 400 },
      )
    }

    // 7. Check for duplicate filename (prevent reprocessing the same file)
    const { data: existing } = await supabase
      .from("import_batches")
      .select("id, status, created_at")
      .eq("filename", filename)
      .not("status", "eq", "failed")
      .limit(1)
      .maybeSingle()

    if (existing) {
      await del(blobUrl).catch(() => {})
      return NextResponse.json(
        {
          error: `El archivo "${filename}" ya fue subido el ${new Date(existing.created_at).toLocaleDateString("es-AR")} (estado: ${existing.status}). Si necesitas reprocesarlo, cambia el nombre del archivo.`,
        },
        { status: 409 },
      )
    }

    // 8. Create batch record.
    // IMPORTANT: it starts as "uploading", NOT "processing".
    // The process-queue cron only picks up ("pending","processing") batches, so
    // while we are still inserting rows the batch is invisible to it. Before
    // this, the cron could run mid-insert, see 0 pending rows, conclude the
    // batch was done and mark it "completed" -> the rows landed afterwards and
    // were never processed (silent failure). Job postings were hit hardest
    // because their huge description columns make the inserts much slower.
    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({
        user_id: auth.userId,
        filename,
        status: "uploading",
        total_rows: totalRows,
        processed_rows: 0,
        batch_type: batchType,
      })
      .select("id")
      .single()

    if (batchError || !batch) {
      await del(blobUrl).catch(() => {})
      return NextResponse.json({ error: "Error al crear el lote de importación" }, { status: 500 })
    }

    const batchId = batch.id
    createdBatchId = batchId

    // 8. Format and insert rows in server-side chunks of 2,000
    const CHUNK_SIZE = 2000
    const formatRow = batchType === "job_postings" ? formatJobPostingRow : formatContactRow
    let insertedRows = 0

    for (let i = 0; i < totalRows; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE)
      const formattedChunk = chunk.map((row: any) => ({
        batch_id: batchId,
        row_data: formatRow(row),
        status: "pending",
      }))

      const { error: insertError } = await supabase.from("import_rows").insert(formattedChunk)

      if (insertError) {
        await supabase
          .from("import_batches")
          .update({ status: "failed", error_message: insertError.message })
          .eq("id", batchId)

        await del(blobUrl).catch(() => {})
        return NextResponse.json(
          { error: `Error al insertar filas: ${insertError.message}`, batchId },
          { status: 500 },
        )
      }

      insertedRows += chunk.length
    }

    // 9. Every row is in. Atomically flip "uploading" -> "pending" so the cron
    // can now pick it up. The RPC re-counts the rows in the database and fails
    // the batch on mismatch, so a batch is only ever queued once it is complete.
    const { data: finalizeResult, error: finalizeError } = await supabase.rpc(
      "finalize_batch_upload",
      { p_batch_id: batchId, p_total_rows: insertedRows },
    )

    if (finalizeError) {
      await supabase
        .from("import_batches")
        .update({ status: "failed", error_message: `Finalize failed: ${finalizeError.message}` })
        .eq("id", batchId)

      await del(blobUrl).catch(() => {})
      return NextResponse.json(
        { error: `Error al finalizar la carga: ${finalizeError.message}`, batchId },
        { status: 500 },
      )
    }

    const finalized = typeof finalizeResult === "string" ? JSON.parse(finalizeResult) : finalizeResult

    if (finalized?.status === "failed") {
      await del(blobUrl).catch(() => {})
      return NextResponse.json(
        {
          error: `Inconsistencia al cargar: se esperaban ${finalized.expected} filas y se encontraron ${finalized.found}. El lote fue marcado como fallido.`,
          batchId,
        },
        { status: 500 },
      )
    }

    // 10. Clean up blob - CSV is now in the database
    await del(blobUrl).catch(() => {})

    return NextResponse.json({
      success: true,
      batchId,
      totalRows: insertedRows,
      message: `${insertedRows} filas cargadas. El procesamiento comenzará automáticamente.`,
    })
  } catch (err: any) {
    // Never leave a batch stuck in "uploading": the cron ignores that status,
    // so it would be invisible forever. Mark it failed so it shows up in
    // /admin/processing and can be retried.
    if (createdBatchId) {
      try {
        await supabase
          .from("import_batches")
          .update({
            status: "failed",
            error_message: `Upload aborted: ${err.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", createdBatchId)
      } catch {
        // best effort
      }
    }

    // Clean up blob on any error
    await del(blobUrl).catch(() => {})
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
