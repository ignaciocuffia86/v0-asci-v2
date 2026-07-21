export interface CompanyAlias {
  aliases: string[]
  canonicalName: string
  canonicalDomain: string
  country?: string
}

export const COMPANY_ALIASES_VERSION = "company-aliases-v1"

export const COMPANY_ALIASES: CompanyAlias[] = [
  {
    aliases: ["banco galicia", "banco de galicia", "galicia"],
    canonicalName: "Galicia Bank",
    canonicalDomain: "galicia.ar",
    country: "Argentina",
  },
  {
    aliases: ["banco frances", "banco frances argentina", "bbva frances"],
    canonicalName: "BBVA en Argentina",
    canonicalDomain: "bbva.com.ar",
    country: "Argentina",
  },
]

export function normalizeCompanyName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(sa|s a|srl|llc|inc|ltd|corp|corporation|company|cia)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function findCompanyAlias(input: string): CompanyAlias | null {
  const normalized = normalizeCompanyName(input)
  return COMPANY_ALIASES.find((entry) => entry.aliases.some((alias) => normalizeCompanyName(alias) === normalized)) ?? null
}
