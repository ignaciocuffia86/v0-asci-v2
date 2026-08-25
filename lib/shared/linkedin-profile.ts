// ═══════════════════════════════════════════════════════════
// Identidad de un perfil de LinkedIn.
//
// Gemelo de las funciones SQL contact_profile_slug() y
// contact_profile_suffix() (supabase/migrations/20260825000000_contact_identity_resolution.sql).
// Si cambia una definición hay que cambiar la otra: el ETL decide con la
// versión SQL si inserta o actualiza, y la UI pliega señales con esta. Si
// divergen, la pantalla muestra una persona que la base cree que son dos.
//
// Por qué hace falta normalizar: la URL de un perfil cambia sin que cambie la
// persona. Medido sobre 544.808 filas de `contacts`:
//   * 88.891 traen acentos en el slug y 299 lo traen percent-encoded
//     (adri%C3%A1n-milhas y adrián-milhas son el mismo perfil).
//   * 1.682 traen un guión colgado al final ("agustin-torruella-").
//   * 6.386 traen el URN ofuscado (/in/ACwAAAL5g4IB...) en vez del slug.
// ═══════════════════════════════════════════════════════════

/** Quita acentos y pasa a minúsculas. Mismo criterio que el translate() de SQL. */
function deaccent(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

/**
 * Slug canónico del perfil: el identificador, no la URL.
 *
 * Sin protocolo, sin dominio regional, sin query ni hash, sin acentos y sin
 * guiones colgados. Devuelve null si la URL no es un perfil de persona
 * (una /company/, un placeholder del ETL, o vacío).
 */
export function linkedinProfileSlug(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith("placeholder:")) return null

  let decoded = url.trim()
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // Un %ZZ suelto rompe decodeURIComponent. Se sigue con el crudo: es peor
    // perder el perfil entero que perder la variante percent-encoded.
  }

  const match = deaccent(decoded).match(/linkedin\.com\/in\/([^/?#]+)/)
  if (!match) return null

  const slug = match[1].replace(/[^a-z0-9_-]/g, "").replace(/^-+|-+$/g, "")
  return slug || null
}

/**
 * Sufijo autogenerado del slug: el id que LinkedIn conserva cuando la persona
 * cambia su nombre visible (adrian-gabriel-cavaiuolo-94541727 y
 * adrian-gabriel-c-94541727 son el mismo perfil).
 *
 * Exige al menos un dígito. Sin esa guarda "ana-abbaca" perdería el apellido,
 * que es [a-f]{6} pero es un apellido. No identifica por sí solo: 398 de los
 * 501 sufijos repetidos en la base son personas distintas, así que siempre se
 * usa junto al nombre.
 */
export function linkedinProfileSuffix(url: string | null | undefined): string | null {
  const slug = linkedinProfileSlug(url)
  if (!slug) return null
  const match = slug.match(/-([0-9a-f]{6,12})$/)
  if (!match || !/[0-9]/.test(match[1])) return null
  return match[1]
}

/**
 * Slug sin el sufijo autogenerado.
 *
 * Es lo que une las dos filas del mismo perfil scrapeado antes y después de que
 * la persona se pusiera una vanity URL: matias-ezequiel-merino-b36b54260 y
 * matias-ezequiel-merino. Como la base del slug automático sale del nombre, dos
 * homónimos la comparten — quien la use para identificar tiene que exigir
 * además el nombre.
 */
export function linkedinProfileBase(url: string | null | undefined): string | null {
  const slug = linkedinProfileSlug(url)
  if (!slug) return null
  const suffix = linkedinProfileSuffix(url)
  if (!suffix) return slug
  return slug.slice(0, -(suffix.length + 1)) || slug
}
