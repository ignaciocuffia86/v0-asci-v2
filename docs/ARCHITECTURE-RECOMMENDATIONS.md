# Recomendaciones de arquitectura — ASCI (v2 / v3 / bot.bigua)

**Fecha:** 2026-08-12
**Alcance:** administración y actualización de la plataforma + estrategia de gestión de apps y subdominios.
**Base:** revisión del código, del mapa de arquitectura (`docs/architecture-map.json` + su render HTML), del MCP Explore, y de los diagnósticos ya catalogados (`OPT-01..16`, 8 `contactPoints`, 14 `deadCode`) y la auditoría de producto (`docs/asci-v3-architecture-audit.md`).
**Naturaleza:** documento advisory. No cambia comportamiento; cada recomendación cita un hallazgo real con su ID y ruta de archivo para que sea auditable.

> Este informe **no repite** la auditoría de producto/IA/UX de `asci-v3-architecture-audit.md`. Aporta la capa que faltaba: **cómo se administra y se actualiza la plataforma**, y **cómo conviene gestionar las apps y subdominios**. Para calidad de insights, costo de IA y UX, esa auditoría sigue siendo la referencia.

---

## 1. Resumen ejecutivo

La plataforma está conceptualmente bien: dos productos (v2 producción, v3 multitenant) conviven en un repo, un deploy y una base, aislados por *schema* de Postgres. El value-prop de v3 —reusar el cache pago de v2 (488k empresas, señales, Apollo)— depende justamente de esa base compartida.

El cuello de botella para **administrar y actualizar** la plataforma **no es el código de features**. Son tres cosas estructurales:

1. **El esquema de datos cambia sin migraciones versionadas.** 235 scripts SQL sueltos, sin historial aplicado ni orden garantizado (`OPT-14`). Es el mayor riesgo operativo: no hay forma confiable de saber qué se aplicó, ni de reproducir el estado en otro entorno.
2. **No existe una frontera v2/v3 verificable.** La regla "v3 no rompe v2" es una convención escrita, no una barrera que el compilador o el lint hagan cumplir (`OPT-12`, `OPT-13`). El acoplamiento real vive en la DB compartida —sobre todo `public.companies`— no en el deploy.
3. **No hay pipeline de release con gates.** El deploy va v0.app → GitHub → Vercel sin correr Vitest ni `tsc` (de hecho `next.config.mjs` **ignora** errores de TypeScript en build). Cualquier regresión llega a producción sin red de seguridad.

Encima de eso hay **cinco P0 de seguridad de administración** ya diagnosticados (guard de admin, crons, RPCs de export, SSRF) que conviene cerrar antes de escalar.

**La topología de subdominios es secundaria.** Separar el deploy de v2 y v3 no resuelve el acoplamiento crítico, porque la DB sigue compartida. La recomendación es **endurecer el monolito ahora** (frontera verificable + migraciones + contrato de datos) y **posponer el split de deploy** hasta que las cadencias de release diverjan de verdad.

**Orden de ejecución recomendado:** P0 seguridad → migraciones + CI → frontera v2/v3 → contrato de la DB compartida → (recién ahí) evaluar topología.

---

## 2. Administración y actualización — recomendaciones priorizadas

### P0 — Seguridad de administración (bloqueantes)

Todos ya están en el mapa como críticos/altos. Son de administración porque afectan el panel de superadmin, los crons y los exports.

| ID | Problema | Acción recomendada |
|----|----------|--------------------|
| `OPT-01` | El guard de admin vive **solo en el layout**; las server actions privilegiadas no revalidan rol. | Extraer `lib/auth/require-superadmin.ts` y llamarlo como **primera línea** de cada server action privilegiada. El layout es UX (no mostrar la página), no control de seguridad. |
| `OPT-02` | El cron de `cleanup` **detecta** el request no autorizado y sigue igual. | Agregar el `return 401` dentro del `if`. Extraer `assertCron(request)` y auditarlo en los 10 crons (`vercel.json`). |
| `OPT-03` | 9 RPC de export `SECURITY DEFINER` con `EXECUTE` para `anon`. | `REVOKE EXECUTE ... FROM anon, PUBLIC` explícito en las 9 + test de regresión que falle si alguna RPC de `public` vuelve a tener `anon` en el ACL. |
| `OPT-04` | `proxy-image` hace `fetch` de una URL controlada por el cliente (**SSRF**). | Allowlist de esquema (solo `https`), bloqueo de IP privadas/loopback tras resolver DNS, límite de tamaño/timeout, validar `content-type` contra `image/*`. `lib/utils/image-validator.ts` ya existe y es el lugar natural. |
| `OPT-10` / `DEAD-08` | Sin cabeceras de seguridad; endpoint de prueba `api/test-alert` público en producción. | `headers()` en `next.config.mjs` (nosniff, HSTS, `X-Frame-Options SAMEORIGIN`, Permissions-Policy) + CSP en `Report-Only` listando el origen de Supabase antes de enforcing. Eliminar `api/test-alert`. |

### P1 — Actualización de la plataforma (el corazón del pedido)

**P1.1 — Adoptar migraciones versionadas (`OPT-14`, `OPT-15`).**
Hoy hay 235 `.sql` sueltos en `scripts/` (numerados `001_…` en adelante) sin registro de qué se aplicó. Esto hace que "actualizar la plataforma" sea una operación manual, no reproducible y sin rollback.
- Sellar el estado actual de `public.*` y `v3.*` como **baseline** (una migración inicial que representa el esquema vivo).
- Adoptar migraciones versionadas con historial aplicado (Supabase migrations; ya existe `supabase/migrations/20260616000000_v3_multitenant.sql` como semilla del patrón).
- Dejar `scripts/run-sql.mjs` (que ya es **dry-run por defecto** sin `--commit`) solo para operaciones puntuales.
- Endurecer el runner: que **rechace** archivos con `COMMIT`/`ROLLBACK` cuando no se pasó `--commit`, porque hoy un `COMMIT` dentro del `.sql` anula el dry-run (`OPT-15`).

**P1.2 — Pipeline de release con gates automáticos.**
No hay CI ni Dockerfile en el repo; el deploy es v0.app → GitHub → Vercel sin validación previa. Además `next.config.mjs` ignora errores de TypeScript en build.
- Agregar GitHub Actions que en cada PR corra `tsc --noEmit`, unit tests (`vitest run tests/unit`) y lint, **bloqueando el merge** si fallan.
- Mantener los *contract tests* (que pegan a Apollo/Supabase reales y cuestan plata) en un job **manual** gateado por `RUN_APOLLO_CONTRACT_TESTS` etc. — nunca en el gate obligatorio.
- Dejar de ignorar errores de TS en build: un error de tipos hoy llega a producción silenciosamente.

**P1.3 — Frontera v2/v3 verificable (`OPT-12`, `OPT-13`).**
La regla "v3 no toca v2" es prosa. Hacerla cumplir por herramientas:
- Crear `lib/shared/` para lo común y **prohibir por lint** que `lib/v3` importe de `lib/` raíz salvo desde ahí. El motor de research ya demostró que el patrón funciona y elimina duplicación real.
- Helper único `v3Db()` que devuelva el cliente ya apuntado al schema `v3`; **prohibir `.from()` crudo** en `lib/v3` y `app/**/v3`. Hoy el schema se resuelve en runtime y es fácil de perder (`OPT-13`).
- Generar **tipos por schema** para que un acceso cruzado o un schema equivocado salte en compilación, no en producción.

**P1.4 — Centralizar el acceso a datos (`OPT-06`).**
16 archivos instancian `createClient` crudo y saltean los helpers de `lib/supabase/`.
- Regla de lint que prohíba importar `@supabase/supabase-js` fuera de `lib/supabase/`.
- `admin()` (service-role) como **único** punto que toca la service key, con un comentario que justifique cada uso.

### P2 — Mantenibilidad

- **Registry de tools MCP (`OPT-07`).** La ruta del servidor MCP concentra transporte, auth, cuota y 36 tools en un solo archivo (~50 KB). Extraer un módulo por familia de tools que exporte definición + handler; la ruta solo itera el registry aplicando el proxy de instrumentación. Aplica igual al Explore. Habilita un test que valide que toda tool citada existe.
- **Separar el contador de rate-limit del log de auditoría (`OPT-08`).** `mcp_request_logs` cumple dos roles incompatibles. Dejar el log como auditoría pura con retención propia y mover el contador a su estructura (o Redis si se busca latencia).
- **Retención de `cron_executions` (`OPT-05`).** 1,3M filas, sin RLS y fuera del cleanup. Agregar retención (p. ej. 14 días), habilitar RLS y evaluar particionado por fecha.
- **Limpieza de dead-code (`DEAD-01..13`).** Feature de `csv-import` contra tablas inexistentes, `app/actions/v3/apollo.ts` y `tech-radar.ts` sin consumidores, `lib/v3/digest.ts` duplicado, `lib/parallel-extract.ts`, `theme-provider.tsx`, etc. Bajo riesgo, alto valor de claridad. Corregir el typo de env var `APOLLO_WEBHOOL_SECRET` (`DEAD-11`).
- **Fuente única de base-URL por entorno.** Hoy conviven hard-codeados `asci.bigua.lat`, `bot.bigua.lat`, `asci.vercel.app` y `app.asci.ai` como *fallbacks* en distintos archivos (`app/layout.tsx`, `lib/v3/email.ts`, `lib/v3/mcp-oauth.ts`, `lib/v3/services/mcp-document-ingestion.ts`, `lib/monitoring.tsx`). Si `NEXT_PUBLIC_APP_URL` queda sin setear, se generan links al dominio equivocado. Centralizar en un único helper de resolución de URL por entorno.

---

## 3. Gobierno del punto de contacto crítico: la DB compartida

El acoplamiento real de la plataforma no es el deploy: es **`public.companies`** (488k filas, referenciada 33 veces por v3, con la columna `hq_country_iso` agregada por v3) y el resto del cache compartido. Los 8 `contactPoints` del mapa son exactamente los lugares donde el invariante "v3 no rompe v2" se puede romper.

**Recomendación central: formalizar la DB compartida como un contrato, no como acceso directo a tablas.**

- Tratar lo que v3 lee de `public` como una **"API de datos" versionada**: vistas o RPC de solo lectura estables (`public.companies_read_v1`, `signals_read_v1`, …) en lugar de 33 lecturas directas a la tabla. Así un cambio de esquema en v2 no rompe v3 en silencio, y v3 no puede depender de columnas internas de v2.
- Marcar el **origen** (`source: 'v2' | 'v3'`) en las tablas que ambas escriben (`radar_findings`, `job_postings`) para poder auditar y revertir por producto (`cp_radar`, `cp_jobs`).

**Cerrar los tres `contactPoints` críticos primero:**

| ID | Riesgo | Por qué es crítico |
|----|--------|--------------------|
| `cp_tenant_leak` | `get_company_signal_summary` deja que un tenant lea proveedores subidos por otro (tablas de upload sin `workspace_id`). | Rompe el aislamiento multitenant, que es **la promesa central de v3**. |
| `cp_country` | El trigger `trg_normalize_country` guarda el **nombre** del país en `country_normalized`; el ISO de HQ vive en `hq_country_iso`. Los exports de admin de v2 filtran contra esa columna. | Escribir ISO en `country_normalized` **rompe los exports de v2 en silencio, sin error**. |
| `cp_companies` | 488k empresas como núcleo único; cualquier migración o `UPDATE` masivo impacta producción de v2. | Es el punto de mayor blast radius. Toda escritura masiva debe pasar por migración versionada + ventana. |

Los otros cinco (`cp_auth`, `cp_signals`, `cp_apollo`, `cp_news`, `cp_jobs`) son alta/media y se cubren con las mismas dos ideas: contrato de lectura versionado + marca de origen. Nota puntual de `cp_news`: el `UPDATE` de `company_news` no tiene `WITH CHECK` y la RLS ata las noticias a bookmarks personales de v2, por lo que un miembro de workspace v3 no las ve en la web.

---

## 4. Estrategia de apps y subdominios (v2 / v3 / bot.bigua)

### Estado actual

| App | Subdominio | Rutas | Schema | Naturaleza |
|-----|-----------|-------|--------|------------|
| ASCI **v2** | `asci.bigua.lat` | `/` (`/search`, `/admin`, `/docs`) | `public.*` | Producción, usuarios reales, single-tenant |
| ASCI **v3** | `bot.bigua.lat` | `/v3/*`, `/api/v3/*` | `v3.*` | Multitenant, MCP + OAuth, iterando |
| Bigua (corporativo) | `bigua.lat` | — | — | Sitio de la empresa madre |

Un repo, un deploy Vercel, una base Supabase. Los subdominios son **alias cosméticos** configurados en Vercel/DNS: no hay routing por host en el código (`proxy.ts` solo normaliza URLs malformadas de `/v3` y refresca la sesión de Supabase). La distinción v2/v3 es puramente por **prefijo de ruta** + **schema**.

### Las tres topologías posibles

**Opción A — Monolito endurecido. ✅ Recomendado ahora.**
Un repo, un deploy, pero con la frontera v2/v3 hecha cumplir por lint + tipos por schema + migraciones versionadas (secciones 2 y 3).
- **Ventajas:** costo bajo; preserva el value-prop de v3 (reusar el cache pago de v2); elimina la mayor parte del riesgo real sin tocar la topología; un solo pipeline de deploy que administrar.
- **Desventajas:** v2 y v3 comparten cadencia de release y runtime; un deploy roto afecta a ambos (mitigable con el gate de CI de P1.2).

**Opción B — Split de deploy (proyectos Vercel separados desde el mismo repo).**
Justificado **solo cuando las cadencias de release diverjan de verdad** (v2 estable/congelado, v3 iterando rápido).
- **Ventajas:** releases y rollbacks independientes; el runtime de v3 no puede tumbar v2; `maxDuration`/crons por proyecto.
- **Desventajas:** **la DB sigue compartida**, así que sin el contrato de datos de la sección 3 el beneficio es parcial. Agrega complejidad: routing por host, `lib/shared` publicable, dos sets de env vars y crons que mantener sincronizados. No hacer esto *antes* de A.

**Opción C — Split total (base de datos por producto).**
No recomendado. v3 pierde su razón de ser: el cache de 488k empresas que v2 ya pagó. Solo tendría sentido si v3 se convierte en un producto independiente con datos propios (spin-off).

### Regla de decisión

> **A ahora. B cuando las cadencias de release de v2 y v3 diverjan de verdad y la sección 3 ya esté hecha. C nunca, salvo spin-off de v3 como producto independiente.**

### Nombres y dominios

- Definir **qué pasa cuando v3 sea el producto principal.** Hoy `bot.bigua.lat` comunica "el bot"; si v3 reemplaza a v2 como core, conviene planear la promoción de dominio (v3 → dominio principal) para que `bot.` no quede como marca permanente de lo que será el producto central.
- Consolidar la **fuente de verdad de dominios** (ver P2, base-URL única): hoy los fallbacks hard-codeados apuntan a cuatro dominios distintos.

---

## 5. MCP: `asci-v3` + `explore`

Hay **dos servidores MCP** corriendo en paralelo como A/B, sobre rutas HTTP de Next (no stdio; no hay `.mcp.json`). Comparten auth OAuth/API-key, cuota y telemetría (`v3.mcp_request_logs`), y se distinguen por `serverInfo` y prefijo de tool.

- **`asci-v3`** (`app/api/v3/mcp/server/[transport]/route.ts`): 36 tools, opera vía el **diccionario de señales** de v2. Patrón `prepare_*` / `submit_*` (asistido por cliente) y `run_*` (server-managed), con operaciones pagas gateadas por `userConfirmed: true`.
- **`asci-explore`** (`app/api/v3/mcp/explore/[transport]/route.ts` + `lib/v3/explore/mcp-explore.ts`): 8 tools `explore_*`, un **funnel conversacional** sobre contactos/vacantes crudos que **bypassa el diccionario** — el cliente aporta el vocabulario (term-cloud) y el server matchea whole-word. Usa **conexión Postgres directa** (`lib/db/direct.ts`) porque `public.contacts` (2,4 GB, índices GIN trigram) supera el corte de 8s de PostgREST.

Recomendaciones:
- **Unificar el plumbing** con el registry de `OPT-07` (auth/cuota/telemetría ya son comunes), manteniendo los dos `serverInfo` mientras dure el A/B.
- **Documentar el patrón de Postgres directo como la vía oficial** para lecturas pesadas (`OPT-11`: el límite de 8s no lo esquiva service-role). Clasificar cada operación pesada en "precalcular en tabla" (lecturas) o "presupuesto de tiempo" (escrituras); lo que no entre, por `lib/db/direct.ts` explícito.
- **Definir el corte del A/B:** criterio de éxito y fecha para quedarse con un solo funnel (diccionario vs. term-cloud) y no mantener dos superficies para siempre. `explore_scrape_jobs` valida ownership de la empresa antes de insertar — extender ese guardrail a toda ingesta de vacantes (`OPT-16`: el scraper busca por título, no por empresa, y puede generar señales falsas visibles en v2).

---

## 6. Tabla de acciones priorizada

Ordenada para ejecución. Esfuerzo: S (horas), M (días), L (semana+).

| # | Acción | Hallazgo | Sev. | Esfuerzo | Impacto en admin/actualización |
|---|--------|----------|------|----------|-------------------------------|
| 1 | Guard superadmin en cada server action | `OPT-01` | Crítica | M | Cierra bypass del panel de admin |
| 2 | `assertCron` + 401 en los 10 crons | `OPT-02` | Crítica | S | Protege jobs de mantenimiento |
| 3 | `REVOKE EXECUTE` a `anon` en 9 RPC export + test | `OPT-03` | Crítica | S | Cierra fuga de datos por export |
| 4 | Cerrar `cp_tenant_leak` (workspace_id en uploads) | `cp_tenant_leak` | Crítica | M | Restaura aislamiento multitenant |
| 5 | Fix SSRF `proxy-image` + quitar `test-alert` | `OPT-04`,`DEAD-08` | Alta | S | Reduce superficie de ataque |
| 6 | Baseline + migraciones versionadas | `OPT-14`,`OPT-15` | Alta | L | **Actualizaciones reproducibles y con rollback** |
| 7 | CI con `tsc`+tests+lint bloqueando merge; dejar de ignorar TS | — | Alta | M | **Red de seguridad en cada release** |
| 8 | Frontera v2/v3 por lint + `v3Db()` + tipos por schema | `OPT-12`,`OPT-13` | Media | L | Hace cumplir el invariante v2/v3 |
| 9 | Contrato de lectura de `public` (vistas/RPC v1) | `cp_companies`,`cp_country` | Crítica | L | Desacopla el punto de mayor riesgo |
| 10 | Centralizar Supabase (`OPT-06`) + base-URL única | `OPT-06` | Media | M | Consistencia de acceso y dominios |
| 11 | Registry MCP + separar rate-limit del log | `OPT-07`,`OPT-08` | Media | M | Servidores MCP mantenibles |
| 12 | Retención `cron_executions` + limpieza dead-code | `OPT-05`,`DEAD-*` | Media | S | Menos ruido operativo |
| 13 | (Decisión) Evaluar split de deploy A→B | §4 | — | — | Solo si divergen cadencias |

**Secuencia sugerida:** 1–5 (seguridad, primer PR) → 6–7 (base de actualización) → 8–9 (frontera + contrato) → 10–12 (mantenibilidad) → 13 (topología, decisión de negocio).

---

## Anexo — Fuentes citadas

- `docs/architecture-map.json` — `meta`, `contactPoints`, `optimizations` (`OPT-01..16`), `deadCode` (`DEAD-01..14`). Render: `docs/architecture-map.html`; viewer seguro en `app/admin/architecture/`.
- `docs/asci-v3-architecture-audit.md` — auditoría de producto/IA/observabilidad (P0/P1/P2). **Referencia, no se duplica.**
- `docs/BOT-BIGUA-LAT-ARCHITECTURE.md` — §13 tabla de seguridad v2/v3, §2.1 tablas que v3 lee, §14 env vars.
- Código: `app/api/v3/mcp/server/[transport]/route.ts`, `app/api/v3/mcp/explore/[transport]/route.ts`, `lib/v3/explore/mcp-explore.ts`, `lib/db/direct.ts`, `proxy.ts`, `vercel.json`, `next.config.mjs`, `lib/supabase/*`, `scripts/run-sql.mjs`.
