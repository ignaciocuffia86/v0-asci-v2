# Plan de mejora — matching de nombres en `screen_account_list`

Estado: **diseño, sin implementar.** Escrito el 27-ago-2026 a partir de la segunda
corrida real del perfil admin: las 78 cuentas tier 2/3 de Marketing Comercial
(hoja "Oscar Bravo"), términos Power BI + stack Microsoft, países `['Chile']`.

Es la continuación directa de `plan-remediacion-screening-y-apollo.md`. Los puntos
1, 2(A) y 2(B) de aquel plan ya están aplicados
(`20260826215500_screening_clave_propia_y_localidad_por_senal.sql`) y esta corrida
los valida: las multinacionales se rescatan por evidencia local (MAPFRE, SURA,
Principal), la fragmentación se consolida y ya no hay `no_match` causado por
nuestro propio filtro de país. Lo que sigue son los defectos que esa corrida
todavía mostró, con su causa raíz y el diseño para cerrarlos.

---

## 0. Qué dejó la corrida del 27-ago

De 78 cuentas: 39 con señal, 26 en ASCI sin señal, **12 ambiguas y 1 "no está en
ASCI"**. Revisadas a mano las 13 problemáticas:

| Caso | Qué devolvió la tool | Qué era en realidad |
|---|---|---|
| `ESSBIO S.A.  - ANSM` | `no_match` | **Essbio está en ASCI y tiene señales.** El sufijo ` - ANSM` (anotación del vendedor) impidió el match exacto y bajó la similitud trigram por debajo del umbral |
| `CAJA COMP. LOS HEROES` | ambigua: `Los Heroes` vs `Caja Los Héroes` (brecha 0.08) | Misma empresa. El candidato con dominio (`losheroes.cl`, 50 contactos) era elegible sin preguntar |
| `MOLYCOP CHILE S.A.` | propuso **`S&A Chile`** con 0.56 | Match incorrecto mostrado con nombre concreto. La empresa real es `Moly-Cop`: el guion parte el token y el trigram no los acerca |
| `BAKELITE Chile S.A.` | propuso **`Bakels Chile`** con 0.65 | Incorrecto: comparten prefijo, no identidad |
| `EMPRESAS MELON S.A.` | propuso `Empresas Melo` | El catálogo no tiene a Melón; el casi-homónimo se presentó como candidata |
| `AMSA - ANTOFAGASTA MINERALS` | ambigua, "4 candidatos empatados" | El separador ` - ` es un alias (sigla + nombre), no parte del nombre |
| `EMP. PORTUARIA VALPARAISO EPV` | ambigua, 2 empatados | `EMP.` es abreviatura de `Empresa`; la sigla final repite la identidad |
| `UNIVERSIDAD DE LOS ANDES` | **matched** → Uniandes de **Colombia** | Homónimo real en otro país. La ficha chilena (uandes.cl) no ganó pese a `countries=['Chile']` |
| `CCU COMPAÑIA CERVECERIAS UNIDAS` | ambigua, 6 empatadas | Variantes de escritura del mismo nombre que la clave laxa todavía no colapsa |
| `BCI LIDER SERVICIOS FINANCIEROS` | ambigua, 5 empatadas | Ídem: mismo conjunto de tokens en distinto orden |
| `CIA PESQUERA CAMANCHACA S.A.` | ambigua, 4 entidades | Fragmentación ya consolidada en señales, pero sigue pidiendo confirmación |
| `TPS TERM PACIFICO SUR VALPARAISO` | ambigua, 2 candidatos | `TERM` abreviatura + sigla al inicio |
| `GASSUR S.A.  (METROGAS STGO.)` | ambigua → Metrogas | Correcto que pregunte: el paréntesis afirma una equivalencia que la tool no puede probar |

Dos lecturas antes de diseñar:

1. **El input de una lista comercial no es un nombre: es una celda de Excel.**
   Trae anotaciones (` - ANSM`), alias (`AMSA - ...`), equivalencias entre
   paréntesis, abreviaturas (`EMP.`, `COMP.`, `TERM`, `CIA`) y siglas sueltas.
   Hoy el pipeline trata toda la celda como un único nombre literal.
2. **El error grave no es la ambigüedad, es la afirmación falsa.** Una fila
   ambigua cuesta una confirmación; `S&A Chile` presentado al lado de
   `MOLYCOP` invita a aceptar un match que es de otra empresa, y `no_match` para
   Essbio pierde una cuenta con señales. GASSUR muestra el contraste: ahí
   preguntar era lo correcto. El objetivo no es "cero ambiguas" sino que cada
   estado diga la verdad.

---

## 1. Cómo funciona hoy (para discutir sobre lo mismo)

`v3.screen_account_list` (versión viva: `20260826215500`):

1. **Normalización del input**: `public.company_core_name` — minúsculas, sin
   acentos, corta en `/`, saca prefijos `grupo|group|holding|the` y sufijos
   societarios **solo al final**. No toca puntuación interna ni anotaciones.
2. **Pasada fuerte**: igualdad `companies.normalized_name = core(input)` (conf
   0.95) y/o dominio `website ILIKE %domain%` (0.97; ambos, 1.00). Quien
   resuelve acá no paga la difusa.
3. **Pasada difusa** (solo pendientes): operador `%` de pg_trgm con umbral 0.45
   sobre `companies.name` (GIN `idx_companies_name_trgm`), similitud =
   `greatest(sim(name, input), sim(normalized_name, core))`, bonus de contención
   de núcleo (0.88) con guarda de 2 tokens. Piso de confianza 0.50: por debajo
   no es candidata.
4. **Consolidación**: `public.company_screen_key` (puntuación→espacio, plural en
   tokens de 6+, espacios colapsados). Mismo key = entidades duplicadas de la
   misma empresa; las señales se suman por key.
5. **Ranking y ambigüedad**: identidad primero (confianza), evidencia como
   desempate. Ambigua si hay rival de key distinto a ≤0.10 del ganador y la
   evidencia no desempata, o si la confianza < 0.75 (`low_confidence`).
6. **Localidad por señal**: `countries` rescata candidatas con contactos en los
   países pedidos aunque la ficha diga otro país; si el filtro dejaría cero,
   salen como `matched_ambiguous` / `country_mismatch`, nunca `no_match`.

Lo que este plan **no** toca, y por qué (ya documentado en `20260826215500` y en
el plan anterior): `company_core_name` / `normalized_name` alimentan
`upsert_company` y `auto_merge_safe_duplicates`; aflojarlos fusiona empresas de
verdad y sin vuelta atrás. Todo lo que sigue vive en el screening: en
`company_screen_key`, en el cuerpo de la RPC o en la capa TS de la tool.

---

## 2. El diseño, por capas

Cada capa ataca una familia de casos de la tabla del §0, es independiente de las
otras, y tiene su guarda contra el daño que podría hacer. El orden es el de
implementación sugerido.

### C1. Variantes del input: la celda se segmenta antes de matchear

**Casos**: ESSBIO, AMSA, GASSUR, TPS. **El de mayor impacto: convierte un
`no_match` falso en una cuenta con señales.**

Del input crudo se generan hasta 4 variantes y **todas** juegan las dos pasadas;
los candidatos de todas las variantes van al mismo pool del input (mismo `idx`),
y la respuesta dice cuál variante matcheó:

- La celda completa (comportamiento actual — ninguna variante puede empeorar lo
  que hoy resuelve).
- Cada segmento partido por ` - `, ` / `, `,` (con espacios alrededor: un guion
  interno tipo `Moly-Cop` NO parte).
- El contenido de paréntesis como variante propia, y el nombre sin el paréntesis:
  `GASSUR S.A. (METROGAS STGO.)` → `gassur` + `metrogas stgo`.
- Descarte de variantes basura: < 3 caracteres, solo dígitos, o puramente
  genéricas (`s.a.`, `chile`, `stgo`).

Así `ESSBIO S.A. - ANSM` produce `essbio` (match exacto de núcleo, conf 0.95) y
`ansm`; `AMSA - ANTOFAGASTA MINERALS` produce la sigla y el nombre, que
convergen en la misma empresa y refuerzan en vez de competir.

**Dónde**: en la CTE `inputs` de la RPC (explota a `input_variants` con el mismo
`idx`), no en la capa TS. La RPC ya agrupa candidatos por `idx`, el fan-out es
natural y el contrato "una fila por input" no cambia. En TS habría que fusionar
respuestas de a pedazos y duplicaría la lógica de ranking.

**Guarda de honestidad**: un match que llegó por una variante parcial no es un
match de la celda entera. Si la única evidencia de identidad viene de un
segmento (típico del paréntesis de GASSUR), la confianza se topea **justo debajo
de `p_match_threshold`** (0.74 con el default de 0.75), para que la fila salga a
confirmar como `low_confidence`, nunca afirmada. Excepción: si dos variantes
distintas del mismo input
convergen en el mismo `screen_key` (AMSA: sigla y nombre apuntan a la misma
empresa), eso ES identidad probada y la confianza no se topea.

**Guarda de performance**: el fan-out multiplica la pasada difusa. Tope de 4
variantes por input y presupuesto medido (§4): si 100 inputs × 4 variantes no
entran en los 8 s de PostgREST, el tope de inputs por llamada baja, no se
recorta la segmentación.

### C2. Matching por tokens con rareza: subconjuntos, abreviaturas y genéricos

**Casos**: LOS HEROES, EMP. PORTUARIA, CCU, BCI, y las guardas de BAKELITE/MELON.
Es la capa más potente y la más delicada.

Hoy la comparación es por trigramas sobre el string entero. La propuesta es una
segunda noción de identidad, por **conjunto de tokens del `screen_key`**, con dos
piezas:

**(a) Rareza por catálogo.** Una tabla chica `company_token_stats(token,
doc_frequency)` materializada desde `companies.name` (refresco periódico o por
migración; son decenas de miles de tokens, no millones). Un token es *genérico*
si su frecuencia supera un percentil a calibrar con datos (candidatos obvios:
`chile`, `empresa(s)`, `grupo`, `caja`, `compania`, `servicios`, `banco`,
`universidad`, `clinica`); es *distintivo* si es raro (`heroes`, `essbio`,
`camanchaca`, `molycop`). No va lista hardcodeada: la frecuencia real del
catálogo ES la lista, y se audita con un `SELECT`.

**(b) Igualdad de identidad tokenizada.** Dos nombres son la misma identidad si
sus tokens **distintivos** coinciden (exacto o por prefijo ≥3 caracteres, que es
lo que resuelve `emp→empresa`, `term→terminal`, `comp→compensacion` sin
diccionario de abreviaturas) y los tokens sobrantes de cada lado son todos
genéricos. El orden no importa (BCI/CCU: mismo multiset, distinto orden).

Con eso:

- `los heroes` ≡ `caja los heroes` ≡ `los heroes caja de compensacion`: el
  distintivo compartido es `los heroes`, los sobrantes (`caja`, `de`,
  `compensacion`) son genéricos → **un solo grupo**, y dentro del grupo gana la
  entidad con identidad externa (dominio, contactos locales, señales) — la regla
  de desempate intra-key que ya existe.
- `banco santander` ≢ `santander consumer`: `consumer` no es genérico y no está
  del otro lado. La rareza es la guarda que hace que "subconjunto" no fusione de
  más.
- BAKELITE vs Bakels, MELON vs Melo: el token distintivo del input **no aparece**
  (ni exacto ni por prefijo — ojo: la relación de prefijo acá existe,
  `melo`⊂`melon`, ver la guarda siguiente).

**Guarda del prefijo**: el match por prefijo vale para *abreviatura contra
palabra* (el corto termina en punto en el input original, o la diferencia de
largo es ≥3: `emp.`→`empresa`), no para dos palabras plenas que difieren en una
letra final (`melo`/`melon`, `bakels`/`bakelite` quedan fuera). Sin esta guarda,
C2 rompería justo los casos F.

**Dónde se usa**: (1) para extender `isDuplicateOfWinner` — un rival cuya
identidad tokenizada es la del ganador no es rival, así LOS HEROES deja de
preguntar; (2) como **veto de candidatura**: una candidata difusa que no
comparte ningún token distintivo con el input no se propone como
`matchedName` por alta que sea su similitud de trigramas (mata `S&A Chile` para
MOLYCOP en el origen).

### C3. Clave aplastada para concatenaciones

**Caso**: MOLYCOP vs `Moly-Cop`. `screen_key` ya convierte `-` en espacio, pero
la *generación* de candidatas es trigram sobre `name` crudo y la similitud entre
`MOLYCOP CHILE S.A.` y `Moly-Cop Chile` no alcanza. Dos cambios chicos:

- La similitud de la pasada difusa suma un tercer término:
  `similarity(replace(screen_key(name),' ',''), replace(screen_key(input),' ',''))`
  — sobre la clave sin espacios, `molycopchile` vs `molycopchile` da 1.0.
- La igualdad de la **pasada fuerte** también prueba la clave aplastada
  (expression index `ON companies ((replace(company_screen_key(name),' ','')))`
  si la medición lo pide; es un índice nuevo y hay que justificarlo con EXPLAIN,
  ver §4).

La comparación de tokens de C2 también se beneficia: `molycop` ≡ `moly cop`
si la versión aplastada de los tokens coincide.

### C4. Candidatas para nombres cortos: word similarity

**Caso**: pendiente §2(c) del plan anterior — MAPFRE ve 1 de sus 108 fichas. No
falló en esta corrida (la ficha exacta existe), pero es la misma familia: la
generación de candidatas es angosta cuando el input es corto, y C1 la vuelve más
urgente porque las variantes segmentadas son cortas (`amsa`, `essbio`, `epv`).

Propuesta: tercera vía de generación, solo para inputs/variantes de núcleo corto
(≤ 8 caracteres o un solo token): operador `<%` (word_similarity) de pg_trgm,
que mide el input contra la *mejor ventana* del nombre y usa el mismo GIN. Con
`pg_trgm.word_similarity_threshold` alto (0.80–0.90, a calibrar): `mapfre <%
'Mapfre Chile Seguros Generales'` da ~1.0 mientras el `%` global da ~0.3.

**Riesgo y por qué va última**: es la capa con más incógnita de performance (el
plan anterior ya lo advertía) y la que más candidatas nuevas mete. Va gateada
por longitud, medida contra producción antes de habilitarla, y con el veto de
C2 aguas abajo para que "más candidatas" no se vuelva "más falsos matches".

### C5. Homónimos entre países: la consolidación aprende a separar

**Caso**: UNIVERSIDAD DE LOS ANDES → Uniandes de Colombia, **afirmado** como
match. Es el error inverso al de LOS HEROES: dos empresas *reales y distintas*
comparten `screen_key`, y la consolidación las trata como duplicados de una
sola. Grave porque el research y el enrichment posteriores corren sobre ese
`companyId`.

Dos reglas:

- **Separación por identidad externa**: dentro de un grupo de mismo
  `screen_key`, si dos entidades tienen **dominios distintos y países distintos**
  (ambos presentes), son homónimos, no duplicados: keys sintéticos separados,
  sus señales no se suman, y compiten como rivales — con lo que la fila puede
  salir ambigua, que para un homónimo real es la verdad.
- **Ranking local cuando hay `countries`**: hoy la evidencia local *rescata*
  candidatas pero no *ordena*. Con `p_countries` presente, entre candidatas de
  confianza empatada (misma brecha de 0.10 que ya define la rivalidad) los
  contactos locales entran al desempate antes que el orden alfabético. Uniandes
  (3 contactos en Chile) pierde contra una ficha uandes.cl con más presencia
  local; si la ficha chilena no existe en el catálogo, la fila sale ambigua con
  la colombiana a la vista — que es exactamente lo que el usuario necesita
  confirmar.

**Guarda**: la separación exige *ambos* campos distintos y presentes. Dominio
distinto solo (o país solo) no separa: el catálogo tiene duplicados legítimos
con un dominio cargado y el otro vacío, y país en blanco es el 87% de las filas.

### C6. El contrato de salida deja de invitar al error

Independiente de las capas anteriores; es lo que hace que un residuo de
matching malo no se convierta en una afirmación falsa del informe.

- **Debajo del umbral no se propone nombre.** `ambiguityReason:
  'low_confidence'` pasa a devolver `matchedName: null` y `companyId: null`; los
  candidatos viajan en `candidates`, explícitamente sin elegir. El informe dice
  "sin match confiable, ¿es alguna de estas?" en vez de poner `S&A Chile` en la
  columna de matcheadas. (Es el §1.4 del plan anterior, que sigue pendiente.)
- **`matchedVia` en cada fila**: `core_exact` | `domain` | `variant:<texto>` |
  `fuzzy` | `word` — auditabilidad de por qué se eligió, y el dato que las
  pruebas necesitan para afirmar *cómo* resolvió, no solo qué devolvió.
- **La variante que matcheó se muestra** (`GASSUR (METROGAS STGO.) → matcheó por
  "metrogas stgo"`), para que quien confirma vea qué parte de su celda hizo el
  trabajo.
- La `interpretationGuidance` de la tool (`lib/v3/services/screen-account-list.ts`)
  se actualiza con las tres cosas.

---

## 3. Qué queda explícitamente afuera

- **Tocar `company_core_name` / `normalized_name` / el merge automático.** Misma
  razón de siempre; cualquier mejora de normalización vive en el screening.
- **Resolver equivalencias de negocio** (¿Gassur ES Metrogas? ¿ANSM ES Essbio?).
  La tool puede acercar los nombres; afirmar la equivalencia es del usuario, y
  el diseño la deja en ambigua a propósito.
- **Bajar el umbral global de trigramas** (0.45): está medido contra producción
  y es lo que sostiene la performance. Las capas agregan vías de candidatura
  selectivas, no aflojan la general.
- **LLM/embeddings para el matching**: el screening es Tier 0 (sin IA, sin
  cupo) y esa propiedad vale más que los últimos puntos de recall. Los casos
  que un modelo resolvería mejor (equivalencias de negocio) son justo los que
  decidimos no resolver solos.

---

## 4. Plan de pruebas

La lección de CLAUDE.md manda: **nada de esto se da por bueno contra datos
sintéticos.** Toda validación corre contra el catálogo real (514k+ empresas),
con la infraestructura que ya existe (`tests/contract/screen-account-list.test.ts`,
gateado por `RUN_SCREEN_CONTRACT_TESTS=1`).

### 4.1 Golden set etiquetado

Las 78 cuentas de esta corrida son el primer golden set real: cada fila tiene
respuesta esperada conocida (las 65 que la tool resolvió bien + las 13 de la
tabla del §0 etiquetadas a mano). Va como fixture
(`tests/contract/fixtures/golden-tier23.json`) con, por fila: input crudo tal
cual la celda, resultado esperado (`status`, empresa o dominio esperado, o
"ambigua está bien acá"), y qué capa la resuelve. Los casos del plan anterior
(los 8 tests de contrato existentes) son la suite de regresión: **ninguno puede
empeorar.**

### 4.2 Aserciones nuevas por capa

| Capa | Caso de regresión mínimo |
|---|---|
| C1 | `ESSBIO S.A.  - ANSM` → matched a Essbio, `matchedVia: variant:essbio`; `AMSA - ...` → un solo contendiente |
| C2 | `CAJA COMP. LOS HEROES` → matched al key de losheroes.cl sin preguntar; `BANCO SANTANDER` sigue sin fusionarse con `Santander Consumer` (control negativo) |
| C2-veto | `MOLYCOP CHILE S.A.` → **nunca** propone `S&A Chile`; `BAKELITE` nunca propone `Bakels` como matched |
| C3 | `MOLYCOP CHILE S.A.` → encuentra `Moly-Cop` si está en catálogo |
| C4 | `MAPFRE` genera >1 candidata; el ganador no cambia |
| C5 | `UNIVERSIDAD DE LOS ANDES` con `countries:['Chile']` → no afirma la ficha de Colombia |
| C6 | Toda fila `low_confidence` tiene `matchedName: null`; `EMPRESAS MELON` no muestra `Empresas Melo` como matcheada |

### 4.3 Métricas sobre el golden set, antes y después de cada capa

- **Afirmaciones falsas** (matched a empresa equivocada): hoy ≥1 (Uniandes);
  objetivo **0**. Es la métrica que manda: una capa que sube recall pero
  produce una afirmación falsa no entra.
- **Pérdidas falsas** (`no_match` de empresa que está): hoy 1 de 78; objetivo 0.
- **Ambiguas evitables** (las que un humano resuelve sin dudar con la info del
  catálogo): hoy ~6 de 12; objetivo ≤2. Las ambiguas *legítimas* (GASSUR,
  homónimos reales) no cuentan como defecto.

### 4.4 Performance, medida como siempre

Contra producción, con EXPLAIN (ANALYZE, BUFFERS), el peor caso de cada capa:

- C1: 100 inputs × 4 variantes, todas difusas (el peor caso nuevo). Techo: 8 s
  de PostgREST. Si no entra: bajar tope de inputs por llamada, no la segmentación.
- C3: el expression index solo si la igualdad aplastada sin índice no entra.
- C4: es la capa que se habilita **última y solo si mide bien**; medir con el
  gate de longitud puesto y con el umbral de word_similarity en 0.80 y 0.90.
- La tabla de frecuencias de C2 se consulta solo para el pool de candidatas de
  cada input (≤ decenas de filas), no en el escaneo: no debería aparecer en el
  plan como costo. Verificarlo.

### 4.5 Aceptación end-to-end

Re-correr por MCP la misma lista tier 2/3 con los mismos términos y comparar
contra `senales_powerbi_microsoft_cuentas_verdes.xlsx` fila por fila. El
criterio de cierre: Essbio aparece con sus señales, Los Héroes sale resuelta,
ninguna fila muestra un nombre incorrecto como matcheado, y las 65 que estaban
bien siguen exactamente igual.

---

## 5. Orden de ejecución propuesto

| # | Qué | Por qué en este orden | Tamaño |
|---|---|---|---|
| 1 | C6 (contrato de salida) | Elimina hoy el daño de los matches malos que las otras capas todavía no evitan; sin migración de matching, es RPC + TS chico | Chico |
| 2 | C1 (variantes del input) | Recupera el `no_match` falso con señales; el caso de mayor costo comercial | Chico-mediano, 1 migración |
| 3 | C2 (tokens con rareza + veto) | Resuelve la mayoría de las ambiguas evitables y es la guarda que C1/C4 necesitan aguas abajo | Mediano: tabla de stats + migración |
| 4 | C3 (clave aplastada) | Chico una vez que C2 existe; el índice solo si la medición lo pide | Chico |
| 5 | C5 (homónimos) | Depende de la separación por identidad externa, que conviene diseñar sobre C2 ya andando | Mediano |
| 6 | C4 (word similarity) | La única con riesgo de performance abierto; entra última, gateada y medida | Mediano |

Cada paso lleva su caso de contrato ANTES de implementar (el golden set del §4.1
se puede armar ya, sin tocar código), y ningún paso se da por bueno sin la
corrida del §4.5.
