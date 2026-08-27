# Teléfonos por MCP

Sale de una corrida real del perfil admin: se pidió una base de 37 cuentas con
contacto, y el enrichment devolvió email pero no teléfono. La respuesta que dio
el modelo —"el número de Apollo se pide aparte, es asíncrono y cuesta créditos
adicionales"— describe bien el mecanismo pero omite lo único que importaba: **por
esta vía no se puede pedir**. No es una decisión de costo, es una tool que no
existe.

Todo lo de abajo está medido contra producción el 27-ago-2026.

---

## 1. Esto es más chico de lo que parece

El esquema ya está entero. **No hace falta ninguna migración.**

| Tabla | Ya tiene |
|---|---|
| `v3.account_contacts` | `phone_status`, `phone_requested_at`, `phone_last_verified_at`, `apollo_request_id` |
| `public.apollo_contacts_cache` | `phone`, `mobile_phone` |

Y la lectura ya está construida: `get_company_contacts` devuelve hoy `hasPhone`,
`phoneStatus`, frescura por campo (`freshness.phone`) y hasta un contador
`pendingPhone`. O sea que la mitad de consumo del contrato existe y nunca se
puede activar, porque nada escribe del otro lado.

El reveal en sí también funciona, y no marginalmente. Historial completo
(21-abr a 12-ago), contado por **persona distinta** —`user_company_contacts`
duplica el mismo contacto por bookmark, así que contar filas infla todo—:

| | Personas | |
|---|---|---|
| Con pedido de teléfono | **141** | |
| Terminaron con teléfono | **80** | 56,7% |
| Apollo no lo tiene | **45** | 31,9% |
| Colgadas en `pending` | **16** | 11,3% |

---

## 2. Lo que falta: cuatro piezas

### 2.1 El reveal, scopeado por principal

Hoy vive en `revealProspectPhone` (`app/actions/apollo.ts`) y es una Server
Action de la UI: entra por `auth.getUser()` y lee `public.user_company_contacts`
filtrando por `user_id`. Nada de eso existe en una llamada MCP, que llega con un
`McpPrincipal` y escribe en `v3.account_contacts`.

Lo que hay que mover es poco —armar la webhook URL, marcar el estado, llamar a
`/people/match` con `run_waterfall_phone=true` en query params— pero la
resolución del contacto y la escritura cambian de tabla.

**Lo que NO hay que copiar:** el modo waterfall es el que entrega por webhook.
Con `reveal_phone_number=true` a secas Apollo busca solo en su base y devuelve un
`request_id` que exige polling, sin webhook. Está documentado en el código actual
y conviene que siga estándolo.

### 2.2 El webhook tiene que aprender el camino v3

`app/api/webhooks/apollo/[secret]/route.ts` matchea por `apollo_person_id` y
actualiza **solo** `user_company_contacts`. La buena noticia es que
`v3.account_contacts` tiene la misma columna `apollo_person_id`, así que el match
es el mismo.

La decisión de diseño que hay que respetar: en v3 **la PII vive en el caché
global compartido**, y `account_contacts` solo referencia `apollo_cache_id`. O
sea que el teléfono va a `apollo_contacts_cache.mobile_phone` / `.phone`, y en
`account_contacts` va únicamente el estado. Escribir el teléfono por workspace
duplicaría PII sin necesidad.

### 2.3 Dos tools

- **`request_contact_phones`** — pide teléfonos para contactos ya enriquecidos de
  una cuenta. Gasta créditos.
- La lectura **no necesita tool nueva**: `get_company_contacts` ya la hace.

### 2.4 La medición

El perfil admin se sostiene en que todo gasto queda medido. `apollo_api_calls`
ya registra `credits_estimated` por llamada, y de ahí sale el número real:

| | |
|---|---|
| Llamadas | 146 |
| Créditos estimados | **620** |
| Por llamada | 5 (0 en las que fallaron antes de llamar) |
| **Por teléfono efectivamente obtenido** | **7,75** |

Contra **1 crédito por email**. Es la comparación que hay que poner delante de
quien decide, y el motivo por el que esto merece su propio paso y no venir
incluido en el enrichment.

---

## 3. Los tres riesgos, medidos

### 3.1 Los vocabularios no coinciden — y ya nos costó una vez

| | Valores |
|---|---|
| v2 (`user_company_contacts`, webhook) | `not_requested` · `pending` · `received` · `not_available` |
| v3 (`account_contacts`, CHECK) | `unknown` · `not_requested` · `processing` · `available` · `unavailable` · `failed` |

Solo `not_requested` está en las dos. Si el webhook escribe `received` en
`v3.account_contacts`, el CHECK lo rechaza.

Esto ya pasó, con la misma forma: `linkContactsToAccount` escribía
`role_origin: 'mcp_enrichment'`, el CHECK lo rechazaba y el enrichment entero
moría con `LINK_CONTACTS_FAILED`. El CHECK tenía razón las dos veces.

**Hay una tercera desalineación, ya presente en el código de hoy:** el default de
la columna es `'unknown'`, `linkContactsToAccount` escribe `'not_requested'`, y
`mcp-contact-coverage.ts` cuenta pendientes buscando `'processing'`. Tres
palabras para el mismo eje. Conviene fijar la traducción en **una** función pura
y testeada, no en cada punto de escritura.

### 3.2 El 11,3% que se cuelga

16 de 141 pedidos quedaron en `pending` para siempre: se gastó el crédito y el
webhook nunca llegó. En la UI eso es una fila con un spinner que alguien ignora.
En un lote de 200 contactos son ~22 estados que nunca cierran, y una tool que
reporta "22 pendientes" indefinidamente es una tool que se deja de leer.

Hace falta un vencimiento: pasado un plazo, `processing` → `failed`, dicho como
"se pidió, se pagó y no llegó" y no como "todavía puede llegar". Un pendiente
eterno es la versión teléfono del `null` que se lee como `0`.

### 3.3 El crédito se gasta aunque no haya teléfono

31,9% de los pedidos terminan en "Apollo no lo tiene". No tengo medido si esos
cobran igual —`credits_estimated` es nuestra estimación, no la factura de
Apollo— así que va como **incógnita explícita**, no como supuesto. Si cobran, el
costo real por teléfono obtenido es el 7,75 de arriba; si no, baja. Antes de
correr un lote grande conviene confirmarlo contra el uso real de la cuenta de
Apollo.

---

## 4. Tres decisiones que son del dueño

**a. ¿Sobre qué subconjunto?** Pedir teléfono para todos los contactos de 37
cuentas es del orden de 185 personas ≈ 1.435 créditos. La alternativa es pedirlo
solo para los que ya tienen email verificado y cargo que matchea, que es donde el
teléfono agrega algo.

**b. ¿La tool espera o no?** El reveal es asíncrono con ~57% de entrega. Una tool
que espera bloquea la conversación por algo que la mitad de las veces no llega.
Una que no espera devuelve "pedidos: 185" y obliga a volver a preguntar. Mi
recomendación: **no esperar**, y que `get_company_contacts` sea el lugar donde se
leen los resultados — que además ya está construido para eso.

**c. ¿El cooldown de 7 días sigue aplicando en admin?** Hoy `revealProspectPhone`
no reintenta antes de 7 días. Es un tope que protege del gasto repetido, no un
tope de plan; por el criterio de "sin bloqueo, nunca sin medición" tendría que
seguir midiéndose y avisando, pero no frenar. Lo dejo planteado porque es gasto
irrecuperable y la decisión es tuya.

---

## 5. Fases

| | Qué | Depende de |
|---|---|---|
| **F1** | La traducción de estados en una función pura + tests. Alinea el default `unknown`, el `not_requested` que se escribe y el `processing` que se lee. | — |
| **F2** | El webhook aprende v3: teléfono al caché, estado a `account_contacts`. Sin tool todavía, así que no hay gasto nuevo. | F1 |
| **F3** | El servicio de reveal scopeado por principal + `request_contact_phones`. Acá empieza a gastar. | F2 |
| **F4** | Vencimiento de `processing` → `failed` y el costo de teléfono en `get_cost_summary`. | F3 |

F1 y F2 no gastan un crédito y dejan el camino de vuelta funcionando, que es lo
que hoy no existe. F3 es la única fase que necesita las decisiones del punto 4.

---

## 6. Lo que NO se hace

- **No se toca la UI ni `user_company_contacts`.** Ese camino funciona, tiene 106
  filas con teléfono y no hay motivo para arriesgarlo.
- **No se piden teléfonos dentro de `run_contact_enrichment`.** Un crédito por
  email y 7,75 por teléfono son decisiones distintas; meterlas en la misma
  llamada esconde la segunda detrás de la primera.
- **No se inventa un teléfono "probable".** Si Apollo no lo tiene, el campo va
  vacío y el estado lo dice.
