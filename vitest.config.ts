import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.ts"],
    exclude: ["tests/contract/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["lib/apollo/**/*.ts", "app/actions/apollo.ts", "app/api/webhooks/apollo/**/*.ts"],
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./"),
    },
  },
})
