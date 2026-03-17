import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { rankDocumentsForBookmark } from "@/lib/documents/rank-documents-for-bookmark"
import { generateGeminiContent } from "@/lib/ai-service"

// Max distinct signal_ids to consider when building the company signal count map
const MAX_SIGNAL_IDS = 50

export async function GET(req: NextRequest) {
  const bookmarkId = req.nextUrl.searchParams.get("bookmarkId")
  if (!bookmarkId) {
    return NextResponse.json({ error: "bookmarkId required" }, { status: 400 })
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    // Check if user has any documents
    const { count } = await supabase
      .from("user_documents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "ready")

    const hasDocuments = (count || 0) > 0

    // Get value profile
    const { data: valueProfile } = await supabase
      .from("user_value_profiles")
      .select("profile_summary, target_industries, target_technologies, target_processes")
      .eq("user_id", user.id)
      .maybeSingle()

    // Get bookmark for context
    const { data: bookmark } = await supabase
      .from("bookmarks")
      .select("company_id, search_context")
      .eq("id", bookmarkId)
      .eq("user_id", user.id)
      .single()

    if (!bookmark) {
      return NextResponse.json({ error: "Bookmark not found" }, { status: 404 })
    }

    // Get company
    const { data: company } = await supabase
      .from("companies")
      .select("industry, master_industry_id")
      .eq("id", bookmark.company_id)
      .single()

    const searchContext = (bookmark.search_context as any) || {}
    const filterSignalIds: string[] = searchContext.filterSignalIds || []

    // When bookmark is general, build a signal_id → count map for the company
    // so the ranker can weight documents proportionally by signal volume
    let companySignalCounts: Record<string, number> | undefined
    if (filterSignalIds.length === 0 && hasDocuments) {
      const { data: companySignals } = await supabase
        .from("signals")
        .select("signal_id")
        .eq("company_id", bookmark.company_id)
        .in("signal_type", ["technology", "process"])
        .not("signal_id", "is", null)

      if (companySignals && companySignals.length > 0) {
        const freq: Record<string, number> = {}
        for (const s of companySignals) {
          freq[s.signal_id] = (freq[s.signal_id] || 0) + 1
        }
        // Keep top N signal IDs by frequency (covers most relevant products)
        companySignalCounts = Object.fromEntries(
          Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_SIGNAL_IDS)
        )
      }
    }

    // Rank documents
    const allRankedDocs = hasDocuments
      ? await rankDocumentsForBookmark(user.id, {
          companyIndustry: company?.industry || null,
          companyMasterIndustryId: company?.master_industry_id || null,
          filterSignalIds,
          companySignalCounts,
        })
      : []

    // Split into recommended (pre-selected, up to 3) and others
    const recommended = allRankedDocs.filter((d) => d.isRecommended).slice(0, 3)
    const others = allRankedDocs.filter((d) => !d.isRecommended || allRankedDocs.indexOf(d) >= 3)

    return NextResponse.json({
      hasDocuments,
      valueProfile: valueProfile || null,
      // Legacy field kept for backward compat
      relevantDocs: recommended.map((d) => ({
        id: d.id,
        title: d.title,
        type: d.type,
        summary: d.ai_summary,
        matchedTags: d.matchedTags,
        score: d.score,
        isRecommended: true,
      })),
      // New fields for document selector UI
      recommended: recommended.map((d) => ({
        id: d.id,
        title: d.title,
        type: d.type,
        summary: d.ai_summary,
        matchedTags: d.matchedTags,
        score: d.score,
        isRecommended: true,
      })),
      others: others.map((d) => ({
        id: d.id,
        title: d.title,
        type: d.type,
        summary: d.ai_summary,
        matchedTags: d.matchedTags,
        score: d.score,
        isRecommended: false,
      })),
    })
  } catch (error: any) {
    console.error("[context-for-bookmark GET] Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: Generate strategy with Gemini using selected docs + signals + value profile
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { bookmarkId, selectedDocIds } = body

    if (!bookmarkId) {
      return NextResponse.json({ error: "bookmarkId required" }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    // Fetch all context in parallel
    const [{ data: valueProfile }, { data: bookmark }] = await Promise.all([
      supabase
        .from("user_value_profiles")
        .select("profile_summary, target_industries, target_technologies, target_processes")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("bookmarks")
        .select("company_id, search_context")
        .eq("id", bookmarkId)
        .eq("user_id", user.id)
        .single(),
    ])

    if (!bookmark) {
      return NextResponse.json({ error: "Bookmark not found" }, { status: 404 })
    }

    // Get company details
    const { data: company } = await supabase
      .from("companies")
      .select("name, industry, master_industry_id, country, website, description")
      .eq("id", bookmark.company_id)
      .single()

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    const searchContext = (bookmark.search_context as any) || {}
    const filterSignalIds: string[] = searchContext.filterSignalIds || []

    // Build signal count map for general bookmarks
    let companySignalCounts: Record<string, number> | undefined
    if (filterSignalIds.length === 0) {
      const { data: companySignals } = await supabase
        .from("signals")
        .select("signal_id")
        .eq("company_id", bookmark.company_id)
        .in("signal_type", ["technology", "process"])
        .not("signal_id", "is", null)

      if (companySignals && companySignals.length > 0) {
        const freq: Record<string, number> = {}
        for (const s of companySignals) {
          freq[s.signal_id] = (freq[s.signal_id] || 0) + 1
        }
        companySignalCounts = Object.fromEntries(
          Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_SIGNAL_IDS)
        )
      }
    }

    // Get signal names for the prompt
    let signalNames: string[] = []
    const allSignalIds = [
      ...new Set([
        ...filterSignalIds,
        ...Object.keys(companySignalCounts ?? {}).slice(0, 10),
      ]),
    ]
    if (allSignalIds.length > 0) {
      const filterType = searchContext.filterType || "general"
      const [{ data: techData }, { data: procData }] = await Promise.all([
        supabase.from("dictionary_products").select("name").in("id", allSignalIds),
        supabase.from("dictionary_processes").select("name").in("id", allSignalIds),
      ])
      signalNames = [
        ...(techData?.map((p) => p.name) || []),
        ...(procData?.map((p) => p.name) || []),
      ]
    }

    // If selectedDocIds provided, only use those documents; otherwise rank automatically
    let docsForPrompt: Awaited<ReturnType<typeof rankDocumentsForBookmark>> = []

    const allRanked = await rankDocumentsForBookmark(user.id, {
      companyIndustry: company.industry,
      companyMasterIndustryId: company.master_industry_id,
      filterSignalIds,
      companySignalCounts,
    })

    if (selectedDocIds && selectedDocIds.length > 0) {
      // Use exactly the docs the user selected
      docsForPrompt = allRanked.filter((d) => selectedDocIds.includes(d.id))
    } else {
      // Fallback: auto-select top recommended docs (backward compat)
      docsForPrompt = allRanked.filter((d) => d.isRecommended).slice(0, 3)
    }

    // Build the prompt
    const docSections = docsForPrompt.map((doc, i) => {
      const tagLabels = doc.matchedTags
        .map((t) => `${t.type === "industry" ? "Industria" : t.type === "technology" ? "Tecnologia" : "Proceso"}: ${t.value}`)
        .join(", ")
      return `- Experiencia #${i + 1} (${doc.type === "url" ? "Referencia web" : "Documento interno"}):
  Lo que hicimos/ofrecemos: ${doc.ai_summary || "Sin resumen"}
  Relacion con la cuenta: ${tagLabels || "Sin match directo"}
  ${doc.extracted_text ? `Detalle: ${doc.extracted_text.slice(0, 2000)}` : ""}`
    }).join("\n\n")

    const prompt = `Eres un consultor de estrategia de ventas B2B. Tu tarea es redactar una ESTRATEGIA DE CUENTA breve e interna (no un mensaje para enviar al cliente).

=== EMPRESA TARGET ===
Nombre: ${company.name}
Industria: ${company.industry || "No especificada"}
Pais: ${company.country || "No especificado"}
Descripcion: ${company.description || "No disponible"}
Senales detectadas (tecnologias/procesos): ${signalNames.length > 0 ? signalNames.join(", ") : "Ninguna especifica"}

=== LO QUE VENDEMOS/OFRECEMOS ===
${valueProfile?.profile_summary || "No definido"}
Tecnologias que manejamos: ${(valueProfile?.target_technologies as string[])?.join(", ") || "No definidas"}
Procesos que resolvemos: ${(valueProfile?.target_processes as string[])?.join(", ") || "No definidos"}

=== NUESTRA EXPERIENCIA RELEVANTE (aprendida de documentos internos - NO citar nombres de documentos) ===
${docSections || "No hay experiencia documentada"}

=== INSTRUCCIONES ===
Redacta una estrategia de cuenta que responda estas preguntas de manera concisa:

1. Que tenemos para ofrecerle a ${company.name}? (basandote en nuestras capacidades, tecnologias y procesos)
2. Por que somos relevantes para ellos? (conectar nuestras capacidades con sus senales/industria)
3. Que experiencia previa respalda nuestra propuesta? (describir lo que hicimos, no citar documentos)

REGLAS:
- Esto es un documento interno de estrategia, NO un mensaje para el cliente. No escribas saludos, no te dirijas a la empresa.
- Escribe en primera persona del plural (nosotros/nuestro), como notas internas de un vendedor.
- Maximo 150 palabras. Se directo y concreto.
- NUNCA menciones nombres de documentos, archivos, PDFs, brochures o URLs internas. La informacion de los documentos es para que APRENDAS que hacemos, no para citarla.
- NUNCA uses frases como "segun nuestro documento", "como se detalla en", "en nuestro informe", "nuestro documento de migracion".
- SI menciona tecnologias, industrias, capacidades y resultados concretos extraidos de los documentos (sin nombrarlos).
- Ejemplo CORRECTO: "Tenemos experiencia migrando infraestructura a AWS para empresas de energia, logrando reduccion de costos del 30%. Podemos aplicar este enfoque en ${company.name} dado que usan tecnologias compatibles."
- Ejemplo INCORRECTO: "Segun nuestro documento 'Migracion Cloud FEB2025', tenemos experiencia en..."
- Si no hay documentos, basa la estrategia en el value profile y las senales.
- Espanol, sin markdown, sin bullet points, prosa corrida.`

    const strategy = await generateGeminiContent(prompt, "gemini-2.5-flash", 0.5, 0)

    return NextResponse.json({ strategy: strategy.trim() })
  } catch (error: any) {
    console.error("[context-for-bookmark POST] Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
