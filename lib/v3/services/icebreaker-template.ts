import { registerForCountry } from "./icebreaker-register"
import { sanitizeUntrustedText } from "./untrusted-text"

// ═══════════════════════════════════════════════════════════════════════════
// Icebreaker DETERMINÍSTICO: sin IA, sin cuota, sin riesgo de alucinación.
//
// El pedido que originó esto era "un icebreaker que nombre la evidencia, no el
// producto". Para eso la IA es opcional: el fragmento ya dice todo. Un template
// que cita lo observado produce el mismo mensaje, cuesta cero y no puede
// inventar una tecnología que la cuenta no tiene — que es el peor error posible
// frente a un cliente.
//
// DOS REGLAS QUE NO SE NEGOCIAN
//
// 1. AGREGA, NO INDIVIDUALIZA. Por default el texto habla del equipo, nunca de
//    una persona. "Vi que en el equipo varios perfiles reportan Power BI"
//    transmite exactamente la misma señal que nombrar al analista, es igual de
//    específico como icebreaker, y no expone a nadie. Nombrar a una persona
//    física a partir de su perfil, para venderle a su empleador, cae bajo la Ley
//    19.628 y su reforma (21.719) en Chile y bajo GDPR si hay matriz europea; y
//    antes que eso es incómodo de recibir: un CIO al que le escriben citando el
//    CV de su analista entiende que lo scrapearon. `nameIndividuals` existe para
//    que un vendedor lo active a conciencia, no como default.
//
// 2. UN EX-EMPLEADO NO PRUEBA USO ACTUAL. Si toda la evidencia viene de gente
//    que ya no está, el template NO escribe el icebreaker: devuelve el motivo.
//    En una planilla de 42 filas nadie revisa perfil por perfil, y un mensaje
//    construido sobre alguien que se fue hace dos años es un error caro y difícil
//    de detectar.
// ═══════════════════════════════════════════════════════════════════════════

export type TermEvidence = {
  term: string
  /** Señales que salen de perfiles de EMPLEADOS ACTUALES. */
  fromCurrentEmployees: number
  /**
   * Señales de EX-empleados. Separadas de las vacantes a propósito: la RPC de
   * screening las devuelve juntas en `fromAlumniOrJobs`, y para un icebreaker son
   * lo opuesto. Un aviso de empleo lo publica la EMPRESA y prueba interés actual;
   * un ex-empleado solo prueba que esa persona usó la tecnología en algún lado.
   * Colapsarlas haría escribir "tienen Power BI" sobre alguien que se fue.
   */
  fromFormerEmployees: number
  /** Señales que salen de avisos de empleo de la empresa. */
  fromJobPostings: number
  /** Fragmento textual, si se quiere citar. Se sanitiza antes de usar. */
  snippet?: string | null
  /** De qué campo salió ("about", "headline", descripción de la vacante). */
  sourceField?: string | null
}

export type IcebreakerTemplateInput = {
  companyName: string
  terms: TermEvidence[]
  contactCountry?: string | null
  /** Activar SOLO a conciencia: expone a una persona física. Ver regla 1. */
  nameIndividuals?: boolean
  /** Nombre de la persona. Se ignora salvo que `nameIndividuals` sea true. */
  personName?: string | null
  /** Sumar una cita textual corta del fragmento. */
  includeQuote?: boolean
}

export type IcebreakerTemplateResult =
  | {
      ok: true
      text: string
      /** En qué se apoyó, para poder auditar la fila del reporte. */
      basis: "current_employees" | "job_postings"
      termsUsed: string[]
      namesIndividual: boolean
    }
  | { ok: false; reason: string; code: "NO_EVIDENCE" | "ONLY_FORMER_EMPLOYEES" }

/** Une términos en lenguaje natural: "A", "A y B", "A, B y C". */
function joinTerms(terms: string[], and: string): string {
  if (terms.length <= 1) return terms[0] ?? ""
  return `${terms.slice(0, -1).join(", ")} ${and} ${terms[terms.length - 1]}`
}

/**
 * Arma el icebreaker a partir de la evidencia. Función pura: mismo input, mismo
 * texto. Eso la vuelve testeable y hace que dos corridas sobre la misma cuenta
 * no den mensajes distintos, que es lo que pasa con un modelo a temperatura 0.6.
 */
export function buildEvidenceIcebreaker(input: IcebreakerTemplateInput): IcebreakerTemplateResult {
  const terms = input.terms.filter((term) => term.term?.trim())
  if (!terms.length) {
    return { ok: false, code: "NO_EVIDENCE", reason: "No hay términos con evidencia para citar." }
  }

  const current = terms.filter((term) => term.fromCurrentEmployees > 0)
  const fromJobs = terms.filter((term) => term.fromCurrentEmployees === 0 && term.fromJobPostings > 0)
  const onlyFormer = terms.filter(
    (term) => term.fromCurrentEmployees === 0 && term.fromJobPostings === 0 && term.fromFormerEmployees > 0,
  )

  // Regla 2: si lo único que queda son ex-empleados, no se escribe el mensaje.
  if (!current.length && !fromJobs.length) {
    if (onlyFormer.length) {
      return {
        ok: false,
        code: "ONLY_FORMER_EMPLOYEES",
        reason:
          "Toda la evidencia viene de ex-empleados: prueba que esas personas trabajaron con la tecnología, no que la cuenta la use hoy. No se construye un icebreaker sobre eso.",
      }
    }
    return { ok: false, code: "NO_EVIDENCE", reason: "Los términos no tienen ninguna señal asociada." }
  }

  const { you } = registerForCountry(input.contactCountry ?? null)
  const isEnglish = you.see === "I noticed"
  const and = isEnglish ? "and" : "y"

  const basis: "current_employees" | "job_postings" = current.length ? "current_employees" : "job_postings"
  const chosen = current.length ? current : fromJobs
  const termNames = chosen.slice(0, 3).map((term) => term.term)
  const termList = joinTerms(termNames, and)

  // Cuántos perfiles distintos sostienen la señal. Es lo que hace la diferencia
  // entre "varios perfiles" (creíble) y "un perfil" (que hay que decir como es).
  const profiles = chosen.reduce((total, term) => total + term.fromCurrentEmployees, 0)

  let text: string
  if (basis === "job_postings") {
    text = isEnglish
      ? `${you.see} that ${input.companyName} has open roles asking for ${termList}.`
      : `${you.see} que ${input.companyName} tiene búsquedas abiertas que piden ${termList}.`
  } else if (input.nameIndividuals && input.personName?.trim()) {
    const name = sanitizeUntrustedText(input.personName, 80).text
    text = isEnglish
      ? `${you.see} that ${name} lists ${termList} on their profile at ${input.companyName}.`
      : `${you.see} que ${name} menciona ${termList} en su perfil en ${input.companyName}.`
  } else if (profiles >= 2) {
    text = isEnglish
      ? `${you.see} that several people on the team at ${input.companyName} list ${termList} on their profiles.`
      : `${you.see} que en el equipo de ${input.companyName} varios perfiles mencionan ${termList}.`
  } else {
    // Con un solo perfil se dice que es uno. Inflarlo a "varios" es la clase de
    // detalle que un cliente verifica en treinta segundos y no perdona.
    text = isEnglish
      ? `${you.see} that someone on the team at ${input.companyName} lists ${termList} on their profile.`
      : `${you.see} que en el equipo de ${input.companyName} hay un perfil que menciona ${termList}.`
  }

  if (input.includeQuote) {
    const quoted = chosen.find((term) => term.snippet?.trim())
    if (quoted?.snippet) {
      const { text: safe } = sanitizeUntrustedText(quoted.snippet, 160)
      if (safe) text += isEnglish ? ` The profile reads: "${safe}".` : ` El perfil dice: "${safe}".`
    }
  }

  return {
    ok: true,
    text,
    basis,
    termsUsed: termNames,
    namesIndividual: Boolean(input.nameIndividuals && input.personName?.trim() && basis === "current_employees"),
  }
}
