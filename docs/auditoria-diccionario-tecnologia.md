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
