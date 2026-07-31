/**
 * Harness de UX del MCP de ASCI.
 *
 * Habla MCP de verdad (streamable http) contra el server local, haciendo de
 * cliente IA: la premisa es que un modelo SOLO ve el nombre, la descripcion y el
 * schema de cada tool. Todo lo que el harness necesite saber para dar el
 * siguiente paso tiene que salir de la respuesta anterior; si hay que adivinar,
 * eso ES el hallazgo de UX.
 *
 * Mide por llamada: latencia, tamano del payload y si la respuesta dice cual es
 * el proximo paso. Al final reporta roundtrips y cuota consumida.
 *
 * Uso:
 *   node scripts/mcp-ux-harness.mjs <fase>
 *
 * Fases: catalogo | descubrimiento | panorama | guardar | evidencia
 * La key se lee de /tmp/asci-test-key (no se hardcodea ni se loguea).
 */

import fs from "fs"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const PORT = process.env.DEV_PORT || "3000"
const URL_MCP = `http://localhost:${PORT}/api/v3/mcp/server/mcp`
const KEY = fs.readFileSync("/tmp/asci-test-key", "utf8").trim()

/** Bitacora de llamadas, para el reporte final. */
const bitacora = []

function fmtBytes(n) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`
}

async function conectar() {
  const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
    requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
  })
  const client = new Client({ name: "asci-ux-harness", version: "1.0.0" })
  await client.connect(transport)
  return client
}

/**
 * Llama una tool midiendo lo que le importa a la UX. Nunca tira: un error es un
 * dato del test, no un crash.
 */
async function llamar(client, nombre, args, nota = "") {
  const t0 = Date.now()
  let ok = true
  let texto = ""
  let error = null
  try {
    const res = await client.callTool({ name: nombre, arguments: args })
    texto = (res.content ?? []).map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n")
    if (res.isError) {
      ok = false
      error = texto
    }
  } catch (e) {
    ok = false
    error = e?.message ?? String(e)
  }
  const ms = Date.now() - t0
  const bytes = Buffer.byteLength(texto || error || "", "utf8")
  bitacora.push({ nombre, ms, bytes, ok, nota })
  console.log(`\n${"─".repeat(78)}`)
  console.log(`${ok ? "OK " : "ERR"} ${nombre}  ${ms}ms  ${fmtBytes(bytes)}${nota ? `  · ${nota}` : ""}`)
  console.log(`args: ${JSON.stringify(args)}`)
  if (!ok) console.log(`ERROR: ${String(error).slice(0, 600)}`)
  return { ok, texto, error, ms, bytes }
}

/** Intenta parsear la respuesta como JSON; muchas tools devuelven texto+JSON. */
function comoJson(texto) {
  if (!texto) return null
  try {
    return JSON.parse(texto)
  } catch {
    const m = texto.match(/\{[\s\S]*\}$/)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        return null
      }
    }
    return null
  }
}

function resumen() {
  console.log(`\n${"═".repeat(78)}`)
  console.log("RESUMEN DE LA FASE")
  console.log("═".repeat(78))
  const total = bitacora.reduce((a, b) => a + b.ms, 0)
  const bytes = bitacora.reduce((a, b) => a + b.bytes, 0)
  for (const [i, c] of bitacora.entries()) {
    console.log(`${String(i + 1).padStart(2)}. ${c.ok ? "OK " : "ERR"} ${c.nombre.padEnd(34)} ${String(c.ms).padStart(6)}ms  ${fmtBytes(c.bytes).padStart(9)}`)
  }
  console.log(`\nroundtrips: ${bitacora.length} · tiempo total: ${(total / 1000).toFixed(1)}s · payload total: ${fmtBytes(bytes)}`)
  const fallidas = bitacora.filter((c) => !c.ok)
  if (fallidas.length) console.log(`fallaron: ${fallidas.map((c) => c.nombre).join(", ")}`)
}

// ───────────────────────── Fase: catalogo ─────────────────────────
// Costo cero. Verifica que el catalogo sea coherente CONSIGO MISMO: si una
// descripcion le dice al modelo "usa X", X tiene que existir. Una referencia
// colgada manda al modelo a llamar algo inexistente.
async function faseCatalogo(client) {
  const { tools } = await client.listTools()
  const nombres = new Set(tools.map((t) => t.name))
  console.log(`tools expuestas: ${tools.length}`)

  // Nombres con pinta de tool mencionados dentro de las descripciones.
  const prefijos = /\b((?:get|list|check|prepare|submit|run|save|remove|search|generate|scrape|refresh|confirm|create|recommend)_[a-z_]{3,})\b/g
  const colgadas = new Map()
  let referencias = 0

  for (const t of tools) {
    const texto = `${t.description ?? ""} ${JSON.stringify(t.inputSchema ?? {})}`
    for (const m of texto.matchAll(prefijos)) {
      const ref = m[1]
      referencias++
      if (!nombres.has(ref)) {
        if (!colgadas.has(ref)) colgadas.set(ref, new Set())
        colgadas.get(ref).add(t.name)
      }
    }
  }

  console.log(`referencias cruzadas entre descripciones: ${referencias}`)
  if (colgadas.size === 0) {
    console.log("integridad: OK, ninguna descripcion apunta a una tool inexistente")
  } else {
    console.log(`\nINTEGRIDAD ROTA: ${colgadas.size} nombre(s) referenciados que NO existen`)
    for (const [ref, desde] of colgadas) {
      console.log(`  - "${ref}" citada por: ${[...desde].join(", ")}`)
    }
  }

  // Cuales tools avisan que gastan algo. Un modelo decide con esto.
  const gastan = tools.filter((t) => /cuota|credito|cupo|consume|GASTA/i.test(t.description ?? ""))
  console.log(`\ntools que declaran costo en la descripcion: ${gastan.length}/${tools.length}`)
  for (const t of gastan) console.log(`  · ${t.name}`)

  const sinDesc = tools.filter((t) => !t.description || t.description.length < 40)
  if (sinDesc.length) {
    console.log(`\ndescripciones pobres (<40 chars), el modelo elige a ciegas: ${sinDesc.length}`)
    for (const t of sinDesc) console.log(`  · ${t.name}: "${t.description ?? ""}"`)
  }

  return { tools, nombres }
}

// ───────────────────────── Fase: schemas ─────────────────────────
// Costo cero. Un cliente MCP ve el schema, asi que el harness tampoco adivina
// argumentos: los lee de aca.
async function faseSchemas(client) {
  const { tools } = await client.listTools()
  for (const t of tools) {
    const p = t.inputSchema?.properties ?? {}
    const req = t.inputSchema?.required ?? []
    const campos = Object.entries(p).map(([k, v]) => {
      const tipo = v.type || v.anyOf?.map((a) => a.type).join("|") || "?"
      return `${k}${req.includes(k) ? "*" : ""}:${tipo}${v.enum ? `(${v.enum.join("|")})` : ""}`
    })
    console.log(`${t.name}(${campos.join(", ")})`)
  }
}

// ───────────────────── Fase: descubrimiento + triage ─────────────────────
// El usuario nombra varias cuentas. Que necesita el modelo para decidir si vale
// la pena guardarlas, y cuantas llamadas le toma llegar a esa decision.
async function faseDescubrimiento(client) {
  const buscadas = ["Techint", "Banco Frances", "Arcor"]
  const hallazgos = {}

  for (const q of buscadas) {
    const r = await llamar(client, "search_companies", { query: q, limit: 3 }, `usuario pregunta por "${q}"`)
    const j = comoJson(r.texto)
    console.log(mostrar(r.texto, 1400))
    if (j) hallazgos[q] = j
  }

  await llamar(client, "list_saved_accounts", {}, "cuales ya puedo trabajar y cuanto cupo queda")
  return hallazgos
}

// ───────────── Fase: preparar noticias (client-assisted) ─────────────
// Solo el paso 1: devuelve el prompt package. Consume 1 unidad de cuota de
// research, asi que se corre una vez y el package se guarda en /tmp para el
// submit posterior (que es donde el harness hace de modelo del cliente).
const ARCOR = "fd18c397-f503-4a9e-9039-4ad7fe09d403"

async function fasePrepararNoticias(client) {
  const idem = `harness-news-${Date.now()}`
  const r = await llamar(
    client,
    "prepare_company_news",
    { companyId: ARCOR, windowDays: 180, idempotencyKey: idem },
    "paso 1 de 2, consume 1 unidad de cuota",
  )
  console.log(mostrar(r.texto, 6000))
  if (r.ok) {
    // Se guarda la idempotencyKey aparte porque el package NO la devuelve, y
    // submit_company_news la exige. Ver hallazgo: el modelo tiene que acordarse
    // de un valor que invento el mismo, sin que nada en la respuesta lo diga.
    const j = comoJson(r.texto) ?? {}
    j.__idempotencyKeyUsada = idem
    fs.writeFileSync("/tmp/asci-news-package.json", JSON.stringify(j))
    console.log(`\npackage guardado · idempotencyKey usada: ${idem}`)
  }
}

// ───────────── Fase: submit de noticias + guardrails ─────────────
// Manda 1 hallazgo bueno y 4 defectuosos a proposito para ver QUE descarta el
// servidor. Los titulos van prefijados [TEST v0] porque las noticias son GLOBALES
// a todo v3 y hay que poder limpiarlas despues.
async function faseSubmitNoticias(client) {
  const pkg = JSON.parse(fs.readFileSync("/tmp/asci-news-package.json", "utf8"))
  const hoy = new Date().toISOString().slice(0, 10)

  const items = [
    {
      // 1. BUENO: url viva y la pagina menciona a la empresa.
      title: "[TEST v0] Arcor comunica novedades corporativas",
      summary: "Caso de control: fuente viva que menciona a la empresa.",
      category: "corporate",
      direction: "neutro",
      // Query string variable: sin esto el re-submit choca contra
      // idx_company_news_unique_source y voltea el lote entero.
      sourceUrl: `https://www.arcor.com/?harness=${Date.now()}`,
      sourceName: "Arcor",
      publishedAt: hoy,
    },
    {
      // 2. SOFT-404: responde 200 pero la pagina no existe.
      title: "[TEST v0] Arcor inaugura planta (soft-404)",
      summary: "La URL da 200 aunque la pagina no existe. Deberia caer.",
      category: "expansion",
      direction: "expansion",
      sourceUrl: "https://www.arcor.com/esta-url-no-existe-harness-test",
      sourceName: "Arcor",
      publishedAt: hoy,
    },
    {
      // 3. DOMINIO MUERTO: no resuelve.
      title: "[TEST v0] Arcor cierra linea (dominio inexistente)",
      summary: "Dominio que no resuelve. Deberia caer.",
      category: "contraccion",
      direction: "contraccion",
      sourceUrl: "https://este-dominio-no-existe-harness-v0-9182.com/nota",
      sourceName: "Inventado",
      publishedAt: hoy,
    },
    {
      // 4. VIVA PERO AJENA: no menciona a la empresa.
      title: "[TEST v0] Arcor mencionado en medio real (falso)",
      summary: "Home de un diario que no habla de la empresa. Deberia caer.",
      category: "corporate",
      direction: "neutro",
      sourceUrl: "https://www.lanacion.com.ar",
      sourceName: "La Nacion",
      publishedAt: hoy,
    },
    {
      // 5. FUERA DE VENTANA: se pidieron 180 dias.
      title: "[TEST v0] Arcor hecho viejo fuera de ventana",
      summary: "Fecha de 2019 con ventana de 180 dias. Deberia caer.",
      category: "corporate",
      direction: "neutro",
      sourceUrl: `https://www.arcor.com/?harness-viejo=${Date.now()}`,
      sourceName: "Arcor",
      publishedAt: "2019-03-01",
    },
  ]

  // La idempotencyKey no viene en el package. Si el harness (o el modelo) no la
  // recuerda del prepare, inventa una: probamos si el server la acepta igual.
  const idem = pkg.__idempotencyKeyUsada ?? `harness-submit-${Date.now()}`
  const nota = pkg.__idempotencyKeyUsada
    ? "idem key reusada del prepare"
    : "idem key NUEVA (el package no la devolvia)"

  const r = await llamar(
    client,
    "submit_company_news",
    { executionId: pkg.executionId, packageHash: pkg.promptPackage.packageHash, idempotencyKey: idem, result: { items } },
    `5 hallazgos: 1 bueno + 4 defectuosos · ${nota}`,
  )
  console.log(mostrar(r.texto, 4000))
}

// ───────────── Fase: determinismo de la busqueda ─────────────
// Si la misma pregunta devuelve otro "canonical" en cada corrida, el modelo puede
// guardar una empresa distinta cada vez y gastar cupo en la equivocada.
async function faseDeterminismo(client) {
  const query = process.argv[3] ?? "Techint"
  const vueltas = 5
  const elegidos = []
  for (let i = 0; i < vueltas; i++) {
    const r = await llamar(client, "search_companies", { query, limit: 3 }, `vuelta ${i + 1}`)
    const j = comoJson(r.texto)
    const lista = j?.companies ?? []
    const canon = lista.find((c) => c.likelyCanonical) ?? lista[0]
    elegidos.push({
      orden: lista.map((c) => `${c.name}${c.likelyCanonical ? "*" : ""}`),
      canon: canon ? `${canon.name} (${canon.id.slice(0, 8)})` : "ninguno",
      cuantosCanon: lista.filter((c) => c.likelyCanonical).length,
    })
  }
  console.log(`\n${"═".repeat(78)}\nDETERMINISMO de search_companies("${query}")\n${"═".repeat(78)}`)
  for (const [i, e] of elegidos.entries()) {
    console.log(`vuelta ${i + 1}: canonical -> ${e.canon}  (marcadas canonical: ${e.cuantosCanon})`)
    console.log(`          orden: ${e.orden.join(" | ")}`)
  }
  const distintos = new Set(elegidos.map((e) => e.canon))
  console.log(
    distintos.size === 1
      ? `\nESTABLE: siempre eligio ${[...distintos][0]}`
      : `\nINESTABLE: ${distintos.size} candidatos distintos en ${vueltas} corridas -> ${[...distintos].join(" / ")}`,
  )
}

// ───────────── Fase: panorama y decision de guardar ─────────────
// La pregunta central: con lo que devuelve el MCP ANTES de gastar cupo, se puede
// decidir si la cuenta vale la pena? Se prueba con una cuenta NO guardada, que es
// el caso real: el usuario evalua primero y guarda despues.
async function fasePanorama(client) {
  // 1. El modelo parte del nombre que dijo el usuario.
  const busq = await llamar(client, "search_companies", { query: "Techint", limit: 3 }, "cuenta NUEVA, no guardada")
  const jb = comoJson(busq.texto)
  const cand = (jb?.companies ?? []).find((c) => c.likelyCanonical) ?? jb?.companies?.[0]
  if (!cand) {
    console.log("no hubo candidato, corto la fase")
    return
  }
  console.log(`candidato elegido: ${cand.name} (${cand.id}) · señales=${cand.evidence?.signals} vacantes=${cand.evidence?.jobPostings}`)

  // 2. Esta guardada? Cuanto cupo hay?
  const acc = await llamar(client, "check_account_access", { companyId: cand.id }, "¿la puedo trabajar?")
  console.log(mostrar(acc.texto, 900))

  // 3. LA PRUEBA: se puede ver el panorama de una cuenta NO guardada?
  const pan = await llamar(client, "get_company_signal_summary", { companyId: cand.id }, "panorama SIN guardar")
  console.log(mostrar(pan.texto, 2000))

  // 4. Profundizar en un termino, con fuente. El termino sale de la respuesta
  //    anterior, no de una lista mia: si no se puede extraer, es hallazgo de UX.
  const jp = comoJson(pan.texto)
  const termino = primerTermino(jp)
  if (termino) {
    const ev = await llamar(client, "get_account_evidence_detail", { companyId: cand.id, term: termino }, `¿por que aparece "${termino}"?`)
    console.log(mostrar(ev.texto, 1800))
  } else {
    console.log("\nNO pude extraer un termino del panorama para profundizar (hallazgo de UX)")
  }

  // 5. Previsualizar el costo de guardar.
  const prev = await llamar(client, "prepare_save_account", { companyId: cand.id }, "costo en cupo antes de confirmar")
  console.log(mostrar(prev.texto, 900))
  return cand
}

/** Busca el primer termino citable en el panorama, sin asumir la forma exacta. */
function primerTermino(j) {
  if (!j) return null
  const pilas = [j.technologies, j.processes, j.signals, j.terms, j.tech, j.topTerms]
  for (const pila of pilas) {
    if (Array.isArray(pila) && pila.length) {
      const p = pila[0]
      if (typeof p === "string") return p
      if (p?.term) return p.term
      if (p?.name) return p.name
if (p?.label) return p.label
    }
  }
  // Ultimo recurso: buscar cualquier objeto con "term" en el arbol.
  let hallado = null
  const visitar = (n) => {
    if (hallado || !n || typeof n !== "object") return
    if (typeof n.term === "string") {
      hallado = n.term
      return
    }
    for (const v of Object.values(n)) visitar(v)
  }
  visitar(j)
  return hallado
}

function mostrar(texto, max = 1200) {
  if (!texto) return "(vacio)"
  return texto.length > max ? `${texto.slice(0, max)}\n… [+${texto.length - max} chars]` : texto
}

// ─────────────────────────── main ───────────────────────────
const fase = process.argv[2] ?? "catalogo"
const client = await conectar()
console.log(`conectado a ${URL_MCP}\nfase: ${fase}\n`)

try {
  if (fase === "catalogo") await faseCatalogo(client)
  else if (fase === "schemas") await faseSchemas(client)
  else if (fase === "descubrimiento") await faseDescubrimiento(client)
  else if (fase === "panorama") await fasePanorama(client)
  else if (fase === "determinismo") await faseDeterminismo(client)
  else if (fase === "preparar-noticias") await fasePrepararNoticias(client)
  else if (fase === "submit-noticias") await faseSubmitNoticias(client)
  else {
    console.log(`fase desconocida: ${fase}`)
  }
} finally {
  if (bitacora.length) resumen()
  await client.close()
}
