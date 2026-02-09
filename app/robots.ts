import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/dashboard/*",
          "/bookmarks",
          "/bookmarks/*",
          "/auth",
          "/auth/*",
          "/search",
          "/search/*",
          "/settings",
          "/settings/*",
          "/api",
          "/api/*",
          "/workspace",
          "/workspace/*",
        ],
      },
    ],
    sitemap: "https://asci.bigua.lat/sitemap.xml",
  }
}
