/**
 * Sonda de un solo uso: corre el actor de vacantes con un tope mínimo y reporta
 * SOLO los nombres de campo del primer item. Sirve para verificar que el preview
 * de la ingesta lea claves que existen de verdad. No escribe nada en la base.
 */
const token = process.env.APIFY_TOKEN
if (!token) {
  console.error("Falta APIFY_TOKEN")
  process.exit(1)
}
const actor = (process.env.APIFY_ACTOR_ID || "bebity/linkedin-jobs-scraper").replace("/", "~")

// Se pasa `title` porque el actor busca por TÍTULO de puesto: con solo
// companyName devolvió 0 items. Acá el objetivo es ver la FORMA de los datos.
const input = {
  title: process.env.PROBE_TITLE || "Analista",
  location: "Argentina",
  publishedAt: "r2592000",
  rows: 5,
  proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
}

const start = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?timeout=180`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(input),
})
if (!start.ok) {
  console.error("start fallo:", start.status, (await start.text()).slice(0, 300))
  process.exit(1)
}
const { data } = await start.json()
console.log("[v0] runId:", data.id, "status:", data.status)

let status = data.status
for (let i = 0; i < 40 && !["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status); i++) {
  await new Promise((r) => setTimeout(r, 5000))
  const poll = await fetch(`https://api.apify.com/v2/actor-runs/${data.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  status = (await poll.json()).data.status
  process.stdout.write(`  ${status}\r`)
}
console.log("\n[v0] status final:", status)

const ds = await fetch(`https://api.apify.com/v2/datasets/${data.defaultDatasetId}/items?limit=5`, {
  headers: { Authorization: `Bearer ${token}` },
})
const items = await ds.json()
console.log("[v0] items:", items.length)
if (!items.length) process.exit(0)

console.log("\n[v0] CLAVES del primer item:")
console.log("  " + Object.keys(items[0]).sort().join(", "))

// Se verifica exactamente lo que lee toPreviewItem, sin imprimir el contenido completo.
const pick = (item, keys) => {
  for (const k of keys) if (typeof item[k] === "string" && item[k].trim()) return k
  return null
}
console.log("\n[v0] que clave gana en cada campo del preview:")
for (const item of items.slice(0, 3)) {
  console.log(
    `  title=${pick(item, ["title", "job_title"])}` +
      `  location=${pick(item, ["location"])}` +
      `  postedAt=${pick(item, ["postedTime", "publishedAt", "post_date"])}` +
      `  url=${pick(item, ["job_url", "applyUrl", "apply_url", "apply_link", "jobUrl", "url", "uniq_id"])}` +
      `  companyName=${pick(item, ["companyName"])}  companyUrl=${pick(item, ["companyUrl"])}`,
  )
}
