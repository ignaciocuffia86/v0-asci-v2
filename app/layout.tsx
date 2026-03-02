import type React from "react"
import type { Metadata, Viewport } from "next"
import "./globals.css"
import { Analytics } from "@vercel/analytics/react"
import { OnboardingProvider } from "@/components/onboarding/onboarding-provider"

import { Inter, Montserrat as V0_Font_Montserrat, Source_Serif_4 as V0_Font_Source_Serif_4 } from 'next/font/google'

// Initialize fonts
const _montserrat = V0_Font_Montserrat({ subsets: ['latin'], weight: ["100","200","300","400","500","600","700","800","900"] })
const _sourceSerif_4 = V0_Font_Source_Serif_4({ subsets: ['latin'], weight: ["200","300","400","500","600","700","800","900"] })

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
})

const SITE_URL = "https://asci.bigua.lat"
const SITE_TITLE = "ASCI | Inteligencia de Senales para Ventas B2B"
const SITE_DESCRIPTION =
  "Descubri senales de compra, encontra tomadores de decision y acelera tu pipeline B2B. La plataforma de inteligencia comercial para equipos de ventas en Latinoamerica. Alternativa a Apollo y ZoomInfo en espanol."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s | ASCI by Bigua",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "prospeccion B2B",
    "prospecting B2B latinoamerica",
    "inteligencia comercial",
    "senales de compra",
    "tomadores de decision",
    "enrichment de contactos",
    "enriquecimiento de datos",
    "stack tecnologico empresas",
    "tecnologias instaladas",
    "outreach B2B",
    "gestion de leads",
    "pipeline de ventas",
    "software comercial B2B",
    "herramienta de prospeccion",
    "alternativa Apollo espanol",
    "alternativa ZoomInfo latam",
    "sales intelligence",
    "plataforma de ventas B2B",
    "gestion de cuentas B2B",
    "signal-based selling",
  ],
  authors: [{ name: "Bigua", url: "https://bigua.lat" }],
  creator: "Bigua",
  publisher: "Bigua",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: "website",
    locale: "es_AR",
    url: SITE_URL,
    siteName: "ASCI by Bigua",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "ASCI - Inteligencia de Senales para Ventas B2B",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
  category: "technology",
}

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <OnboardingProvider>
          {children}
        </OnboardingProvider>
        <Analytics />
      </body>
    </html>
  )
}
