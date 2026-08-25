/**
 * Registro de lenguaje por país del contacto.
 *
 * Vive aparte porque lo necesitan los DOS caminos del icebreaker: el que genera
 * con IA (`icebreakers.ts`, que arrastra el SDK de `ai`) y el determinístico
 * (`icebreaker-template.ts`, que no llama a ningún modelo y tiene que poder
 * testearse sin eso). Duplicarlo sería la misma clase de desfasaje que dejó
 * nueve tools inalcanzables cuando el catálogo de scopes estaba en dos lugares.
 */

export type LanguageRegister = {
  register: string
  instructions: string
  /** Segunda persona del registro, para los templates sin IA. */
  you: { see: string; possessive: string }
}

export function registerForCountry(country: string | null): LanguageRegister {
  const c = (country ?? "").toLowerCase()
  if (["argentina", "uruguay"].some((x) => c.includes(x))) {
    return {
      register: "es-rioplatense",
      you: { see: "Vi", possessive: "tu" },
      instructions:
        "Usá voseo rioplatense (vos, tenés, querés). Tono profesional pero cercano, directo, sin formalidad excesiva.",
    }
  }
  if (["mexico", "méxico", "colombia", "chile", "peru", "perú", "ecuador"].some((x) => c.includes(x))) {
    return {
      register: "es-tuteo",
      you: { see: "Vi", possessive: "tu" },
      instructions:
        "Usa tuteo (tú, tienes, quieres). Tono profesional y cordial, ligeramente más formal que el rioplatense.",
    }
  }
  if (["spain", "españa"].some((x) => c.includes(x))) {
    return {
      register: "es-espana",
      you: { see: "Vi", possessive: "tu" },
      instructions: "Usa tuteo peninsular. Tono profesional directo, sin rodeos.",
    }
  }
  if (["united states", "usa", "canada", "united kingdom", "brazil", "brasil"].some((x) => c.includes(x))) {
    return {
      register: "en",
      you: { see: "I noticed", possessive: "your" },
      instructions: "Write in professional English. Direct, concise, no fluff.",
    }
  }
  return {
    register: "es-neutral",
      you: { see: "Vi", possessive: "su" },
    instructions: "Usa español neutro profesional (tú/usted según convenga, evita regionalismos).",
  }
}
