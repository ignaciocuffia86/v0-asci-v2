# Detección de cambios de puesto y movimientos de rol

Fecha: 2026-08-17
Contexto: es la señal clave de dos features propuestas en
`docs/oportunidades-producto-b2b-tech.md` — **B (intent por contratación)** y
**E (monitoreo de clientes actuales)**.

---

## 1. Respuesta corta

Monitorear perfiles de LinkedIn para detectar cambios de rol es **técnicamente
posible y comercialmente suicida**. Pero la pregunta tiene una respuesta mejor:
**ya tenés un detector de cambio de puesto corriendo en producción**, y hoy
tira el evento a la basura.

---

## 2. El precedente que define el terreno: Proxycurl

Proxycurl era el proveedor #1 de datos de LinkedIn vía API, con ~USD 10M de
facturación. En enero de 2025 LinkedIn y Microsoft lo demandaron alegando que
operaba "cientos de miles" de cuentas falsas para recolectar perfiles. Terminó en
**injunction permanente**: borrar todos los datos de LinkedIn recolectados, cesar
todo acceso. La empresa **cerró operaciones a comienzos de julio de 2025**.

Dos lecturas que importan:

1. **El argumento "es data pública" no alcanzó.** El terreno de disputa no es el
   CFAA sino el *user agreement*, y ahí LinkedIn gana.
2. **La escala del adversario.** El CEO de Proxycurl atribuyó el desenlace a los
   recursos legales de LinkedIn respaldados por Microsoft. No es una pelea que se
   elija dar.

### Por qué esto NO invalida lo que ya hacés

Hay una diferencia jurídica y práctica entre lo que ASCI ya scrapea y lo que
implicaría monitorear perfiles:

| Qué | Actor | Naturaleza del dato | Riesgo |
|---|---|---|---|
| Vacantes | `bebity~linkedin-jobs-scraper` (`lib/v3/services/apify-client.ts:53`) | Contenido **corporativo** publicado | Moderado |
| Páginas de empresa | `harvestapi~linkedin-company` (`lib/v3/services/linkedin-company-enrichment.ts:32`) | Contenido **corporativo** | Moderado |
| **Perfiles de personas** | — | **Dato personal** | **Alto** |

El salto a perfiles personales agrega el eje de privacidad: Ley 25.326 (Argentina),
LGPD (Brasil), y GDPR si hay ciudadanos europeos en la base. Y es exactamente el
territorio donde LinkedIn litiga.

**El activo que se arriesga no es abstracto:** un ban de la cuenta de Apify apaga
*dos* pipelines productivos que hoy funcionan — el radar de vacantes y el
enrichment de empresas. El costo del downside es desproporcionado.

---

## 3. Lo que ya tenés y no estás usando

`app/api/cron/apollo-reverify/route.ts` corre todos los días a las 04:00
(`vercel.json`). Toma 50 contactos con `last_verified_at > 90 días`, los re-matchea
contra Apollo y hace esto:

```ts
// Detectar cambio de empresa: comparar organization_id contra el cache
const movedCompany =
  cacheEntry?.organization_id &&
  person.organizationId &&
  cacheEntry.organization_id !== person.organizationId

const reviewReason = movedCompany ? "changed_company" : null
```

**Eso es un detector de cambio de puesto.** Ya está escrito, ya corre, ya funciona.
El problema es qué hace con el hallazgo:

```ts
.update({
  role: person.title ?? c.role,     // ← pisa el título anterior, sin registrarlo
  needs_review: !!reviewReason,     // ← el evento muere como higiene de datos
  review_reason: reviewReason,
})
```

El evento se trata como **calidad de dato**, no como **señal comercial**. Y el
cambio de *título dentro de la misma empresa* — la promoción, que es justo el
"cambio de posición" de la pregunta — se sobrescribe sin dejar rastro.

### Lo que falta (poco)

1. **Persistir el evento, no el estado.** Una tabla `contact_job_changes`
   (`contact_id`, `from_company_id`, `to_company_id`, `from_title`, `to_title`,
   `change_type`, `detected_at`, `source`). Hoy se pisa la fila y se pierde la historia.
2. **Detectar también el cambio de título**, no sólo de `organization_id`.
3. **Enrutar el evento a las dos lecturas:**
   - *Prospecting:* tu champion se fue a otra cuenta → entrada caliente en esa cuenta.
   - *Churn:* el sponsor de tu cliente se fue → riesgo de renovación.
4. **Subir la cobertura.** 50 contactos/día con ciclo de 90 días cubre ~4.500
   contactos. Hay que dimensionar el batch contra el volumen real.

**Esfuerzo: 2–3 días.** Es el mejor ROI de todo lo analizado en esta conversación.

---

## 4. Cómo ampliar la cobertura, por relación valor/riesgo

### ✅ a) Apollo job change alerts (nativo) — recomendado

Apollo lanzó tracking de cambio de trabajo en diciembre de 2025, extendido a
comienzos de 2026: guardás el contacto, Apollo lo monitorea, y cuando cambia de
empresa busca el nuevo email verificado con *waterfall enrichment*. La entrega es
asincrónica **por webhook**.

Encaja perfecto con lo que ya existe: ya sos cliente de Apollo, ya tenés
`apollo_contacts_cache`, y ya tenés el patrón de webhook resuelto en
`app/api/webhooks/apollo/[secret]/route.ts` (secret en el path, siempre 200 por
idempotencia). Reemplaza el polling casero por push, sin pagar un proveedor nuevo.

**Limitación honesta:** la cobertura de Apollo en LATAM es peor que en EE.UU. Por
eso conviene como *una* capa, no como *la* solución.

### ✅ b) Noticias como fuente de nombramientos — recomendado

En LATAM los nombramientos ejecutivos se publican en prensa tanto o más que en
LinkedIn. Ya tenés `public.company_news` y el motor de research
(`collect → structure → verify`) que devuelve **sólo fuentes citadas**.

Falta un extractor tipado: `{persona, cargo_nuevo, cargo_anterior, empresa, fecha,
fuente}`, persistido como un `radar_type` nuevo — `'people-moves'`. Nota: hay que
ampliar el CHECK, que hoy es
`CHECK (radar_type IN ('tech','news','jobs-interpretation'))`
(`scripts/400_v3_account_centric.sql:309`).

Cubre justo el segmento que más importa (C-level y gerencias = comité de compra),
es 100% legal y trazable a fuente.

### ✅ c) Vacantes como proxy invertido — casi gratis

Ya está el dato. Una vacante de "Head of Data" significa que el rol **está vacante
o es nuevo**, y eso da dos señales por el precio de una:

- rol **nuevo** → presupuesto nuevo, iniciativa nueva
- rol de **reemplazo** → tu contacto se fue, hay que remapear la cuenta

`radar_findings.supporting_job_posting_ids` ya existe para trazar la evidencia.
Costo incremental: cero. Además es **anticipatorio**: la vacante aparece antes de
que la persona actualice su perfil.

### ⚠️ d) Bounce de email como detector pasivo

Si un mail a un contacto conocido rebota duro, la persona se fue. Es el detector
más barato que existe, pero requiere que el envío pase por el sistema o que haya
integración con el CRM/Gmail del cliente. Vale la pena si se avanza con el
envío de outbound.

### ⚠️ e) Proveedores licenciados (People Data Labs, Datamagnet, Cognism)

Cubren el gap sin riesgo legal, pero: PDL refresca **por lotes**, así que los
registros llegan con lag respecto del cambio real; y ninguno tiene buena cobertura
LATAM — que es justamente tu diferencial. Los dejaría para cuando un cliente
grande lo pida explícitamente y lo pague.

### ❌ f) Scrapear perfiles vía Apify u otro actor

Es el camino de Proxycurl. Viola el user agreement, expone dato personal bajo tres
regímenes regulatorios, y pone en riesgo la cuenta de Apify de la que dependen dos
pipelines que hoy funcionan. **No lo recomiendo.**

### ❌ g) API oficial de LinkedIn

Sales Navigator tiene alertas de cambio de puesto **como feature de UI para el
usuario final**, pero la API de LinkedIn (Partner Program) no expone esos datos
para reventa ni para ingesta a un producto propio. No hay vía oficial para lo que
se busca.

---

## 5. Recomendación

**Una arquitectura de tres capas, todas con datos que ya están en casa:**

```
Apollo push (job change alerts)  → contactos ya conocidos y enriquecidos
        +
Noticias (people-moves)          → C-level y nombramientos públicos, con fuente
        +
Vacantes (proxy invertido)       → detección anticipada e indirecta
        ↓
   contact_job_changes  (tabla de eventos, no de estado)
        ↓
   ┌────────────────┴────────────────┐
Prospecting                        Churn / expansión
"tu champion se mudó               "el sponsor de tu cliente
 a una cuenta objetivo"             se fue"
```

**Orden de ejecución:**

1. Convertir el evento del cron en señal persistida (2–3 días). Ya está el 80% escrito.
2. Sumar el extractor `people-moves` sobre noticias (~1 semana).
3. Evaluar Apollo job change alerts contra la base real de contactos antes de
   comprometerse (spike de 2 días: medir qué % de los contactos LATAM efectivamente cubre).

Lo que **no** haría: entrar a scrapear perfiles personales. El upside es marginal
frente a las tres capas de arriba, y el downside es perder la cuenta de Apify más
exposición regulatoria sobre dato personal.

---

## Fuentes

- [LinkedIn Wins Legal Case Against Data Scrapers — Social Media Today](https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/)
- [The #1 LinkedIn Scraping Startup Proxycurl Shuts Down — StartupHub.ai](https://www.startuphub.ai/ai-news/startup-news/2025/the-1-linkedin-scraping-startup-proxycurl-shuts-down)
- [Enrichment & job change alerts — Apollo.io](https://www.apollo.io/product/enrichment-job-change-alerts)
- [Use Job Change Alerts to Enrich Contacts — Apollo Knowledge Base](https://knowledge.apollo.io/hc/en-us/articles/5130064363661-Use-Job-Change-Alerts-to-Update-Contacts)
- [Real-Time Intent Signal APIs: Job Changes — Datamagnet](https://www.datamagnet.co/post/real-time-intent-signal-apis-job-changes/)
