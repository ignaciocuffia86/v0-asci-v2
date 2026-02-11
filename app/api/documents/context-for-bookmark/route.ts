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

    const prompt = `Eres un consultor de ventas B2B experto en estrategia de cuentas. 
Genera una PROPUESTA DE VALOR CONTEXTUALIZADA para abordar a esta empresa.

=== EMPRESA TARGET ===
Nombre: ${company.name}
Industria: ${company.industry || "No especificada"}
Pais: ${company.country || "No especificado"}
Website: ${company.website || "No especificado"}
Descripcion: ${company.description || "No disponible"}
Senales detectadas (tecnologias/procesos): ${signalNames.length > 0 ? signalNames.join(", ") : "Ninguna especifica"}

=== MI PROPUESTA DE VALOR (lo que vendo/ofrezco) ===
${valueProfile?.profile_summary || "No definida"}
Industrias target: ${(valueProfile?.target_industries as string[])?.join(", ") || "No definidas"}
Tecnologias que manejo: ${(valueProfile?.target_technologies as string[])?.join(", ") || "No definidas"}
Procesos que resuelvo: ${(valueProfile?.target_processes as string[])?.join(", ") || "No definidos"}

=== DOCUMENTOS RELEVANTES (casos de exito, brochures, propuestas) ===
${docSections || "No hay documentos cargados"}

=== INSTRUCCIONES ===
Genera una propuesta de valor en primera persona (como si fuera el vendedor escribiendo) que incluya:

1. **Contexto de la empresa**: Que sabemos de ellos y por que son relevantes como prospecto.
2. **FIT con mi oferta**: Explicar la conexion entre lo que yo ofrezco y lo que esta empresa necesita, basandote en las senales detectadas y los documentos relevantes.
3. **Referencia a experiencia previa**: Si hay documentos (casos de exito, propuestas) que matchean con la industria o tecnologia de esta empresa, mencionarlos como experiencia relevante. Ejemplo: "Trabajamos con [empresa del caso] en un contexto similar...".
4. **Angulo de entrada**: Una frase concreta de como abrir la conversacion.

REGLAS:
- Escribe en espanol, tono profesional pero directo, sin formalismos excesivos.
- Maximo 200 palabras.
- No uses bullet points ni formato markdown. Escribe en prosa corrida, parrafos cortos.
- Se especifico: menciona nombres de tecnologias, industrias y empresas de los documentos cuando aplique.
- Si no hay documentos relevantes, basa la estrategia solo en el value profile y las senales.`

    const strategy = await generateGeminiContent(prompt, "gemini-2.5-flash", 0.5)

    return NextResponse.json({ strategy: strategy.trim() })
  } catch (error: any) {
    console.error("[v0] Error generating strategy:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
