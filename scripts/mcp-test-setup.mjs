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

// pg lee `sslmode=require` de la URL como 'verify-full' e ignora el objeto `ssl`
// de abajo, con lo que el cert self-signed de Supabase hace fallar el handshake.
// Hay que sacar el parametro de la URL, igual que run-sql.mjs.
function sinSslMode(url) {
  try {
    const u = new URL(url)
    u.searchParams.delete("sslmode")
    return u.toString()
  } catch {
    return url.replace(/[?&]sslmode=[^&]*/g, "")
  }
}

const client = new Client({
  connectionString: sinSslMode(process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL),
  ssl: { rejectUnauthorized: false },
})
await client.connect()

/** Genera una key con el formato que espera mcp-auth: asci_ + random. */
function nuevaKey() {
  const raw = `asci_${crypto.randomBytes(24).toString("hex")}`
  return { raw, hash: crypto.createHash("sha256").update(raw).digest("hex"), prefix: raw.slice(0, 12) }
}

async function crearKey(workspaceId, nombre) {
  const { raw, hash, prefix } = nuevaKey()
  // En vez de listar columnas NOT NULL una por una (created_by, owner_user_id, …),
  // se CLONA una key real existente y se sobreescribe solo lo propio de la nueva.
  // Asi el test hereda scopes, modos y cualquier columna obligatoria que el esquema
  // agregue en el futuro, sin tener que perseguir el error 23502 columna por columna.
  const { rows } = await client.query(
    `SELECT * FROM v3.mcp_api_keys WHERE revoked_at IS NULL ORDER BY created_at LIMIT 1`,
  )
  if (!rows.length) throw new Error("No hay una key real de la cual clonar el esquema.")
  const plantilla = rows[0]

  // Columnas que NO se copian: se generan nuevas o se sobreescriben.
  const overrides = {
    id: undefined, // que lo genere el default
    workspace_id: workspaceId,
    name: nombre,
    key_hash: hash,
    key_prefix: prefix,
    created_at: undefined,
    revoked_at: null,
    last_used_at: null,
  }
  // Columnas a insertar = las de la plantilla menos las autogeneradas.
  const finales = Object.keys(plantilla).filter((c) => !["id", "created_at"].includes(c))
  const valores = finales.map((c) => (c in overrides ? overrides[c] : plantilla[c]))
  await client.query(
    `INSERT INTO v3.mcp_api_keys (${finales.join(",")}) VALUES (${finales.map((_, i) => `$${i + 1}`).join(",")})`,
    valores,
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
const sufijo = Date.now()
const valores = { name: `${MARCA} workspace B`, plan: base.plan }
// Se completan todas las obligatorias sin default a partir de la plantilla o de un
// valor de prueba unico, para no depender de saber el esquema de memoria.
if (obligatorias.includes("slug")) valores.slug = `test-v0-harness-b-${sufijo}`
if (obligatorias.includes("domain")) valores.domain = `test-v0-harness-b-${sufijo}.invalid`
if (obligatorias.includes("owner_user_id")) valores.owner_user_id = base.owner_user_id
if (obligatorias.includes("created_by")) valores.created_by = base.created_by

const claves = Object.keys(valores)
const { rows: creado } = await client.query(
  `INSERT INTO v3.workspaces (${claves.join(",")}) VALUES (${claves.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id, name, plan`,
  claves.map((k) => valores[k]),
)
const wsB = creado[0]
console.log(`[v0] workspace B creado: ${wsB.id} (plan ${wsB.plan})`)

// validateMcpRequest exige una fila ACTIVA en workspace_members para el par
// (workspace_id, owner_user_id) de la key; si falta, la auth corta antes de mirar
// scopes y mcp-handler responde un generico "No authorization provided" que no dice
// nada del motivo real. Sin este miembro, la key del workspace B daba 401.
const keyB = await crearKey(wsB.id, `${MARCA} MCP UX B`)

// validateMcpRequest exige una fila ACTIVA en workspace_members para el par
// (workspace_id, owner_user_id) DE LA KEY; si falta, la auth corta antes de mirar
// scopes y mcp-handler responde un generico "No authorization provided" que no dice
// nada del motivo real. El user sale de la key (v3.workspaces no tiene owner_user_id).
await client.query(
  `INSERT INTO v3.workspace_members (workspace_id, user_id, role, status)
   SELECT k.workspace_id, k.owner_user_id, 'admin', 'active'
   FROM v3.mcp_api_keys k
   WHERE k.workspace_id = $1 AND k.revoked_at IS NULL
   ON CONFLICT DO NOTHING`,
  [wsB.id],
)
console.log(`[v0] miembro activo agregado al workspace B`)

fs.writeFileSync("/tmp/asci-test-key-b", keyB, { mode: 0o600 })
console.log(`[v0] key B lista (prefijo ${keyB.slice(0, 12)}…)`)
console.log(`\n[v0] WS_B=${wsB.id}`)

await client.end()
