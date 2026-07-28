// Sonda temporal: valida empiricamente si el actor de Apify acepta `companyName`
// como filtro en origen. Se borra al terminar la verificacion.
const TOKEN = process.env.APIFY_TOKEN
const ACTOR = "bebity~linkedin-jobs-scraper"
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }

async function j(url, init) {
  const r = await fetch(url, init)
  const t = await r.text()
  try {
    return JSON.parse(t)
  } catch {
    return { __raw: t.slice(0, 500), __status: r.status }
  }
}

function report(label, items) {
  console.log(`\n=== ${label} ===`)
  if (!Array.isArray(items)) {
    console.log("no-array:", JSON.stringify(items).slice(0, 400))
    return
  }
  console.log("items:", items.length)
  if (!items.length) return
  const by = {}
  for (const i of items) {
    const k = i.companyName || "(sin nombre)"
    by[k] = (by[k] || 0) + 1
  }
  console.log("-- empresas devueltas --")
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(3)}  ${k}`)
  }
  const m = items.filter((i) => /arcor/i.test(i.companyName || ""))
  console.log(`pureza Arcor: ${m.length}/${items.length} = ${Math.round((m.length / items.length) * 100)}%`)
  const ej = m[0] || items[0]
  console.log("claves:", Object.keys(ej).join(", "))
  console.log(
    "ejemplo:",
    JSON.stringify(
      { title: ej.title, companyName: ej.companyName, companyUrl: ej.companyUrl, location: ej.location, publishedAt: ej.publishedAt },
      null,
      1
    )
  )
}

const runId = process.argv[2]
if (runId) {
  // Modo 1: inspeccionar los parciales de un run que ya ocurrio.
  const run = await j(`https://api.apify.com/v2/actor-runs/${runId}`, { headers: H })
  console.log("status:", run.data?.status, "| dur(s):", Math.round((run.data?.stats?.durationMillis || 0) / 1000))
  const items = await j(`https://api.apify.com/v2/datasets/${run.data?.defaultDatasetId}/items?limit=500`, { headers: H })
  report(`parciales de ${runId}`, items)
} else {
  // Modo 2: run nuevo y acotado. `rows` bajo para que no expire.
  const input = {
    companyName: ["Grupo Arcor", "Arcor"],
    location: "Argentina",
    proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    rows: 25,
  }
  console.log("input:", JSON.stringify(input))
  const items = await j(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?timeout=260`,
    { method: "POST", headers: H, body: JSON.stringify(input) }
  )
  report("companyName como filtro (rows=25)", items)
}
