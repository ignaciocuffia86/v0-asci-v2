import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { rankDocumentsForBookmark } from "@/lib/documents/rank-documents-for-bookmark"
import { generateGeminiContent } from "@/lib/ai-service"

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

    // Get company industry
    const { data: company } = await supabase
      .from("companies")
      .select("industry")
      .eq("id", bookmark.company_id)
      .single()

    const searchContext = (bookmark.search_context as any) || {}
    const filterSignalIds: string[] = searchContext.filterSignalIds || []

    // Rank documents
    const rankedDocs = hasDocuments
      ? await rankDocumentsForBookmark(user.id, {
          companyIndustry: company?.industry || null,
          filterSignalIds,
        })
      : []

    return NextResponse.json({
      hasDocuments,
      valueProfile: valueProfile || null,
      relevantDocs: rankedDocs.map((d) => ({
        title: d.title,
        type: d.type,
        summary: d.ai_summary,
        matchedTags: d.matchedTags,
      })),
    })
  } catch (error: any) {
    console.error("[v0] Error fetching docs context:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST: Generate strategy with Gemini using docs + signals + value profile
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { bookmarkId } = body

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
    const [
      { data: valueProfile },
      { data: bookmark },
    ] = await Promise.all([
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

    // Get company details + signals
    const { data: company } = await supabase
      .from("companies")
      .select("name, industry, country, website, description")
      .eq("id", bookmark.company_id)
      .single()

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    const searchContext = (bookmark.search_context as any) || {}
    const filterSignalIds: string[] = searchContext.filterSignalIds || []

    // Get signal names
    let signalNames: string[] = []
    if (filterSignalIds.length > 0) {
      const filterType = searchContext.filterType || "general"
      if (filterType === "technology") {
        const { data } = await supabase.from("dictionary_products").select("name").in("id", filterSignalIds)
        signalNames = data?.map((p) => p.name) || []
      } else if (filterType === "process") {
        const { data } = await supabase.from("dictionary_processes").select("name").in("id", filterSignalIds)
        signalNames = data?.map((p) => p.name) || []
      }
    }

    // Get ranked documents with content
    const rankedDocs = await rankDocumentsForBookmark(user.id, {
      companyIndustry: company.industry,
      filterSignalIds,
    })

    // Build the prompt
    const docSections = rankedDocs.map((doc) => {
      const tagLabels = doc.matchedTags
        .map((t) => `${t.type === "industry" ? "Industria" : t.type === "technology" ? "Tecnologia" : "Proceso"}: ${t.value}`)
        .join(", ")
      return `- "${doc.title}" (${doc.type.toUpperCase()}, Score: ${doc.score})
  Resumen: ${doc.ai_summary || "Sin resumen"}
  FIT con la cuenta: ${tagLabels || "Sin match directo"}
  ${doc.extracted_text ? `Contenido clave: ${doc.extracted_text.slice(0, 2000)}` : ""}`
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

=== DOCUMENTOS RELEVANTES (casos de exito, brochures, propuestas) ===
${docSections || "No hay documentos cargados"}

=== INSTRUCCIONES ===
Redacta una estrategia de cuenta que responda estas preguntas de manera concisa:

1. Que tenemos para ofrecerle a ${company.name}? (basandote en nuestros docs, tecnologias y procesos)
2. Por que somos relevantes para ellos? (conectar nuestras capacidades con sus senales/industria)
3. Que experiencia previa respalda nuestra propuesta? (mencionar casos de exito o documentos relevantes si aplica)

REGLAS:
- Esto es un documento interno de estrategia, NO un mensaje para el cliente. No escribas saludos, no te dirijas a la empresa.
- Escribe en primera persona del plural (nosotros/nuestro), como notas internas de un vendedor.
- Maximo 150 palabras. Se directo y concreto.
- Menciona tecnologias, nombres de casos y datos especificos cuando los tengas.
- Si no hay documentos relevantes, basa la estrategia en el value profile y las senales.
- Ejemplo de tono correcto: "Tenemos experiencia en implementacion de SAP para empresas de energia. El caso de [X] es directamente aplicable porque... Nuestra propuesta se centra en..."
- Ejemplo de tono INCORRECTO: "Hola [empresa], sabemos que ustedes..."
- Espanol, sin markdown, sin bullet points, prosa corrida.`

    const strategy = await generateGeminiContent(prompt, "gemini-2.5-flash", 0.5)

    return NextResponse.json({ strategy: strategy.trim() })
  } catch (error: any) {
    console.error("[v0] Error generating strategy:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
