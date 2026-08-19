import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { type NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/auth/require-superadmin"

// Token minting para el upload directo browser → Vercel Blob del import de
// cuentas (mismo patrón que /api/ingest/blob-upload: el archivo nunca pasa por
// esta función, así que no aplica el límite de 4.5MB del body serverless).
//
// A diferencia del ingest de v2 (cualquier usuario autenticado), acá el upload
// es parte del wizard de /v3/admin: solo superadmin. Cuando la Fase 2 habilite
// a admins de workspace, este guard se amplía junto con el de las actions.
export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const guard = await requireSuperadmin()
        if ("error" in guard) throw new Error(guard.error)

        return {
          allowedContentTypes: [
            "text/csv",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/octet-stream",
          ],
          // 500 filas de nombres + URLs entran holgadas en 10MB; un archivo más
          // grande es señal de que no es el template.
          maximumSizeInBytes: 10 * 1024 * 1024,
          tokenPayload: JSON.stringify({ userId: guard.userId }),
        }
      },
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de upload"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
