import { describe, expect, it } from "vitest"

import { authorizedBatchCredits } from "@/lib/v3/services/mcp-batch-job"

// ═══════════════════════════════════════════════════════════════════════════
// El batchPlanHash pasa a AUTORIZAR gasto en Apollo, y eso abre una puerta que
// hay que dejar cerrada: que el presupuesto del lote se use para saltear el cupo
// mensual de un plan pago.
//
// El caso concreto: un workspace Silver tiene 150 créditos por mes. Cotizar 60
// cuentas x 10 contactos son 600. Si el lote autorizara los 600, el cupo del plan
// dejaría de existir para cualquiera que sepa pedir un lote grande — y nadie lo
// habría decidido.
// ═══════════════════════════════════════════════════════════════════════════

describe("authorizedBatchCredits", () => {
  it("una credencial CON topes no puede exceder su cupo mensual", () => {
    // 60 cuentas x 10 contactos contra un plan al que le quedan 150.
    expect(authorizedBatchCredits(600, false, 150)).toBe(150)
  })

  it("si el lote entra en el cupo, se autoriza entero", () => {
    expect(authorizedBatchCredits(120, false, 150)).toBe(120)
  })

  it("con el cupo agotado el lote no autoriza nada", () => {
    // Cero es la respuesta correcta: el enrichment va a frenar en el techo, y es
    // mejor que frene que autorizar un gasto que el plan no permite.
    expect(authorizedBatchCredits(600, false, 0)).toBe(0)
  })

  it("un cupo mensual ya excedido no produce un presupuesto NEGATIVO", () => {
    // getMonthlyPoolUsage puede superar el límite (una reserva del peor caso que
    // todavía no se ajustó). Un negativo acá se restaría mal en cada comparación.
    expect(authorizedBatchCredits(600, false, -25)).toBe(0)
  })

  it("una credencial SIN topes autoriza el peor caso completo", () => {
    // Es el punto del perfil admin: el techo deja de ser el mes y pasa a ser lo
    // que se cotizó y alguien confirmó.
    expect(authorizedBatchCredits(600, true, 150)).toBe(600)
    expect(authorizedBatchCredits(600, true, 0)).toBe(600)
  })
})
