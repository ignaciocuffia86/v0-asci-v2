/**
 * Verifica que checkUrlsAlive detecte dominios inexistentes.
 *
 * Antes del fix TODAS las urls pasaban como vivas: undici pone ENOTFOUND en
 * err.cause.code y el codigo leia err.message ("fetch failed").
 *
 * Uso: node scripts/probe-url-check.mjs
 */
import { checkUrlsAlive } from "../lib/ai-structurer.ts"

const CASOS = [
  { url: "https://www.arcor.com", esperado: "viva" },
  { url: "https://www.lanacion.com.ar", esperado: "viva" },
  { url: "https://este-dominio-no-existe-harness-v0-9182.com/nota", esperado: "muerta" },
  { url: "https://otro-dominio-inventado-asci-4471.org/x", esperado: "muerta" },
  { url: "no-es-una-url", esperado: "muerta" },
]

const vivas = await checkUrlsAlive(
  CASOS.map((c) => c.url),
  { context: "probe" },
)

let fallos = 0
console.log("")
for (const c of CASOS) {
  const real = vivas.has(c.url) ? "viva" : "muerta"
  const ok = real === c.esperado
  if (!ok) fallos++
  console.log(`${ok ? "OK  " : "FALLA"} ${real.padEnd(7)} (esperado ${c.esperado.padEnd(7)}) ${c.url}`)
}
console.log(fallos === 0 ? "\nTodos los casos correctos" : `\n${fallos} caso(s) mal`)
process.exit(fallos === 0 ? 0 : 1)
