import { NextRequest, NextResponse } from "next/server"
import { lookup } from "node:dns/promises"
import net from "node:net"

// SSRF-hardened image proxy (OPT-04).
// The url is client-controlled, so every fetch target is constrained:
//   - https only
//   - exact-match host allowlist (no substring bypass like the old .includes())
//   - the resolved IP must be public (blocks DNS-rebinding to private ranges)
//   - redirects are refused (a redirect could jump to a non-allowlisted host)
//   - response must be an image and under a size cap, with a request timeout

export const runtime = "nodejs" // node:dns / node:net
export const dynamic = "force-dynamic"

const ALLOWED_HOSTS = new Set([
  "salesql.s3.eu-central-1.amazonaws.com",
  "d2ojpxxtu63wzl.cloudfront.net",
  "media.licdn.com",
  "static.licdn.com",
])

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB
const FETCH_TIMEOUT_MS = 8000

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }
  const lower = ip.toLowerCase()
  if (lower === "::" || lower === "::1") return true // unspecified / loopback
  if (lower.startsWith("fe80")) return true // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true // unique-local
  // IPv4-mapped IPv6 (::ffff:a.b.c.d)
  const mapped = lower.split(":").pop() || ""
  if (mapped.includes(".") && net.isIPv4(mapped)) return isPrivateIp(mapped)
  return false
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url")
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 })
  }

  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Only https is allowed" }, { status: 400 })
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: "Domain not allowed" }, { status: 403 })
  }

  // Reject hosts that resolve to a non-public address (SSRF via DNS rebinding).
  try {
    const { address } = await lookup(parsed.hostname)
    if (isPrivateIp(address)) {
      return NextResponse.json({ error: "Resolved to a non-public address" }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: "DNS resolution failed" }, { status: 502 })
  }

  try {
    const response = await fetch(parsed.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      return new NextResponse(null, { status: response.status })
    }

    const contentType = response.headers.get("content-type") || ""
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Not an image" }, { status: 415 })
    }

    const declaredLength = Number(response.headers.get("content-length") || 0)
    if (declaredLength && declaredLength > MAX_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 })
    }

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 })
    }

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
