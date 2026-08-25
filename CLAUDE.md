# CLAUDE.md

## Cómo se contribuye

**Todo va por pull request.** `main` tiene tres checks obligatorios —`Unit tests`,
`Typecheck` y `Lint` (`.github/workflows/ci.yml`)— y el PR es lo que los hace correr
*antes* del merge. Un push directo a `main` puede pasar igual si la credencial tiene
bypass, pero entonces los checks corren **después**, cuando ya está adentro: eso
convierte el gate en un aviso.

    git checkout -b claude/<tema>
    # ... trabajo, y antes de pushear:
    pnpm typecheck && pnpm lint && pnpm test
    git push -u origin claude/<tema>
    # y abrir el PR contra main

Antes de pushear conviene correr los tres localmente: son los mismos que corre CI y
tardan segundos.

## Comandos

| | |
|---|---|
| `pnpm test` | Suite unitaria (Vitest). **No** corre `tests/contract/**`: esos pegan contra Apollo y Supabase reales, y algunos cuestan plata |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint 9 (flat config). Los *warnings* son deuda preexistente; los errores tienen que ser 0 |

Los tests de contrato se habilitan con su flag: `pnpm test:contract` (`RUN_APOLLO_CONTRACT_TESTS=1`).

## Migraciones

Van en `supabase/migrations/` y **el nombre del archivo tiene que coincidir con la
versión registrada en la base**. Aplicarlas es una decisión del dueño del proyecto:
no se aplican contra producción sin pedirlo.

Una lección que costó cara y conviene no repetir: **validar una migración contra
datos sintéticos no alcanza.** Una RPC de matching de empresas pasó todas las
pruebas locales sobre 300.000 filas generadas y, contra las 514.269 reales, tenía
cuatro defectos —dos de correctitud y uno de performance 4x peor que lo medido—.
Los nombres sintéticos parecían el peor caso y producían menos trabajo que los
reales. Si una migración toca matching, conteos o performance, hay que probarla
contra el catálogo real antes de darla por buena.

## Dónde está la documentación viva

- `docs/mcp-inventario-y-perfiles.md` — las 50 tools de los tres MCP, qué hace y qué
  **no** permite cada una, los solapamientos y el diseño de los perfiles admin y
  standard. Es el punto de entrada para tocar cualquier cosa del MCP.
- `docs/plan-mcp-ejecucion-directa.md` — el plan por fases y qué quedó hecho.
- `docs/architecture-map.html` — mapa general del proyecto.
