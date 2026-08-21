import { describe, expect, it } from "vitest"
import {
  classifyMovementFocus,
  classifyMovementType,
  emailKind,
  pickEmail,
  pickPhone,
  phoneKind,
} from "@/lib/v3/services/personnel-movements-rules"

const COMPANY_ID = "11111111-1111-1111-1111-111111111111"

describe("classifyMovementType", () => {
  it("sin posiciones previas es ingreso nuevo", () => {
    expect(classifyMovementType(null, COMPANY_ID, "Omarsa")).toBe("ingreso_nuevo")
    expect(classifyMovementType([], COMPANY_ID, "Omarsa")).toBe("ingreso_nuevo")
  })

  it("empresa previa distinta es ingreso nuevo", () => {
    expect(
      classifyMovementType(
        [{ company_id: "22222222-2222-2222-2222-222222222222", company_name: "Otra SA" }],
        COMPANY_ID,
        "Omarsa",
      ),
    ).toBe("ingreso_nuevo")
  })

  it("misma empresa por company_id es rotación interna", () => {
    expect(
      classifyMovementType([{ company_id: COMPANY_ID, company_name: "Omarsa" }], COMPANY_ID, "Omarsa"),
    ).toBe("rotacion_interna")
  })

  it("misma empresa por nombre (case/espacios) es rotación interna", () => {
    expect(
      classifyMovementType([{ company_name: "  OMARSA " }], COMPANY_ID, "omarsa"),
    ).toBe("rotacion_interna")
  })

  it("solo mira la posición previa más reciente", () => {
    expect(
      classifyMovementType(
        [{ company_name: "Otra SA" }, { company_id: COMPANY_ID, company_name: "Omarsa" }],
        COMPANY_ID,
        "Omarsa",
      ),
    ).toBe("ingreso_nuevo")
  })
})

describe("classifyMovementFocus", () => {
  const profile = {
    recommendedJobTitles: ["Gerente de Analytics", "Data Architect"],
    targetTerms: ["SAP", "Power BI", "telecomunicaciones"],
  }

  it("cargo gerencial es decisor por patrón genérico", () => {
    expect(classifyMovementFocus("Gerente de Compras", null, profile).focus).toBe("decisor")
    expect(classifyMovementFocus("IT Director", null, profile).focus).toBe("decisor")
    expect(classifyMovementFocus("Jefe de Sistemas", null, profile).focus).toBe("decisor")
  })

  it("cargo que matchea los recomendados del workspace es decisor", () => {
    expect(classifyMovementFocus("Senior Data Architect", null, profile).focus).toBe("decisor")
  })

  it("cargo técnico que menciona un target es perfil objetivo, con el término", () => {
    const result = classifyMovementFocus("Ingeniero de telecomunicaciones", null, profile)
    expect(result.focus).toBe("perfil_objetivo")
    expect(result.matchedTerms).toContain("telecomunicaciones")
  })

  it("el headline también cuenta para el match de targets", () => {
    const result = classifyMovementFocus("Analista", "Consultor SAP FI en proyectos regionales", profile)
    expect(result.focus).toBe("perfil_objetivo")
    expect(result.matchedTerms).toContain("SAP")
  })

  it("decisor que además matchea targets conserva los términos", () => {
    const result = classifyMovementFocus("Gerente de Power BI", null, profile)
    expect(result.focus).toBe("decisor")
    expect(result.matchedTerms).toContain("Power BI")
  })

  it("sin señal devuelve null", () => {
    expect(classifyMovementFocus("Supervisor de bodega", null, profile).focus).toBeNull()
    expect(classifyMovementFocus(null, null, profile).focus).toBeNull()
  })

  it("términos cortos (<3 chars) no matchean", () => {
    const result = classifyMovementFocus("Analista de BI", null, {
      recommendedJobTitles: [],
      targetTerms: ["BI"],
    })
    expect(result.focus).toBeNull()
  })
})

describe("emailKind", () => {
  it("reconoce dominios personales conocidos", () => {
    expect(emailKind("juan@gmail.com")).toBe("personal")
    expect(emailKind("juan@hotmail.com.ar")).toBe("personal")
    expect(emailKind("juan@proton.me")).toBe("personal")
  })

  it("todo lo demás es corporativo", () => {
    expect(emailKind("juan@bancoripley.com")).toBe("corporativo")
    // Un dominio parecido pero distinto NO es personal: la lista es exacta.
    expect(emailKind("juan@notgmail.com")).toBe("corporativo")
  })
})

describe("pickEmail", () => {
  it("prioriza el corporativo aunque el personal venga primero", () => {
    expect(
      pickEmail({
        email1: "juan@gmail.com",
        email1_status: "valid",
        email2: "juan@bancoripley.com",
        email2_status: "valid",
      }),
    ).toEqual({ value: "juan@bancoripley.com", kind: "corporativo" })
  })

  it("cae al personal cuando no hay corporativo, y lo declara", () => {
    expect(pickEmail({ email1: "juan@gmail.com", email1_status: "Valid" })).toEqual({
      value: "juan@gmail.com",
      kind: "personal",
    })
  })

  it("ignora los que no están marcados valid", () => {
    // El corporativo existe pero no está validado: no se ofrece.
    expect(
      pickEmail({
        email1: "juan@bancoripley.com",
        email1_status: "invalid",
        email2: "juan@gmail.com",
        email2_status: "valid",
      }),
    ).toEqual({ value: "juan@gmail.com", kind: "personal" })
    expect(pickEmail({ email1: "a@x.com", email1_status: "unknown" })).toBeNull()
    expect(pickEmail({})).toBeNull()
  })
})

describe("phoneKind", () => {
  it("solo los tipos de la empresa son corporativos", () => {
    expect(phoneKind("company")).toBe("corporativo")
    expect(phoneKind("Work")).toBe("corporativo")
    expect(phoneKind("mobile")).toBe("personal")
    // Sin tipo no se puede afirmar que sea de la empresa.
    expect(phoneKind(null)).toBe("personal")
  })
})

describe("pickPhone", () => {
  it("prioriza la línea de la empresa aunque venga segunda", () => {
    expect(
      pickPhone({
        phone1: "+54 11 5555",
        phone1_type: "mobile",
        phone2: " +593 4-371-3035 ",
        phone2_type: "company",
      }),
    ).toEqual({ value: "+593 4-371-3035", rawType: "company", kind: "corporativo" })
  })

  it("cae al personal si no hay corporativo, y null sin ninguno", () => {
    expect(pickPhone({ phone1: " ", phone2: "+54 11 5555", phone2_type: null })).toEqual({
      value: "+54 11 5555",
      rawType: null,
      kind: "personal",
    })
    expect(pickPhone({})).toBeNull()
  })
})
