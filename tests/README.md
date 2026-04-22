# Tests

Test suite para la integracion con Apollo.

## Correr

```bash
# Unit + integration (default, no pega a Apollo)
npm test

# Watch mode
npm run test:watch

# Contract tests (pega a Apollo real, necesita APOLLO_API_KEY)
npm run test:contract
```

## Estructura

```
tests/
  unit/apollo/           # helpers puros (domain, hash, parsers, validator)
  integration/apollo/    # flows con fetch mockeado
  contract/              # pega a Apollo real, skipped por default
```

## Lo que NO cubre aun

- Supabase queries en el flow completo de `searchApolloProspects` (requeriria
  mock de `createClient`/`createServiceRoleClient`). El flow se testea por
  piezas: enrichment en integration, parsing en unit.
- Webhook (`app/api/webhooks/apollo/route.ts`) — pendiente, requiere fixtures
  con firma valida.
- UI (`prospects-tab.tsx`) — pendiente, requiere Playwright o RTL + jsdom.

## Fixtures

Los tests usan factories inline para generar responses. Si aparecen casos
reales raros que queremos cubrir, agregar snapshots anonimizados en
`tests/fixtures/apollo/`.
