/**
 * Prepara (y limpia) las credenciales para correr el harness de UX del MCP.
 *
 * Crea dos cosas:
 *   - una API key para el workspace real (Bigua), para las fases normales
 *   - un workspace B de prueba + su key, para verificar que los uploads globales
 *     (noticias, tech radar, casos de exito) se ven desde OTRO tenant
 *
 * Todo lo que crea queda marcado con el prefijo [TEST v0] para poder borrarlo sin
 * ambiguedad. `--cleanup` revoca las keys y borra el workspace B.
 *
 * Uso:
 *   node scripts/mcp-test-setup.mjs            # crea y escribe las keys en /tmp
 *   node scripts/mcp-test-setup.mjs --cleanup  # revoca y borra lo de prueba
 *
 * Las keys se escriben en /tmp/asci-test-key (workspace A) y /tmp/asci-test-key-b
 * (workspace B). Nunca se imprimen enteras ni se commitean.
 */

import crypto from "crypto"
import fs from "fs"
import { Client } from "pg"

const MARCA = "[TEST v0] harness"
const WS_A = "c731ba5a-aeb1-4e36-8bd5-401135566ecd" // Bigua (real)
const cleanup = process.argv.includes("--cleanup")

const client = new Client({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

/** Genera una key con el formato que espera mcp-auth: asci_ + random. */
function nuevaKey() {
  const raw = `asci_${crypto.randomBytes(24).toString("hex")}`
  return { raw, hash: crypto.createHash("sha256").update(raw).digest("hex"), prefix: raw.slice(0, 12) }
}

async function crearKey(workspaceId, nombre) {
  const { raw, hash, prefix } = nuevaKey()
  // Se copian scopes y modos de la key real de Claude para que el test corra con
  // los mismos permisos que el cliente de verdad, no con permisos inventados.
  await client.query(
    `INSERT INTO v3.mcp_api_keys (workspace_id, name, key_hash, key_prefix, scopes, allowed_modes)
     SELECT $1, $2, $3, $4,
            coalesce((SELECT scopes FROM v3.mcp_api_keys WHERE name='Claude' AND revoked_at IS NULL LIMIT 1), scopes),
            coalesce((SELECT allowed_modes FROM v3.mcp_api_keys WHERE name='Claude' AND revoked_at IS NULL LIMIT 1), allowed_modes)
     FROM v3.mcp_api_keys LIMIT 1`,
    [workspaceId, nombre, hash, prefix],
  )
  return raw
}

if (cleanup) {
  const { rowCount: revocadas } = await client.query(
    `UPDATE v3.mcp_api_keys SET revoked_at = now() WHERE name LIKE $1 AND revoked_at IS NULL`,
    [`${MARCA}%`],
  )
  // El workspace B se borra completo; sus FKs son ON DELETE CASCADE dentro de v3.
  const { rows: wsB } = await client.query(`SELECT id, name FROM v3.workspaces WHERE name LIKE $1`, [`${MARCA}%`])
  for (const ws of wsB) {
    await client.query(`DELETE FROM v3.workspaces WHERE id = $1`, [ws.id])
    console.log(`[v0] workspace borrado: ${ws.name} (${ws.id})`)
  }
  console.log(`[v0] keys revocadas: ${revocadas}`)
  for (const f of ["/tmp/asci-test-key", "/tmp/asci-test-key-b"]) {
    if (fs.existsSync(f)) fs.unlinkSync(f)
  }
  console.log("[v0] limpieza lista.")
  await client.end()
  process.exit(0)
}

// ── Workspace A: la key para el workspace real ──
const keyA = await crearKey(WS_A, `${MARCA} MCP UX A`)
fs.writeFileSync("/tmp/asci-test-key", keyA, { mode: 0o600 })
console.log(`[v0] key A lista para Bigua (prefijo ${keyA.slice(0, 12)}…)`)

// ── Workspace B: tenant separado para la prueba cross-tenant ──
const cols = await client.query(
  `SELECT column_name, is_nullable, column_default FROM information_schema.columns
   WHERE table_schema='v3' AND table_name='workspaces' ORDER BY ordinal_position`,
)
// Se insertan solo las columnas obligatorias sin default, para no depender de un
// esquema que puede cambiar.
const obligatorias = cols.rows.filter((c) => c.is_nullable === "NO" && !c.column_default).map((c) => c.column_name)
console.log(`[v0] columnas obligatorias de v3.workspaces: ${obligatorias.join(", ") || "(ninguna)"}`)

const { rows: plantilla } = await client.query(`SELECT * FROM v3.workspaces WHERE id = $1`, [WS_A])
const base = plantilla[0]
const valores = { name: `${MARCA} workspace B`, plan: base.plan }
if (obligatorias.includes("slug")) valores.slug = `test-v0-harness-b-${Date.now()}`
if (obligatorias.includes("owner_user_id")) valores.owner_user_id = base.owner_user_id
if (obligatorias.includes("created_by")) valores.created_by = base.created_by

const claves = Object.keys(valores)
const { rows: creado } = await client.query(
  `INSERT INTO v3.workspaces (${claves.join(",")}) VALUES (${claves.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id, name, plan`,
  claves.map((k) => valores[k]),
)
const wsB = creado[0]
console.log(`[v0] workspace B creado: ${wsB.id} (plan ${wsB.plan})`)

const keyB = await crearKey(wsB.id, `${MARCA} MCP UX B`)
fs.writeFileSync("/tmp/asci-test-key-b", keyB, { mode: 0o600 })
console.log(`[v0] key B lista (prefijo ${keyB.slice(0, 12)}…)`)
console.log(`\n[v0] WS_B=${wsB.id}`)

await client.end()
