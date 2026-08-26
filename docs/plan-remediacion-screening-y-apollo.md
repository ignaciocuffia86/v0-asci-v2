# Plan de remediación — screening de listas y enrichment de Apollo

Estado: **propuesto, sin implementar.** Escrito el 26-ago-2026 a partir de la primera
corrida real del perfil admin: 75 cuentas de Chile, señal Power BI, con el objetivo de
enriquecer tomadores de decisión de TI desde Apollo.

Cada causa raíz de acá está **medida contra producción**, no inferida. Los comandos que
la producen están en cada sección para poder repetirlos.

---

## 0. El objetivo, que es lo que ordena las prioridades

> Sobre una lista de cuentas de Chile, traer señales de Power BI y después enriquecer
> desde Apollo para conseguir tomadores de decisión de TI.

De las 75 cuentas, la corrida dejó:

| Estado | Cuentas | Qué significa para el objetivo |
|---|---|---|
| Tiene la señal | 24 | Sirven ya |
| Está en ASCI, sin la señal | 30 | Sirven para enrichment, no para el pitch de Power BI |
| **Hay que confirmar cuál es** | **14** | **Frenan el trabajo: 19% de la lista** |
| **No está en ASCI** | **7** | **Se pierden, y 6 de las 7 SÍ están** |

O sea: **21 de 75 (28%) no llegan al enrichment por defectos de matching, no por falta
de datos.** Ese es el costo que este plan viene a bajar.

---

## 1. Falsos "elegir entre N candidatas" (14 filas)

### La causa raíz NO es la regla de ambigüedad

La primera hipótesis era que el umbral de ambigüedad estaba mal calibrado. Es falso. La
regla del RPC dice: hay ambigüedad si un rival de OTRA entidad (`core_key <> winner_core`)
queda a menos de 0.10 del ganador. La regla es razonable. **El problema es que "otra
entidad" está mal definida.**

Las seis parejas que dispararon la ambigüedad, con su brecha real:

| Nombre de la lista | Ganadora | Segunda | Brecha |
|---|---|---|---|
| AMSA - ANTOFAGASTA MINERALS | `Antofagasta Minerals (AMSA)` | `Antofagasta Minerals AMSA` | **0.00** |
| CIA PESQUERA CAMANCHACA S.A. | `Cia. Pesquera Camanchaca S.A.` | `Cia.Pesquera Camanchaca S.A.` | **0.00** |
| CCU COMPAÑIA CERVECERIAS UNIDAS | `CCU "Compañía Cervecería Unidas"` | `CCU (Compañia Cervecerias Unidas)` | **0.00** |
| BCI LIDER SERVICIOS FINANCIEROS | `Lider Bci Servicios Financieros` | `Servicios Financieros S.A. Lider Bci` | **0.00** |
| LABORATORIO SAVAL S.A. | `Laboratorio Saval.` | `Laboratorios SAVAL S.A.` | 0.03 |
| CAJA COMP. LOS HEROES | `Los Heroes` | `Caja Los Héroes` | 0.08 |

**Son la misma empresa escrita distinto.** `Antofagasta Minerals (AMSA)` y
`Antofagasta Minerals AMSA` difieren en dos paréntesis. `Cia. Pesquera Camanchaca S.A.`
y `Cia.Pesquera Camanchaca S.A.` difieren en **un espacio**. Y sin embargo el RPC las
trata como entidades rivales, porque `isDuplicateOfWinner` es `false` para todas.

El mecanismo de consolidación existe y es correcto: el RPC agrupa por `core_key`
(`company_core_name`) y excluye del conteo de rivales a las que colapsan con la ganadora.
Lo que falla es el normalizador:

```sql
select public.company_core_name('Antofagasta Minerals (AMSA)'),  -- antofagasta minerals (amsa)
       public.company_core_name('Antofagasta Minerals AMSA');    -- antofagasta minerals amsa
```

`company_core_name` baja a minúsculas, saca acentos y saca sufijos legales, pero **no saca
puntuación ni normaliza espacios**.

### Segundo defecto, de reporte

El número que ve el usuario —"Elegir entre 19 candidatas"— es `candidate_count`, que es
`count(*) OVER (PARTITION BY idx)`: **el pool entero de candidatas**, no las que están
realmente empatadas. En AMSA el pool es 19 pero la contienda real es entre 2. Pedirle a
alguien que elija entre 19 cuando hay 2 en disputa es lo que hace que se sienta roto.

### Qué hacer

1. **Endurecer `company_core_name`**: sacar toda puntuación (`(){}[].,"'&-`), colapsar
   espacios múltiples. Con solo esto, **4 de las 6 parejas colapsan** y dejan de ser
   ambiguas.
2. Para las otras dos hace falta más: singularizar (`laboratorios` → `laboratorio`) y
   tratar prefijos genéricos de tipo societario (`caja`, `compañía`). Es opinable y
   riesgoso: **va en un segundo paso, medido aparte.**
3. **Reportar contendientes, no pool**: exponer `contenderCount` = rivales con
   `core_key <> winner_core` dentro de la brecha, y usar ESE número en el informe.
   `candidateCount` puede quedar como dato de diagnóstico.
4. **No proponer un nombre cuando la confianza es baja.** `BAKELITE Chile S.A.` matcheó
   `Bakels Chile` (0.65) y `MOLYCOP CHILE S.A.` matcheó `S&A Chile` (0.56) — las dos son
   **incorrectas**, y el informe las muestra con un nombre concreto al lado, que invita a
   aceptarlas. Debajo del umbral, la fila tiene que decir "sin match confiable" y ofrecer
   los candidatos sin elegir uno.

### Cómo se valida

Contra el catálogo real, no contra sintéticos (§ Migraciones de CLAUDE.md). El caso
`Cia. Pesquera Camanchaca` vs `Cia.Pesquera Camanchaca` es el test de regresión: un
espacio no puede partir una empresa en dos.

---

## 2. Los 7 "no está en ASCI" — 6 sí están

### Reproducción

```sql
-- Con países: los 7 dan no_match, y filteredByCountry = 1
select v3.screen_account_list('[{"input":"MAPFRE"}, ...]'::jsonb, null, null, array['Chile'], 2, 5, 0.75);
-- Sin países: 6 de 7 matchean
select v3.screen_account_list('[{"input":"MAPFRE"}, ...]'::jsonb, null, null, null,           2, 5, 0.75);
```

| Nombre | Ficha que existe | País de esa ficha |
|---|---|---|
| MAPFRE | MAPFRE | Spain |
| SURA | SURA | Colombia |
| PRINCIPAL FINANCIAL GROUP | Principal Financial | United States |
| EWOS | EWOS | Norway |
| UNIVERSIDAD DE LOS ANDES | Universidad de los Andes | Colombia |
| UNIVERSIDAD CATOLICA DEL MAULE | (ficha) | **United States** ← dato mal cargado |
| ESSBIO S.A. - ANSM | — | no matchea ni sin país |

### Dos causas encadenadas

**(a) La generación de candidatas es demasiado angosta para marcas cortas.** El catálogo
tiene 108 fichas que contienen "mapfre" y 117 que contienen "sura", pero el umbral de
trigramas (`pg_trgm.similarity_threshold = 0.45`) contra un nombre de 6 caracteres solo
alcanza a la ficha que se llama exactamente igual. `filteredByCountry: 1` lo confirma:
**se generó UNA sola candidata**, no 108.

**(b) Esa única candidata es la casa matriz global, y el filtro de país la elimina.** El
filtro compara contra `companies.country`, que en esa ficha es el país del HQ. Una
multinacional con operación en Chile queda afuera por tener la sede en España.

El filtro de país ya es prudente con los nulos (`country IS NULL` no excluye), y hace
bien: **el 87,4% del catálogo no tiene país** (452.389 de 517.326). Lo que no contempla
es el caso opuesto: país presente pero irrelevante para la pregunta.

### La decisión de diseño que hay que tomar

Hoy `countries: ["Chile"]` significa *"la ficha dice Chile"*. Hay dos lecturas
alternativas y **hay que elegir una explícitamente**:

| Opción | Qué significa | Costo |
|---|---|---|
| **A. Localidad por señal** (recomendada) | La empresa es chilena si su **evidencia** (contactos, vacantes) está en Chile, sin importar el HQ | Es la semántica correcta para multinacionales. Requiere mirar las señales antes de filtrar: más caro |
| B. País como preferencia, no como filtro | El país ordena candidatas pero nunca elimina la última | Barato y evita el "no está" falso. No resuelve el caso de dos fichas legítimas en países distintos |
| C. Statu quo + red de seguridad | Si el filtro dejaría cero candidatas, devolver las excluidas como `matched_ambiguous` con motivo `country_mismatch` | El más chico de todos. **Va igual, sea cual sea la opción elegida** |

**Lo que no se negocia es C**: `no_match` significa "no está en el catálogo", y decir eso
cuando en realidad se excluyó algo es reportar mal. Un dato que descartamos nosotros no
puede presentarse como un dato que no existe.

**(c) Aparte:** ampliar la generación de candidatas para nombres cortos (bajar el umbral
de trigramas cuando el core es corto, o sumar match por palabra completa). Sin esto,
MAPFRE va a seguir viendo 1 de sus 108 fichas.

---

## 3. El guard de "lugares del plan" no debería existir en admin

**Síntoma:** "22 de 48 lugares que había libres, ahora quedan 26".

**Causa:** `lib/v3/services/mcp-batch-estimate.ts:146` calcula
`slotsAvailable = followedCap - followedCount` y la línea 212 empuja un **bloqueo** si no
alcanza. De todos los cálculos de esa función, **solo `checkResearchQuota` recibe
`principal.unrestricted`** (línea 150). Los lugares del plan quedaron afuera del flag.

Hoy no bloqueó porque sobraban lugares. Con un lote de 60 cuentas, bloquearía.

**Qué hacer:**

1. Pasar `principal.unrestricted` al cálculo de lugares: **seguir midiendo, dejar de
   bloquear**. Es la misma regla que ya rige en el resto: *sin bloqueo, nunca sin
   medición*. El bloqueo pasa a `wouldBlockReason`, como en `checkResearchQuota`.
2. Sacar del texto la mención a lugares cuando la credencial no tiene topes: hoy
   `mcp-account-lifecycle.ts:125` y `:263` dicen *"Pedí confirmación al usuario antes de
   llamar save_account"*, y para admin eso es exactamente el ruido que el perfil vino a
   eliminar.

---

## 4. El lote no relevó la confirmación de Apollo

**Síntoma:** el modelo anunció que *"cada una necesita su confirmación propia
(prepare_contact_enrichment → run_contact_enrichment)"*, que es lo contrario de lo que
dicen las `instructions` del server admin.

**Causa: las dos descripciones se contradicen.**

- `prepare_contact_enrichment` **sí** tiene la excepción del lote: *"Salvo que pases
  `batchJobId`: ahí el gasto ya está autorizado por el batchPlanHash…"*.
- `run_contact_enrichment` dice, sin excepción alguna: *"Requiere confirmación explícita
  del usuario sobre el costo mostrado en la preparación."*

El modelo obedeció la descripción de la tool que ejecuta el gasto, que es lo correcto de
su parte. Y `ADMIN_DESCRIPTION_RULES` no reescribe ninguna de las dos **a propósito**, con
un test que lo fija (`mcp-admin-profile.test.ts`: *"el gasto en Apollo conserva su
confirmación"*).

**Qué hacer:**

1. Agregar la excepción a la descripción de `run_contact_enrichment`: si el `planHash`
   vino de una preparación con `batchJobId`, el gasto **ya fue autorizado** por el
   batchPlanHash y no hay que volver a preguntar.
2. Que `run_contact_enrichment` **devuelva qué techo lo autorizó** (`ceiling`), como ya
   hace `prepare`. Así el modelo puede decirlo con precisión en vez de deducirlo.
3. Actualizar el test para que fije la intención correcta: lo que se preserva es la
   confirmación **del plan** (una por lote), no la re-confirmación por cuenta. Sin
   `batchJobId` no cambia nada: sigue haciendo falta confirmar.

---

## 5. El tope de 10 cargos trunca en silencio

**Síntoma:** se cargaron 18 cargos en el lote; el plan topea en 10 por ejecución.

**Causa:** `lib/v3/mcp-contact-coverage.ts:82` (`maxRoles = limits.maxRoles || 10`) y
`lib/v3/services/mcp-contact-enrichment.ts:338`
(`sanitizeTitleList(input.roles, { max: limits.maxRoles })`) **truncan**. El recorte
ocurre en la ejecución, cuando el gasto ya está autorizado, y se queda con los primeros N
del arreglo — no con los más valiosos.

**Qué hacer:**

1. **El truncamiento silencioso se termina, en todos los perfiles.** Si llegan más cargos
   que el tope, hay que decirlo **en la cotización** (`estimate_batch` /
   `prepare_contact_enrichment`), no descubrirlo al ejecutar. Es el mismo principio del
   presupuesto de Apollo: lo que va a pasar se dice antes de que se pague.
2. Para `unrestricted`, levantar el tope: es un límite de plan, y el perfil admin existe
   para no tenerlo. Sigue midiéndose.
3. Si el tope rige, que el recorte sea **por prioridad explícita**, no por orden de
   llegada del arreglo.

---

## 6. Orden de ejecución

El orden no es por tamaño: es por cuánto desbloquea del objetivo.

| # | Qué | Desbloquea | Tamaño |
|---|---|---|---|
| 1 | §2(C) red de seguridad: nunca reportar `no_match` habiendo excluido candidatas | 7 cuentas dejan de perderse en silencio | Chico, 1 migración |
| 2 | §1.1 puntuación en `company_core_name` + §1.3 contendientes | 4 de 14 ambigüedades y el número que se muestra | Chico, 1 migración |
| 3 | §4 la excepción del lote en `run_contact_enrichment` | El flujo de Apollo del perfil admin, que hoy no se usa como fue diseñado | Chico, sin migración |
| 4 | §5 el tope de cargos, visible en la cotización | Que no se gasten créditos con 8 cargos menos de los pedidos | Chico, sin migración |
| 5 | §3 lugares del plan con `unrestricted` | Lotes grandes desde admin | Chico, sin migración |
| 6 | §2(A/B) la semántica de `countries` | Multinacionales | **Requiere tu decisión** |
| 7 | §2(c) candidatas para marcas cortas | MAPFRE ve 1 de 108 fichas | Mediano, hay que medir performance |
| 8 | §1.2 singular/plural y prefijos societarios | Las 2 ambigüedades que quedan | Opinable, medir aparte |

---

## 7. Qué hacer con el lote en curso

`Job 998ad8a4-e303-42a9-9a47-a36d0b921dce`, 22 cuentas, 110 créditos autorizados, 0
gastados.

**No hace falta tirarlo.** El research ya corriendo es válido y es el gasto grande. Lo
que conviene es **no ejecutar el enrichment hasta cerrar los puntos 3 y 4**, porque hoy
gastaría créditos con 10 de los 18 cargos y elegidos por orden de arreglo. El lote no
vence: los créditos quedan autorizados hasta que se usen.

Las 7 cuentas perdidas y las 14 ambiguas se pueden recuperar **sin volver a investigar**:
son un `screen_account_list` nuevo sobre esos 21 nombres una vez arreglado el punto 1 y 2.
