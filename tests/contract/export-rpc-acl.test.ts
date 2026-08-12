/**
 * Contract test de regresión para OPT-03: ninguna de las RPC de export del
 * schema `public` (SECURITY DEFINER) debe ser ejecutable por el rol `anon`.
 *
 * `has_function_privilege('anon', oid, 'EXECUTE')` cubre tanto un GRANT directo
 * a anon como el grant por defecto a PUBLIC, así que este test falla si
 * cualquiera de las dos vías reaparece.
 *
 * Pega a la base real, por eso está gateado. Para correrlo:
 *
 *   RUN_ACL_CONTRACT_TESTS=1 npx vitest run tests/contract/export-rpc-acl.test.ts
 */

import { describe, expect, it } from "vitest"
import { conConexionDirecta } from "@/lib/db/direct"

const RUN = process.env.RUN_ACL_CONTRACT_TESTS === "1"
const hasEnv = !!process.env.POSTGRES_URL_NON_POOLING
const runIf = RUN && hasEnv ? describe : describe.skip

const EXPORT_FUNCTIONS = [
  "export_contacts",
  "export_companies",
  "export_companies_countries",
  "export_companies_industries",
  "export_companies_with_signals",
  "get_companies_for_export",
  "get_export_stats",
  "get_available_countries_for_export",
  "get_bookmark_export_data",
]

runIf("ACL de las RPC de export (OPT-03)", () => {
  it("ninguna función de export en public es ejecutable por anon", async () => {
    const rows = await conConexionDirecta(async (client) => {
      const res = await client.query<{ sig: string; anon_exec: boolean }>(
        `select p.oid::regprocedure::text as sig,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = any($1::text[])`,
        [EXPORT_FUNCTIONS],
      )
      return res.rows
    })

    // Si no encontró ninguna, el nombre cambió o la base está vacía: avisar en
    // vez de pasar en verde por vacío.
    expect(rows.length).toBeGreaterThan(0)

    const leaky = rows.filter((r) => r.anon_exec).map((r) => r.sig)
    expect(leaky).toEqual([])
  })
})
