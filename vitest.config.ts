import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

// Los tests de contrato pegan contra servicios reales (y algunos cuestan plata),
// asi que no corren en `npm test`. Pero el exclude es mas fuerte que el filtro de
// la CLI: con `exclude: ["tests/contract/**"]` fijo, `npm run test:contract`
// (`vitest run tests/contract`) respondia "No test files found" y salia con
// codigo 1 SIN correr nada. O sea que el script existia pero nunca ejecuto un
// test: falsa confianza. Se excluyen solo cuando NO se pidieron explicitamente.
const CONTRACT_FLAGS = ["RUN_APOLLO_CONTRACT_TESTS", "RUN_DEDUPE_AI_CONTRACT_TESTS"]
const runContract = CONTRACT_FLAGS.some((f) => process.env[f] === "1")

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.ts"],
    exclude: [...(runContract ? [] : ["tests/contract/**"]), "node_modules/**"],
    setupFiles: ["tests/setup.ts"],
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
