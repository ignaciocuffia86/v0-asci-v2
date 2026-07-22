import { NextRequest, NextResponse } from "next/server"
import { consumeUploadToken } from "@/lib/v3/services/mcp-document-ingestion"

export const runtime = "nodejs"

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 })
    return NextResponse.json(await consumeUploadToken(token, file))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo procesar el archivo" }, { status: 400 })
  }
}
