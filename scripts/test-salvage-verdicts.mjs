/**
 * Test del rescate de veredictos parciales (lib/v3/dedupe-ai.ts).
 *
 * Replica `salvageVerdicts` en JS plano para poder correrlo con node sin levantar
 * Next ni tocar la base. Si se cambia la funcion real, cambiar esta copia.
 *
 * Correr: node scripts/test-salvage-verdicts.mjs
 */

const schemaOk = (o) =>
  o &&
  typeof o === "object" &&
  Number.isInteger(o.g) &&
  Array.isArray(o.same) &&
  Array.isArray(o.different) &&
  typeof o.confidence === "number" &&
  typeof o.reasoning === "string"

function safeJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function salvageVerdicts(text) {
  if (!text) return []
  const start = text.indexOf('"results"')
  if (start === -1) return []
  const abre = text.indexOf("[", start)
  if (abre === -1) return []

  const out = []
  let depth = 0
  let objStart = -1
  let inString = false
  let escaped = false

  for (let i = abre + 1; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === "\\") {
      if (inString) escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === "{") {
      if (depth === 0) objStart = i
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0 && objStart !== -1) {
        const parsed = safeJson(text.slice(objStart, i + 1))
        if (schemaOk(parsed)) out.push(parsed)
        objStart = -1
      }
    } else if (ch === "]" && depth === 0) {
      break
    }
  }
  return out
}

let fallos = 0
const check = (nombre, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado)
  if (!ok) {
    fallos++
    console.log(`FALLO ${nombre}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`)
  } else {
    console.log(`OK ${nombre}`)
  }
}

const v = (g) => ({ g, same: [g], different: [], confidence: 0.9, reasoning: "misma empresa" })
const s = (o) => JSON.stringify(o)

// 1. Respuesta completa: se rescatan todos.
check(
  "respuesta completa",
  salvageVerdicts(`{"results":[${s(v(1))},${s(v(2))},${s(v(3))}]}`).map((x) => x.g),
  [1, 2, 3],
)

// 2. El caso real del bug: cortada a mitad del ultimo objeto.
check(
  "truncada a mitad de objeto",
  salvageVerdicts(`{"results":[${s(v(1))},${s(v(2))},{"g":3,"same":[3],"differe`).map((x) => x.g),
  [1, 2],
)

// 3. Cortada justo despues de una coma.
check(
  "truncada en la coma",
  salvageVerdicts(`{"results":[${s(v(1))},${s(v(2))},`).map((x) => x.g),
  [1, 2],
)

// 4. Llaves y corchetes DENTRO de un string no deben confundir al contador.
check(
  "llaves dentro del reasoning",
  salvageVerdicts(
    `{"results":[{"g":1,"same":[1],"different":[],"confidence":0.9,"reasoning":"el nombre {raro} tiene [corchetes] y } sueltas"},${s(v(2))}]}`,
  ).map((x) => x.g),
  [1, 2],
)

// 5. Comillas escapadas dentro del reasoning.
check(
  "comillas escapadas",
  salvageVerdicts(
    `{"results":[{"g":1,"same":[1],"different":[],"confidence":0.9,"reasoning":"se llama \\"Arcor\\" igual"},${s(v(2))}]}`,
  ).map((x) => x.g),
  [1, 2],
)

// 6. Objeto con forma invalida se descarta, los buenos se conservan.
check(
  "descarta objeto invalido",
  salvageVerdicts(`{"results":[${s(v(1))},{"g":"dos","same":[]},${s(v(3))}]}`).map((x) => x.g),
  [1, 3],
)

// 7. Basura sin results.
check("sin results", salvageVerdicts("perdon, no puedo ayudarte con eso"), [])
check("texto vacio", salvageVerdicts(""), [])
check("undefined", salvageVerdicts(undefined), [])

// 8. Preambulo antes del JSON (algunos modelos lo agregan).
check(
  "con preambulo",
  salvageVerdicts(`Aca va el analisis:\n\`\`\`json\n{"results":[${s(v(1))}]}\n\`\`\``).map((x) => x.g),
  [1],
)

// 9. Se preservan los valores, no solo el conteo.
const uno = salvageVerdicts(`{"results":[{"g":7,"same":[7,8],"different":[9],"confidence":0.42,"reasoning":"dudoso"}]}`)
check("preserva valores", uno[0], { g: 7, same: [7, 8], different: [9], confidence: 0.42, reasoning: "dudoso" })

console.log(fallos === 0 ? "\nTODO OK" : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
