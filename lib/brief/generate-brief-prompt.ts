import type { BriefContext } from "./brief-types"

/**
 * Genera el prompt para crear un Brief Ejecutivo comercial conciso.
 * Orientado a vendedores: panorama de cuenta + estrategia de abordaje.
 */
export function generateBriefPrompt(context: BriefContext): string {
  const {
    company,
    searchContext,
    strategy,
    currentEmployees,
    alumni,
    jobPostings,
    news,
    implementations,
    prospects,
  } = context

  // --- Build contact list (unified, no duplicates) ---
  const formatContacts = () => {
    const seen = new Set<string>()
    const lines: string[] = []

    // Signal contacts (current employees)
    for (const c of currentEmployees.slice(0, 5)) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      const emailTag = c.emailType === "corporate" ? " (Corp)" : ""
      lines.push(
        `- ${c.name} | ${c.role || "Sin cargo"} | Senales: ${c.keywords.join(", ") || "N/A"} | Email: ${c.email || "N/D"}${emailTag} | LinkedIn: ${c.linkedinUrl || "N/D"}`,
      )
    }

    // Prospects / decision makers
    for (const p of prospects.slice(0, 5)) {
      if (seen.has(p.fullName)) continue
      seen.add(p.fullName)
      const emailTag = p.emailStatus === "verified" ? " (Verificado)" : ""
      lines.push(
        `- ${p.fullName} | ${p.role || "Sin cargo"} | Seniority: ${p.seniority || "N/D"} | Email: ${p.email || "N/D"}${emailTag} | LinkedIn: ${p.linkedinUrl || "N/D"}`,
      )
    }

    // Alumni (brief mention only if they exist)
    if (alumni.length > 0) {
      lines.push(
        `\n(Tambien se detectaron ${alumni.length} ex-empleados con senales: ${alumni.map((a) => `${a.name} - ${a.role}`).join(", ")})`,
      )
    }

    return lines.length > 0 ? lines.join("\n") : "No se identificaron contactos relevantes."
  }

  // --- News (max 3, brief) ---
  const formatNews = () => {
    if (news.length === 0) return "Sin noticias recientes."
    return news
      .slice(0, 3)
      .map((n) => {
        const date = n.publishedAt
          ? new Date(n.publishedAt).toLocaleDateString("es-ES", { month: "short", year: "numeric" })
          : "S/F"
        return `- [${date}] ${n.title}${n.summary ? ` — ${n.summary.substring(0, 120)}` : ""} (${n.sourceName || "Web"})`
      })
      .join("\n")
  }

  // --- Value profile + docs context ---
  const formatValueContext = () => {
    const parts: string[] = []

    if (context.valueProfile?.profileSummary) {
      parts.push(`PROPUESTA DE VALOR:
${context.valueProfile.profileSummary}
Tecnologias: ${context.valueProfile.targetTechnologies.join(", ") || "No definidas"}
Procesos: ${context.valueProfile.targetProcesses.join(", ") || "No definidos"}`)
    }

    if (strategy?.valueProposition) {
      parts.push(`\nESTRATEGIA DEFINIDA PARA ESTA CUENTA:
${strategy.valueProposition}`)
    }

    if (context.relevantDocs && context.relevantDocs.length > 0) {
      parts.push(`\nEXPERIENCIA RELEVANTE (de documentos internos, NO citar nombres de archivos):`)
      for (const doc of context.relevantDocs.slice(0, 3)) {
        const tags = doc.matchedTags.map((t) => t.value).join(", ")
        parts.push(`- Lo que hicimos: ${doc.summary || "Sin resumen"} (FIT: ${tags})`)
      }
    }

    return parts.length > 0 ? parts.join("\n") : "No hay propuesta de valor definida. Se recomienda completar la seccion Docs y Estrategia."
  }

  // --- Signals summary ---
  const formatSignals = () => {
    const lines: string[] = []

    if (searchContext.signalNames.length > 0) {
      lines.push(`Senales buscadas: ${searchContext.signalNames.join(", ")}`)
    }

    if (jobPostings.length > 0) {
      lines.push(`\nPosiciones abiertas (${jobPostings.length}):`)
      for (const jp of jobPostings.slice(0, 3)) {
        const kws = jp.detectedKeywords.length > 0 ? ` [Senales: ${jp.detectedKeywords.join(", ")}]` : ""
        lines.push(`- ${jp.title}${kws}`)
      }
    }

    if (implementations.length > 0) {
      lines.push(`\nImplementaciones detectadas (${implementations.length}):`)
      for (const impl of implementations.slice(0, 3)) {
        lines.push(
          `- ${impl.title}${impl.providerName ? ` (${impl.providerName})` : ""}${impl.technology ? ` — ${impl.technology}` : ""}`,
        )
      }
    }

    return lines.length > 0 ? lines.join("\n") : "Sin senales especificas."
  }

  // --- Total contacts for footer ---
  const totalSignals = currentEmployees.length + alumni.length
  const totalContacts = totalSignals + prospects.length

  const prompt = `Eres un consultor senior de ventas B2B. Genera un BRIEF EJECUTIVO COMERCIAL conciso para el equipo de ventas.
Este brief sera entregado a los comerciales para que entiendan la cuenta y sepan como abordarla.

=== EMPRESA ===
${company.name} | ${company.industry || "Industria no especificada"} | ${company.country || "Pais no especificado"}
Web: ${company.website || "N/D"}
${company.description ? company.description.substring(0, 300) : "Sin descripcion disponible."}

=== SENALES E INTELIGENCIA COMERCIAL ===
${formatSignals()}

=== LO QUE OFRECEMOS Y NUESTRA EXPERIENCIA ===
${formatValueContext()}

=== NOTICIAS RECIENTES ===
${formatNews()}

=== CONTACTOS IDENTIFICADOS (${totalContacts}) ===
${formatContacts()}

=== GENERA EL BRIEF CON ESTA ESTRUCTURA EXACTA ===

## Resumen de la Cuenta
[2-3 oraciones: que hace la empresa, industria, pais, tamano si se infiere. Solo hechos.]

## Por que es una Oportunidad
[Top 3 razones concretas que justifican el esfuerzo comercial. Cada razon con evidencia especifica (senal, noticia, posicion abierta, implementacion). Incluir nivel de confianza: ALTO (senales directas), MEDIO (posiciones abiertas), BAJO (noticias/inferido).]

## Estrategia de Abordaje
[El corazon del brief. Basandote en nuestra propuesta de valor, documentos y experiencia: que le podemos ofrecer a esta cuenta, por que somos relevantes, y cual es el angulo de entrada. Si hay estrategia definida por el vendedor, usarla como base. NUNCA mencionar nombres de documentos internos, pero SI usar el conocimiento que aportan. Maximo 100 palabras.]

## Noticias Relevantes
[Max 3 noticias con fecha y fuente. Solo incluir si existen. Cada una en 1 linea.]

## Contactos Clave
[Lista unica de los contactos mas relevantes (max 8). Incluir: nombre, cargo, email, LinkedIn. No repetir contactos. Agrupar brevemente: primero los que tienen senales, luego decision makers.]

## Proximos Pasos
[3 acciones concretas y priorizadas que el comercial debe ejecutar. Ser especifico: "Contactar a [nombre] por LinkedIn mencionando [tema]", no "Investigar la cuenta".]

=== REGLAS ===
1. NUNCA inventes datos. Si no hay info, indicalo.
2. Indica nivel de confianza cuando sea relevante: [ALTO], [MEDIO], [BAJO].
3. NUNCA cites nombres de documentos, archivos internos o PDFs.
4. Maximo 800 palabras total (~1 pagina A4).
5. Espanol profesional de negocios. Sin emojis.
6. Si falta propuesta de valor, indica que se recomienda completar Docs y Estrategia.
7. Tono directo y accionable. Esto lo lee un comercial ocupado, no un analista.
8. Formato Markdown. Usa ## para secciones, ** para bold, - para listas.

Fecha: ${new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" })}
Fuentes: ${totalSignals} contactos con senales, ${jobPostings.length} posiciones, ${news.length} noticias, ${implementations.length} implementaciones, ${prospects.length} decision makers`

  return prompt
}
