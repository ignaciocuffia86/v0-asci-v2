# Rediseño de la taxonomía del diccionario

> Fecha: 24 de agosto de 2026
> Estado: **aplicado** el 24/08/2026 · migración `20260824120000_dictionary_taxonomy_tres_ejes.sql`
> Contexto: último punto abierto tras los siete lotes de limpieza documentados en
> `auditoria-diccionario-tecnologia.md`

## El diagnóstico: falta una dimensión, no faltan vendors

Los vendors `Legacy`, `Backend`, `Frontend` y `CMS` son categorías haciendo de vendors. La
lectura fácil es "corrijamos los cuatro". Si se hace eso —Java pasa a Oracle, React a Meta,
Wordpress a Automattic— el diccionario queda formalmente correcto y comercialmente igual de
inútil, porque nadie le vende React a una cuenta.

El problema real es que el modelo tiene **una sola dimensión** y el negocio hace **tres preguntas**:

| Pregunta | Eje que la responde | ¿Se puede hoy? |
| --- | --- | --- |
| ¿Qué cuentas tienen SAP? | vendor | Sí |
| ¿Qué cuentas tienen un ERP? | categoría | **No** |
| ¿Qué cuentas tienen algo a modernizar? | ciclo de vida | **No** |

Y la tercera es la más valiosa: **SAP ECC tiene 4.444 cuentas** y el soporte mainstream de SAP
termina en 2027. Esa lista es el pipeline de migración a S/4HANA, y hoy solo se llega a ella
sabiendo de antemano que hay que buscar "SAP ECC".

## Qué es el vendor hoy, en el código

En `lib/v3/services/capability-search.ts` el vendor no es una etiqueta: es un **nodo de expansión
de búsqueda**.

```ts
// 3. vendor exacto → todos sus productos
const vendor = dict.vendors.find((v) => norm(v.name) === q)
if (vendor) {
  for (const p of dict.products) if (p.vendor_id === vendor.id) hits.push(asProduct(p))
}
```

Buscar "Oracle" devuelve los ocho productos de Oracle. Eso explica por qué los cuatro vendors
falsos sobrevivieron: **buscar "Frontend" hoy devuelve Angular, React, Vue, Next, Flutter e
Ionic, y funciona** — accidentalmente, pero funciona.

Lo que revela es que el campo nunca fue "quién fabrica esto", sino "qué palabra quiero que
expanda a un conjunto de productos". Con esa definición, las categorías merecen el mismo
tratamiento que los vendors, no reemplazarlos. **Por eso la propuesta no cambia el significado de
`vendor`:** agrega los otros dos ejes al lado.

## La propuesta

```sql
alter table dictionary_products
  add column categoria text,
  add column ciclo_vida text default 'vigente';   -- 'vigente' | 'legado'
```

| Eje | Pregunta que responde | Ejemplos |
| --- | --- | --- |
| **vendor** | ¿Con quién tiene contrato la cuenta? Quién se lo vende, quién lo audita. *Ya existe.* | SAP, Oracle, Microsoft, Salesforce, Atlassian |
| **categoría** | ¿Para qué le sirve? Permite comparar entre vendors y buscar por necesidad, no por marca. | ERP, CRM, Datos y BI, Ciberseguridad, Desarrollo |
| **ciclo de vida** | ¿Es una oportunidad de modernización? Solo `legado` cuando el vendor anunció sucesor y fin de soporte. | SAP ECC → S/4HANA, Oracle Forms → APEX |

Los tres son ortogonales: `SAP ECC` es vendor SAP, categoría ERP y ciclo legado, y las tres cosas
son verdad a la vez. Hoy el modelo obliga a elegir una.

## Las 9 categorías

Salieron de agrupar los 90 productos reales. Criterio: **cada categoría corresponde a una
conversación comercial distinta**. Si dos grupos se le venden a la misma persona con el mismo
argumento, son una sola categoría.

### ERP y backoffice — 12 productos · 9.472 cuentas
SAP ECC / Business Suite (4.444, *legado*) · Dynamics 365 ERP (1.708) · SAP S/4HANA (1.632) ·
Oracle E-Business Suite (1.613, *legado*) · SAP Business One (921) · SAP Ariba (592) ·
Oracle ERP Cloud (536) · Workday (455) · ODOO ERP (437) · Oracle NetSuite (377) ·
SAP SuccessFactors (375) · Oracle HCM Cloud (177)

Incluye RRHH y compras. SuccessFactors, Workday y Oracle HCM podrían ser su propia categoría,
pero se venden en la misma conversación de backoffice y son solo tres productos.

### Cloud e infraestructura — 12 productos · 22.467 cuentas
Microsoft SQL Server (11.711) · Oracle Database (5.674) · AWS (5.624) · Windows Server (3.810) ·
Google Cloud (2.492) · Azure (2.301) · Weblogic (1.613, *legado*) · AS/400 (1.204, *legado*) ·
IBM Z (654, *legado*) · SCCM (610, *legado*) · IBM WebSphere (427, *legado*) · SAP PI / PO (240)

Las bases de datos van acá y no en "Datos y BI": SQL Server y Oracle Database son infraestructura
que se opera, no herramientas de análisis. Quien las administra no es quien arma un dashboard.

### Desarrollo — 22 productos
Java (11.728) · Python (7.861) · PHP (7.214) · JavaScript / TypeScript (7.115) · React (4.241) ·
Visual Basic (3.993, *legado*) · Angular (3.637) · NodeJS (2.489) · Spring Boot (2.131) ·
Wordpress (1.999) · Oracle Forms (1.869, *legado*) · Delphi (1.784, *legado*) · Vue.js (1.238) ·
Django (1.234) · ASP.NET Core (980) · Cobol (969, *legado*) · Next.js (786) · Flutter (758) ·
Ruby on Rails (719) · Ionic (623) · Flask (550) · Micro Focus (81, *legado*)

Acá se ve por qué "Legacy" no funcionaba como vendor: **Java y Cobol comparten categoría pero no
ciclo de vida**. Con dos ejes cada uno queda donde corresponde, en vez de forzarlos al mismo cajón
por su edad.

### Datos y BI — 11 productos
Power BI (4.817) · Tableau (1.550) · Qlik (1.184) · SAP BusinessObjects (952) ·
SAP Crystal Reports (854) · Google Looker (687) · Oracle Analytics Cloud (480) ·
MicroStrategy (440) · Talend (205) · SAS (144) · Microsoft Fabric (41)

### Productividad y colaboración — 11 productos
SharePoint (2.687) · Jira (2.070) · Microsoft 365 (1.586) · Exchange Server (903, *legado*) ·
Google Workspace (491) · Bitbucket y Bamboo (360) · Copilot (335) · Trello (298) ·
Atlassian sin identificar (132) · Confluence (69) · ELO Digital Office (0)

### CRM y marketing — 7 productos
Sales Cloud (2.156) · Zoho (605) · HubSpot (525) · Marketing Cloud (301) ·
Dynamics 365 CRM (222) · Service Cloud (162) · Commerce Cloud (30)

### Ciberseguridad e identidad — 8 productos
Check Point (598) · Palo Alto Networks (381) · Intune (260) · Microsoft Entra (163) ·
SentinelOne (97) · Microsoft Defender (77) · Purview (62) · Microsoft Sentinel (33)

Intune está acá y no en productividad porque quien lo compra es el equipo de seguridad. Es
discutible.

### Automatización y low-code — 4 productos
Power Automate (951) · Power Apps (668) · Automation Anywhere (214) · SAP Signavio (27)

### Observabilidad y gestión de servicios — 3 productos
ServiceNow (389) · Dynatrace (283) · Datadog (273)

La más floja de las nueve: junta monitoreo con gestión de tickets porque ninguna llega sola a masa
crítica. Si el diccionario crece por acá, se parte en dos.

## El eje de ciclo de vida

El que hoy no existe en ninguna forma y probablemente el que más plata mueve. La regla es estricta
a propósito, para que no se vuelva una opinión: **solo `legado` si el propio vendor anunció un
sucesor y una fecha de fin de soporte.**

| Producto | Cuentas | Sucesor anunciado |
| --- | ---: | --- |
| Java *(a discutir)* | 11.728 | Oracle audita licenciamiento Java SE — exposición, no obsolescencia |
| SAP ECC / Business Suite | 4.444 | SAP S/4HANA · fin de mantenimiento mainstream 2027 |
| Visual Basic | 3.993 | VB6 sin soporte desde 2008 · .NET |
| Oracle Forms | 1.869 | Oracle APEX / Fusion |
| Delphi | 1.784 | Modernización de escritorio |
| Oracle E-Business Suite | 1.613 | Oracle Fusion Cloud ERP |
| Weblogic | 1.613 | Contenedores / Oracle Cloud |
| AS/400 | 1.204 | Modernización IBM i |
| Cobol | 969 | Rehosting / reescritura |
| Microsoft Exchange Server | 903 | Exchange Online |
| IBM Z | 654 | Modernización de mainframe |
| SCCM | 610 | Microsoft Intune · co-management es la ruta oficial |
| IBM WebSphere | 427 | Liberty / contenedores |

**14.008 cuentas distintas** tienen al menos una de estas trece. Hoy hay que saber los trece
nombres y buscarlos uno por uno; con el campo es un filtro.

**Java es el caso a discutir.** No es legado: está más vivo que nunca. Lo que sí es cierto es que
Oracle cambió el licenciamiento de Java SE en 2023 y audita activamente, así que 11.728 cuentas
con Java es una lista interesante — por un motivo distinto al de las otras doce. Mezclarlo ensucia
el eje. **Recomendación: sacarlo de `legado`** y resolver esa lista como consulta aparte.

## Los cuatro vendors falsos

Con la categoría existiendo, `Legacy`, `Backend`, `Frontend` y `CMS` desaparecen como vendors: lo
que aportaban ahora lo aporta el otro eje, y mejor. Quedan 21 productos sin vendor.

**Regla propuesta: el vendor es quien te lo puede vender.** No quien lo fabricó ni quien lo
mantiene en GitHub — con quién puede tener un contrato la cuenta. Si no hay a quién comprarle, el
vendor es `NULL`, que el código ya soporta.

| Producto | Vendor | Por qué |
| --- | --- | --- |
| Java | Oracle | Hay licenciamiento real de Java SE y Oracle audita |
| IBM Z · AS/400 · IBM WebSphere | **IBM** *(vendor nuevo)* | Hoy están bajo "Legacy" e IBM ni figura como vendor |
| Cobol · Micro Focus | Micro Focus / OpenText | Vende el compilador y el rehosting |
| Delphi | Embarcadero | Licencia comercial vigente |
| Visual Basic · ASP.NET Core | Microsoft | Ya deberían estarlo |
| Wordpress | `NULL` | La mayoría es self-hosted |
| React · Angular · Vue · Next.js · Flutter · Ionic · Node · Python · PHP · Django · Flask · Rails · Spring Boot · JS/TS | `NULL` | No hay a quién comprarles. Poner "Meta" o "Google" sería correcto de trivia e inútil de negocio |

De paso: los vendors `Zoho ` y `SentinelOne ` tienen un espacio al final del nombre.

## Costo de implementación

| Paso | Dónde | Tamaño |
| --- | --- | --- |
| Agregar las dos columnas | migración sobre `dictionary_products` | Aditiva y nullable, no rompe nada |
| Backfill de las 90 filas | un `update` con el mapeo de este documento | Ya está escrito acá |
| Expandir la búsqueda por categoría y ciclo | `lib/v3/services/capability-search.ts` | ~12 líneas, calcadas del bloque de vendor |
| Exponer los campos | `lib/v3/services/dictionary.ts` y `types.ts` | Dos campos más en el `select` |
| Agrupar el ABM por categoría | `components/dictionary/vendors-table.tsx` | Lo más grande: hoy el árbol cuelga de vendor |
| Reasignar vendors y crear IBM | datos | 21 productos + 3 vendors nuevos |

**No toca keywords ni señales, así que no hay reprocesamiento.** Es metadata sobre productos que
ya existen; si algo sale mal se revierte con un `update`.

## Decisiones pendientes

1. **¿Los tres ejes o solo categoría?** El ciclo de vida es el de más valor comercial pero también
   el único que es una opinión sobre el mercado y no un hecho sobre el producto.
2. **Java en `legado`: sí o no.** Recomendación: no.
3. **¿Las nueve categorías cierran?** Las dos más dudosas: *Observabilidad y gestión de servicios*
   (junta cosas distintas por falta de masa) e *Intune* (¿ciberseguridad o productividad?).
4. **¿RRHH sale de ERP?** SuccessFactors, Workday y Oracle HCM están dentro de "ERP y backoffice".
5. **El ABM:** ¿el árbol pasa a colgar de categoría, o un selector para ver por vendor o categoría?


---

## Registro de ejecución · 24 de agosto de 2026

Aplicado con los tres ejes y Java fuera de `legado`, como se decidió. Las tres preguntas que
quedaron abiertas se resolvieron con lo propuesto: las nueve categorías tal cual, RRHH dentro de
"ERP y backoffice", y el ABM con un selector vendor/categoría en lugar de reemplazar el árbol.

### Estado resultante

| Categoría | Productos | En legado | Cuentas |
| --- | ---: | ---: | ---: |
| Desarrollo | 22 | 5 | 28.137 |
| Cloud e infraestructura | 12 | 5 | 22.465 |
| ERP y backoffice | 12 | 2 | 9.470 |
| Datos y BI | 11 | 0 | 7.616 |
| Productividad y colaboración | 11 | 1 | 6.247 |
| CRM y marketing | 7 | 0 | 3.127 |
| Automatización y low-code | 4 | 0 | 1.275 |
| Ciberseguridad e identidad | 8 | 0 | 1.274 |
| Observabilidad y gestión de servicios | 3 | 0 | 812 |

90 productos, **0 sin categoría**. 13 productos en `legado` sobre **14.005 cuentas distintas**.

*(Con el split de .NET de escritorio que sigue: 91 productos, 14 en legado sobre 14.976 cuentas.)*

### Java fuera de legado: la decisión se validó sola

Sacar Java del eje bajó el total de 14.008 a 14.005 cuentas: **aportaba 3 cuentas únicas**. Sus
11.728 cuentas ya estaban cubiertas por los otros doce productos, así que en la práctica solo
agregaba ruido conceptual sin agregar alcance. La regla estricta —solo `legado` si el vendor
anunció sucesor y fin de soporte— se sostiene.

### Vendors

- **Tres vendors nuevos:** IBM (IBM Z, AS/400, IBM WebSphere), Micro Focus / OpenText (Cobol,
  Microfocus) y Embarcadero (Delphi).
- **Java pasó a Oracle**, `Visual Basic` y `ASP.NET Core` a Microsoft.
- **15 productos quedaron con `vendor_id` NULL** por la regla "el vendor es quien te lo puede
  vender": React, Angular, Vue, Next.js, Flutter, Ionic, NodeJS, Python, PHP, Django, Flask,
  Rails, Spring Boot, JavaScript/TypeScript y Wordpress.
- **Los cuatro vendors falsos se borraron.** Quedan 26 vendors reales.
- Se limpiaron los espacios finales de `Zoho ` y `SentinelOne `.

### Código

| Archivo | Cambio |
| --- | --- |
| `supabase/migrations/20260824120000_…sql` | Columnas, constraint, índices, backfill y vendors |
| `lib/v3/services/types.ts` | `categoria` y `ciclo_vida` en `DictionaryData` |
| `lib/v3/services/dictionary.ts` | Los dos campos en el `select` del diccionario |
| `lib/v3/services/capability-search.ts` | Niveles **3a** (categoría) y **3c** (ciclo de vida), con alias cortos |
| `components/dictionary/vendors-table.tsx` | Selector vendor/categoría, badges de categoría y legado |
| `tests/unit/shared/capability-search.test.ts` | Fixture actualizado + 4 tests nuevos |

**La expansión por categoría acepta alias cortos** porque nadie escribe el nombre completo:
`erp`, `crm`, `bi`, `datos`, `cloud`, `nube`, `seguridad`, `ciberseguridad`, `identidad`,
`productividad`, `desarrollo`, `automatizacion`, `rpa`, `itsm`, `observabilidad`. Y `legado`
—junto con `legacy`, `obsoleto` y `modernizacion`— expande a los 13 productos del eje.

**`vigente` no expande a propósito:** son 77 productos y devolver casi todo el diccionario no es
una respuesta útil.

Verificación: `tsc --noEmit` limpio, 199 tests en verde (23 en capability-search, 4 de ellos
nuevos), `eslint` sin errores sobre los archivos tocados.

### Efecto colateral bueno en el ABM

Los 15 productos sin vendor habrían quedado invisibles en el ABM, porque el árbol consultaba
`dictionary_products` filtrando por `vendor_id`. Se agregó un grupo "Sin vendor (open source)"
en la vista por vendor, y en la vista por categoría aparecen naturalmente.

### .NET de escritorio fuera de Visual Basic

`WPF`, `WinForms`, `Windows Forms` y `ADO.NET` estaban dentro de Visual Basic. Medido sobre sus
627 señales, **el contexto de C# le gana al de VB 4 a 1**:

| Keyword | Señales | Contexto VB | Contexto C# |
| --- | ---: | ---: | ---: |
| `WPF` | 325 | 26 | 116 |
| `WinForms` | 123 | 10 | 30 |
| `Windows Forms` | 93 | 11 | 28 |
| `ADO.NET` | 86 | 8 | 54 |

Y sobre la plataforma, **.NET Framework viejo le gana a .NET moderno 3 a 1** (225 contra 70), así
que el producto nuevo va como `legado`: el sucesor anunciado por Microsoft es .NET 8+.

Se creó **`.NET Framework y escritorio`** (Microsoft · Desarrollo · legado) con las cuatro
keywords movidas más `NET Framework`, `WCF`, `Windows Communication Foundation`,
`ASP.NET Web Forms`, `ASMX`, `XAML` y `Windows Presentation Foundation`.

`NET Framework` entró con **1.466 señales** —el 100% con contexto de desarrollo— y `WCF` con 856.
Eran dos huecos grandes: el diccionario no detectaba la plataforma .NET clásica de ninguna forma.

**Resultado:** Visual Basic pasó de 3.993 a **3.629 cuentas**, y el producto nuevo arrancó con
**2.125 cuentas**.

**Caveat sobre la marca de legado:** ese 24% con contexto de .NET moderno hace que el flag sea más
débil acá que en los otros trece productos del eje, donde no hay variante moderna posible (Cobol,
AS/400, Oracle Forms). Si molesta, se baja a `vigente` con un `update`; las keywords de Framework
puro (`WCF`, `ASMX`, `ASP.NET Web Forms`) quedan igual para separarlo después.

**Y una alta que no pasó su propia prueba:** `Web Forms` quedó 23 con contexto ASP.NET contra 29
de web genérico (formularios, HTML, UX). Invertido respecto del umbral, así que salió.
`ASP.NET Web Forms` cubre el caso limpio. Es la cuarta vez en el trabajo que verificar las propias
altas encuentra algo — después de `CCSA`, `Pub/Sub` y `Crystal Reports`.

### Baja de ELO Digital Office

45 keywords y cero señales en los siete lotes. Antes de borrarlo se verificó que el cero fuera
real y no un "nunca se procesó":

| | |
| --- | ---: |
| Jobs `add_keyword` | 45 |
| Completados | **45** |
| Señales | 0 |
| `document_tags` que lo referencian | 0 |

Las keywords corrieron contra toda la base y matchearon cero. **No es un problema de cómo estaban
escritas** —todas arrancan con "ELO" y son inequívocas— simplemente no hay nadie en el corpus que
lo mencione.

Se borró el producto y el vendor, que quedaba huérfano. Las 45 keywords siguen recuperables en
`dictionary_backup_20260824` si algún día entra una cuenta con ELO.

### Lo que sigue abierto
- **Keywords con co-ocurrencia** — la mejora de motor que rescataría términos como `Fabric`
  exigiendo contexto.
- **"Observabilidad y gestión de servicios"** junta monitoreo con ITSM por falta de masa. Si el
  diccionario crece por ahí, se parte en dos.
