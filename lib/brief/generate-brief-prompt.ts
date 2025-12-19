import type { BriefContext } from "./brief-types"

/**
 * Genera el prompt optimizado para Gemini para crear el Brief Ejecutivo
 * Incluye toda la estructura y reglas para generación con confidence levels
 */
export function generateBriefPrompt(context: BriefContext): string {
  const { company, searchContext, strategy, currentEmployees, alumni, jobPostings, news, implementations, prospects } =
    context

  // Format contacts section
  const formatContacts = () => {
    const contactsSection: string[] = []

    if (currentEmployees.length > 0) {
      contactsSection.push(`EMPLEADOS ACTUALES CON SEÑALES (${currentEmployees.length}) [Confidence: ALTO]:`)
      for (const c of currentEmployees) {
        contactsSection.push(`- ${c.name} | ${c.role}`)
        contactsSection.push(`  Señales: ${c.keywords.join(", ") || "N/A"}`)
        contactsSection.push(`  LinkedIn: ${c.linkedinUrl || "No disponible"}`)
        contactsSection.push(
          `  Email: ${c.email || "No disponible"}${c.emailType === "corporate" ? " (Corporativo)" : ""}`,
        )
        contactsSection.push(`  Teléfono: ${c.phone || "No disponible"}`)
        contactsSection.push("")
      }
    } else {
      contactsSection.push("EMPLEADOS ACTUALES CON SEÑALES: No hay señales internas detectadas.")
    }

    if (alumni.length > 0) {
      contactsSection.push(`\nALUMNI / EX-EMPLEADOS CON SEÑALES (${alumni.length}) [Confidence: ALTO]:`)
      for (const c of alumni) {
        contactsSection.push(`- ${c.name} | ${c.role}`)
        contactsSection.push(`  Señales: ${c.keywords.join(", ") || "N/A"}`)
        contactsSection.push(`  LinkedIn: ${c.linkedinUrl || "No disponible"}`)
        contactsSection.push("")
      }
    }

    return contactsSection.join("\n")
  }

  // Format job postings section
  const formatJobPostings = () => {
    if (jobPostings.length === 0) {
      return "POSICIONES ABIERTAS: No tenemos evidencia de posiciones abiertas actualmente."
    }

    const lines = [`POSICIONES ABIERTAS (${jobPostings.length}) [Confidence: MEDIO]:`]
    for (const jp of jobPostings) {
      lines.push(`- ${jp.title}`)
      lines.push(`  Publicado: ${jp.postedAt ? new Date(jp.postedAt).toLocaleDateString("es-ES") : "No especificado"}`)
      if (jp.detectedKeywords.length > 0) {
        lines.push(`  Señales detectadas: ${jp.detectedKeywords.join(", ")}`)
      }
      if (jp.snippet) {
        lines.push(`  Extracto: "${jp.snippet.substring(0, 150)}..."`)
      }
      lines.push("")
    }
    return lines.join("\n")
  }

  // Format news section
  const formatNews = () => {
    if (news.length === 0) {
      return "NOTICIAS: No tenemos noticias recientes, se recomienda buscar manualmente."
    }

    const lines = [`NOTICIAS RECIENTES (${news.length}) [Confidence: BAJO]:`]
    for (const n of news) {
      lines.push(`- [${n.category || "General"}] ${n.title}`)
      if (n.summary) {
        lines.push(`  Resumen: ${n.summary.substring(0, 200)}`)
      }
      lines.push(
        `  Fuente: ${n.sourceName || "No especificada"} | Fecha: ${n.publishedAt ? new Date(n.publishedAt).toLocaleDateString("es-ES") : "No especificada"}`,
      )
      if (n.sourceUrl) {
        lines.push(`  URL: ${n.sourceUrl}`)
      }
      lines.push("")
    }
    return lines.join("\n")
  }

  // Format implementations section
  const formatImplementations = () => {
    if (implementations.length === 0) {
      return "" // Omitir sección si está vacía
    }

    const lines = [`IMPLEMENTACIONES / CASOS (${implementations.length}) [Confidence: BAJO]:`]
    for (const impl of implementations) {
      lines.push(`- ${impl.title}`)
      if (impl.providerName) {
        lines.push(`  Proveedor/Partner: ${impl.providerName}`)
      }
      if (impl.technology) {
        lines.push(`  Tecnología: ${impl.technology}`)
      }
      if (impl.summary) {
        lines.push(`  Detalle: ${impl.summary.substring(0, 200)}`)
      }
      lines.push(
        `  Evidencia: ${impl.evidenceLevel === "strong" ? "Verificado" : impl.evidenceLevel === "medium" ? "Probable" : "Inferido"}`,
      )
      if (impl.sourceUrl) {
        lines.push(`  URL: ${impl.sourceUrl}`)
      }
      lines.push("")
    }
    return lines.join("\n")
  }

  // Format prospects section
  const formatProspects = () => {
    if (prospects.length === 0) {
      return "DECISION MAKERS: Se recomienda buscar tomadores de decisión tanto dentro de ASCI como por fuera."
    }

    const lines = [`DECISION MAKERS / PROSPECTOS (${prospects.length}) [Confidence: ALTO]:`]
    for (const p of prospects) {
      lines.push(`- ${p.fullName} | ${p.role || "No especificado"}`)
      lines.push(`  Email: ${p.email || "No disponible"}${p.emailStatus === "verified" ? " (Verificado)" : ""}`)
      lines.push(`  Teléfono: ${p.phone || "No disponible"}`)
      lines.push(`  LinkedIn: ${p.linkedinUrl || "No disponible"}`)
      lines.push("")
    }
    return lines.join("\n")
  }

  // Format strategy section
  const formatStrategy = () => {
    if (!strategy?.valueProposition) {
      return "ESTRATEGIA: [WARNING] Falta definir una propuesta de valor para la cuenta."
    }

    return `ESTRATEGIA DEFINIDA POR EL VENDEDOR:
Propuesta de valor: ${strategy.valueProposition}
${strategy.targetSummary ? `Objetivo: ${strategy.targetSummary}` : ""}`
  }

  // Build the complete prompt
  const prompt = `Eres un consultor senior de ventas B2B especializado en tecnología. Tu tarea es generar un BRIEF EJECUTIVO para el equipo comercial.

=== CONTEXTO DE LA INVESTIGACIÓN ===
Estamos desarrollando la investigación de mercado de la compañía ${company.name} de ${company.country || "país no especificado"} que tiene su web en ${company.website || "no disponible"}.

Industria: ${company.industry || "No especificada"}
${company.description ? `Descripción: ${company.description.substring(0, 300)}` : ""}

=== OBJETIVO DEL VENDEDOR ===
${searchContext.signalNames.length > 0 ? `Buscando oportunidades relacionadas con: ${searchContext.signalNames.join(", ")}` : "Búsqueda general de oportunidades"}
${formatStrategy()}

=== DATOS RECOPILADOS DE ASCI ===

${formatContacts()}

${formatJobPostings()}

${formatNews()}

${formatImplementations()}

${formatProspects()}

=== INSTRUCCIONES PARA EL BRIEF ===

Genera un Brief Ejecutivo en formato Markdown con el siguiente formato EXACTO:

## RESUMEN EJECUTIVO

[2-3 oraciones que resuman la oportunidad. Incluye el nivel de FIT inferido.]

## TOP 3 RAZONES DE FIT

1. **[Razón 1]** [Confidence: ALTO/MEDIO/BAJO]
   [Explicación con evidencia específica y fuente]

2. **[Razón 2]** [Confidence: ALTO/MEDIO/BAJO]
   [Explicación con evidencia específica y fuente]

3. **[Razón 3]** [Confidence: ALTO/MEDIO/BAJO]
   [Explicación con evidencia específica y fuente]

## RIESGOS Y BLOQUEOS

[Lista de riesgos identificados con recomendaciones de mitigación. Si detectas proveedor incumbente, sector regulado, o falta de datos, inclúyelo aquí.]

## SEÑALES DETECTADAS

### Contactos con Señales
[Lista resumida de los contactos más relevantes con sus señales. Máx 5.]

### Posiciones Abiertas
[Lista resumida de job postings relevantes. Máx 3.]

### Alumni Relevantes
[Si hay alumni, mencionar que se encontraron X ex-empleados con experiencia en las señales buscadas.]

## CONTEXTO DE MERCADO

### Noticias
[Resumen de noticias relevantes con fecha y fuente]

### Implementaciones
[Solo si hay datos. Casos detectados con partners/tecnologías]

## CONTACTOS CLAVE

[Tabla o lista de los decision makers identificados con sus datos de contacto]

## PLAYBOOK DE ABORDAJE

### Canales Recomendados
[LinkedIn, email, llamada, evento, etc. basado en los datos disponibles]

### Tono y Enfoque
[Consultivo, directo, técnico, etc. basado en la propuesta de valor]

### Acciones Comerciales Recomendadas
1. [Acción 1]
2. [Acción 2]
3. [Acción 3]

### Pendientes de Verificación Humana
- [Items que requieren verificación manual]

## FUENTES CONSULTADAS

- ASCI Resumen: ${currentEmployees.length} contactos con señales
- Alumni: ${alumni.length} ex-empleados
- Job Postings: ${jobPostings.length} posiciones
- Noticias: ${news.length} artículos
- Implementaciones: ${implementations.length} casos
- Prospectos Apollo: ${prospects.length} decision makers

Fecha de captura: ${new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" })}

---

=== REGLAS ESTRICTAS ===

1. **NUNCA inventes datos**. Si no hay evidencia, indica: "No hay datos disponibles" o "Requiere verificación".
2. **SIEMPRE indica el nivel de confidence**: [ALTO] para datos de Resumen/Prospectos, [MEDIO] para Job Postings, [BAJO] para Noticias/Implementaciones.
3. **SIEMPRE incluye la fuente** entre paréntesis: (Resumen), (Posiciones), (Noticias), (Implementaciones), (Prospectos).
4. **USA inferencias correctamente**: Si es inferencia, etiquétalo como "posible", "se observa en búsquedas laborales", etc.
5. **Tono consultivo y ejecutivo**: Orientado a impacto y decisiones, sin adjetivos grandilocuentes.
6. **SÉ TRANSPARENTE con la incertidumbre**: "no confirmado", "posible", "alta probabilidad por X evidencia".
7. **Idioma**: Todo en español profesional de negocios.
8. **Extensión máxima**: 2500 palabras (aprox. 2 páginas A4).
9. **NO uses emojis**.
10. Si falta la propuesta de valor del vendedor, indica en el brief que se recomienda completar el tab de Estrategia.`

  return prompt
}
