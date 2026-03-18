import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

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
        // Authenticate the user before allowing upload
        const supabase = await createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          throw new Error("No autenticado")
        }

        return {
          allowedContentTypes: ["text/csv", "application/vnd.ms-excel", "application/octet-stream"],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100MB max
          tokenPayload: JSON.stringify({ userId: user.id }),
        }
      },

    })

    return NextResponse.json(jsonResponse)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
