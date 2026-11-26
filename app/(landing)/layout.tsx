import type React from "react"
import Script from "next/script"
import type { Metadata } from "next"
import { Inter, Inter_Tight } from "next/font/google"

// Tipografía de la landing: una sans para el texto y una sola familia para
// todos los títulos. Se cargan acá (y no en el root) para no tocar la app.
const textFont = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-landing-text",
  display: "swap",
})
const displayFont = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-landing-display",
  display: "swap",
})

export const metadata: Metadata = {
  title: "ASCI | Señales de compra B2B para Claude y ChatGPT",
  description:
    "ASCI es un servidor MCP que conecta tu asistente de IA a 669 mil perfiles profesionales y 275 mil avisos de empleo, con foco en Latinoamérica. Preguntá qué empresas usan una tecnología, quién la usa y a quién llamar, con la evidencia de cada señal.",
}

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "ASCI",
      url: "https://asci.bigua.lat",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Servidor MCP de señales de compra B2B para Latinoamérica. Conecta Claude, ChatGPT o cualquier cliente MCP a perfiles profesionales y avisos de empleo, para prospectar por tecnología con la evidencia de cada señal.",
      offers: {
        "@type": "Offer",
        category: "Software as a Service",
        priceCurrency: "USD",
        availability: "https://schema.org/OnlineOnly",
      },
      provider: {
        "@type": "Organization",
        name: "Bigua",
        url: "https://bigua.lat",
        logo: "https://asci.bigua.lat/brand/bigua-isologo-dark.png",
      },
      featureList: [
        "Servidor MCP para Claude, ChatGPT y otros clientes compatibles",
        "Prospección de cuentas por tecnología, país e industria",
        "Evidencia citada de cada señal: persona o aviso, fecha y link",
        "Avisos de empleo recientes como señal de compra",
        "Presencia tecnológica sobre un listado de cuentas propio",
        "Tomadores de decisión y revelado de contactos con Apollo.io",
        "Radar de rotación: quién entró y quién salió de una cuenta",
        "Búsqueda de personas por tecnología y por concepto",
      ],
      screenshot: "https://asci.bigua.lat/opengraph-image",
    },
    {
      "@type": "Organization",
      name: "Bigua",
      url: "https://bigua.lat",
      logo: "https://asci.bigua.lat/brand/bigua-isologo-dark.png",
      description:
        "Growth y ventas B2B. Marketing, prospeccion y automatizacion para empresas en Latinoamerica.",
      sameAs: ["https://bigua.lat"],
    },
    {
      "@type": "WebSite",
      name: "ASCI by Bigua",
      url: "https://asci.bigua.lat",
      description:
        "Señales de compra B2B para Latinoamérica, dentro de Claude y ChatGPT vía MCP.",
      inLanguage: "es",
      publisher: {
        "@type": "Organization",
        name: "Bigua",
      },
      potentialAction: {
        "@type": "SearchAction",
        target: "https://asci.bigua.lat/search?q={search_term_string}",
        "query-input": "required name=search_term_string",
      },
    },
  ],
}

export default function LandingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Script
        id="json-ld-structured-data"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        strategy="afterInteractive"
      />
      <div
        className={`${textFont.variable} ${displayFont.variable}`}
        style={{ fontFamily: "var(--font-landing-text), ui-sans-serif, system-ui, sans-serif" }}
      >
        {children}
      </div>
    </>
  )
}
