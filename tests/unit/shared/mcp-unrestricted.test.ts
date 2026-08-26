import { afterEach, describe, expect, it } from "vitest"

import {
  SCOPES_BY_TYPE,
  UNRESTRICTED_SCOPE,
  effectiveApiKeyScopes,
  keyTypeFromScopes,
  scopesAreUnrestricted,
} from "@/lib/v3/mcp-key-scopes"
import { releaseQuotaBlocks, type ResearchQuotaItem } from "@/lib/v3/plans"
import { ADMIN_WORKSPACE_ENV_VAR, adminWorkspaceId, isAdminWorkspace, oauthUnrestricted } from "@/lib/v3/admin-workspace"

// ═══════════════════════════════════════════════════════════════════════════
// Fase A del perfil admin: quién queda sin topes y quién NO.
//
// Todo lo que se prueba acá es el lado de la DERIVACIÓN —de scopes guardados a
// "esta credencial no tiene topes"—, que es puro y no toca la base. Los cuatro
// guards que consultan el flag se prueban contra la base en los tests de
// integración; lo que no puede fallar en silencio es esto: que una credencial
// termine sin topes sin que nadie lo haya decidido.
// ═══════════════════════════════════════════════════════════════════════════

describe("el marcador de credencial sin topes", () => {
  it("solo la key admin lo lleva", () => {
    expect(SCOPES_BY_TYPE.admin.scopes).toContain(UNRESTRICTED_SCOPE)
    for (const type of ["standard", "explore", "profiles"] as const) {
      expect(SCOPES_BY_TYPE[type].scopes, `${type} no puede llevar el marcador`).not.toContain(UNRESTRICTED_SCOPE)
    }
  })

  it("admin se deriva ANTES que standard, aunque comparta todos sus scopes", () => {
    // Si se evaluara después, una key admin se leería como standard y el límite de
    // "una key activa por tipo y por usuario" dejaría emitir las dos.
    expect(keyTypeFromScopes(SCOPES_BY_TYPE.admin.scopes)).toBe("admin")
    expect(keyTypeFromScopes(SCOPES_BY_TYPE.standard.scopes)).toBe("standard")
  })

  it("admin alcanza todo lo que alcanza standard", () => {
    // El perfil no es "más tools", es "sin topes": si le faltara una tool de
    // standard, el informe on-demand se cortaría en el mismo lugar que hoy.
    for (const scope of SCOPES_BY_TYPE.standard.scopes) {
      expect(SCOPES_BY_TYPE.admin.scopes).toContain(scope)
    }
  })

  it("admin puede operar en los tres modos", () => {
    expect(SCOPES_BY_TYPE.admin.allowedModes).toEqual(["read", "server_managed", "client_assisted"])
  })
})

describe("scopesAreUnrestricted", () => {
  it("es false para los tres tipos que sí tienen topes", () => {
    for (const type of ["standard", "explore", "profiles"] as const) {
      expect(scopesAreUnrestricted(SCOPES_BY_TYPE[type].scopes)).toBe(false)
    }
    expect(scopesAreUnrestricted(SCOPES_BY_TYPE.admin.scopes)).toBe(true)
  })

  it("tolera null y vacío sin volverse permisivo", () => {
    expect(scopesAreUnrestricted(null)).toBe(false)
    expect(scopesAreUnrestricted([])).toBe(false)
  })

  it("una key LEGACY nunca queda sin topes", () => {
    // Las keys que guardaron los literales "read"/"write" se expanden por el
    // camino legacy. Ninguna expansión puede producir el marcador: si lo
    // produjera, credenciales viejas que nadie revisó pasarían a no tener cap.
    for (const legacy of [["read"], ["write"], ["read", "write"]]) {
      expect(scopesAreUnrestricted(effectiveApiKeyScopes(legacy))).toBe(false)
    }
  })

  it("expandir los scopes de standard tampoco lo produce", () => {
    expect(scopesAreUnrestricted(effectiveApiKeyScopes(SCOPES_BY_TYPE.standard.scopes))).toBe(false)
  })
})

// ── El lado de la cuota: se mide igual, deja de bloquear ────────────────────

const item = (over: Partial<ResearchQuotaItem>): ResearchQuotaItem => ({
  input: "Agrosuper",
  companyId: "c1",
  allowed: true,
  isRefresh: false,
  reason: null,
  nextAutoRefreshDate: null,
  ...over,
})

describe("releaseQuotaBlocks", () => {
  it("permite lo que estaba bloqueado y CONSERVA por qué lo estaba", () => {
    const [released] = releaseQuotaBlocks([
      item({ allowed: false, reason: "Alcanzaste el cupo de 240 investigaciones nuevas este mes" }),
    ])
    expect(released.allowed).toBe(true)
    expect(released.wouldBlockReason).toContain("cupo de 240")
  })

  it("vacía `reason` en lo que libera", () => {
    // Los callers muestran `reason` cuando allowed es false. Un item permitido que
    // arrastra un motivo de bloqueo se lee como un error que no ocurrió.
    const [released] = releaseQuotaBlocks([item({ allowed: false, reason: "sin cupo" })])
    expect(released.reason).toBeNull()
  })

  it("no toca lo que ya estaba permitido", () => {
    const original = item({ allowed: true })
    const [released] = releaseQuotaBlocks([original])
    expect(released).toBe(original)
    expect(released.wouldBlockReason).toBeUndefined()
  })

  it("conserva isRefresh y la fecha del próximo refresh", () => {
    // Son la medición, no el bloqueo: sin ellos no se puede decir cuánto cupo
    // habría consumido el informe, que es para lo que existe el perfil.
    const [released] = releaseQuotaBlocks([
      item({ allowed: false, isRefresh: true, reason: "está en seguimiento", nextAutoRefreshDate: "5 de septiembre" }),
    ])
    expect(released.isRefresh).toBe(true)
    expect(released.nextAutoRefreshDate).toBe("5 de septiembre")
  })
})

// ── El workspace admin: la excepción, y sus bordes ──────────────────────────

describe("isAdminWorkspace", () => {
  const original = process.env[ADMIN_WORKSPACE_ENV_VAR]
  afterEach(() => {
    if (original === undefined) delete process.env[ADMIN_WORKSPACE_ENV_VAR]
    else process.env[ADMIN_WORKSPACE_ENV_VAR] = original
  })

  it("sin la variable configurada NADIE es el workspace admin", () => {
    // Falla cerrado: un despliegue mal configurado se queda sin la función, no
    // la reparte. Si esto diera true, el cron dejaría de refrescar cuentas de
    // clientes reales.
    delete process.env[ADMIN_WORKSPACE_ENV_VAR]
    expect(adminWorkspaceId()).toBeNull()
    expect(isAdminWorkspace("c731ba5a-aeb1-4e36-8bd5-401135566ecd")).toBe(false)
  })

  it("un workspaceId vacío contra una variable vacía NO da true", () => {
    // El borde que convertiría a cualquier workspace en la excepción: dos
    // valores ausentes comparados con === son iguales.
    process.env[ADMIN_WORKSPACE_ENV_VAR] = ""
    expect(isAdminWorkspace("")).toBe(false)
    expect(isAdminWorkspace(null)).toBe(false)
    expect(isAdminWorkspace(undefined)).toBe(false)
  })

  it("solo el id exacto es la excepción", () => {
    process.env[ADMIN_WORKSPACE_ENV_VAR] = "ws-admin"
    expect(isAdminWorkspace("ws-admin")).toBe(true)
    expect(isAdminWorkspace("ws-admin-2")).toBe(false)
    expect(isAdminWorkspace("WS-ADMIN")).toBe(false)
  })

  it("tolera espacios alrededor del valor configurado", () => {
    process.env[ADMIN_WORKSPACE_ENV_VAR] = "  ws-admin  "
    expect(isAdminWorkspace("ws-admin")).toBe(true)
  })
})

describe("oauthUnrestricted", () => {
  const WS_ADMIN = "c731ba5a-aeb1-4e36-8bd5-401135566ecd"
  const original = process.env[ADMIN_WORKSPACE_ENV_VAR]

  afterEach(() => {
    if (original === undefined) delete process.env[ADMIN_WORKSPACE_ENV_VAR]
    else process.env[ADMIN_WORKSPACE_ENV_VAR] = original
  })

  // ═════════════════════════════════════════════════════════════════════════
  // Un token OAuth podía valer `unrestricted: false` y nada más, y eso dejaba el
  // perfil admin INALCANZABLE desde un conector de claude.ai —que se autentica
  // por OAuth y no tiene dónde pegar una API key—: conectaba y listaba cero
  // tools. Las dos llaves siguen siendo las mismas que exige emitir una key
  // admin, y ninguna sale del cliente.
  // ═════════════════════════════════════════════════════════════════════════

  it("superadmin EN el workspace admin queda sin topes", () => {
    process.env[ADMIN_WORKSPACE_ENV_VAR] = WS_ADMIN
    expect(oauthUnrestricted(WS_ADMIN, true)).toBe(true)
  })

  it("un superadmin en el workspace de un CLIENTE conserva los topes", () => {
    // La llave que protege al cliente: ser superadmin de ASCI no puede levantarle
    // los topes al workspace de otro, que es de quien paga esa cuenta.
    process.env[ADMIN_WORKSPACE_ENV_VAR] = WS_ADMIN
    expect(oauthUnrestricted("11111111-1111-1111-1111-111111111111", true)).toBe(false)
  })

  it("un usuario común del workspace admin NO queda sin topes", () => {
    // La otra llave: estar en el workspace correcto no alcanza sin el rol.
    process.env[ADMIN_WORKSPACE_ENV_VAR] = WS_ADMIN
    expect(oauthUnrestricted(WS_ADMIN, false)).toBe(false)
  })

  it("sin la variable configurada, NADIE queda sin topes", () => {
    // Falla cerrado: un despliegue mal configurado se queda sin la función, no
    // la reparte. Es el mismo criterio que el resto de este módulo.
    delete process.env[ADMIN_WORKSPACE_ENV_VAR]
    expect(oauthUnrestricted(WS_ADMIN, true)).toBe(false)
  })
})
