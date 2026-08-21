import { describe, expect, it } from "vitest"
import {
  classifyMovementFocus,
  classifyMovementType,
  pickPhone,
  pickValidEmail,
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

describe("pickValidEmail", () => {
  it("devuelve el primer email con estado valid", () => {
    expect(
      pickValidEmail({
        email1: "malo@x.com",
        email1_status: "invalid",
        email2: "bueno@x.com",
        email2_status: "Valid",
      }),
    ).toBe("bueno@x.com")
  })

  it("sin estado valid devuelve null aunque haya emails", () => {
    expect(pickValidEmail({ email1: "a@x.com", email1_status: "unknown" })).toBeNull()
    expect(pickValidEmail({})).toBeNull()
  })
})

describe("pickPhone", () => {
  it("devuelve el primer teléfono con su tipo", () => {
    expect(pickPhone({ phone1: " +593 4-371-3035 ", phone1_type: "company" })).toEqual({
      phone: "+593 4-371-3035",
      type: "company",
    })
  })

  it("cae al segundo si el primero está vacío y null sin ninguno", () => {
    expect(pickPhone({ phone1: " ", phone2: "+54 11 5555", phone2_type: null })).toEqual({
      phone: "+54 11 5555",
      type: null,
    })
    expect(pickPhone({})).toBeNull()
  })
})
