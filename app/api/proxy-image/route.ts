import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url")
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 })
  }

  try {
    // Only allow image URLs from known sources
    const allowedDomains = [
      "salesql.s3.eu-central-1.amazonaws.com",
      "d2ojpxxtu63wzl.cloudfront.net",
      "media.licdn.com",
      "static.licdn.com",
    ]
    const parsed = new URL(url)
    if (!allowedDomains.some((d) => parsed.hostname.includes(d))) {
      return NextResponse.json({ error: "Domain not allowed" }, { status: 403 })
    }

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    })

    if (!response.ok) {
      return new NextResponse(null, { status: response.status })
    }

    const contentType = response.headers.get("content-type") || "image/png"
    const buffer = await response.arrayBuffer()

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "Access-Control-Allow-Origin": "*",
      },
    })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
