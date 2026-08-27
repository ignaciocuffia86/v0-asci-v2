import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

// Los tests de contrato pegan contra servicios reales (y algunos cuestan plata),
// asi que no corren en `npm test`. Pero el exclude es mas fuerte que el filtro de
// la CLI: con `exclude: ["tests/contract/**"]` fijo, `npm run test:contract`
// (`vitest run tests/contract`) respondia "No test files found" y salia con
// codigo 1 SIN correr nada. O sea que el script existia pero nunca ejecuto un
// test: falsa confianza. Se excluyen solo cuando NO se pidieron explicitamente.
// Cada test de contrato nuevo tiene que sumar SU flag acá. Omitirlo no rompe
// nada de forma visible: el archivo simplemente no se encuentra y vitest sale
// diciendo "No test files found" — el mismo modo de falla que este bloque venía
// a resolver. Pasó con RUN_SCREEN_CONTRACT_TESTS, que se usó en dos tests y no
// estaba en la lista: los dos parecían correr y nunca corrieron.
const CONTRACT_FLAGS = ["RUN_APOLLO_CONTRACT_TESTS", "RUN_DEDUPE_AI_CONTRACT_TESTS", "RUN_TECH_RADAR_CONTRACT_TESTS", "RUN_PUBLIC_DOCS_COMPARE", "RUN_SCREEN_CONTRACT_TESTS"]
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
      // `server-only` es un marcador: su entrada por defecto tira si no la
      // resuelve la condicion "react-server", que vitest no aplica. El paquete
      // trae `empty.js` justo para eso, asi que se apunta ahi. Sin este alias
      // cualquier modulo de servidor (lib/shared/evidence.ts, lib/tech-radar.ts)
      // es intesteable.
      "server-only": resolve(__dirname, "./node_modules/server-only/empty.js"),
    },
  },
})
