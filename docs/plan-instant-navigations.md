# Instant Navigations en ASCI V2 — Análisis de viabilidad

Fecha: 2026-08-17
Estado: análisis previo a implementación (no se cambió código de la app)

---

## 1. Qué es "Instant Navigations"

Es la feature que Next.js estabilizó en **16.3**. Una navegación es "instantánea"
cuando el browser empieza a pintar la página destino **en el momento del click**,
mostrando el contenido estático/cacheado y los fallbacks, mientras el servidor
streamea el resto adentro de esos fallbacks.

Se apoya en tres piezas:

| Pieza | Qué hace |
|---|---|
| `cacheComponents: true` | Todo es dinámico por defecto; se opta a cachear con `"use cache"`. Habilita la validación en dev y el Navigation Inspector. |
| `partialPrefetching: true` | Cada `<Link>` visible prefetchea el **App Shell** de la ruta destino (uno por ruta, compartido entre todos los links), no un prefetch por link. |
| `<Suspense>` + `"use cache"` | Definen qué entra en el shell (instantáneo) y qué streamea después. |

```ts
// next.config.ts
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
}
```

Detalle clave para nosotros: **carga directa (F5) y navegación cliente producen
UI inicial distinta**. En navegación cliente sólo se re-renderiza lo que está
*por debajo* del layout compartido, así que un `<Suspense>` en el root layout no
cubre la transición `/v3/chat → /v3/accounts`. Los boundaries tienen que estar
donde ocurre el cambio.

---

## 2. Requisitos duros

1. **Upgrade de Next**: hoy `next@16.0.10`. `partialPrefetching` requiere **16.3+**
   (última estable: `16.3.1`). `cacheComponents` existe desde 16.0 pero el paquete
   completo es 16.3.
2. **Eliminar route segment configs**: con `cacheComponents` activo, exportar
   `dynamic`, `revalidate` o `fetchCache` **es un error de build**. En el repo hay:
   - `app/admin/users/page.tsx:3` → `export const dynamic = "force-dynamic"`
   - `app/api/landing-stats/route.ts:7` → `export const revalidate = 3600`
   - ~15 `export const dynamic = "force-dynamic"` más en route handlers de `/api/cron/*`
     y webhooks (a validar caso por caso).
3. **Nada de IO síncrono en el prerender**: `new Date()`, `Date.now()`, `Math.random()`,
   `crypto.randomUUID()` en el shell rompen el build y `instant = false` **no** los tapa.
4. **Playwright** si queremos blindar con e2e (`@next/playwright` → helper `instant()`).
   Hoy el proyecto usa Vitest, no hay e2e.

---

## 3. Diagnóstico del código actual

Medido sobre el repo:

| Métrica | Valor | Implicancia |
|---|---|---|
| Páginas (sin `/api`) | 49 | Superficie a auditar |
| Server components `async` | 23 | Todas bloquean antes de pintar |
| Client components (`"use client"`) | 20 | Ya navegan "instantáneo" en soft nav |
| Archivos con `<Suspense>` | 3 | Prácticamente no hay streaming |
| `loading.tsx` | 4 (`/`, `/search`, `/bookmarks`, `/bookmarks/[id]`) | **Ninguno en `/v3`**, que es la app principal |
| `"use cache"` / `unstable_cache` / `cacheTag` | 0 | Cero caché de datos hoy |
| Archivos que importan `next/link` | 21 | |
| Llamadas a `router.push(...)` | 40 | **No prefetchean nada** |

### 3.1 El cuello de botella real

`app/v3/layout.tsx` hace el read de sesión en el top level:

```tsx
export default async function V3Layout({ children }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()   // ← bloquea todo el árbol
  if (!user) redirect("/auth/login?next=/v3")
  const [workspace, profileRes] = await Promise.all([...])   // ← 2 queries más
  return (<div>...<V3Navbar/>{children}...</div>)
}
```

La guía oficial de auth con Cache Components dice literalmente lo contrario:
*"Keep the session read out of a layout's top level. A top-level `await` on the
session in a layout holds the whole segment, including `{children}`, behind that request."*

Y encima cada página repite el chequeo. `app/v3/chat/page.tsx`:

```tsx
const status = await getOnboardingStatus()   // getCurrentUser → getWorkspaceForUser → workspaceHasDocuments (secuencial)
if (...) redirect(...)
const conversations = await listConversations()  // recién acá los datos de la página
return <ChatShell initialConversations={conversations} />
```

Cadena completa por click hoy, todo secuencial y antes del primer pixel:

```
proxy.ts (updateSession → supabase.auth.getUser)
  → layout: auth.getUser + workspace + profile
    → page: getOnboardingStatus (auth + 2 queries)
      → datos de la página (listConversations / getFollowedAccounts / getAccountDetail)
        → primer render
```

Eso es lo que hace que la app se sienta "pegajosa": no es el bundle, es una
cascada de round-trips a Supabase con la pantalla anterior congelada.

### 3.2 Navegación por `router.push`

El command palette (`components/v3/command-palette.tsx`) y ~40 call sites navegan
con `router.push`. **El prefetch sólo aplica a `<Link>`**. Aunque activemos todo,
esas rutas no van a ser instantáneas salvo que se conviertan a `<Link>` o se
agregue `router.prefetch()`.

---

## 4. ¿Va a funcionar mejor la web? Sí, pero con matices

### Dónde gana (real)

1. **Percepción de velocidad en `/v3`**: hoy el click deja la pantalla vieja
   congelada 300–800 ms. Con shell + Suspense, el navbar y los skeletons aparecen
   al instante y los datos entran por streaming. Es la mejora más visible.
2. **`/v3/chat`** (punto de entrada del producto): `ChatShell` puede pintarse ya,
   con la lista de conversaciones streameando.
3. **`/v3/accounts` → `/v3/accounts/[companyId]`**: el shell del detalle se prefetchea
   una vez y se comparte entre todas las filas de la lista (hoy no hay prefetch útil
   porque la página entera es dinámica).
4. **Landing y `/docs`**: contenido no personalizado → candidatos reales a `"use cache"`
   y a shell 100% estático.
5. **`/search`**: ya es client component; el catálogo de empresas es dato compartido,
   no per-tenant → `"use cache"` aplica de verdad ahí.
6. **Menos carga de prefetch**: partial prefetching hace **un shell por ruta**
   compartido, en vez de un prefetch por link. Con listas largas de cuentas eso es
   menos tráfico que el prefetch clásico.

### Dónde NO gana (importante para no vender humo)

- **ASCI es 100% multi-tenant y auth-gated.** Los datos de cuentas, documentos y
  chat son por workspace y salen con el admin client / RLS. Eso **no se puede
  meter en el shell compartido**: el shell es común a todos los usuarios.
  El camino correcto es `"use cache: private"` (cachea en el browser del usuario,
  nunca en el servidor) o simplemente Suspense + streaming.
- **No baja el TTFB de los datos.** Las queries a Supabase tardan lo mismo; lo que
  cambia es que ya no bloquean el pintado. Es latencia percibida, no throughput.
- **La primera visita fría sigue esperando.** "Instant" asume cachés tibias.
- El middleware (`proxy.ts`) corre en cada request incluidos los prefetches, así que
  el `supabase.auth.getUser()` de ahí se ejecuta más veces que hoy.

### Conclusión honesta

**~70% del beneficio percibido se consigue sin `cacheComponents`**: sacar el `await`
de sesión del layout, agregar `loading.tsx`/`<Suspense>` en `/v3`, y convertir los
`router.push` de navegación a `<Link>`. Instant Navigations formaliza y valida eso
(la validación en dev que te marca ruta por ruta qué bloquea es lo más valioso del
paquete) y suma el prefetch de shell compartido. Vale la pena, pero el orden importa:
primero la reestructuración, después los flags.

---

## 5. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Cachear datos de un workspace en caché de servidor y servirlos a otro tenant | **Alta** | Nunca `"use cache"` sobre funciones que leen sesión adentro. Extraer `workspaceId`/`userId` y pasarlo como argumento, o usar `"use cache: private"`. Revisión de seguridad obligatoria en el PR. |
| Los `redirect()` por sesión en el top de las páginas (`v3/page.tsx`, `chat`, `accounts`, `campaigns`) no pueden vivir en el shell estático | Media | Mover el gating de onboarding a `proxy.ts` o a un componente dentro de un boundary. |
| Upgrade 16.0.10 → 16.3.1 con 49 páginas | Media | Upgrade solo primero, verificar build + `typecheck` + `test`, y recién después los flags. |
| Migración larga que bloquea otras features | Media | Codemod `cache-components-instant-false` para opt-out global y adoptar ruta por ruta. |
| Sin e2e, regresiones silenciosas | Baja | `@next/playwright` + helper `instant()` en las 3 rutas críticas. |
| CSP / `images: unoptimized` / crons de `vercel.json` | Nula | No se ven afectados. |

---

## 6. Plan por fases

### Fase 0 — Quick wins, sin cambiar de versión (1–2 días)
Beneficio grande, riesgo casi nulo, no requiere Next 16.3.

- Sacar `supabase.auth.getUser()` del top level de `app/v3/layout.tsx`; el navbar
  recibe user/workspace desde un componente dentro de `<Suspense>`.
- Agregar `app/v3/loading.tsx` + `loading.tsx` en `chat`, `accounts`, `accounts/[companyId]`, `settings`, `docs`.
- Envolver en `<Suspense>` los bloques de datos de las páginas v3 en lugar de `await` arriba.
- Deduplicar `getOnboardingStatus()`: hoy corre en layout **y** en cada página
  (con `React.cache` o moviendo el gating al middleware).
- Convertir los `router.push` de navegación pura (command palette, navbar) a `<Link>`.

**Medible**: tiempo desde el click hasta el primer pixel del destino.

### Fase 1 — Upgrade + Cache Components (2–4 días)
- `pnpm up next@16.3.1 eslint-config-next@16.3.x`, build + typecheck + tests verdes.
- `cacheComponents: true` + codemod `cache-components-instant-false` sobre `./app`.
- Eliminar `dynamic`/`revalidate`/`fetchCache` de los segmentos que erroren.
- Quitar `instant = false` ruta por ruta, empezando por: landing → `/docs` → `/search`
  → `/v3/chat` → `/v3/accounts` → `/v3/accounts/[companyId]` → admin.
- `"use cache: private"` en el helper de sesión; `"use cache"` sólo en datos
  compartidos (catálogo de empresas, landing-stats, diccionario).

### Fase 2 — Partial Prefetching (1 día)
- `partialPrefetching: true`.
- Auditoría de `<Link>`: `prefetch={true}` sólo donde el destino depende de `params`
  (típicamente `/v3/accounts/[companyId]`).
- Navigation Inspector para verificar qué entra al shell de cada ruta.

### Fase 3 — Blindaje (1 día, opcional)
- `@next/playwright` + tests `instant()` en chat, accounts y detalle de cuenta.
- `experimental.exposeTestingApiInProductionBuild` para correrlos en CI.

**Total estimado: 5–8 días de trabajo efectivo.** Fase 0 sola ya justifica el esfuerzo.

---

## 7. Cómo medir si sirvió

1. **Antes**: grabar en DevTools (throttling 4G) el click `/v3/chat → /v3/accounts` y
   anotar el delta hasta el primer pixel del destino.
2. **Después de Fase 0** y **después de Fase 2**: misma medición.
3. Web Analytics de Vercel (ya está `@vercel/analytics`) para INP en producción.
4. Contar round-trips a Supabase por navegación (hoy: middleware + layout + página + datos).

---

## 8. Recursos

- Guía: `docs/01-app/02-guides/instant-navigation.mdx` (repo de Next.js)
- Migración: `migrating-to-cache-components.mdx`, `adopting-partial-prefetching.mdx`
- Auth: `authentication-with-cache-components.mdx` — patrón `"use cache: private"`
- Skills oficiales de Vercel para agentes:
  `npx skills add vercel/next.js --skill next-cache-components-adoption`
  `npx skills add vercel/next.js --skill next-partial-prefetching-adoption`
