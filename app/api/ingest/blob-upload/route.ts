import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { type NextRequest, NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/auth/require-superadmin"

// This route handles the token generation for client-side Blob uploads.
// The actual file never passes through this serverless function -- it goes
// directly from the browser to Vercel Blob, bypassing the 4.5MB body limit.
export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Only superadmins may ingest into the shared global pool (A1 hardening):
        // this mints a Blob upload token, and the upload feeds public.contacts,
        // which is superadmin-write by RLS. Gate the token issuance to match.
        const auth = await requireSuperadmin()
        if ("error" in auth) {
          throw new Error(auth.error)
        }

        return {
          allowedContentTypes: ["text/csv", "application/vnd.ms-excel", "application/octet-stream"],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100MB max
          tokenPayload: JSON.stringify({ userId: auth.userId }),
        }
      },

    })

    return NextResponse.json(jsonResponse)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
