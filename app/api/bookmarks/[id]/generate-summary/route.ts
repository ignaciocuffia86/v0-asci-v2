import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { generateGeminiContent } from "@/lib/ai-service"

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id: bookmarkId } = params

  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    // 1. Fetch bookmark data
    const { data: bookmark, error: bookmarkError } = await supabase
      .from("bookmarks")
      .select("*")
      .eq("id", bookmarkId)
      .eq("user_id", user.id)
      .single()

    if (bookmarkError || !bookmark) {
      return NextResponse.json({ error: "Bookmark no encontrado" }, { status: 404 })
    }

    // 2. Fetch company data
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("*")
      .eq("id", bookmark.company_id)
      .single()

    if (companyError || !company) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 })
    }

    const searchContext = bookmark.search_context || {}
    const filterSignalIds = searchContext.filterSignalIds || []

    // 3. Fetch related data in parallel
    const [{ data: news }, { data: implementations }, { data: jobPostings }, { data: prospects }, { data: strategy }] =
      await Promise.all([
        supabase
          .from("company_news")
          .select("title, summary, category, published_at, source_name")
          .eq("company_id", company.id)
          .order("published_at", { ascending: false })
          .limit(15),

        supabase
          .from("company_implementations")
          .select("title, summary, provider_name, technology, published_at")
          .eq("company_id", company.id)
          .order("published_at", { ascending: false })
          .limit(10),

        supabase
          .from("job_postings")
          .select("title, location, posted_at, description")
          .eq("company_id", company.id)
          .order("posted_at", { ascending: false })
          .limit(10),

        supabase
          .from("user_company_contacts")
          .select("full_name, role, email, phone, mobile_phone, seniority, headline, is_decision_maker, linkedin_url")
          .eq("company_id", company.id)
          .eq("user_id", user.id)
          .eq("is_decision_maker", true)
          .limit(20),

        supabase
          .from("user_company_strategies")
          .select("target_summary, recommended_pitch, sender_context_override")
          .eq("bookmark_id", bookmarkId)
          .eq("user_id", user.id)
          .maybeSingle(),
      ])

    // Construir query de señales según filtros del bookmark
    let signalsQuery = supabase
      .from("signals")
      .select(`
        id,
        signal_type,
        keyword_matched,
        is_current_employee,
        signal_id,
        contacts!inner (
          id,
          full_name,
          current_position_title,
          profile_picture_url,
          linkedin_url,
          email1,
          email1_status,
          email2,
          email2_status,
          phone1,
          phone2
        )
      `)
      .eq("company_id", company.id)

    // Aplicar filtro si existe
    if (filterSignalIds.length > 0) {
      signalsQuery = signalsQuery.in("signal_id", filterSignalIds)
    }

    const { data: signalsData } = await signalsQuery.limit(50)

    const techSignalIds = [
      ...new Set(
        (signalsData || [])
          .filter((s) => s.signal_type === "technology")
          .map((s) => s.signal_id)
          .filter(Boolean),
      ),
    ]

    const processSignalIds = [
      ...new Set(
        (signalsData || [])
          .filter((s) => s.signal_type === "process")
          .map((s) => s.signal_id)
          .filter(Boolean),
      ),
    ]

    const productMap = new Map<string, string>()
    const processMap = new Map<string, string>()

    if (techSignalIds.length > 0) {
      const { data: products } = await supabase.from("dictionary_products").select("id, name").in("id", techSignalIds)
      for (const p of products || []) {
        productMap.set(p.id, p.name)
      }
    }

    if (processSignalIds.length > 0) {
      const { data: processes } = await supabase
        .from("dictionary_processes")
        .select("id, name")
        .in("id", processSignalIds)
      for (const p of processes || []) {
        processMap.set(p.id, p.name)
      }
    }

    const contactSignalsMap = new Map<
      string,
      {
        contactName: string
        contactRole: string
        contactLinkedIn: string | null
        contactEmail: string | null
        contactEmailStatus: string | null
        contactPhone: string | null
        isCurrent: boolean
        keywords: string[]
      }
    >()

    for (const signal of signalsData || []) {
      const contact = signal.contacts as any
      if (!contact?.id) continue

      if (!contactSignalsMap.has(contact.id)) {
        // Seleccionar el mejor email disponible (priorizar email1 válido)
        let bestEmail = null
        let emailStatus = null
        if (contact.email1) {
          bestEmail = contact.email1
          emailStatus = contact.email1_status
        } else if (contact.email2) {
          bestEmail = contact.email2
          emailStatus = contact.email2_status
        }

        // Seleccionar el mejor teléfono disponible
        const bestPhone = contact.phone1 || contact.phone2 || null

        contactSignalsMap.set(contact.id, {
          contactName: contact.full_name || "Sin nombre",
          contactRole: contact.current_position_title || "",
          contactLinkedIn: contact.linkedin_url,
          contactEmail: bestEmail,
          contactEmailStatus: emailStatus,
          contactPhone: bestPhone,
          isCurrent: signal.is_current_employee,
          keywords: [],
        })
      }

      const existing = contactSignalsMap.get(contact.id)!
      if (signal.is_current_employee) {
        existing.isCurrent = true
      }

      let keywordName =
        signal.signal_type === "technology" ? productMap.get(signal.signal_id) : processMap.get(signal.signal_id)

      if (!keywordName) keywordName = signal.keyword_matched

      if (keywordName && !existing.keywords.includes(keywordName)) {
        existing.keywords.push(keywordName)
      }
    }

    const signalsGrouped = Array.from(contactSignalsMap.values())
    const currentEmployeesWithSignals = signalsGrouped.filter((s) => s.isCurrent)
    const alumniWithSignals = signalsGrouped.filter((s) => !s.isCurrent)

    // 4. Build detailed context for AI Brief
    const signalsContext =
      signalsGrouped.length > 0
        ? `SEÑALES DE COMPRA DETECTADAS (${signalsGrouped.length} personas):

EMPLEADOS ACTUALES CON SEÑALES (${currentEmployeesWithSignals.length}):
${
  currentEmployeesWithSignals.length > 0
    ? currentEmployeesWithSignals
        .map(
          (s) =>
            `- ${s.contactName} | ${s.contactRole}
  Tecnologías/Procesos: ${s.keywords.join(", ")}
  LinkedIn: ${s.contactLinkedIn || "No disponible"}
  Email: ${s.contactEmail || "No disponible"}${s.contactEmailStatus ? ` (${s.contactEmailStatus})` : ""}
  Teléfono: ${s.contactPhone || "No disponible"}`,
        )
        .join("\n\n")
    : "No hay empleados actuales con señales."
}

EX-EMPLEADOS / ALUMNI CON SEÑALES (${alumniWithSignals.length}):
${
  alumniWithSignals.length > 0
    ? alumniWithSignals
        .map(
          (s) =>
            `- ${s.contactName} | ${s.contactRole}
  Tecnologías/Procesos: ${s.keywords.join(", ")}
  LinkedIn: ${s.contactLinkedIn || "No disponible"}`,
        )
        .join("\n\n")
    : "No hay alumni con señales."
}`
        : "No hay señales de compra detectadas."

    const jobPostingsContext =
      jobPostings && jobPostings.length > 0
        ? `POSICIONES ABIERTAS (${jobPostings.length}):
${jobPostings
  .map(
    (j) =>
      `- ${j.title}
  Ubicación: ${j.location || "No especificada"}
  Publicado: ${j.posted_at || "No especificada"}
  ${j.description ? `Descripción: ${j.description.substring(0, 150)}...` : ""}`,
  )
  .join("\n\n")}`
        : "No hay posiciones abiertas registradas."

    const newsContext =
      news && news.length > 0
        ? `NOTICIAS RECIENTES (${news.length}):
${news
  .map(
    (n) =>
      `- [${n.category}] ${n.title}
  ${n.summary ? `Resumen: ${n.summary.substring(0, 200)}` : ""}
  Fuente: ${n.source_name || "No especificada"} | Fecha: ${n.published_at || "No especificada"}`,
  )
  .join("\n\n")}`
        : "No hay noticias registradas."

    const implementationsContext =
      implementations && implementations.length > 0
        ? `IMPLEMENTACIONES Y CASOS DE ÉXITO (${implementations.length}):
${implementations
  .map(
    (i) =>
      `- ${i.title}
  Vendor/Proveedor: ${i.provider_name || "No especificado"}
  Tecnología: ${i.technology || "No especificada"}
  ${i.summary ? `Detalle: ${i.summary.substring(0, 200)}` : ""}
  Fecha: ${i.published_at || "No especificada"}`,
  )
  .join("\n\n")}`
        : "No hay implementaciones registradas."

    const prospectsContext =
      prospects && prospects.length > 0
        ? `PROSPECTOS / DECISION MAKERS (${prospects.length}):
${prospects
  .map(
    (p) =>
      `- ${p.full_name} | ${p.role || p.headline || "No especificado"} | ${p.email || "No disponible"} | ${
        p.mobile_phone || p.phone || "No disponible"
      } | ${p.linkedin_url || "No disponible"}`,
  )
  .join("\n")}`
        : "No hay prospectos/decision makers identificados."

    const strategyContext = strategy
      ? `ESTRATEGIA Y PROPUESTA DE VALOR DEFINIDA:
Objetivo: ${strategy.target_summary || "No definido"}
Pitch recomendado: ${strategy.recommended_pitch || "No definido"}
Propuesta de valor del vendedor: ${strategy.sender_context_override || "No definida"}`
      : "No hay estrategia definida para esta cuenta."

    // 5. Generate Brief Ejecutivo with Gemini
    const prompt = `Eres un experto en ventas B2B y generación de oportunidades. Genera un BRIEF EJECUTIVO completo para abordar la siguiente cuenta.

=== INFORMACIÓN DE LA EMPRESA ===
Nombre: ${company.name}
Industria: ${company.industry || "No especificada"}
País: ${company.country || "No especificado"}
Descripción: ${company.description || "No disponible"}
Website: ${company.website || "No disponible"}

=== CONTEXTO DEL BOOKMARK ===
${signalsContext}

${jobPostingsContext}

${newsContext}

${implementationsContext}

${prospectsContext}

${strategyContext}

Notas adicionales del usuario: ${bookmark.notes || "Sin notas"}

=== INSTRUCCIONES PARA EL BRIEF ===

Genera un Brief Ejecutivo con el siguiente formato EXACTO (usa los encabezados tal cual):

**BRIEF EJECUTIVO PARA ${company.name.toUpperCase()}**

**1. SEÑALES DETECTADAS**
[Escribe 2 párrafos analizando las señales de compra detectadas. Incluye:
- Personas con señales relevantes (empleados actuales y alumni con experiencia en tecnologías específicas)
- Posiciones abiertas que indiquen inversión en tecnología
- Cualquier otra señal que indique momento de compra
Si no hay señales, indica qué tipo de señales se deberían buscar.]

**2. CONTEXTO DE MERCADO**
[Escribe 2 párrafos describiendo las noticias relevantes de los últimos 6 meses que puedan indicar inversión en tecnología. Incluye:
- Noticias de transformación digital, expansión, o cambios estratégicos
- Implementaciones tecnológicas recientes con vendors/proveedores
- Inversiones o adquisiciones relevantes
Si no hay información suficiente, indica qué se debería investigar.]

**3. CONTACTOS CLAVE**
[CONTACTOS_PLACEHOLDER]

**4. PLAYBOOK DE ABORDAJE**
[Escribe 2-3 párrafos con la estrategia recomendada para abordar esta cuenta, considerando:
- El contexto de la estrategia definida (si existe)
- Los canales recomendados (email, LinkedIn, llamada)
- El tono y enfoque del mensaje inicial
- Los pain points a atacar basado en las señales
- Timing recomendado
El tono debe ser ${strategy?.sender_context_override ? "alineado con la propuesta de valor definida: " + strategy.sender_context_override.substring(0, 200) : "profesional, consultivo y orientado a generar valor"}]

REGLAS:
- Sé específico con nombres, fechas, cargos y datos concretos
- Si falta información, indícalo claramente y sugiere cómo obtenerla
- El brief debe ser accionable, no genérico
- Usa español profesional de negocios
- No uses emojis
- Máximo 2500 caracteres en total
- En la sección "3. CONTACTOS CLAVE" escribe EXACTAMENTE "[CONTACTOS_PLACEHOLDER]" sin modificar. Los contactos se agregarán automáticamente después.`

    let summary: string
    try {
      summary = await generateGeminiContent(prompt, "gemini-2.5-flash", 0.4)
    } catch (error) {
      console.error("[v0] Gemini 2.5 Flash fallo, intentando con 2.0 Flash...")
      summary = await generateGeminiContent(prompt, "gemini-2.0-flash", 0.4)
    }

    const keyContacts = [
      // Primero los prospectos/decision makers
      ...(prospects || []).map((p) => ({
        name: p.full_name,
        role: p.role || p.headline || "No especificado",
        email: p.email || null,
        phone: p.mobile_phone || p.phone || null,
        linkedin: p.linkedin_url || null,
        source: "prospect" as const,
      })),
      // Luego empleados con señales que tengan info de contacto
      ...currentEmployeesWithSignals
        .filter((s) => s.contactEmail || s.contactPhone || s.contactLinkedIn)
        .map((s) => ({
          name: s.contactName,
          role: s.contactRole,
          email: s.contactEmail || null,
          phone: s.contactPhone || null,
          linkedin: s.contactLinkedIn || null,
          source: "signal" as const,
        })),
    ]
    // Eliminar duplicados por nombre
    const uniqueContacts = keyContacts.reduce(
      (acc, contact) => {
        const existing = acc.find((c) => c.name.toLowerCase() === contact.name.toLowerCase())
        if (!existing) {
          acc.push(contact)
        } else {
          // Mergear info si el existente tiene menos datos
          if (!existing.email && contact.email) existing.email = contact.email
          if (!existing.phone && contact.phone) existing.phone = contact.phone
          if (!existing.linkedin && contact.linkedin) existing.linkedin = contact.linkedin
        }
        return acc
      },
      [] as typeof keyContacts,
    )

    // 6. Save summary to database
    const { data: savedSummary, error: saveError } = await supabase
      .from("bookmark_summaries")
      .upsert(
        {
          bookmark_id: bookmarkId,
          summary,
          generated_at: new Date().toISOString(),
          metadata: {
            news_count: news?.length || 0,
            implementations_count: implementations?.length || 0,
            job_postings_count: jobPostings?.length || 0,
            signals_count: signalsGrouped.length,
            current_employees_count: currentEmployeesWithSignals.length,
            alumni_count: alumniWithSignals.length,
            decision_makers_count: prospects?.length || 0,
            has_strategy: !!strategy,
            company_name: company.name,
            company_industry: company.industry,
            company_country: company.country,
            key_contacts: uniqueContacts.slice(0, 10), // Limitar a 10 contactos
          },
        },
        {
          onConflict: "bookmark_id",
        },
      )
      .select()
      .single()

    if (saveError) {
      console.error("[v0] Error guardando resumen:", saveError)
      return NextResponse.json({ error: "Error guardando resumen" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      summary: savedSummary,
    })
  } catch (error: any) {
    console.error("[v0] Error generando resumen:", error)
    return NextResponse.json({ error: error.message || "Error generando resumen" }, { status: 500 })
  }
}
