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
          backgroundColor: "#0a0f1c",
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
              "linear-gradient(rgba(59,130,246,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.06) 1px, transparent 1px)",
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
            stroke="#3B82F6"
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0.25"
          />
          <path
            d="M60 28 C77.7 28 92 42.3 92 60"
            stroke="#3B82F6"
            strokeWidth="4.5"
            strokeLinecap="round"
            opacity="0.5"
          />
          <path
            d="M60 46 C67.7 46 74 52.3 74 60"
            stroke="#3B82F6"
            strokeWidth="5"
            strokeLinecap="round"
            opacity="0.8"
          />
          <circle cx="60" cy="60" r="5" fill="#3B82F6" />
          <path
            d="M60 110 C32.4 110 10 87.6 10 60"
            stroke="#3B82F6"
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0.25"
          />
          <path
            d="M60 92 C42.3 92 28 77.7 28 60"
            stroke="#3B82F6"
            strokeWidth="4.5"
            strokeLinecap="round"
            opacity="0.5"
          />
          <path
            d="M60 74 C52.3 74 46 67.7 46 60"
            stroke="#3B82F6"
            strokeWidth="5"
            strokeLinecap="round"
            opacity="0.8"
          />
        </svg>

        {/* Brand name */}
        <div
          style={{
            display: "flex",
            fontSize: "64px",
            fontWeight: 800,
            color: "#f8fafc",
            letterSpacing: "-0.02em",
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
            fontWeight: 500,
            color: "#94a3b8",
            textAlign: "center",
            maxWidth: "700px",
            lineHeight: 1.4,
          }}
        >
          Inteligencia de Senales para Ventas B2B
        </div>

        {/* Keywords bar */}
        <div
          style={{
            display: "flex",
            gap: "12px",
            marginTop: "32px",
            flexWrap: "wrap",
            justifyContent: "center",
            maxWidth: "900px",
          }}
        >
          {["Prospeccion", "Enrichment", "Decision Makers", "Senales de Compra", "Pipeline B2B"].map(
            (keyword) => (
              <div
                key={keyword}
                style={{
                  padding: "8px 20px",
                  backgroundColor: "rgba(59,130,246,0.1)",
                  border: "1px solid rgba(59,130,246,0.2)",
                  borderRadius: "99px",
                  color: "#60A5FA",
                  fontSize: "16px",
                  fontWeight: 500,
                }}
              >
                {keyword}
              </div>
            ),
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: "28px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "#475569",
            fontSize: "16px",
          }}
        >
          by Bigua — bigua.lat
        </div>
      </div>
    ),
    {
      ...size,
    },
  )
}
