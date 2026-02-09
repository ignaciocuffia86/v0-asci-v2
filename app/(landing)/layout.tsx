import type React from "react"
import Script from "next/script"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "ASCI | Inteligencia de Senales para Ventas B2B - Prospeccion y Enrichment",
  description:
    "Descubri senales de compra, encontra tomadores de decision y acelera tu pipeline B2B. La plataforma de inteligencia comercial para equipos de ventas en Latinoamerica. Alternativa a Apollo y ZoomInfo en espanol.",
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
        "Plataforma de inteligencia de senales para ventas B2B. Detecta senales de compra, encuentra tomadores de decision y acelera tu pipeline comercial en Latinoamerica.",
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
        logo: "https://asci.bigua.lat/logo.jpg",
      },
      featureList: [
        "Deteccion de senales de compra",
        "Busqueda de tomadores de decision",
        "Enrichment de contactos B2B",
        "Monitoreo de stack tecnologico",
        "Pipeline de prospeccion Kanban",
        "Resumen de compania con IA",
        "Exportacion de contactos a CSV y Excel",
        "Integracion con Apollo.io",
      ],
      screenshot: "https://asci.bigua.lat/opengraph-image",
    },
    {
      "@type": "Organization",
      name: "Bigua",
      url: "https://bigua.lat",
      logo: "https://asci.bigua.lat/logo.jpg",
      description:
        "Growth y ventas B2B. Marketing, prospeccion y automatizacion para empresas en Latinoamerica.",
      sameAs: ["https://bigua.lat"],
    },
    {
      "@type": "WebSite",
      name: "ASCI by Bigua",
      url: "https://asci.bigua.lat",
      description:
        "Plataforma de inteligencia de senales para ventas B2B en Latinoamerica.",
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
      {children}
    </>
  )
}
