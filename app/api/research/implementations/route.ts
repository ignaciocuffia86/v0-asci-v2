import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
const CACHE_DAYS = 7

function replaceVariables(
  prompt: string,
  context: {
    company_name: string
    website?: string
    industry?: string
    linkedin_url?: string
    keywords?: string[]
    vendors?: string[]
    products?: string[]
    processes?: string[]
  },
): string {
  return prompt
    .replace(/{company_name}/g, context.company_name || "")
    .replace(/{website}/g, context.website || "")
    .replace(/{industry}/g, context.industry || "tecnología")
    .replace(/{linkedin_url}/g, context.linkedin_url || "")
    .replace(/{keywords}/g, context.keywords?.join(", ") || "")
    .replace(/{vendors}/g, context.vendors?.join(", ") || "")
    .replace(/{products}/g, context.products?.join(", ") || "")
    .replace(/{processes}/g, context.processes?.join(", ") || "")
}

async function getImplementationsFromCache(supabase: any, companyId: string) {
  const cacheDate = new Date()
  cacheDate.setDate(cacheDate.getDate() - CACHE_DAYS)

  const { data: cachedImplementations } = await supabase
    .from("company_implementations")
    .select("*")
    .eq("company_id", companyId)
    .gte("created_at", cacheDate.toISOString())
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(10)

  return cachedImplementations
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { bookmarkId, companyId, companyName } = body

  if (!bookmarkId || !companyName) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const { data: bookmark } = await supabase
    .from("bookmarks")
    .select("id, company_id, search_context")
    .eq("id", bookmarkId)
    .eq("user_id", user.id)
    .single()

  if (!bookmark) {
    return NextResponse.json({ error: "Bookmark not found" }, { status: 404 })
  }

  const cachedImplementations = await getImplementationsFromCache(supabase, bookmark.company_id)

  if (cachedImplementations && cachedImplementations.length > 0) {
    return NextResponse.json({
      success: true,
      count: cachedImplementations.length,
      message: `Se encontraron ${cachedImplementations.length} implementaciones`,
      implementations: cachedImplementations,
    })
  }

  // Si no hay cache, buscar en Perplexity
  const searchContext = bookmark.search_context as {
    filterType?: string
    filtersUsed?: {
      technology?: string[]
      process?: string[]
    }
  } | null

  const bookmarkTechnologies = searchContext?.filtersUsed?.technology || []
  const bookmarkProcesses = searchContext?.filtersUsed?.process || []

  const { data: company } = await supabase
    .from("companies")
    .select("industry, website, linkedin_url")
    .eq("id", companyId)
    .single()

  const variableContext = {
    company_name: companyName,
    website: company?.website || "",
    industry: company?.industry || "tecnología",
    linkedin_url: company?.linkedin_url || "",
    keywords: [...bookmarkTechnologies, ...bookmarkProcesses],
    vendors: bookmarkTechnologies,
    products: bookmarkTechnologies,
    processes: bookmarkProcesses,
  }

  const { data: promptConfig } = await supabase
    .from("admin_prompts")
    .select("prompt_text")
    .eq("prompt_key", "implementations_research")
    .eq("is_active", true)
    .single()

  const basePrompt =
    promptConfig?.prompt_text ||
    "Busca casos de éxito, implementaciones o proyectos tecnológicos realizados EN {company_name}. Busca menciones de proveedores como Accenture, IBM, Deloitte, consultoras o vendors que hayan implementado soluciones."

  const prompt = replaceVariables(basePrompt, variableContext)

  try {
    const twentyFourMonthsAgo = new Date()
    twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24)
    const month = String(twentyFourMonthsAgo.getMonth() + 1).padStart(2, "0")
    const day = String(twentyFourMonthsAgo.getDate()).padStart(2, "0")
    const year = twentyFourMonthsAgo.getFullYear()
    const searchAfterDate = `${month}/${day}/${year}`

    const perplexityResponse = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: `Eres un investigador de negocios especializado en casos de éxito tecnológicos. 

REGLAS IMPORTANTES:
1. SIEMPRE responde en formato JSON válido, sin excepciones.
2. Si no encuentras información, devuelve: {"implementations": [], "message": "No se encontraron implementaciones verificables"}
3. NUNCA respondas con texto explicativo fuera del JSON.
4. Solo incluye implementaciones con fuentes verificables.

Formato de respuesta:
{
  "implementations": [
    {
      "title": "Título del proyecto o caso de éxito",
      "provider_name": "Nombre del proveedor/consultora que implementó",
      "technology": "Tecnología principal usada (SAP, Oracle, Salesforce, etc.)",
      "summary": "Descripción breve del proyecto (2-3 oraciones)",
      "results": "Resultados obtenidos si se mencionan",
      "source_url": "URL de la fuente",
      "source_name": "Nombre del medio/fuente",
      "published_at": "YYYY-MM-DD o null si no se conoce"
    }
  ],
  "message": "Mensaje opcional sobre la búsqueda"
}

Máximo 10 casos más relevantes.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 4000,
        search_after_date_filter: searchAfterDate,
        web_search_options: {
          search_context_size: "high",
        },
      }),
    })

    if (!perplexityResponse.ok) {
      const error = await perplexityResponse.text()
      console.error("Perplexity error:", error)

      const { data: oldCache } = await supabase
        .from("company_implementations")
        .select("*")
        .eq("company_id", bookmark.company_id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(10)

      if (oldCache && oldCache.length > 0) {
        return NextResponse.json({
          success: true,
          count: oldCache.length,
          message: `Se encontraron ${oldCache.length} implementaciones`,
          implementations: oldCache,
        })
      }

      return NextResponse.json({ error: "Error en búsqueda AI" }, { status: 500 })
    }

    const perplexityData = await perplexityResponse.json()
    const content = perplexityData.choices?.[0]?.message?.content

    if (!content) {
      const { data: oldCache } = await supabase
        .from("company_implementations")
        .select("*")
        .eq("company_id", bookmark.company_id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(10)

      if (oldCache && oldCache.length > 0) {
        return NextResponse.json({
          success: true,
          count: oldCache.length,
          message: `Se encontraron ${oldCache.length} implementaciones`,
          implementations: oldCache,
        })
      }

      return NextResponse.json({ error: "No se encontraron resultados" }, { status: 404 })
    }

    // Verificar si la respuesta empieza con JSON válido
    const trimmedContent = content.trim()
    const startsWithJson =
      trimmedContent.startsWith("{") || trimmedContent.startsWith("[") || trimmedContent.startsWith("```")

    const noAccessPhrases = [
      "no es posible acceder",
      "no puedo acceder",
      "no tengo acceso",
      "currently unable",
      "cannot access",
      "limitaciones actuales",
      "sin acceso operativo",
      "actualmente no es posible",
      "actualmente no",
      "en este momento no",
      "en este momento, no",
      "no se puede garantizar",
      "no es posible verificar",
      "no dispongo de acceso",
      "no cuento con acceso",
      "lo siento",
      "i'm sorry",
      "i cannot",
      "no puedo",
    ]

    const contentLower = content.toLowerCase()
    const isAccessError = !startsWithJson || noAccessPhrases.some((phrase) => contentLower.includes(phrase))

    if (isAccessError && !startsWithJson) {
      const { data: oldCache } = await supabase
        .from("company_implementations")
        .select("*")
        .eq("company_id", bookmark.company_id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(10)

      if (oldCache && oldCache.length > 0) {
        return NextResponse.json({
          success: true,
          count: oldCache.length,
          message: `Se encontraron ${oldCache.length} implementaciones`,
          implementations: oldCache,
        })
      }

      return NextResponse.json({
        success: true,
        count: 0,
        message:
          "No se pudieron encontrar implementaciones verificables en este momento. Intenta nuevamente más tarde.",
        implementations: [],
      })
    }

    let implementationsData
    try {
      const jsonMarkdownMatch = content.match(/```json\n?([\s\S]*?)\n?```/)
      if (jsonMarkdownMatch) {
        implementationsData = JSON.parse(jsonMarkdownMatch[1])
      } else {
        const jsonObjectMatch = content.match(/\{[\s\S]*"implementations"[\s\S]*\}/)
        if (jsonObjectMatch) {
          implementationsData = JSON.parse(jsonObjectMatch[0])
        } else {
          implementationsData = JSON.parse(content)
        }
      }
    } catch (parseError) {
      console.error("Error parsing Perplexity response:", parseError)

      const { data: oldCache } = await supabase
        .from("company_implementations")
        .select("*")
        .eq("company_id", bookmark.company_id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(10)

      if (oldCache && oldCache.length > 0) {
        return NextResponse.json({
          success: true,
          count: oldCache.length,
          message: `Se encontraron ${oldCache.length} implementaciones`,
          implementations: oldCache,
        })
      }

      return NextResponse.json({
        success: true,
        count: 0,
        message: "No se pudieron procesar los resultados. Intenta nuevamente más tarde.",
        implementations: [],
      })
    }

    const implementations = implementationsData.implementations || []

    const itemsToInsert = implementations.map((item: any) => ({
      bookmark_id: bookmarkId,
      company_id: bookmark.company_id,
      user_id: user.id,
      requested_by: user.id,
      title: item.title,
      provider_name: item.provider_name,
      technology: item.technology,
      summary: item.summary,
      results: item.results,
      source_url: item.source_url,
      source_name: item.source_name,
      published_at: item.published_at || null,
    }))

    if (itemsToInsert.length > 0) {
      for (const impl of itemsToInsert) {
        const { data: existing } = await supabase
          .from("company_implementations")
          .select("id")
          .eq("company_id", bookmark.company_id)
          .eq("title", impl.title)
          .maybeSingle()

        if (!existing) {
          await supabase.from("company_implementations").insert(impl)
        }
      }
    }

    const existingContext = bookmark.search_context || {}
    await supabase
      .from("bookmarks")
      .update({
        search_context: {
          ...existingContext,
          last_implementations_search: new Date().toISOString(),
        },
      })
      .eq("id", bookmarkId)

    const { data: insertedImplementations } = await supabase
      .from("company_implementations")
      .select("*")
      .eq("company_id", bookmark.company_id)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(10)

    return NextResponse.json({
      success: true,
      count: insertedImplementations?.length || itemsToInsert.length,
      message:
        itemsToInsert.length > 0
          ? `Se encontraron ${itemsToInsert.length} implementaciones`
          : implementationsData.message || "No se encontraron implementaciones verificables",
      implementations: insertedImplementations || [],
    })
  } catch (error) {
    console.error("Research implementations error:", error)

    const { data: oldCache } = await supabase
      .from("company_implementations")
      .select("*")
      .eq("company_id", bookmark.company_id)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(10)

    if (oldCache && oldCache.length > 0) {
      return NextResponse.json({
        success: true,
        count: oldCache.length,
        message: `Se encontraron ${oldCache.length} implementaciones`,
        implementations: oldCache,
      })
    }

    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
