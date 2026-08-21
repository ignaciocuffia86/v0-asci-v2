# MCP v3 — `search_companies_by_capability` v2 y bloque firmográfico

**Estado:** RPC aplicada en producción (`asciv2-database`). Código TS en el branch
`claude/mcp-search-companies-capability-u4ghts`, pendiente de deploy.

## Por qué

Una sesión real de prospección ("cuentas argentinas con Angular y Oracle Forms,
para modernización de legacy") terminó resolviéndose por query directa a Supabase.
Todo lo que hubo que hacer a mano era trabajo que la tool podía hacer sola, y el
usuario final no tiene ese acceso. Los cuatro choques, en orden de cuánto dolieron:

| Choque | Qué pasaba | Ahora |
|---|---|---|
| No había filtro por volumen | Para llegar a 89 cuentas había que bajar 889 y descartar 800 | `minSignals` (medido: 380 → 32 con `minSignals: 6`) |
| `matchedTerms` sin conteos | Mercado Libre y La Segunda parecían equivalentes | `termHits: [{term, signals}]` |
| Los términos se sumaban | El usuario pedía intersección, la hacía el modelo afuera | `termsMode: "any" \| "all"` (380 → 36) |
| `truncated: true` sin salida | Había que cortar por industria hasta que cada corte entrara en 50 | `cursor` / `nextCursor` |

Y dos de transparencia:

- **`includeProviders` era invisible.** El default descarta service providers y
  nada en la respuesta lo decía; se descubría cuando el SQL no cerraba con el MCP.
  Ahora sale `excluded: {serviceProviders, providersIncluded}` — en la búsqueda de
  arriba son **338 cuentas**.
- **`currentEmployees` estaba mal nombrado.** No eran empleados: eran contactos de
  la base de ASCI. Mercado Libre figuraba con 122 teniendo 85.000 empleados, y un
  usuario final lo lee como dotación siempre. Pasó a `contactsInBase` /
  `alumniInBase`, y la dotación real ahora solo sale del bloque firmográfico.

## Contrato

### `search_companies_by_capability`

Parámetros nuevos: `termsMode`, `minSignals`, `include`, `cursor`.

```jsonc
{
  "terms": ["Angular", "Oracle Forms"],
  "termsMode": "all",          // "any" (default) suma; "all" interseca
  "minSignals": 6,
  "countries": ["Argentina"],
  "include": ["firmographics"], // opt-in: 6 campos x 50 filas
  "mode": "detail",
  "limit": 25,
  "cursor": "<nextCursor de la llamada anterior>"
}
```

Fila de `detail`:

```jsonc
{
  "companyId": "…", "name": "La Segunda Seguros CLSG", "country": "Argentina",
  "industryId": "insurance", "industry": "Seguros",
  "website": "http://www.lasegunda.com.ar",
  "signals": 29,
  "termHits": [{ "term": "Angular", "signals": 16 }, { "term": "Oracle Forms", "signals": 13 }],
  "contactsInBase": 19,   // contactos de ASCI, NO dotación
  "alumniInBase": 9,
  "jobPostings": 1,
  "latestSignalAt": "2026-03-10T21:58:26Z",
  "firmographics": {      // solo con include: ["firmographics"]
    "linkedinUrl": "https://www.linkedin.com/company/la-segunda-seguros-clsg",
    "domain": "lasegunda.com.ar",
    "employeesApollo": 2200,   // null = NO LO SABEMOS (cobertura ~1%)
    "isPublic": null, "ticker": null, "stockExchange": null
  }
}
```

Además de la fila: `offset`, `nextCursor`, `excluded`, `appliedFilters`.

Tres decisiones que no son obvias:

1. **La unidad de intersección es el término pedido, no la entrada del
   diccionario.** "Dynamics 365" resuelve a CRM *y* ERP; exigir las dos sería
   exigir algo que nadie pidió. Por eso el TS manda `p_term_groups` (un grupo por
   término del usuario) y no una lista plana de ids.
2. **Con `termsMode: "all"`, un término sin resolver es un error.** La intersección
   sin él daría un número que se leería como si fuera el pedido.
3. **El cursor va firmado con la forma de la consulta.** Cambiar un país y
   conservar el cursor devolvería la página 3 de otra búsqueda, que parece
   plausible; ahora falla con `CAPABILITY_CURSOR_MISMATCH`.

### `get_company_profile`

Devuelve `firmographics` siempre (es una sola empresa, no hay payload que cuidar),
más `fieldNotes` cuando `employeesApollo` es null.

### `get_company_signal_summary`

Nuevo `detail: "compact" | "full"`, **default `"compact"`** en el MCP.

COTO —una cuenta con 10 señales— devolvía ~10.000 tokens en `full`, porque trae
hasta 3 fragmentos por término, las implementaciones enteras y 30 vacantes con 500
caracteres de descripción. Con ese costo, validar las 20 cuentas de una búsqueda es
inviable y la validación termina delegada al usuario. `compact` devuelve la misma
lectura (`[{label, type, count, lastSeen}]` + conteos) sin una sola cita textual.
Cuando hace falta la cita, `get_account_evidence_detail` ya va a un término puntual.

## Performance

El techo son los 8 s de PostgREST. Medido en producción (1,7M señales):

| Caso | Antes (v1, documentado) | Ahora |
|---|---|---|
| 2 procesos grandes, sin filtros, `detail` 50 + firmographics | ~6,1 s | **4,96 s** |
| Ídem `screening` | ~6,1 s | 6,4 s |
| Angular + Oracle Forms, Argentina, `minSignals` 6, AND, firmographics | — | **0,24 s** |

Lo que hizo que las funciones nuevas no costaran nada:

- Sale el JOIN a `dictionary_products` / `dictionary_processes` de dentro de
  `matched`: v1 resolvía el nombre del término por cada una de las ~365.000 filas
  de señal; ahora se resuelve contra un CTE de ≤22 filas.
- Sale el `array_agg(DISTINCT term)`, que ordenaba el input de cada grupo.
- `termHits` se agrega **solo para las ≤50 filas de la página**. Se probaron y
  descartaron dos variantes: precalcularlo para todas costaba 1,1 s (jsonb_agg
  sobre 110.042 empresas, 37 batches con spill a disco); un `LEFT JOIN LATERAL`
  por fila costaba **33 s**, porque Postgres inlinea el CTE adentro del lateral y
  re-escanea las 365.040 filas de `matched` una vez por fila devuelta.

Los topes de 2 procesos / 20 productos por llamada se mantienen.

## Nota de seguridad

El cambio de firma obliga a `DROP` + `CREATE` (un `CREATE OR REPLACE` con otra
lista de argumentos crea una sobrecarga, no reemplaza). El proyecto tiene `ALTER
DEFAULT PRIVILEGES` que le da `EXECUTE` a `anon` y `authenticated` **directamente**
sobre cada función nueva del schema, así que un `REVOKE ... FROM PUBLIC` no alcanza:
después del `CREATE`, la función quedó con
`{postgres,anon,authenticated,service_role}`, y siendo `SECURITY DEFINER` eso es un
lector anónimo de `companies` y `signals`. La migración revoca de `PUBLIC, anon,
authenticated` y el catálogo quedó verificado en
`{postgres=X/postgres,service_role=X/postgres}`, igual que la v1.

## Ventana entre la RPC y el deploy

La RPC ya está aplicada, el TS no. Mientras tanto, el MCP en producción devuelve
los campos nuevos (`termHits`, `contactsInBase`, `excluded`) con las descripciones
viejas, que todavía hablan de `matchedTerms` y `currentEmployees`. No se rompe nada
—verificado contra el MCP en vivo— pero el modelo lee una descripción desactualizada
hasta que se despliegue el branch.

## Lo que queda afuera

`export_capability_search`: aun con todo esto, 889 filas no entran en una
conversación. Si exportar es un caso de uso recurrente, lo que falta no es un
parámetro sino una tool que devuelva una URL firmada a un CSV. Necesita un bucket
privado nuevo, política de retención y decidir el gate de PII; se dejó para una
segunda tanda.
