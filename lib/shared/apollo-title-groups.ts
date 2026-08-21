/**
 * Grupos de cargos predefinidos para la búsqueda de decisores.
 *
 * Vive acá y no dentro de una pantalla porque lo usan las DOS: el tab de
 * prospectos de v2 y la sección de decisores del bookmark de v3. Si se agrega
 * un grupo, aparece en los dos lados.
 *
 * Módulo leaf, sin imports: lo puede consumir un componente cliente sin
 * arrastrar nada de servidor.
 */
export const PREDEFINED_JOB_TITLE_GROUPS = [
  {
    label: "Operaciones",
    titles: [
      "Director de Operaciones",
      "COO",
      "VP Operaciones",
      "Gerente de Operaciones",
      "Head of Operations",
    ],
  },
  {
    label: "TI / Sistemas",
    titles: [
      "Director de TI",
      "Director de Sistemas",
      "CTO",
      "IT Manager",
      "Gerente de Sistemas",
      "Jefe de Sistemas",
      "VP IT",
    ],
  },
  {
    label: "Innovacion / Transformacion",
    titles: [
      "Director de Innovacion",
      "Chief Innovation Officer",
      "Director de Transformacion Digital",
      "Head of Innovation",
      "Gerente de Innovacion",
    ],
  },
] as const

/** Países que Apollo acepta: etiqueta en español, valor en inglés para la API. */
export const APOLLO_COUNTRIES = [
  { label: "Argentina", value: "Argentina" },
  { label: "Bolivia", value: "Bolivia" },
  { label: "Brasil", value: "Brazil" },
  { label: "Chile", value: "Chile" },
  { label: "Colombia", value: "Colombia" },
  { label: "Costa Rica", value: "Costa Rica" },
  { label: "Ecuador", value: "Ecuador" },
  { label: "El Salvador", value: "El Salvador" },
  { label: "España", value: "Spain" },
  { label: "Estados Unidos", value: "United States" },
  { label: "Guatemala", value: "Guatemala" },
  { label: "Honduras", value: "Honduras" },
  { label: "México", value: "Mexico" },
  { label: "Nicaragua", value: "Nicaragua" },
  { label: "Panamá", value: "Panama" },
  { label: "Paraguay", value: "Paraguay" },
  { label: "Perú", value: "Peru" },
  { label: "República Dominicana", value: "Dominican Republic" },
  { label: "Uruguay", value: "Uruguay" },
  { label: "Venezuela", value: "Venezuela" },
] as const

/**
 * `companies.country` no está normalizado: guarda direcciones enteras
 * ("Quito, Pichincha, Ecuador") y nombres en español. Devuelve el valor que
 * espera Apollo, o "" cuando no se reconoce — buscar sin filtro de país es
 * mejor que buscar con el país equivocado.
 */
export function mapToApolloCountry(raw: string | null | undefined): string {
  if (!raw) return ""
  const texto = raw.trim().toLowerCase()
  if (!texto) return ""
  for (const { label, value } of APOLLO_COUNTRIES) {
    if (texto === label.toLowerCase() || texto === value.toLowerCase()) return value
    // El país suele ser el último campo de una dirección.
    if (texto.endsWith(label.toLowerCase()) || texto.endsWith(value.toLowerCase())) return value
  }
  return ""
}
