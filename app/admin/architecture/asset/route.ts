import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

// ═══════════════════════════════════════════════════════════
// Sirve docs/architecture-map.{html,json} SOLO a super-admins.
//
// Importante: un route handler NO hereda app/admin/layout.tsx, así que el
// guard se revalida acá. Si esto se relajara, el mapa (que documenta fallas
// de seguridad reales) quedaría accesible a cualquier usuario autenticado.
// ═══════════════════════════════════════════════════════════

// Whitelist explícita: nunca se construye el path con input del usuario,
// así no hay superficie de path traversal.
const ARCHIVOS = {
  html: { ruta: "docs/architecture-map.html", tipo: "text/html; charset=utf-8", nombre: "architecture-map.html" },
  json: { ruta: "docs/architecture-map.json", tipo: "application/json; charset=utf-8", nombre: "architecture-map.json" },
} as const

type Clave = keyof typeof ARCHIVOS

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response("No autenticado", { status: 401 })
  }

  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single()

  if (perfil?.role !== "superadmin") {
    // 404 en lugar de 403: no confirmamos que el recurso exista.
    return new Response("No encontrado", { status: 404 })
  }

  const pedido = request.nextUrl.searchParams.get("file")
  const clave: Clave = pedido === "json" ? "json" : "html"
  const archivo = ARCHIVOS[clave]
  const descargar = request.nextUrl.searchParams.get("download") === "1"

  let contenido: string
  try {
    contenido = await readFile(join(process.cwd(), archivo.ruta), "utf8")
  } catch {
    return new Response(
      `No se encontró ${archivo.ruta}. Corré: node scripts/build-architecture-map.mjs`,
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    )
  }

  return new Response(contenido, {
    headers: {
      "Content-Type": archivo.tipo,
      "Content-Disposition": `${descargar ? "attachment" : "inline"}; filename="${archivo.nombre}"`,
      // Contenido sensible: que no quede en caches intermedias ni en el CDN.
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      // El mapa se embebe en /admin/architecture, así que solo mismo origen.
      "X-Frame-Options": "SAMEORIGIN",
    },
  })
}
