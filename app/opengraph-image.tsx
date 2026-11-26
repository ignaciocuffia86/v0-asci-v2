import { ImageResponse } from "next/og"

export const runtime = "edge"

export const alt = "ASCI - Inteligencia de Senales para Ventas B2B"
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = "image/png"

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background grid pattern */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(217,242,112,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(217,242,112,0.05) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* Sonar SVG */}
        <svg
          width="100"
          height="100"
          viewBox="0 0 120 120"
          fill="none"
          style={{ marginBottom: "24px" }}
        >
          <path
            d="M60 10 C87.6 10 110 32.4 110 60"
            stroke="#d9f270"
            strokeWidth="8"
            strokeLinecap="round"
            opacity="0.35"
          />
          <path
            d="M60 28 C77.7 28 92 42.3 92 60"
            stroke="#d9f270"
            strokeWidth="8"
            strokeLinecap="round"
            opacity="0.65"
          />
          <path
            d="M60 46 C67.7 46 74 52.3 74 60"
            stroke="#d9f270"
            strokeWidth="8"
            strokeLinecap="round"
            opacity="1"
          />
          <circle cx="60" cy="60" r="5" fill="#d9f270" />
          <path
            d="M60 110 C32.4 110 10 87.6 10 60"
            stroke="#d9f270"
            strokeWidth="8"
            strokeLinecap="round"
            opacity="0.35"
          />
          <path
            d="M60 92 C42.3 92 28 77.7 28 60"
            stroke="#d9f270"
            strokeWidth="8"
            strokeLinecap="round"
            opacity="0.65"
          />
          <path
            d="M60 74 C52.3 74 46 67.7 46 60"
            stroke="#d9f270"
            strokeWidth="8"
            strokeLinecap="round"
            opacity="1"
          />
        </svg>

        {/* Brand name */}
        <div
          style={{
            display: "flex",
            fontSize: "64px",
            fontWeight: 500,
            color: "#f5f5f0",
            letterSpacing: "-0.035em",
            marginBottom: "16px",
          }}
        >
          ASCI
        </div>

        {/* Tagline */}
        <div
          style={{
            display: "flex",
            fontSize: "26px",
            fontWeight: 400,
            color: "#a3a3a3",
            textAlign: "center",
            maxWidth: "700px",
            lineHeight: 1.4,
          }}
        >
          Inteligencia de señales para ventas B2B
        </div>

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: "28px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "#737373",
            fontSize: "16px",
          }}
        >
          by Biguá · bigua.lat
        </div>
      </div>
    ),
    {
      ...size,
    },
  )
}
