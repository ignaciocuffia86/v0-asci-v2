# Auditoría del diccionario de tecnologías

> Fecha: 24 de agosto de 2026
> Alcance: `dictionary_vendors` / `dictionary_products` (rama tecnologías) y las señales
> `signal_type = 'technology'` que generan sobre `contacts` y `job_postings`.
> Objetivo: detectar presencia de tecnología por cuenta con el menor falso positivo posible.

Estado del diccionario al momento de la auditoría:

| | |
| --- | --- |
| Vendors | 27 |
| Productos | 82 |
| Keywords | 3.300 |
| Señales de tecnología | 329.101 |
| Keywords duplicadas entre productos | 44 |
| Keywords duplicadas dentro del mismo producto | 9 |
| Keywords que nunca pueden matchear | 36 |
| Señales huérfanas (keyword ya borrada) | 18.530 |

Las consultas están en [`scripts/audit-dictionary-keywords.sql`](../scripts/audit-dictionary-keywords.sql).

---

## 0. Cómo matchea el motor (esto explica todo lo demás)

`process_dictionary_job` arma el patrón así:

```sql
v_pattern := '\y' || public.escape_regex(v_job.keyword) || '\y';
...  c.current_position_title ~* v_pattern OR c.headline ~* v_pattern OR ...
```

Regex case-insensitive con límite de palabra a ambos lados. Tres consecuencias:

1. **No hay contexto.** La keyword matchea sola en cualquier parte del texto.
   `PAN` matchea "Pan American Energy" igual que "PAN firewall".
2. **No distingue idioma.** El corpus es LatAm bilingüe: `Defender` matchea el verbo
   español, `Entra` matchea "usted entra en", `SITs` matchea "sits".
3. **El `\y` rompe los símbolos.** `\y` exige una transición palabra ↔ no-palabra. Si la
   keyword empieza o termina en un símbolo (`C#`, `.NET Core`, `@Component`), esa
   transición nunca ocurre y la keyword **jamás matchea**. Verificado contra la base.

---

## H1 · Keywords que nunca pueden matchear · crítico

36 keywords empiezan o terminan en un carácter no alfanumérico. 34 de ellas tienen
exactamente **0 señales históricas**.

| Producto | Keywords muertas | Fix |
| --- | --- | --- |
| Oracle E-Business Suite | `AOL (Application Object Library)`, `MOAC (Multi Org Access Control)`, `Accounts Payable (AP)`, `Accounts Receivable (AR)`, `General Ledger (GL)`, `Fixed Assets (FA)`, `Inventory (INV)`, `Purchasing (PO)` | Sacar el paréntesis final: `Oracle Payables`, `EBS General Ledger` |
| Angular | `@Component`, `@NgModule`, `@Injectable`, `@Input`, `@Output`, `@HostListener`, `@HostBinding` | Sin arroba: `NgModule`, `HostListener` |
| ASP.NET Core | `.NET Core`, `.NET 6`, `.NET 7`, `.NET 8`, `C#` | `NET Core`, `NET 8`, `CSharp` |
| SAP ECC 6 | `SAP Gateway (ECC)`, `SAP OData (ECC)`, `SAP CRM (Business Suite)` | `SAP Gateway`, `SAP OData`, `SAP CRM` |
| SAP S/4HANA | `CVI (Customer Vendor Integration)`, `SAP AIF (Application Interface Framework)` | `Customer Vendor Integration`, `SAP AIF` |
| Oracle ERP Cloud | `OTBI (Oracle Transactional Business Intelligence)`, `FSM (Functional Setup Manager)` | `Oracle Transactional Business Intelligence` |
| Django | `path()`, `re_path()` | `Django URLconf` |
| Spring Boot | `@Transactional`, `@Scheduled` | `Transactional Spring`, `Scheduled Spring` |
| Vue.js | `.vue Files`, `@vue/cli` | `Vue SFC`, `Vue CLI` |
| Delphi | `.dfm files`, `.pas units` | `archivos dfm`, `unidades pas` |
| Weblogic | `ALSB (AquaLogic Service Bus)` | `AquaLogic Service Bus` |

Aparte, cinco keywords del producto PHP que parecen nombres de categoría internos y no
términos que alguien escriba en un perfil: `php_core`, `php_ecosystem`, `php_frameworks`,
`php_cms`, `php_testing`. Se eliminan.

---

## H2 · Falsos positivos con evidencia · crítico

Cada fila verificada contra snippets reales guardados en `signals`.

| Keyword | Suma a | Señales | Evidencia real | Propuesta |
| --- | --- | ---: | --- | --- |
| `Storage` | Ionic | 5.008 | "Data Base Storage. Application Server Storage. Datacenter…" | eliminar |
| `Exchange` | Exchange Server | 5.030 | "Petroleum Industry Data Exchange Standards" | → `Exchange Server`, `Exchange Online` |
| `PAN` | Palo Alto Networks | 1.695 | **1.435 de 1.695** dicen literalmente "Pan American Energy" | eliminar |
| `EBS` | AWS | 1.685 | "plataformas auditadas: Oracle EBS SAP…" cuenta como AWS | → `Amazon EBS`, `Elastic Block Store` |
| `CMS` | IBM Z | 961 | "Backend en CMS basado…", "Web site/CMS/Portal" | eliminar |
| `OCI` | Oracle Database | 904 | choca con Open Container Initiative | → `Oracle Cloud Infrastructure` |
| `Vapor` | PHP (Laravel Vapor) | 640 | "generación de vapor" en perfiles industriales | → `Laravel Vapor` |
| `Nova` | PHP (Laravel Nova) | 571 | "AMBEV NOVA RIO", "Quala Nova" | → `Laravel Nova` |
| `morgan` | NodeJS (middleware) | 511 | apellido Morgan, J.P. Morgan | eliminar |
| `Subjects` | Angular (RxJS) | 487 | palabra común en inglés | → `RxJS Subject`, `BehaviorSubject` |
| `SAT` | SAP ECC (transacción) | 435 | SAT = autoridad fiscal de México | eliminar |
| `ORM` | Django | 414 | término genérico de cualquier framework | → `Django ORM` |
| `EC` | SuccessFactors | 368 | sigla de dos letras | → `Employee Central` |
| `Navigator` | Flutter | 319 | palabra común | → `Flutter Navigator` |
| `EDI` | SAP ECC | 315 | estándar de industria, no es de SAP | mover a Procesos |
| `Defender` | Sentinel defender | 308 | "Comités de Crédito para exponer y **defender** la…" | → `Microsoft Defender` |
| `RCM` | SuccessFactors | 289 | Revenue Cycle Management en salud | → `SuccessFactors Recruiting` |
| `OEM` | Oracle Database | 271 | Original Equipment Manufacturer | → `Oracle Enterprise Manager` |
| `CP` | IBM Z | 242 | sigla de dos letras | eliminar |
| `Horizon` | PHP (Laravel) | 206 | VMware Horizon, nombres de empresa | → `Laravel Horizon` |
| `Scout` | PHP (Laravel) | 204 | palabra común | → `Laravel Scout` |
| `Reactive` | Vue.js | 201 | adjetivo genérico | eliminar |
| `Rack` | Ruby on Rails | 200 | rack de servidores | → `Rack Middleware` |
| `CRA` | React | 180 | sigla ambigua en LatAm | → `Create React App` |
| `Fortify` | PHP (Laravel) | 170 | Fortify es de Micro Focus, otro vendor del diccionario | → `Laravel Fortify` |
| `RFC` | SAP ECC | 149 | RFC = registro fiscal mexicano | → `SAP RFC`, `tRFC`, `qRFC` |
| `SITs` | Purview | 147 | "Evaluación de **sits** costo" | → `Sensitive Information Types` |
| `Relay` | React | 143 | relay eléctrico / de red | → `Relay GraphQL` |
| `Flux` | Spring Boot | 129 | genérico; además Flux es patrón de React | → `Project Reactor Flux` |
| `CPT` | Wordpress | 112 | CPT = código médico | → `Custom Post Type` |
| `ISR` | Next.js | 100 | ISR = Impuesto Sobre la Renta (MX) | → `Incremental Static Regeneration` |
| `Devise` | Ruby on Rails | 99 | verbo inglés / palabra francesa | → `Devise gem` |
| `Aurora` | AWS | 89 | nombre propio, ciudad, marca | → `Amazon Aurora` |
| `Sentinel` | Sentinel defender | 86 | "Verificación de clientes nuevos en SENTINEL" (buró PE) | → `Microsoft Sentinel`, `Azure Sentinel` |
| `Comprehend` | AWS | 72 | verbo inglés | → `Amazon Comprehend` |
| `Lambda` | AWS | 71 | lambda functions, lambda architecture | → `AWS Lambda` |
| `Buffer` | NodeJS | 64 | término genérico | eliminar |
| `Dapper` | ASP.NET Core | 61 | adjetivo inglés | → `Dapper ORM` |
| `S1` | SentinelOne | 54 | "S1 Seguridad Privada S.A.S", "Norma S1 de Seguridad e Higiene" | eliminar |
| `SARA` | SAP ECC | 52 | nombre de persona | → `SAP SARA` |
| `Singularity` | SentinelOne | 44 | "Executive Program at Singularity University" | → `SentinelOne Singularity` |
| `SNOW` | ServiceNow | 43 | "Ski Corral… snow" | eliminar |
| `Lex` | AWS | 36 | "manejo del Lex Doctor", "herramienta Lex 100" (software jurídico) | → `Amazon Lex` |
| `Entra` | Microsoft Entra | 25 | "ahí es donde usted **entra** en…" | → `Microsoft Entra`, `Entra ID` |
| `Polly` | AWS y ASP.NET | 20 | "Monster High, MEGA and Polly Pocket" | → `Amazon Polly` / `Polly .NET` |

### Caso aparte: lenguajes y tooling atribuidos a un framework

`Javascript` (10.603 señales) y `TypeScript` (1.244) están cargados dentro de **React**:
hoy cualquier perfil que diga "JavaScript" cuenta como cuenta con React. Lo mismo con
`Jest`, `Cypress`, `Storybook`, `Webpack`, `Swagger`, `OpenAPI`, `npm`, `Redis` y
`Memcached`: es tooling transversal, no evidencia del producto. Propuesta: sacarlos de los
productos y, si interesan, crear productos propios.

---

## H3 · Keywords duplicadas entre productos · alto

Cuando una keyword vive en dos productos, un solo perfil genera **dos señales** y la cuenta
aparece con dos tecnologías donde hay una.

### El caso grave: SAP ERP vs SAP ECC 6 / Business Suite 7

Dos productos distintos con **24 keywords idénticas** (`SAP ECC`, `SAP R/3`, `SAP R3`,
`SAP ERP 6.0`, `SAP ERP Central Component`, `SAP NetWeaver`, `SAP FI`, `SAP CO`, `SAP MM`,
`SAP SD`, `SAP PP`, `SAP PM`, `SAP QM`, `SAP PS`, `SAP HR`, `SAP HCM`, `SAP Workflow`,
`BAPI`, `BADI`, `LSMW`, …). Entre los dos suman 22.268 señales sobre poblaciones casi
iguales de cuentas (4.313 y 4.535).

**Recomendación:** unificar en un solo producto "SAP ECC / Business Suite" y dejar S/4HANA
como el producto separado — que es la distinción que importa comercialmente: quién ya migró
y quién no.

Total: **44 keywords** aparecen en más de un producto.

| Keyword | Productos |
| --- | --- |
| `Azure Sentinel` | Microsoft / Azure · Microsoft / Sentinel defender |
| `BAdI` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `BAPI` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `CORS Middleware` | Backend / ASP.NET Core · Backend / NodeJS / Express.Js |
| `EAR Deployment` | Legacy / Java · Oracle / Weblogic |
| `EBS` | Amazon / AWS · Oracle / Oracle E-Business Suite (EBS) |
| `Exchange Admin Center` | Microsoft / Microsoft 365 · Microsoft / Microsoft Exchange Server |
| `Exchange Administrator` | Microsoft / Microsoft 365 · Microsoft / Microsoft Exchange Server |
| `Fusion HCM` | Oracle / Oracle ERP Cloud · Oracle / Oracle HCM Cloud |
| `JWT Authentication` | Backend / ASP.NET Core · Backend / Django |
| `Lifecycle Hooks` | Frontend / Angular · Frontend / Ionic |
| `LPAR` | Legacy / AS/400 · Legacy / IBM Z |
| `LSMW` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `Memcached` | Amazon / AWS · Backend / Django |
| `Options API` | CMS / Wordpress · Frontend / Vue.js |
| `Oracle Integration Cloud` | Oracle / Oracle Database · Oracle / Oracle ERP Cloud |
| `Oracle Reports` | Oracle / Oracle E-Business Suite (EBS) · Oracle / Oracle Forms |
| `PL/SQL` | Oracle / Oracle Database · Oracle / Oracle PL/SQL |
| `Polly` | Amazon / AWS · Backend / ASP.NET Core |
| `SAP CO` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP ECC` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP ERP 6.0` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP ERP Central Component` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP FI` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP HCM` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP HR` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP MM` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP NetWeaver` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP PI` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP S/4HANA |
| `SAP PM` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP PO` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP S/4HANA |
| `SAP PP` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP Process Orchestration` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP S/4HANA |
| `SAP PS` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP QM` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP R/3` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP R3` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP SD` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SAP Workflow` | SAP / SAP ECC 6 / Business Suite 7 · SAP / SAP ERP |
| `SharePoint Admin Center` | Microsoft / Microsoft 365 · Microsoft / Microsoft Sharepoint |
| `SharePoint Administrator` | Microsoft / Microsoft 365 · Microsoft / Microsoft Sharepoint |
| `SQL Trace` | Oracle / Oracle Database · SAP / SAP ECC 6 / Business Suite 7 |
| `WAR Deployment` | Legacy / Java · Oracle / Weblogic |
| `WebLogic Server` | Legacy / Java · Oracle / Weblogic |

### Duplicados literales dentro del mismo producto

| Producto | Keyword repetida |
| --- | --- |
| Backend / Ruby on Rails | `Cancancan` |
| ELO Digital Office / Elo Digital Office | `ELO Digital Office` |
| Legacy / Cobol | `COBOL` |
| Legacy / IBM Z | `DASD` |
| MicroStrategy / MicroStrategy | `MicroStrategy` |
| ODOO / ODOO ERP | `Odoo` |
| Palo Alto Networks / Palo Alto Networks | `PAN`, `Palo Alto` |
| SAP / SAP ECC 6 / Business Suite 7 | `BADI` |
| SentinelOne  / Sentinel One | `S1`, `Singularity` |

---

## H4 · Señales huérfanas de keywords ya borradas · alto

**18.530 señales** vivas cuya keyword ya no existe en el diccionario. Alguien limpió las
keywords pero las señales nunca se borraron, y hoy siguen contando en la UI y en los
reportes por cuenta.

Casi todas son del producto **Oracle PL/SQL**, que hoy tiene 3 keywords pero arrastra 24.543
señales generadas por términos como `procedures` (7.172), `functions` (4.734), `packages`
(884) y `oracle 11g` (575) — que además eran genéricos. También hay 804 señales de
`advanced analytics` en SAS Viya.

Acción: job de limpieza que borre toda señal cuya `keyword_matched` no esté en el array del
producto, y agregar esa garantía al flujo de borrado para que no vuelva a pasar. El DELETE
está en `scripts/audit-dictionary-keywords.sql`, comentado — hay que correrlo en lotes desde
un job con service role, nunca desde el browser (ver `docs/etl-diccionario-mejores-practicas.md`, punto 4).

---

## H5 · Problemas de taxonomía · alto

Decisiones de estructura a cerrar antes de poblar las nubes, porque cambian qué keyword va
de qué lado.

- **Cuatro "vendors" que no son vendors.** `Legacy`, `Backend`, `Frontend` y `CMS` son
  categorías. Adentro conviven productos de vendors reales (Java → Oracle, Wordpress →
  Automattic) con stacks open source sin dueño. Si el objetivo es leer presencia por cuenta
  y por vendor, esto rompe la lectura: "Legacy" aparece como el vendor #1 por volumen.
- **Jira contiene productos que no son Jira.** `Confluence` (86), `Bitbucket` (439),
  `Trello` (336) y `Bamboo` son productos separados de Atlassian. Hoy 861 señales cuentan
  como Jira.
- **"Sentinel defender" son dos productos.** Microsoft Sentinel (SIEM) y Microsoft Defender
  (endpoint) se venden e implementan por separado. Mezclarlos impide distinguir una cuenta
  con SIEM de una con EDR.
- **"Oracle PL/SQL" no es un producto**, es el lenguaje de Oracle Database. Fusionar.
- **Nombres de vendor con espacio final**: `Zoho ` y `SentinelOne `.
- **Talend está bajo el vendor Qlik.** Es correcto (Qlik la compró), pero conviene decidir
  si el diccionario refleja marca comercial o dueño corporativo, y aplicar el criterio parejo.

---

## Método propuesto para las nubes de tags

Regla única para los 82 productos. Cada keyword cae en uno de tres cajones y **solo los dos
primeros entran al diccionario**.

| Tier | Qué es | Ejemplos |
| --- | --- | --- |
| **T1 · Ancla** | Nombra el producto de forma inequívoca. Si aparece, la cuenta tiene el producto. Casi siempre incluye la marca. | `SAP S/4HANA`, `Microsoft Intune`, `Qlik NPrinting`, `Laravel Vapor` |
| **T2 · Jerga interna** | No lleva la marca, pero nadie fuera de ese producto la usa. Encuentra a quien trabajó de verdad con la herramienta. | `GlideRecord`, `AMPscript`, `LSMW`, `FNDLOAD`, `SPFx`, `QVD` |
| **T3 · Ambigua** | Palabra común, sigla corta, o término compartido entre vendors. Queda afuera, o entra calificada con la marca adelante. | `Storage`, `PAN`, `Exchange`, `ORM`, `Lambda`, `Fabric` |

Cinco reglas mecánicas que se aplican antes de proponer nada:

1. **Nada de siglas de ≤3 caracteres sin marca** (`EC`, `CP`, `PAN`, `S1`, `SAT`, `ILE`).
2. **Nada que sea palabra de diccionario en español o inglés** — el corpus es LatAm bilingüe
   (`defender`, `entra`, `pan`, `vapor`, `sits`, `storage`, `scout`).
3. **Ninguna keyword en dos productos.** Si aplica a dos, se califica en ambos o sube al padre.
4. **Nada empieza ni termina en símbolo**, por el `\y` del motor.
5. **Tooling transversal fuera de los productos** (Jest, Swagger, Docker, Redis).

### Propuesta aparte: keywords con co-ocurrencia

Hay términos T3 valiosos que se rescatarían si el motor pudiera exigir contexto: `Fabric`
solo cuenta si el texto también dice `Power BI`, `Synapse` o `OneLake`. Requiere un campo
nuevo en `dictionary_products` (algo como `keywords_context jsonb`) y tocar
`process_dictionary_job`. No bloquea nada de lo anterior; se evalúa por separado.

---

## Batch 1 propuesto · Ciberseguridad

Primer lote para aprobación. Los cuatro productos donde hoy casi todas las señales son ruido.

### Microsoft Sentinel *(producto nuevo, separado de Defender)*

- **T1:** `Microsoft Sentinel`, `Azure Sentinel`, `Sentinel SIEM`, `Sentinel SOAR`,
  `Sentinel Workspace`, `Sentinel Analytics Rules`, `Sentinel Playbooks`, `Sentinel Watchlists`,
  `Sentinel Workbooks`, `Sentinel Data Connectors`, `Sentinel UEBA`, `Sentinel Content Hub`,
  `Sentinel Automation Rules`
- **T2:** `KQL`, `Kusto Query Language`, `Log Analytics Workspace`, `ASIM Parsers`,
  `Advanced Security Information Model`, `Hunting Queries`, `Fusion ML Rules`
- **Sacar:** `Sentinel`, `Defender`, `ASIM`, `Hunting Bookmarks`, `Sentinel Roles`,
  `Sentinel Diagnostics`, `Syslog Sentinel`, `CEF Sentinel`

De las 113 keywords actuales, 102 nunca generaron una sola señal. La lista baja a ~20.

### Microsoft Defender *(producto nuevo, separado de Sentinel)*

- **T1:** `Microsoft Defender`, `Defender XDR`, `Microsoft Defender XDR`, `Defender for Endpoint`,
  `Microsoft Defender for Endpoint`, `Defender for Identity`, `Defender for Office 365`,
  `Defender for Cloud`, `Defender for Cloud Apps`, `Defender Antivirus`,
  `Defender Vulnerability Management`, `Defender Portal`
- **T2:** `Advanced Hunting`, `Attack Surface Reduction`, `Microsoft Secure Score`
- **Sacar:** `Defender`
- **A confirmar:** `MDE` — sigla de 3 letras, decidir si entra.

### Palo Alto Networks

- **T1:** `Palo Alto Networks`, `Palo Alto firewall`, `Palo Alto NGFW`, `Palo Alto Panorama`,
  `Palo Alto Cortex`, `Cortex XDR`, `Cortex XSOAR`, `Prisma Access`, `Prisma Cloud`,
  `Prisma SD-WAN`, `PA-Series`, `PAN-OS`, `GlobalProtect`, `WildFire`
- **T2:** `PCNSE`, `PCNSA`, `App-ID`, `User-ID`, `Content-ID`
- **Sacar:** `PAN`, `Palo Alto`, `VM-Series`, `Palo Alto security`

`PAN` aporta 1.695 señales y 1.435 dicen "Pan American Energy". `Palo Alto` sin apellido
matchea la ciudad; lo cubren `Palo Alto Networks` y `Palo Alto firewall`. Las certificaciones
(PCNSE/PCNSA) son la señal más limpia que existe en LinkedIn.

### SentinelOne

- **T1:** `SentinelOne`, `Sentinel One`, `SentinelOne EDR`, `SentinelOne XDR`,
  `SentinelOne agent`, `SentinelOne Singularity`, `Singularity XDR`, `Singularity Cloud`,
  `Singularity Platform`, `Ranger IoT`, `Storyline`, `Purple AI`
- **Sacar:** `S1`, `Singularity`, `SentinelOne detection`, `SentinelOne response`,
  `SentinelOne protection`

### Check Point *(calidad OK, solo se agrega)*

- **Agregar T1:** `CheckPoint` (sin espacio, como lo escribe medio LinkedIn), `SmartConsole`,
  `SmartDashboard`, `Gaia OS`, `CCSA`, `CCSE`
- **Sacar:** `Check Point management`, `Check Point appliance`, `Check Point security`

---

## Orden propuesto para los lotes siguientes

1. ~~Ciberseguridad~~ — arriba, para revisión.
2. **Cloud e infraestructura** — AWS, Azure, GCP, Oracle Cloud. Mayor volumen y donde más se pisan.
3. **ERP** — SAP (incluye resolver ECC vs ERP), Oracle EBS/Fusion, Dynamics, Odoo, Workday, NetSuite.
4. **Datos y BI** — Power BI, Fabric, Tableau, Qlik, Looker, MicroStrategy, SAS.
5. **CRM y productividad** — Salesforce, HubSpot, Zoho, ServiceNow, M365, Google Workspace, Atlassian.
6. **Stacks de desarrollo** — el bloque más ruidoso y el que menos habla de decisiones de
   compra. Decidir antes si aporta al objetivo comercial o si conviene achicarlo.

### Ejecutable sin esperar la revisión producto por producto

- Borrar las 18.530 señales huérfanas.
- Sacar las 36 keywords que nunca pueden matchear, más las 5 `php_*`.
- Sacar las keywords de H2 marcadas "eliminar", que solas explican más de 9.000 señales falsas.

---

## Registro de ejecución · 24 de agosto de 2026

Aplicado sobre producción con respaldo previo del diccionario completo en
`dictionary_backup_20260824`. El script está en
[`scripts/cleanup-dictionary-20260824.sql`](../scripts/cleanup-dictionary-20260824.sql).

| Acción | Impacto | Verificación |
| --- | ---: | --- |
| Borrado de señales huérfanas (H4) | −18.607 | 0 huérfanas restantes |
| Baja de las 36 keywords que nunca matchean + las 5 `php_*` (H1) | −41 kw | 12 productos actualizados |
| Baja de las 10 keywords marcadas "eliminar" (H2) | −9.389 | `Storage`, `PAN`, `CMS`, `morgan`, `SAT`, `CP`, `Reactive`, `Buffer`, `S1`, `SNOW` |
| Fusión de Oracle PL/SQL en Oracle Database (H5) | 88 kw | 13.372 señales en el producto unificado |
| Unificación SAP ERP + SAP ECC 6 → "SAP ECC / Business Suite" (H3) | 169 kw | 13.538 señales / 5.123 cuentas; se deduplicaron 8.730 señales que eran la misma persona contada dos veces |
| Separación de "Sentinel defender" en dos productos (H5) | +1 producto | Sentinel 97 kw / 96 señales · Defender 16 kw / 362 señales |

**Estado final:** 81 productos (antes 82), 3.226 keywords (antes 3.300), 288.644 señales de
tecnología (antes 329.101). Un 12% menos de señales, todas ruido demostrable o conteo duplicado.

### Hallazgo nuevo — aprobado y ejecutado

Al verificar la limpieza aparecieron **4.162 señales de tecnología cuyo `signal_id` apuntaba a
productos que ya no existen** — ocho productos borrados entre noviembre de 2025 y marzo de 2026:
uno de Node.js con 2.970 señales, uno de Angular con 601, uno de Laravel con 418, más Wordpress
(81), Python (50), Django (28), Flask (12) y Copilot (2).

Era un caso distinto del aprobado en su momento: no una keyword huérfana, sino un producto
entero que desapareció y dejó sus señales atrás. La UI no podía mostrarlas asociadas a nada.
Se borraron junto con el lote ERP; quedan 0.

### Pendientes de la tabla H2

Las keywords marcadas "→ reemplazar" siguen en el diccionario a propósito: cada una es una
decisión de producto y se propone en el lote temático que corresponda. Entre ellas, dos que
conviene no olvidar porque son las que arrastran más ruido: `Exchange` (5.030 señales) y
`Javascript` dentro de React (10.603).

---

## Lote 2 · ERP — aplicado el 24 de agosto de 2026

Nube keyword por keyword para los 12 productos ERP, con el conteo real de señales de cada
término y evidencia de cada baja. Resumen:

| Producto | Keywords hoy | Sacar | Mover | Agregar |
| --- | ---: | ---: | ---: | ---: |
| SAP ECC / Business Suite | 169 | 22 (939 señales falsas) | 9 (585) | 6 |
| SAP S/4HANA | 108 | 37 (151) | 2 (90) | 8 |
| SAP SuccessFactors | 39 | 7 (709) | — | 8 |
| SAP Ariba | 32 | 19 (0) | — | 4 |
| SAP Business One | 28 | 11 (0) | — | 4 |
| Oracle E-Business Suite | 45 | 6 (666) | 1 (240) | 6 |
| Oracle ERP Cloud | 56 | 4 (81) | 4 (443) | 6 |
| Oracle HCM Cloud | 21 | 1 (29) | 2 (53) | 7 |
| Oracle NetSuite | 1 | — | — | 16 |
| Dynamics 365 ERP | 11 | — | — | 13 |
| ODOO ERP | 73 | 47 (0) | — | 6 |
| Workday Financial & HCM | 51 | 38 (2) | — | 12 |

**Falsos positivos más grandes del lote**, todos verificados contra snippets:

- `Order Management` en Oracle EBS (664) — "Order Management Analyst (Temporal) en Mondelēz".
  Es un puesto de negocio, no el módulo OM.
- `EC` (368) y `RCM` (289) en SuccessFactors — RCM es *Reliability Centered Maintenance*:
  "Ingeniero de Procesos (RCM - HUAWEI/ZTE)", "Asset Management TPM RCM RCA". Entre las dos son
  el 51% de las señales del producto.
- `EDI` (315) en SAP ECC — estándar de industria, no de SAP.
- `CTS` (190) en SAP ECC — en Perú es *Compensación por Tiempo de Servicios*: los snippets dicen
  "gratificaciones", "ingreso a planilla", "impuestos mensuales".
- `RFC` (149) en SAP ECC — registro fiscal mexicano. Lo cubren `tRFC` y `qRFC`.
- `Investment Management` (149) en SAP ECC — "Investment Management Consultant" de banca.
- `Transportation Management` (82) en S/4HANA — "Consultor Funcional Certificado 2024
  **Oracle** Transportation Management OTM". Suma consultores de Oracle a la presencia de SAP.
- `Setup and Maintenance` (39) en Oracle ERP Cloud — "NGS omics data pipeline",
  "SugarCRM plugins development".
- `FSM` (29) en Oracle HCM — *Field Service Management*, no Functional Setup Manager.

**Huecos de cobertura más grandes:**

- **Workday no tiene la keyword `Workday`.** 51 keywords generaron 60 señales entre todas.
- **Dynamics 365 ERP no detecta `AX`, `NAV` ni `Navision`**, que es donde está la base instalada
  real de Microsoft ERP en LatAm y el mejor indicador de una cuenta candidata a migrar.
- **NetSuite tiene una sola keyword.** Falta toda la familia `Suite*` (SuiteScript, SuiteFlow,
  SuiteTalk), que es T2 perfecta.
- **Falta `RISE with SAP`** en S/4HANA: nadie lo menciona salvo que la cuenta esté en un proyecto
  de migración.
- **Falta `OpenERP`** en Odoo, el nombre viejo del producto, que sigue en perfiles con
  experiencia previa a 2014.

### Tres productos nuevos propuestos

- **SAP BusinessObjects** — recibe 374 señales hoy escondidas dentro de ECC y S/4HANA
  (`SAP BO`, `SAP BusinessObjects`, `Crystal Reports SAP`, `SAP Analytics Cloud`), más
  `WebI`, `Universe Designer`, `Information Design Tool`.
- **SAP PI / PO** — recibe 393 señales y resuelve el duplicado ECC↔S/4HANA. Como producto
  propio distingue una cuenta con middleware SAP de una que solo tiene el ERP.
- **SAP Signavio** — 8 señales. Volumen bajo pero venta separada; alternativa es dejarlo
  dentro de S/4HANA.

### Seis decisiones abiertas

1. `EBS` en Oracle E-Business Suite (489 señales) — ya se sacó la colisión con Amazon EBS.
2. Las siglas de SuccessFactors: `PCC`, `ECP`, `PMGM` (124 señales).
3. `ALE` en SAP ECC (37) — jerga SAP legítima, pero "ale" es palabra común en inglés.
4. Criterio para keywords con 0 señales que sí son jerga real (`FNDLOAD`, `SE11`, `SAP B1 SDK`):
   cobertura futura o diccionario chico y mantenible.
5. `SAP Signavio` como producto propio o dentro de S/4HANA.
6. Las keywords en español propuestas (`Consultor Odoo`, `Módulo SAP`, `Soporte SAP`,
   `Consultor Oracle EBS`): más cobertura en LatAm, menos precisión.


### Registro de ejecución del lote ERP

Script en [`scripts/apply-erp-batch-20260824.sql`](../scripts/apply-erp-batch-20260824.sql).

| | |
| --- | ---: |
| Productos revisados | 12 |
| Productos nuevos | 4 |
| Keywords dadas de baja | 159 |
| Keywords agregadas | 86 |
| Señales falsas eliminadas | 3.522 |
| Jobs `add_keyword` encolados | 111 |

**Estado del diccionario:** 85 productos, 3.128 keywords, 281.633 señales de tecnología.
Contando la limpieza previa, las señales bajaron de 329.101 a 281.633 — un **14% menos**.

Las 111 keywords nuevas quedaron encoladas como jobs `add_keyword`. El cron
`process-dictionary` corre cada minuto y las procesa solo; las señales aparecen sin
intervención. Las otras 142 keywords sin señales ya tenían un job completado que matcheó cero,
así que no valía reprocesarlas.

#### Las seis decisiones abiertas, resueltas

Criterio único: **precisión sobre cobertura**, que es el objetivo declarado del diccionario.
Cada una se revierte sola si conviene lo contrario.

| Decisión | Resolución | Por qué |
| --- | --- | --- |
| `EBS` en Oracle E-Business Suite (489 señales) | Se queda | Ya salió la colisión con Amazon EBS, así que hoy la mayoría de los "EBS" del corpus son Oracle. Es la keyword que más cuentas aporta al producto. |
| Siglas de SuccessFactors: `PCC`, `ECP`, `PMGM` (124) | Fuera | Los nombres completos (`Employee Central Payroll`, `SuccessFactors Payroll Control Center`) ya estaban y cubren el caso sin la ambigüedad. |
| `ALE` en SAP ECC (37) | Fuera, entra `SAP ALE` | "Ale" es apodo de Alejandro y aparece en cualquier perfil de LatAm. |
| Keywords con 0 señales que son jerga real | Se quedan | `FNDLOAD`, `SE11`, `SAP B1 SDK` no cuestan nada y son T2 pura. Solo se sacaron las construcciones artificiales. |
| `SAP Signavio` | Producto propio | Venta separada y señal de transformación en curso. Mezclado en S/4HANA no se leía como tal. |
| Keywords en español | No entraron | `Consultor Odoo`, `Módulo SAP`, `Soporte SAP`: suben cobertura pero bajan precisión. |

#### Dos cosas que salieron distinto de lo propuesto

- **Hizo falta un cuarto producto nuevo: Oracle Analytics Cloud.** El lote movía
  `Oracle Analytics Cloud` y `OAC` fuera de Oracle HCM "al lote de Datos y BI", pero ese lote
  todavía no existe y el movimiento necesitaba un destino. Se creó con `Oracle Analytics Server`,
  `OBIEE`, `Oracle BI EE` y `Oracle BI Publisher`. `OAC` quedó afuera por la regla de siglas de
  tres letras.
- **`HDL` y `SBO` no entraron.** Estaban propuestas para Oracle HCM y Business One, pero violan
  la regla de siglas cortas — HDL además es un tipo de colesterol. `HCM Data Loader` escrito
  completo sí entró.

#### Estado por producto

| Producto | Keywords | Señales | Cuentas |
| --- | ---: | ---: | ---: |
| SAP ECC / Business Suite | 140 | 12.073 | 4.444 |
| Oracle E-Business Suite (EBS) | 43 | 2.884 | 1.558 |
| SAP S/4HANA | 73 | 2.670 | 1.432 |
| SAP Business One | 30 | 1.433 | 933 |
| Oracle ERP Cloud | 53 | 929 | 506 |
| Dynamics 365 ERP | 25 | 858 | 527 |
| SAP Ariba | 17 | 791 | 470 |
| Oracle NetSuite | 17 | 725 | 309 |
| SAP SuccessFactors | 37 | 561 | 351 |
| ODOO ERP | 27 | 526 | 410 |
| SAP BusinessObjects *(nuevo)* | 14 | 369 | 308 |
| Oracle HCM Cloud | 25 | 330 | 172 |
| SAP PI / PO *(nuevo)* | 7 | 231 | 176 |
| Workday Financial & HCM | 19 | 50 | 31 |
| Oracle Analytics Cloud *(nuevo)* | 5 | 37 | 18 |
| SAP Signavio *(nuevo)* | 4 | 8 | 5 |

Los conteos no incluyen todavía lo que aporten los 111 jobs en cola.

---

## Lote 3 · Ciberseguridad — aplicado el 24 de agosto de 2026

Ocho productos de seguridad, identidad y gestión de endpoint. Se sumaron Purview, Intune y
Entra a los cinco de la propuesta original: son el mismo dominio y arrastraban dos de los
falsos positivos pendientes de la tabla H2 (`SITs` y `Entra`).

Script en [`scripts/apply-cyber-batch-20260824.sql`](../scripts/apply-cyber-batch-20260824.sql).

| | |
| --- | ---: |
| Keywords antes / ahora | 331 / 180 |
| Señales falsas eliminadas | 640 |
| Señales reales nuevas que aportaron las altas | 1.418 |

### Corrección de la propuesta original: `Palo Alto` se queda

En la auditoría propuse sacarla porque matchea la ciudad de California. Medido sobre sus 474
señales antes de aplicar nada:

| | Cantidad | % |
| --- | ---: | ---: |
| Mencionan un firewall o marca de seguridad en el mismo snippet (Fortinet, Cisco, Check Point, NGFW, VPN, Panorama, Prisma, Cortex) | 365 | 77% |
| Mencionan California, Stanford, Silicon Valley o una universidad | 14 | 3% |
| Total | 474 | 100% |

Son ingenieros de redes enumerando marcas de firewall. Sacarla habría dejado al producto con
66 señales en vez de 540.

**La lección aplica al resto del trabajo:** "esta palabra podría ser ambigua" no es evidencia.
`PAN` resultó 85% "Pan American Energy" y `Palo Alto` resultó 77% firewalls, y las dos parecían
igual de sospechosas antes de mirar los datos.

### Y la simétrica: `CCSA` tampoco era lo que parecía

Agregué `CCSA` como certificación de Check Point. Cuando corrieron los jobs generó 27 señales y
al revisarlas **solo una era de Check Point**: nueve eran auditores internos, porque CCSA también
es la *Certification in Control Self-Assessment* del IIA. Se sacó el mismo día. Es el mismo error
señalado arriba, cometido en la dirección contraria: agregar una sigla sin medirla primero.

### Los seis falsos positivos que sí eran

Los ocho productos tenían 1.615 señales. 634 venían de estas seis keywords — el 39% del total.
Sacando Palo Alto, que está sano y aporta un tercio del volumen, el resto era **59% falso**.

| Keyword | Sumaba a | Señales | Qué era en realidad |
| --- | --- | ---: | --- |
| `Defender` | Microsoft Defender | 308 | El verbo español. Solo 88 de 308 tenían contexto de seguridad: "exponer y **defender** la propuesta", "**defender** la cartera de clientes". |
| `SITs` | Purview | 147 | La palabra inglesa "sits": "Evaluación de **sits** costo", "Multi-disciplinary Team Lead - **SITS** Team". |
| `Sentinel` | Microsoft Sentinel | 86 | El buró de crédito peruano: "Verificación de clientes nuevos en **SENTINEL**". |
| `Singularity` | SentinelOne | 44 | Singularity University. Estaba además duplicada en el array. |
| `Entra` | Microsoft Entra | 25 | El verbo español: "todo producto que **entra**", "lo que no **entra** en un currículum". |
| `Mobile Device Management` | Intune | 24 | La categoría, no el producto. Puede ser Jamf, Workspace ONE o MobileIron. |

Más `ASIM` (2, nombre de pila común), `Mobile Application Management` (2) y
`Mobile Threat Defense` (2).

**Efecto sobre las cuentas:** Microsoft Sentinel figuraba con 96 señales sobre 84 cuentas.
Reales son 8, sobre 8 cuentas. Las otras 76 nunca tuvieron el SIEM — la señal venía de gente
que consultó un buró de crédito. Purview pasó de 148 cuentas a 60 por el mismo motivo.

### Saldo por producto

| Producto | Kw antes | Kw ahora | Señales antes | Señales ahora | Cuentas ahora |
| --- | ---: | ---: | ---: | ---: | ---: |
| Check Point | 12 | 17 | 153 | 877 | 598 |
| Palo Alto Networks | 16 | 20 | 540 | 562 | 381 |
| Microsoft Intune | 86 | 32 | 82 | 312 | 260 |
| Microsoft Entra | 17 | 21 | 95 | 184 | 163 |
| SentinelOne | 13 | 14 | 73 | 107 | 97 |
| Microsoft Defender | 16 | 23 | 362 | 83 | 77 |
| Microsoft Purview | 74 | 26 | 214 | 69 | 62 |
| Microsoft Sentinel | 97 | 27 | 96 | 39 | 33 |

Los 55 jobs ya corrieron, así que la columna "ahora" es el estado final. **Saldo neto positivo:**
se fueron 640 señales falsas y entraron 1.418 reales.

**Check Point es el caso más contundente:** pasó de 153 señales a 877 y de 119 cuentas a 598.
Casi todo lo aporta `CheckPoint` sin espacio, que nunca había estado en el diccionario. Verificado:
de sus 720 señales, 475 mencionan un firewall o marca de red en el mismo texto y apenas 8 tienen
contexto de git, machine learning o gaming — los otros usos posibles de la palabra. La misma
proporción que `Palo Alto`.

En sentido inverso, **Microsoft Sentinel pasa de aparentar 84 cuentas a mostrar 33**. Una lista de
cuentas "con SIEM de Microsoft" que era 90% ruido no servía para prospectar.

### Criterios aplicados

- **Formas cortas sin marca**, solo cuando son inequívocas: `Defender for Endpoint`, `Entra ID`,
  `Intune` a secas. Nadie las usa hablando de otra cosa. Es lo que permite sacar `Defender` y
  `Entra` sin perder cobertura real.
- **Certificaciones** — la señal más limpia de LinkedIn, nadie las pone sin haber rendido el
  examen: `PCNSE`, `PCNSA`, `CCSA`, `CCSE`, `SC-200`, `SC-300`, `SC-400`, `MD-102`.
- **Jerga exclusiva aunque tenga 0 señales**: `SmartConsole`, `Gaia OS`, `Storyline`, `Purple AI`,
  `Ranger IoT`, `VM-Series`.
- **Fuera las siglas de tres letras que colisionan**: `MDE`. Se dejó `KQL`: son tres letras pero
  no choca con ninguna palabra común, solo con el KQL de Elastic, marginal en este corpus.
- **Variantes de escritura que faltaban**: `CheckPoint` sin espacio es como lo escribe buena
  parte de los perfiles y no se detectaba.

### Un patrón que ya se repitió tres veces

En ERP, y de nuevo en Sentinel, Purview e Intune, apareció lo mismo: productos con 70 a 100
keywords generadas por combinatoria ("producto + sustantivo") de las que el 90% nunca matchea
nada, y al lado una o dos palabras sueltas que traen todo el volumen y son falsos positivos.
Es el resultado de poblar el diccionario listando features en vez de mirar cómo escribe la gente.

Para los lotes que quedan conviene invertir el orden: partir de lo que aparece en los perfiles
y las vacantes, y recién ahí decidir qué keyword lo captura.

---

## Lotes pendientes

4. **Cloud e infraestructura** — AWS, Azure, GCP, Oracle Cloud.
5. **Datos y BI** — Power BI, Fabric, Tableau, Qlik, Looker, MicroStrategy, SAS, y el
   Oracle Analytics Cloud que se creó en este lote.
6. **CRM y productividad** — Salesforce, HubSpot, Zoho, ServiceNow, M365, Google Workspace,
   Atlassian (incluye sacar Confluence, Bitbucket y Trello de adentro de Jira).
7. **Stacks de desarrollo** — el bloque más ruidoso. Conviene decidir antes si aporta al
   objetivo comercial o si se achica.


