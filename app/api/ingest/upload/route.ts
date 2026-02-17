import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import Papa from "papaparse"

export const maxDuration = 60

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
  // 1. Authenticate the user
  const supabaseAuth = await createServerClient()
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  // 2. Parse the FormData
  const formData = await request.formData()
  const file = formData.get("file") as File | null
  const batchType = (formData.get("batchType") as BatchType) || "contacts"

  if (!file) {
    return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 })
  }

  if (!BATCH_TYPES[batchType]) {
    return NextResponse.json({ error: "Tipo de batch inválido" }, { status: 400 })
  }

  // 3. Use service role for bulk inserts (bypasses RLS)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  try {
    // 4. Read the file content
    const csvText = await file.text()

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
    const requiredHeaders = BATCH_TYPES[batchType].requiredHeaders
    const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h))

    if (missingHeaders.length > 0) {
      return NextResponse.json(
        { error: `Faltan columnas requeridas: ${missingHeaders.join(", ")}` },
        { status: 400 },
      )
    }

    // 7. Create batch record
    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({
        user_id: user.id,
        filename: file.name,
        status: "processing",
        total_rows: totalRows,
        processed_rows: 0,
        batch_type: batchType,
      })
      .select("id")
      .single()

    if (batchError || !batch) {
      console.error("[Ingest API] Error creating batch:", batchError)
      return NextResponse.json({ error: "Error al crear el lote de importación" }, { status: 500 })
    }

    const batchId = batch.id

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
        console.error(`[Ingest API] Error inserting chunk at offset ${i}:`, insertError)
        // Mark batch as failed if bulk insert fails
        await supabase
          .from("import_batches")
          .update({ status: "failed", error_message: insertError.message })
          .eq("id", batchId)

        return NextResponse.json(
          { error: `Error al insertar filas: ${insertError.message}`, batchId },
          { status: 500 },
        )
      }

      insertedRows += chunk.length
    }

    // 9. Batch is now "processing" - the Vercel cron will pick it up automatically
    // No need to call triggerBatchProcessing - the cron runs every minute
    console.log(`[Ingest API] Batch ${batchId} created with ${insertedRows} rows. Cron will process.`)

    return NextResponse.json({
      success: true,
      batchId,
      totalRows: insertedRows,
      message: `${insertedRows} filas cargadas. El procesamiento comenzará automáticamente.`,
    })
  } catch (err: any) {
    console.error("[Ingest API] Unexpected error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
