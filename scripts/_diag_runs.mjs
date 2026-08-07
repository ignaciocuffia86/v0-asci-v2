import pg from "pg"
const { Client } = pg

let conn = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
conn = conn.replace(/([?&])sslmode=[^&]*/g, "$1").replace(/[?&]$/, "")
const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await client.connect()

console.log("=== ultimas filas de v3.tech_radar_runs ===")
const runs = await client.query(
  `select id, status, caller, company_name, web_searches, sources_count, findings_count, cost_usd, started_at, finished_at
   from v3.tech_radar_runs order by started_at desc limit 10`,
)
console.table(runs.rows)

console.log("=== conteo por status ===")
const byStatus = await client.query(`select status, count(*) from v3.tech_radar_runs group by status`)
console.table(byStatus.rows)

await client.end()
