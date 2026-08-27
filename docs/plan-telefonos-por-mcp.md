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

El esquema ya tenía todas las columnas. **La única migración que hizo falta fue
de vocabulario**, no de estructura: alinear el CHECK de `phone_status` al de v2
(ver §3.1). Ninguna columna nueva.

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

### 2.1 El reveal, scopeado por principal — HECHO

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

Quedó en `lib/v3/services/mcp-contact-phones.ts`. Dos cosas que no estaban en el
plan y salieron de escribirlo:

- **Se falla antes de gastar si falta el webhook.** Sin `NEXT_PUBLIC_SITE_URL` o
  `APOLLO_WEBHOOK_SECRET` no se llama a Apollo: el waterfall cobra igual y el
  número no vuelve nunca. Es el único error de configuración que cuesta plata.
- **`pending` se marca ANTES de llamar, y se revierte si Apollo no acepta.** Si el
  proceso se cae entre la marca y la respuesta, el estado ya dice que hay un
  pedido en vuelo y una segunda corrida no lo duplica. Pero un `pending` que
  nunca llegó a pedirse es peor que un fallo —parece que todavía puede llegar—,
  así que cuando el waterfall no acepta, la fila vuelve a `not_requested`.

### 2.2 El webhook aprende el camino v3 — HECHO

`app/api/webhooks/apollo/[secret]/route.ts` matcheaba por `apollo_person_id` y
actualizaba **solo** `user_company_contacts`. `v3.account_contacts` tiene la
misma columna, así que el match es el mismo.

El lado v3 vive aparte, en `lib/v3/services/contact-phone-inbox.ts`, y el
webhook lo llama **en un solo punto, antes de sus tres salidas**. No es
cosmético: abajo hay tres `return` distintos —sin teléfono, ya lo tenía, lo
escribimos— y repartir el camino v3 entre los tres es la forma segura de que uno
quede afuera la próxima vez que alguien toque esa función. Lo que v3 hace no
depende del resultado de v2.

Dónde va cada cosa, que es la diferencia con v2: **el número al caché
compartido** (`apollo_contacts_cache`), **el estado a `account_contacts`**. v2
guarda el número en la fila del usuario; en v3 eso duplicaría el mismo teléfono
por workspace.

**Las dos reglas que no son obvias**, y que por eso tienen test propio:

- El **estado** se toca solo en filas que están en `pending`. Pedir es por
  workspace: si A pagó el reveal y B tiene a la misma persona sin haberla
  pedido, el estado de B sigue en `not_requested`. Marcarle `received`
  afirmaría un pedido que no hizo.
- La **fecha de verificación** se toca en todas las filas de esa persona, haya
  pedido o no, porque describe el DATO y no el pedido. B se beneficia del número
  que pagó A —está en el caché compartido, que es el punto del diseño— y sin la
  fecha, `get_company_contacts` lo contaría como `never_verified` y
  `withUsablePhone` daría 0 teniendo el número en la mano.

El resultado del lado v3 viaja en el log del webhook y en las seis respuestas.
Sin eso, un teléfono que no aterriza se pierde en silencio: v2 devuelve 200
igual y nadie se entera.

Depende de la migración `20260827172000`: sin ella, el CHECK viejo rechaza
`received` y `not_available`.

### 2.2b Los teléfonos viejos, al caché compartido — HECHO

F2 dejó el camino para que los teléfonos NUEVOS aterricen en
`apollo_contacts_cache`. Los viejos seguían solo en `user_company_contacts`, y
sin moverlos el MCP habría salido a pagarle a Apollo por números que ya
compramos — el mismo error que se acaba de cerrar para los emails.

Medido antes de escribir la migración (`20260827190000`):

| | |
|---|---|
| Filas con teléfono en `user_company_contacts` | 106 |
| **Personas distintas** | **80** |
| De esas, ya con fila en el caché | **80** (0 huérfanas) |
| Con móvil / solo fijo | 65 / 15 |
| Personas con dos números distintos entre sus filas | **0** |

Las 106 filas eran 80 personas: la tabla duplica el contacto por bookmark, hasta
4 filas por persona, así que contar filas infla el número un 32%. Cero
conflictos y cero filas nuevas — son 80 `UPDATE` sobre filas que ya existían.

**No se insertan personas nuevas.** Importar al caché gente que nunca pasó por el
enrichment de v3 es otra decisión: traería su email, su cargo y su empresa, y no
es lo que este backfill viene a resolver.

Dos guardas que parecen de más y no lo son: solo se llena la columna si está
**vacía** (misma regla que v2 y el webhook), y el `UPDATE` excluye las filas
donde no hay nada real que escribir — si no, tocaría `updated_at` de filas que no
cambian, y `splitByContactCache` usa esa fecha para decidir frescura: las
estaríamos rejuveneciendo sin motivo.

Verificado después de aplicar: 80 teléfonos en el caché (65 móvil, 15 fijo),
4.416 filas totales —ninguna nueva—, 0 personas de v2 sin espejo, y re-correrla
toca **0 filas**.

### 2.3 Dos tools — HECHO

- **`request_contact_phones`** — pide teléfonos para contactos ya enriquecidos de
  una cuenta. Gasta créditos. Registrada en `lib/v3/mcp-server-tools.ts` con
  `userConfirmed: true` obligatorio, igual que el enrichment.
- La lectura **no necesita tool nueva**: `get_company_contacts` ya la hace.

La regla del gasto vive en `decidirPedidos`, exportada aparte y pura: sin base ni
red, para que se pueda testear el criterio que decide 5 créditos por contacto
(`tests/unit/v3/contact-phone-requests.test.ts`).

### 2.4 La medición

El perfil admin se sostiene en que todo gasto queda medido. `apollo_api_calls`
ya registra `credits_estimated` por llamada, y de ahí sale el número real:

| | |
|---|---|
| Llamadas | 146 |
| Créditos que registra nuestra telemetría | 620 |
| Teléfonos obtenidos | 80 |
| **Costo real por teléfono obtenido** | **5** |

**Apollo NO cobra cuando no tiene el teléfono** (confirmado por el dueño). Eso
corrige el número que este plan traía: 7,75 salía de dividir 620 entre 80, pero
620 es lo que registra `credits_estimated`, que anota 5 por llamada sin mirar el
resultado. Como 45 de los 146 pedidos volvieron sin número y no se cobraron, el
gasto real es del orden de 5 × 80 = 400, y el costo por teléfono obtenido es **5,
no 7,75**.

Sigue siendo **5 veces el precio de un email**, así que la conclusión de diseño
no cambia: esto merece su propio paso y no venir incluido en el enrichment.

**Consecuencia aparte, que no es de este plan pero sale de acá:**
`credits_estimated` sobreestima el gasto de teléfono en ~35% (620 contra ~400).
Cualquier informe de costo que lo sume como si fuera la factura de Apollo está
inflando. Se puede reconciliar contra el webhook, que ya sabe si hubo número.

---

## 3. Los tres riesgos, medidos

### 3.1 Los vocabularios no coincidían — RESUELTO

| | Valores |
|---|---|
| v2 (`user_company_contacts`, webhook) | `not_requested` · `pending` · `received` · `not_available` |
| v3 (`account_contacts`, CHECK viejo) | `unknown` · `not_requested` · `processing` · `available` · `unavailable` · `failed` |

Solo `not_requested` estaba en las dos, así que el webhook —que escribe las
palabras de v2— no podía tocar `v3.account_contacts` sin que el CHECK lo
rechazara. El camino de vuelta del teléfono no podía existir.

Es la misma forma exacta del bug que ya mató el enrichment una vez:
`linkContactsToAccount` escribía `role_origin: 'mcp_enrichment'`, el CHECK lo
rechazaba y todo moría con `LINK_CONTACTS_FAILED`. El CHECK tenía razón las dos
veces.

Había además una tercera desalineación viva en el código: el default de la
columna era `'unknown'`, `linkContactsToAccount` escribía `'not_requested'` y
`mcp-contact-coverage.ts` contaba pendientes buscando `'processing'` — que nadie
escribía nunca, o sea que `pendingPhone` daba **0 por construcción**.

**Se alineó v3 a v2**, y v2 gana no por antigüedad sino porque es el vocabulario
que está en producción con 5.148 filas y el que habla el webhook de Apollo, que
es la pieza que ninguna de las dos plataformas controla. Alinear v3 a v2 es un
CHECK y un default; al revés sería migrar datos vivos y reescribir el webhook.

La fuente única es `lib/shared/phone-status.ts`, y el mapeo de las palabras
viejas está escrito dos veces a propósito —ahí y en el `CASE` de la migración—
con un test que verifica que no diverjan. Se pierde `failed`: desde el lado de
quien lee un informe es indistinguible de que Apollo no entregara, y tener las
dos palabras obligaba a explicar la diferencia en cada informe.

### 3.2 El 11,3% que se cuelga

16 de 141 pedidos quedaron en `pending` para siempre: se gastó el crédito y el
webhook nunca llegó. En la UI eso es una fila con un spinner que alguien ignora.
En un lote de 200 contactos son ~22 estados que nunca cierran, y una tool que
reporta "22 pendientes" indefinidamente es una tool que se deja de leer.

Hace falta un vencimiento: pasado un plazo, `pending` → `not_available`, que en
el vocabulario alineado es el estado que significa "se pidió, se pagó y no hay
número". Un pendiente eterno es la versión teléfono del `null` que se lee como
`0`: un estado que parece información y no lo es.

Queda como F4 y no se hizo acá porque hoy no hay nada que vencer —
`v3.account_contacts` tiene 0 filas— y el plazo correcto se elige mirando cuánto
tarda un webhook real en llegar, no de memoria.

### 3.3 El crédito cuando no hay teléfono — RESUELTO: no se cobra

31,9% de los pedidos terminan en "Apollo no lo tiene", y **esos no se cobran**
(confirmado por el dueño). La incógnita que este plan traía queda cerrada, y con
ella baja el costo por teléfono obtenido de 7,75 a 5 (ver §2.4).

Queda una consecuencia: nuestra propia telemetría no lo sabe. `credits_estimated`
anota 5 por llamada sin mirar el resultado, así que sobreestima ~35%.

### 3.4 Volver a pagar por gente que ya tenemos

No estaba en el plan original y es el más caro de los tres, porque no afecta solo
al teléfono: afecta a TODO el enrichment.

El caché de búsqueda acierta solo cuando la consulta entera se repite —mismo
organization_id, mismos cargos, mismo maxResults—. Cambiar un cargo la falla por
completo y se vuelve a enriquecer, y a pagar, a gente que ya está en la base.

Medido sobre las 4.223 llamadas a `people/match` del historial:

| | |
|---|---|
| Llamadas totales | 4.223 |
| Personas distintas | 3.300 |
| **Llamadas repetidas sobre la misma persona** | **923** |
| De esas, dentro de la ventana de frescura | **921** |
| De esas, el mismo día | 677 |
| Refresh legítimo (más de 90 días) | **2** |

**921 créditos pagados por datos que ya teníamos**, sobre 4.223: el 21,8%.

La regla: una fila en `apollo_contacts_cache` significa que ya pagamos por esa
persona —`writeSearchCache` solo inserta contactos ya enriquecidos— así que
dentro de la ventana no se vuelve a pedir, **tenga email o no**. Que Apollo no
tenga el email también es una respuesta, y ya la compramos. Fuera de la ventana
sí se vuelve a pedir: ahí el gasto compra un dato nuevo.

Ante cualquier error de lectura del caché se pide todo. La dirección segura del
error es gastar de más; devolver un hit falso sería entregar un contacto vacío
como si fuera real, y encima sin haber preguntado.

---

## 4. Tres decisiones que son del dueño

**a. ¿Sobre qué subconjunto? — DECIDIDO: email verificado Y cargo que matchea.**
Pedir teléfono para todos los contactos de 37 cuentas es del orden de 185
personas: con el costo corregido y la tasa de entrega real (56,7%), ~105
teléfonos y ~525 créditos. Con el filtro se paga solo por los contactos que ya
probaron ser los correctos —los que ibas a llamar igual—, que es donde 5 créditos
contra 1 del email se justifican.

Los descartes viajan en la respuesta con su motivo, y el ORDEN importa: "ya tiene
teléfono" y "pedido en curso" van antes que los de calificación, porque son los
que responden *por qué no se gastó*. Si un contacto ya tiene el número, que
además no tenga el email verificado es ruido: informarlo mandaría a arreglar un
email para conseguir un dato que ya está en la base.

**b. ¿La tool espera o no? — DECIDIDO: no espera.** El reveal es asíncrono con
~57% de entrega; una tool que espera bloquea la conversación por algo que la
mitad de las veces no llega. `request_contact_phones` devuelve qué se pidió y
termina, y **los resultados se leen por cuenta con `get_company_contacts`**, que
ya está construido para eso (`hasPhone`, `phoneStatus`, `freshness.phone`,
`pendingPhone`).

Consecuencia de diseño que sigue de esto: el estado es la única forma de saber
qué pasó, así que tiene que ser legible sin glosa externa. Por eso
`PHONE_STATUS_MEANING` viaja en el payload — `not_available` se lee como "esta
persona no tiene teléfono" cuando en realidad es "Apollo no nos lo dio, y el
crédito se gastó igual".

**c. ¿El cooldown de 7 días aplica en admin? — DECIDIDO: no.** Es un tope
administrativo, no un freno técnico, y el perfil admin existe para no tenerlos.
Se sigue midiendo y avisando; no frena.

Lo que SÍ frena, y es la regla que lo reemplaza: **antes de salir a Apollo se
revisa el caché de contactos.** Ver §3.4 — no es un tope sino no pagar dos veces
por el mismo dato, que es una distinción distinta y mucho más útil.

---

## 5. Fases

| | Qué | Depende de |
|---|---|---|
| ~~**F1**~~ | ~~La traducción de estados en una función pura + tests.~~ **HECHO.** `lib/shared/phone-status.ts` + migración `20260827172000` + `pendingPhone` arreglado. | — |
| ~~**F2**~~ | ~~El webhook aprende v3.~~ **HECHO.** `lib/v3/services/contact-phone-inbox.ts`, enganchado en un solo punto del webhook. Sin tool todavía, así que no hay gasto nuevo. | F1 |
| ~~**F3**~~ | ~~El servicio de reveal scopeado por principal + `request_contact_phones`.~~ **HECHO.** `lib/v3/services/mcp-contact-phones.ts` + la tool registrada. Acá empieza a gastar: 5 créditos por pedido aceptado. | F2 |
| **F4** | Vencimiento de `pending` → `not_available` y el costo de teléfono en `get_cost_summary`. | F3 |

F1, F2 y el backfill no gastaron un crédito: armaron el camino de vuelta y
metieron en el caché los 80 teléfonos que v2 ya había pagado. F3 es la que
empieza a gastar, y por eso iba última de las tres. Queda F4, que no gasta: es
vencer los `pending` colgados y mostrar el costo del teléfono en
`get_cost_summary`.

---

## 6. Lo que NO se hace

- **No se toca la UI ni `user_company_contacts`.** Ese camino funciona, tiene 106
  filas con teléfono y no hay motivo para arriesgarlo.
- **No se piden teléfonos dentro de `run_contact_enrichment`.** Un crédito por
  email y 5 por teléfono son decisiones distintas; meterlas en la misma llamada
  esconde la segunda detrás de la primera —y la más cara de las dos.
- **No se inventa un teléfono "probable".** Si Apollo no lo tiene, el campo va
  vacío y el estado lo dice.
