import next from "eslint-config-next"

// ESLint 9 flat config. eslint-config-next 16 ships a native flat config array
// (Next core-web-vitals + TypeScript + React + a11y + import rules).
//
// Philosophy (per docs/ARCHITECTURE-RECOMMENDATIONS.md P1): turn the lint gate
// ON now with zero errors, then tighten progressively. The React-Compiler rule
// family that eslint-config-next 16 ships as *errors* (set-state-in-effect,
// immutability, purity, …) flags large amounts of working, shipped code and
// would need careful per-component refactors. Those are demoted to warnings so
// they stay visible as debt without blocking the gate; genuine Next/React
// correctness rules stay as errors. Promote a rule back to "error" once its
// warnings are worked down.
const eslintConfig = [
  {
    // Never lint generated output, vendored assets, or the SQL/ops scripts.
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "next-env.d.ts",
      "scripts/**",
      "supabase/**",
    ],
  },
  ...next,
  {
    rules: {
      // React-Compiler rule family (eslint-plugin-react-hooks v6) — pre-existing
      // debt, demoted to warnings. Track and pay down, then re-promote.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",
      // Cosmetic: unescaped ' / " in JSX text (mostly Spanish copy). Non-blocking.
      "react/no-unescaped-entities": "warn",
    },
  },
]

export default eslintConfig
