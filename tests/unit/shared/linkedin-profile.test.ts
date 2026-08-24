import { describe, expect, it } from "vitest"
import { linkedinProfileBase, linkedinProfileSlug, linkedinProfileSuffix } from "@/lib/shared/linkedin-profile"

// Estos casos son URLs reales de `contacts`. La versión SQL
// (contact_profile_slug / contact_profile_suffix) tiene que dar lo mismo:
// si divergen, el ETL y la UI dejan de estar de acuerdo sobre quién es quién.
describe("linkedinProfileSlug", () => {
  it("normaliza dominio regional, mayúsculas, query, hash y barra final", () => {
    expect(linkedinProfileSlug("http://ar.linkedin.com/in/Juan-Perez/?trk=x#top")).toBe("juan-perez")
  })

  it("acentos y percent-encoding caen en el mismo slug", () => {
    expect(linkedinProfileSlug("https://www.linkedin.com/in/adri%C3%A1n-milhas")).toBe("adrian-milhas")
    expect(linkedinProfileSlug("https://www.linkedin.com/in/adrián-milhas")).toBe("adrian-milhas")
  })

  it("saca el guión colgado del final", () => {
    expect(linkedinProfileSlug("https://www.linkedin.com/in/agustín-torruella-")).toBe("agustin-torruella")
  })

  it("conserva el sufijo autogenerado: es parte del slug", () => {
    expect(linkedinProfileSlug("https://www.linkedin.com/in/matias-ezequiel-merino-b36b54260")).toBe(
      "matias-ezequiel-merino-b36b54260",
    )
  })

  it("ignora lo que no es un perfil de persona", () => {
    expect(linkedinProfileSlug("https://www.linkedin.com/company/molinos-agro")).toBeNull()
    expect(linkedinProfileSlug("placeholder:e4f1c0de-0000-0000-0000-000000000000")).toBeNull()
    expect(linkedinProfileSlug(null)).toBeNull()
    expect(linkedinProfileSlug("")).toBeNull()
  })

  it("no se rompe con un percent-encoding inválido", () => {
    expect(linkedinProfileSlug("https://www.linkedin.com/in/juan%ZZperez")).toBe("juanzzperez")
  })
})

describe("linkedinProfileSuffix", () => {
  it("saca el id de perfil que sobrevive al cambio de nombre visible", () => {
    // Caso real: la misma persona con dos formas de su nombre.
    expect(linkedinProfileSuffix("https://www.linkedin.com/in/adrián-gabriel-cavaiuolo-94541727")).toBe("94541727")
    expect(linkedinProfileSuffix("https://www.linkedin.com/in/adrián-gabriel-c-94541727")).toBe("94541727")
  })

  it("no confunde un apellido hexadecimal con un sufijo", () => {
    expect(linkedinProfileSuffix("https://www.linkedin.com/in/ana-abbaca")).toBeNull()
  })

  it("no toma sufijos numéricos cortos de vanity URLs", () => {
    expect(linkedinProfileSuffix("https://www.linkedin.com/in/matias-merino-1")).toBeNull()
  })
})

describe("linkedinProfileBase", () => {
  it("une el slug autogenerado con la vanity URL del mismo perfil", () => {
    expect(linkedinProfileBase("https://www.linkedin.com/in/matias-ezequiel-merino-b36b54260")).toBe(
      "matias-ezequiel-merino",
    )
    expect(linkedinProfileBase("https://www.linkedin.com/in/matias-ezequiel-merino")).toBe("matias-ezequiel-merino")
  })

  it("deja intacto un slug sin sufijo", () => {
    expect(linkedinProfileBase("https://www.linkedin.com/in/amilhas")).toBe("amilhas")
  })
})
