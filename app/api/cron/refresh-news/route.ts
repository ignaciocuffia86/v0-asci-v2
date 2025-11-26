import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"

// Usar service role para cron jobs
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET(request: Request) {
  // Verificar el secret para cron jobs
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const results = {
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    details: [] as any[],
  }

  try {
    // Obtener bookmarks de alta prioridad que no se actualizaron en 14 días
    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)

    const { data: bookmarks, error: bookmarksError } = await supabase
      .from("bookmarks")
      .select(`
        id,
        user_id,
        company_id,
        priority,
        search_context,
        companies (
          id,
          name,
          industry
        )
      `)
      .eq("priority", "alta")

    if (bookmarksError) {
      console.error("Error fetching bookmarks:", bookmarksError)
      return NextResponse.json({ error: "Error fetching bookmarks" }, { status: 500 })
    }

    // Filtrar bookmarks que necesitan actualización
    const bookmarksToProcess = (bookmarks || []).filter((b) => {
      const lastSearch = b.search_context?.last_news_search
      if (!lastSearch) return true // Nunca buscado
      return new Date(lastSearch) < twoWeeksAgo
    })

    // Obtener el prompt configurado
    const { data: promptConfig } = await supabase
      .from("admin_prompts")
      .select("prompt_text")
      .eq("prompt_key", "news_research")
      .eq("is_active", true)
      .single()

    const basePrompt =
      promptConfig?.prompt_text || "Busca noticias recientes (últimos 6 meses) sobre {company_name} en {industry}."

    // Procesar cada bookmark (con límite para evitar timeout)
    const maxToProcess = 10 // Limitar por ejecución
    const toProcess = bookmarksToProcess.slice(0, maxToProcess)

    for (const bookmark of toProcess) {
      results.processed++
      const company = bookmark.companies as any

      if (!company?.name) {
        results.skipped++
        results.details.push({
          bookmarkId: bookmark.id,
          status: "skipped",
          reason: "No company name",
        })
        continue
      }

      try {
        const prompt = basePrompt
          .replace("{company_name}", company.name)
          .replace("{industry}", company.industry || "tecnología")

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
                content: `Eres un investigador de negocios. Responde SIEMPRE en formato JSON válido:
{
  "news": [
    {
      "title": "Título",
      "summary": "Resumen breve",
      "source_url": "URL",
      "source_name": "Medio",
      "published_at": "YYYY-MM-DD",
      "relevance_tags": ["expansion", "new_product", "partnership", "technology"]
    }
  ]
}
Máximo 5 noticias más relevantes.`,
              },
              { role: "user", content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 2000,
          }),
        })

        if (!perplexityResponse.ok) {
          throw new Error("Perplexity API error")
        }

        const perplexityData = await perplexityResponse.json()
        const content = perplexityData.choices?.[0]?.message?.content

        if (content) {
          const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/)
          const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content
          const newsData = JSON.parse(jsonStr)
          const newsItems = newsData.news || []

          let inserted = 0
          for (const item of newsItems) {
            const { data: existing } = await supabase
              .from("company_news")
              .select("id")
              .eq("bookmark_id", bookmark.id)
              .eq("title", item.title)
              .single()

            if (!existing) {
              await supabase.from("company_news").insert({
                bookmark_id: bookmark.id,
                user_id: bookmark.user_id,
                title: item.title,
                summary: item.summary,
                source_url: item.source_url,
                source_name: item.source_name,
                published_at: item.published_at || null,
                relevance_tags: item.relevance_tags || [],
              })
              inserted++
            }
          }

          // Actualizar timestamp de búsqueda
          await supabase
            .from("bookmarks")
            .update({
              search_context: {
                ...bookmark.search_context,
                last_news_search: new Date().toISOString(),
              },
            })
            .eq("id", bookmark.id)

          results.success++
          results.details.push({
            bookmarkId: bookmark.id,
            company: company.name,
            status: "success",
            newsInserted: inserted,
          })
        }

        // Rate limiting - esperar entre requests
        await new Promise((resolve) => setTimeout(resolve, 1000))
      } catch (error: any) {
        results.failed++
        results.details.push({
          bookmarkId: bookmark.id,
          status: "failed",
          error: error.message,
        })
      }
    }

    // Log del resultado para monitoreo
    console.log("Cron refresh-news completed:", results)

    return NextResponse.json({
      success: true,
      message: `Processed ${results.processed} bookmarks`,
      results,
    })
  } catch (error: any) {
    console.error("Cron refresh-news error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
