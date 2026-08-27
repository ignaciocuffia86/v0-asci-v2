import { describe, expect, it } from "vitest"

import { authorizedBatchCredits } from "@/lib/v3/services/mcp-batch-job"

// ═══════════════════════════════════════════════════════════════════════════
// El perfil admin es "sin bloqueo, nunca sin medición". El modo de falla de esa
// regla no es que algo explote: es que un tope se cuele disfrazado de número.
//
// El caso real: armando una base de 37 cuentas, el perfil admin devolvió
// "quedan 26 lugares libres de 60" y "74 créditos de 145 disponibles", y con eso
// el modelo pidió excluir cuentas y cotizar antes de trabajar. Ninguno de los dos
// techos se aplicaba a esa credencial — pero como viajaban como números, se
// leyeron como límites.
//
// De ahí la convención que estos tests fijan: SIN TOPE se dice `null`, nunca 0 y
// nunca el número del plan. `0` significa "no queda nada", que es exactamente lo
// contrario, y es un error que ningún typechecker ve.
// ═══════════════════════════════════════════════════════════════════════════

describe("authorizedBatchCredits — el lote no achica lo que no tiene techo", () => {
  it("sin topes autoriza el peor caso entero, aunque el cupo del plan esté agotado", () => {
    expect(authorizedBatchCredits(740, true, 0)).toBe(740)
    expect(authorizedBatchCredits(740, true, -50)).toBe(740)
  })

  it("con topes sigue recortando al cupo que queda", () => {
    expect(authorizedBatchCredits(740, false, 145)).toBe(145)
    expect(authorizedBatchCredits(74, false, 145)).toBe(74)
  })

  it("un cupo negativo no se convierte en un autorizado negativo", () => {
    // `monthlyRemaining` sale de una resta y puede dar negativo si el pool se
    // pasó. Autorizar -5 créditos no significa nada; el piso es 0.
    expect(authorizedBatchCredits(74, false, -5)).toBe(0)
  })
})

describe("la convención de `null`: sin tope no es cero", () => {
  // Estas dos funciones son la forma exacta en que el payload decide qué mostrar.
  // Van acá y no inline en el servicio porque el bug no es de cálculo: es de
  // lectura, y se reintroduce cada vez que alguien escribe `?? 0`.
  const remainingFor = (cap: number | null, used: number) => (cap === null ? null : Math.max(0, cap - used))

  it("cupo null ⇒ restante null, NO 0", () => {
    expect(remainingFor(null, 120)).toBeNull()
    // El `?? 0` que hay que no escribir: convierte "sin techo" en "agotado".
    expect(remainingFor(null, 120) ?? 0).toBe(0)
  })

  it("cupo real agotado ⇒ 0, que sí quiere decir agotado", () => {
    expect(remainingFor(145, 145)).toBe(0)
    expect(remainingFor(145, 200)).toBe(0)
  })

  it("cupo real con saldo ⇒ el saldo", () => {
    expect(remainingFor(145, 71)).toBe(74)
  })
})
