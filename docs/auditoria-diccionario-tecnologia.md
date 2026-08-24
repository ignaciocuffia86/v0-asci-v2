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

## Lote 4 · Cloud e infraestructura — aplicado el 24 de agosto de 2026

Trece productos: AWS, Azure, Google Cloud Platform, Oracle Database, Weblogic, SQL Server,
Windows Server, Exchange Server, SCCM, Datadog, Dynatrace, AS/400 e IBM Z.

Script en [`scripts/apply-cloud-batch-20260824.sql`](../scripts/apply-cloud-batch-20260824.sql).

| | |
| --- | ---: |
| Keywords antes / ahora | 512 / 515 |
| Señales falsas eliminadas | 10.229 |
| Keywords nuevas | 80 |
| Señales reales que aportaron las altas | 7.528 |

### Corrección de un error mío en el lote ERP

En el lote de ERP afirmé, para justificar que `EBS` se quedara en Oracle E-Business Suite:
*"ya salió la colisión con Amazon EBS, así que hoy la mayoría de los EBS del corpus son
Oracle"*. **Era falso: nunca la saqué de AWS.** La decisión de dejar `EBS` en Oracle se aprobó
sobre una premisa que afirmé sin verificar.

Medido ahora: de las 1.679 señales que `EBS` generaba **dentro de AWS**, solo 3 mencionan algo
de AWS en el mismo texto. Los snippets dicen "Oracle EBS Finance Technical Consultant" y
"Oracle EBS Functional Analyst" — consultores de Oracle contando como usuarios de Amazon Web
Services. Ya está resuelto: `EBS` salió de AWS y entró `Amazon EBS`.

### El criterio, ya estabilizado

No es la longitud de la sigla ni si "suena" ambigua: es **la proporción entre señales
identificablemente reales e identificablemente falsas** en el corpus. Se queda por encima de
~80:20, sale por debajo.

Cinco keywords que estaban en la lista de bajas y la medición salvó:

| Keyword | Producto | Señales | Medición |
| --- | --- | ---: | --- |
| `OSB` | Weblogic | 354 | 354/354 mencionan Oracle, SOA o middleware |
| `Lambda` | AWS | 70 | 70/70 mencionan AWS. En la auditoría la había marcado genérica |
| `Bicep` | Azure | 24 | 24/24 con contexto Azure o IaC |
| `Configuration Manager` | SCCM | 452 | 219 contexto Microsoft vs 40 ITIL — 85:15 |
| `OCI` | Oracle Database | 901 | 66% con contexto Oracle. Proponía reemplazarla; no hacía falta |
| `ILE` | AS/400 | 45 | 39/45 con contexto IBM i |

Y la que salió por el mismo criterio: **`Exchange`** (5.028) — 1.380 con contexto de correo
contra 1.026 de "foreign exchange", "stock exchange", "data exchange" e "intercambio". 57:43,
la peor relación del lote.

### Los falsos positivos

| Keyword | Sumaba a | Señales | Qué era |
| --- | --- | ---: | --- |
| `Exchange` | Exchange Server | 5.028 | Ver arriba |
| `EBS` | AWS | 1.679 | "Oracle EBS Finance Technical Consultant" |
| `Visual Studio` | Azure | 1.117 | Es un IDE, no una nube |
| `Redis` | AWS | 526 | Base independiente; aparece más junto a GCP (49) que a AWS (37) |
| `OEM` | Oracle Database | 271 | Original Equipment Manufacturer, perfiles de automotriz |
| `Power Systems` | AS/400 | 220 | Ingeniería eléctrica. Solo 19 de 220 mencionan IBM |
| `Entra ID` | Azure | 106 | Duplicada — la agregué al producto Entra en el lote anterior |
| `SNS` | AWS | 98 | "prevención de riesgo - SNS Iquique", empresa chilena |
| `Aurora` | AWS | 89 | Nombre propio; 3 de 89 con contexto AWS |
| `RBAC` | Azure | 82 | Término genérico de identidad |
| `MSU` | IBM Z | 72 | "MSU S.A", "MSU ENERGY" |
| `Comprehend` | AWS | 72 | El verbo inglés; cero contexto AWS |
| `ECS` | AWS | 59 | 2 de 59 con contexto AWS |
| `TPF` | IBM Z | 55 | "TPF INGENIERIA" |
| `X-Ray` | AWS | 48 | Radiografía; cero contexto AWS |
| `AMI` | AWS | 47 | También Advanced Metering Infrastructure en utilities |
| `PDS`, `SNA`, `RMF`, `GDG`, `HMC`, `MIPS`, `VTL`, `IPL`, `WLM`, `IFL` | IBM Z | 248 | Siglas que en este corpus casi nunca aparecen en contexto de mainframe |
| `Lex`, `Polly` | AWS | 46 | "Lex Doctor", "Polly Pocket" |
| `CIAM` | Google Cloud | 26 | Customer IAM; no tiene nada de Google |
| `App Engine`, `Compute Engine`, `Cloud SQL`, `Cloud IAM`, `Cloud Functions` | GCP | 49 | Nombres de Google que como frase suelta leen genéricos |
| `spool`, `NoSQL Database`, `APN`, `Memcached` | IBM Z / AWS | 101 | Categorías o siglas de otra industria |
| 26 términos genéricos de Java EE | Weblogic | 20 | `JMS Queues`, `WSDL Services`, `XSLT Transformations`… |

### Los huecos de cobertura

El desbalance más llamativo del diccionario: **AWS tenía 134 keywords** — entre ellas
`AWS DeepRacer`, `AWS DeepLens` y `AWS DeepComposer`, tres juguetes educativos que nadie pone
en un perfil — y **ninguna para S3, EC2, RDS o Lambda con el nombre completo**.

| Producto | Lo que faltaba |
| --- | --- |
| AWS | `Amazon S3`, `S3 Bucket`, `Amazon EC2`, `Amazon RDS`, `AWS RDS`, `AWS Lambda`, `Amazon ElastiCache` |
| Azure | `Azure DevOps`, `Azure Functions`, `Azure Kubernetes Service`, `AKS`, `Azure App Service`, `Azure Monitor`, `Application Insights`, `Azure Databricks` |
| Google Cloud | `BigQuery`, `Google Cloud Storage`, `Pub/Sub`, `Cloud Dataflow`, `Cloud Build`, `Cloud Spanner` |
| IBM Z | `JCL`, `VSAM`, `CICS`, `ISPF`, `RACF`, `DB2 for z/OS`, `Endevor`, `Changeman` |
| AS/400 | `RPGLE`, `RPG IV`, `CL/400`, `Query/400`, `IBM Power Systems` |

Los dos más caros:

- **Google Cloud no tenía `BigQuery`**, el producto insignia de la plataforma y el que más
  aparece en vacantes de datos. Sí tenía `Eventarc` y `Anthos`.
- **IBM Z no tenía `JCL`, `VSAM`, `CICS` ni `ISPF`**, la jerga central del mainframe. Sí tenía
  `MSU`, `MIPS` y `VTL`, que resultaron ser nombres de empresas. El producto miraba exactamente
  al lado equivocado.

Se agregaron también las certificaciones de cada nube (`AZ-104`, `AZ-305`, `AZ-900`,
`Professional Cloud Architect`, `OCI Architect`).

Una de las altas no pasó su propia prueba: `Pub/Sub` en Google Cloud quedó en 82 con contexto
Google contra 32 de Kafka, RabbitMQ y SQS — *publish/subscribe* es también un patrón de
arquitectura genérico. 72:28 está debajo del umbral, así que se reemplazó por `Cloud Pub/Sub` y
`Google Pub/Sub`. Es la misma verificación que descartó `CCSA` en el lote anterior: **medir las
altas, no solo las bajas**.

### Saldo

| Producto | Kw antes | Kw ahora | Señales antes | Señales ahora | Cuentas antes | Cuentas ahora |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Microsoft SQL Server | 22 | 25 | 21.422 | 22.288 | 11.339 | 11.722 |
| AWS | 134 | 139 | 19.731 | 17.535 | 6.573 | 5.627 |
| Oracle Database | 88 | 87 | 13.355 | 13.380 | 5.731 | 5.681 |
| Google Cloud Platform | 16 | 22 | 5.697 | 6.594 | 2.217 | 2.493 |
| Microsoft Windows Server | 20 | 22 | 5.321 | 5.341 | 3.804 | 3.814 |
| Azure | 63 | 65 | 3.347 | 4.790 | 1.999 | 2.303 |
| Weblogic | 62 | 36 | 3.511 | 3.491 | 1.624 | 1.614 |
| AS/400 | 12 | 15 | 2.194 | 2.047 | 1.289 | 1.204 |
| IBM Z | 49 | 44 | 809 | 1.851 | 441 | 655 |
| Microsoft Exchange Server | 15 | 22 | 5.738 | 1.102 | 3.779 | 903 |
| System Center Configuration Manager | 18 | 21 | 930 | 935 | 608 | 610 |
| Datadog | 8 | 10 | 622 | 622 | 273 | 273 |
| Dynatrace | 5 | 7 | 475 | 475 | 283 | 283 |

**Exchange Server es la corrección más grande de todo el trabajo:** pasó de 3.779 cuentas a 903.
Casi tres mil cuentas dejaron de figurar con un servidor de correo Microsoft que nunca tuvieron.

**IBM Z va en la dirección opuesta y es el mejor resultado del lote:** subió de 441 cuentas a 655
*después* de sacarle 14 keywords. Sacar las siglas que eran nombres de empresa y poner en su
lugar `JCL`, `VSAM`, `CICS` e `ISPF` más que duplicó las señales del producto. Es la
demostración de que el problema no era tener pocas keywords, era tener las equivocadas.

Azure ganó 304 cuentas por `Azure DevOps` sola (2.073 señales) y Google Cloud 276 por `BigQuery`
(822). Las dos faltaban por completo.

### Los que no se tocaron

Microsoft SQL Server (21.422 señales, el producto más detectado del diccionario), Windows
Server, Datadog y Dynatrace pasaron sin bajas. Todos tienen nombre de marca inventado o siglas
inequívocas (`T-SQL`, `SSIS`, `SSRS`, `SSAS`, `WSUS`).

**El patrón de los cuatro lotes:** los productos con nombre de marca inventado no dan problemas
nunca. Sufren los que usan palabras del idioma — Exchange, Aurora, Lambda, Comprehend, Defender,
Entra — o siglas que otra industria también usa.

---

## Lote 5 · Datos y BI — aplicado el 24 de agosto de 2026

Once productos (diez más uno nuevo). Script en
[`scripts/apply-datos-bi-batch-20260824.sql`](../scripts/apply-datos-bi-batch-20260824.sql).

### El caso Fabric

Tres keywords de una palabra sostenían casi todo el volumen del lote y las tres parecían
igual de riesgosas: `Tableau` es una palabra francesa, `Looker` parece un sustantivo inglés y
`Fabric` es "tela".

| Keyword | Señales | Con contexto BI | Claramente otra cosa | Veredicto |
| --- | ---: | ---: | ---: | --- |
| `Tableau` | 3.184 | 1.906 | 1 | Se queda |
| `Looker` | 884 | 504 | 1 | Se queda |
| `Fabric` | 631 | 164 | 80 | **Sale** (67:33) |

Las 80 de `Fabric` son de redes ("switching y routing", "AWS Edge Fabric", "Service Fabric") y
de la industria textil. Microsoft eligió para su producto una palabra que ya estaba ocupada en
dos lugares distintos. **Es exactamente el mismo problema que `Defender`, `Exchange`,
`Sentinel`, `Entra`, `Aurora` y `Comprehend`: la lista de productos que rompen el diccionario
es la lista de productos cuyo nombre es una palabra que ya existía.**

La diferencia con Tableau y Looker no es qué tan rara suena la palabra, es si la gente que la
escribe en LatAm la usa para otra cosa.

### Bajas

| Keyword | Sumaba a | Señales | Qué era |
| --- | --- | ---: | --- |
| `Fabric` | Microsoft Fabric | 631 | Redes y textil |
| `Data Manager` | Qlik | 409 | Es un puesto, no un producto. Solo 22 de 409 con contexto BI: "Technical Data Manager", "Clinical Data Manager Assistant" |
| `Dossiers` | MicroStrategy | 39 | Cero contexto BI: "Press & Communications", "Asuntos Regulatorios", "Document Control" |
| `Strategy One` | MicroStrategy | 2 | Frase genérica |
| `Data Model Viewer`, `Data Load Editor` | Qlik | 0 | Nombres de pantalla que leen genéricos |
| 23 verticales de SAS | SAS | 0 | `SAS Tax Fraud`, `SAS Social Benefits Analytics`, `SAS Claims Fraud` |
| 8 combinatorias de Looker | Looker | 0 | `Looker BI`, `Looker Data Platform`, `Looker REST API` |

Más el duplicado literal `Microstrategy`/`MicroStrategy`.

**Una que no se agregó a propósito: `SAS`.** En LatAm es "Sociedad por Acciones Simplificada" y
aparece en miles de razones sociales. Mismo caso que `CTS` en Perú o `RFC` en México.

### Altas

Power BI tenía 12 keywords y 10.536 señales, pero todas eran variantes del nombre. **Ninguna era
del oficio.** Se agregaron `DAX`, `Power Query`, `PBIX`, `Tabular Editor`, `RLS Power BI`,
`Power BI Dataflows`, `Power BI Report Builder`, `PL-300`.

`DAX` y `Power Query` son el lenguaje y el motor de transformación: quien los escribe construyó
modelos, no miró un dashboard. Es la diferencia entre una cuenta que *tiene* Power BI y una que
lo *usa en serio*.

También: `OneLake`, `Direct Lake`, `Fabric Lakehouse` (Fabric); `tMap` (Talend); `LOD Expressions`
(Tableau); `BEx Analyzer`, `SAP Datasphere` (BusinessObjects); `Qlik` a secas; `Oracle Analytics`,
`OBIA` (Oracle Analytics Cloud). Se dejó afuera `OAS`, que en inglés es también *Organization of
American States*.

### Una alta que salió mal y terminó en producto nuevo

Se agregó `Crystal Reports` a SAP BusinessObjects. El job trajo **974 señales**, casi duplicando
el producto. Al revisar: **solo 17 de esos 974 contactos tienen alguna otra señal de
BusinessObjects.** Los otros 957 escriben "Crystal Reports" y nada más de la plataforma.

Tiene sentido: Crystal Reports se vende suelto y lo usa gente que no tiene ni va a tener
BusinessObjects. Como señal comercial son dos cuentas distintas. Se creó **SAP Crystal Reports**
como producto propio; la señal no se pierde, deja de disfrazarse.

*Tercera vez en tres lotes que verificar las propias altas encuentra algo:* `CCSA` resultó una
certificación de auditoría, `Pub/Sub` un patrón genérico, y ahora esto. **Medir las bajas no
alcanza.**

### Saldo

| Producto | Kw antes | Kw ahora | Señales antes | Señales ahora | Cuentas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Power BI | 12 | 21 | 10.536 | 11.157 | 4.817 |
| Tableau | 16 | 20 | 3.219 | 3.222 | 1.550 |
| Qlik Sense & QlikView | 55 | 55 | 1.450 | 1.795 | 1.184 |
| SAP BusinessObjects | 14 | 17 | 1.459 | 1.491 | 945 |
| Google Looker | 18 | 10 | 1.042 | 1.301 | 687 |
| SAP Crystal Reports *(nuevo)* | — | 6 | — | 979 | 854 |
| MicroStrategy | 27 | 26 | 767 | 727 | 440 |
| Oracle Analytics Cloud | 5 | 9 | 651 | 727 | 479 |
| Talend | 14 | 17 | 260 | 264 | 205 |
| SAS Viya y SAS 9 | 79 | 56 | 172 | 194 | 144 |
| Microsoft Fabric | 20 | 28 | 648 | 45 | 41 |

- **Power BI ganó 621 señales** solo con `DAX` y `Power Query`.
- **Qlik subió a pesar de perder 409:** sacar `Data Manager` y agregar `Qlik` dio saldo +345.
  Mismo patrón que IBM Z — la keyword que faltaba valía más que las que sobraban.
- **Microsoft Fabric cae de 397 cuentas a 41, y es correcto.** El producto salió en 2023; que
  397 cuentas de LatAm ya lo tuvieran era implausible.

El producto "Viya Platform" se renombró a **"SAS Viya y SAS 9"**: cubre las dos generaciones,
no solo Viya.

---

## Lote 6 · CRM y productividad — aplicado el 24 de agosto de 2026

Diecinueve productos. Script en
[`scripts/apply-crm-productividad-batch-20260824.sql`](../scripts/apply-crm-productividad-batch-20260824.sql).

Este lote casi no tuvo falsos positivos clásicos. El problema era otro y más difícil de ver:
**keywords que apuntan al vendor correcto pero al producto equivocado.**

### Un cuarto de Jira no era Jira

`Bitbucket` (437), `Trello` (336), `Atlassian` (187), `Confluence` (86) y `Bamboo` (48) estaban
dentro del producto Jira: 1.094 de sus 5.242 señales. Eso ya estaba marcado en la auditoría,
pero faltaba saber si importaba — si quien usa Trello igual usa Jira, mezclarlos casi no cambia
nada. Medido:

| De los contactos que mencionan… | Total | También mencionan Jira | % |
| --- | ---: | ---: | ---: |
| `Atlassian` | 187 | 19 | 10% |
| `Bitbucket` | 437 | 17 | 4% |
| `Trello` | 336 | 17 | 5% |
| `Confluence` | 86 | 3 | 3% |

Poblaciones casi disjuntas. Jira reportaba 2.452 cuentas cuando buena parte nunca vio un Jira, y
del otro lado escondía 360 cuentas con Bitbucket y 298 con Trello — conversaciones comerciales
completamente distintas.

Cuatro productos nuevos: **Confluence**, **Bitbucket y Bamboo**, **Trello** y
**Atlassian (producto sin identificar)**. El último suena raro a propósito: `Atlassian` trae
señal real (168 contactos que nombran la marca sin decir qué usan) pero no dice qué producto.
Ponerlo en Jira era mentir; borrarlo era perder información.

### Vendor correcto, producto equivocado

| Keyword | Señales | Medición | Qué se hizo |
| --- | ---: | --- | --- |
| `Microsoft Dynamics` | 1.009 | 294 con contexto CRM vs **472 con contexto ERP** (AX, NAV, Navision, Business Central, contabilidad, manufactura) | Movida a Dynamics 365 ERP: pasa de acertar 294 y errar 472 a lo inverso, +178 atribuciones correctas |
| `Copilot` | 687 | 382 (56%) con contexto de GitHub, repos, código o IDE | Se **mantiene**; el producto se renombra a "Copilot (GitHub y Microsoft 365)" |

**La distinción que quedó:** cuando una keyword ambigua reparte entre un producto y algo que no
es tecnología (`Exchange`, `Fabric`, `Defender`, `PAN`), sale. Cuando reparte entre dos productos
del mismo vendor (`Copilot`, `Microsoft Dynamics`), se queda y lo que se arregla es dónde vive y
cómo se llama. `Copilot` tiene la misma proporción que `Exchange` (56:44 contra 57:43) y sin
embargo se trata distinto: en Exchange el 43% no era Microsoft en absoluto.

### Falsos positivos

| Keyword | Sumaba a | Señales | Qué era |
| --- | --- | ---: | --- |
| `Commerce Cloud` | Salesforce Commerce Cloud | 106 | SAP y Oracle también tienen uno: "Ingeniero de solución **SAP** Commerce Cloud" |
| `MCC` | Marketing Cloud | 71 | Minería: "Mantenimiento Centrado en Confiabilidad", "GUARDIA BRIGADISTA 7X7 MCC" |
| `Microsoft Cloud` | Microsoft 365 | 66 | Marca paraguas, se pisa con Azure |
| `CPQ` | Sales Cloud | 52 | Categoría, no producto: Oracle CPQ, SAP CPQ, Conga |
| `MCP Servers` | Copilot | 30 | Model Context Protocol es un estándar abierto |
| `eDiscovery` | Google Workspace | 27 | Genérico, y además función de Purview |
| `CRM Cloud`, `Order Management System` | Sales / Commerce Cloud | 37 | Frases de categoría |
| `FSL`, `Query Studio`, `Salesforce Integration` | varios | 22 | Siglas cortas y keywords en el producto de otro vendor |
| 6 duplicados cross-product | Microsoft 365 | 45 | `SharePoint Administrator`, `Exchange Administrator`, `Intune Administrator`, `Teams Administrator`, `Microsoft 365 Defender`, `Azure AD Connect` |

También se movió `Power Platform Developer` (96) de Microsoft 365 a Power Apps.

### Los tres Zoho eran uno

Zoho CRM (681), Zoho Marketing (30) y Zoho Desk (**1**). Y dentro de Zoho CRM estaban cargadas
`zoho desk` y `zoho mail`: la separación ni siquiera se respetaba a sí misma. Se unificaron en
**Zoho**.

Es la decisión inversa a la de Jira y por el mismo motivo: **la granularidad tiene que seguir a
la evidencia.** Atlassian se partió porque las poblaciones eran disjuntas y grandes; Zoho se
unificó porque no había poblaciones que distinguir.

### Altas

**Microsoft 365 no tenía `Microsoft Teams`** — la aplicación con la que la gente identifica a
M365 más que con ninguna otra. Entró con 391 señales. Y en Salesforce faltaba todo el oficio:
`Salesforce Apex`, `Apex Trigger`, `Lightning Web Components`, `Salesforce Flow`, `Trailhead`.
Mismo hueco que Power BI en el lote anterior — el producto detectaba el nombre pero no a quien lo
construye. *No entró `Apex` a secas: colisiona con Oracle APEX.*

También: `Power Fx`, `Dataverse`, `Jira Software`, `Jira Service Management`, `Google Meet`,
`Automation 360`, `ServiceNow CMDB` y las certificaciones (`PL-100`, `PL-200`, `PL-400`,
`PL-500`, `MS-102`, `ServiceNow CSA`, `HubSpot Certified`, `Salesforce Certified`).

`Dataverse` se verificó tras el alta —también es un repositorio de datos académico y un nombre de
empresa— y quedó 24 de 30 con contexto Microsoft. Pasa.

### Saldo

| Producto | Señales antes | Señales ahora | Cuentas |
| --- | ---: | ---: | ---: |
| Sales Cloud | 5.756 | 5.714 | 2.156 |
| Microsoft SharePoint | 4.745 | 4.745 | 2.687 |
| Jira | 5.242 | 4.378 | 2.070 |
| Dynamics 365 ERP | 858 | 2.659 | 1.708 |
| Microsoft 365 | 2.134 | 2.326 | 1.586 |
| Power Automate | 1.350 | 1.352 | 951 |
| Power Apps | 861 | 956 | 668 |
| HubSpot | 781 | 774 | 525 |
| Copilot (GitHub y M365) | 767 | 737 | 335 |
| ServiceNow | 711 | 718 | 389 |
| Google Workspace | 662 | 711 | 491 |
| Zoho | 711 | 694 | 596 |
| Marketing Cloud | 670 | 606 | 301 |
| Bitbucket y Bamboo *(nuevo)* | — | 535 | 360 |
| Trello *(nuevo)* | — | 336 | 298 |
| Automation Anywhere | 312 | 315 | 214 |
| Dynamics 365 CRM | 1.318 | 309 | 222 |
| Service Cloud | 291 | 287 | 162 |
| Atlassian sin identificar *(nuevo)* | — | 194 | 132 |
| Confluence *(nuevo)* | — | 101 | 69 |
| Commerce Cloud | 159 | 39 | 30 |
| ELO Digital Office | 0 | 0 | 0 |

- **Jira baja de 2.452 cuentas a 2.070**, y aparecen 360 con Bitbucket, 298 con Trello, 132 con
  Atlassian y 69 con Confluence.
- **Dynamics 365 CRM cae de 1.318 señales a 309.** La corrección más brusca del lote: nueve de
  cada diez de sus señales venían de una keyword que apuntaba mayormente al ERP.
- **Microsoft 365 sube pese a perder ocho keywords**, por `Microsoft Teams`.

**ELO Digital Office sigue en cero**, con 45 keywords. Es el único producto del diccionario que
nunca generó una sola señal en ninguno de los seis lotes. Las keywords están bien armadas —todas
empiezan con "ELO"— simplemente no hay nadie en la base que lo mencione. Vale decidir si se
mantiene por cobertura futura o se saca.

---

## Lote 7 · Stacks de desarrollo — aplicado el 24 de agosto de 2026

Veinte productos de los vendors Backend, Frontend, Legacy y CMS. Script en
[`scripts/apply-stacks-dev-batch-20260824.sql`](../scripts/apply-stacks-dev-batch-20260824.sql).

### Los lenguajes estaban dentro de los frameworks

El producto React tenía cargadas `Javascript` (10.596 señales) y `TypeScript` (1.244): entre las
dos, **más de la mitad de todas las señales del producto**.

Es el error más caro del diccionario y el más fácil de pasar por alto, porque las señales no son
falsas — la gente sí sabe JavaScript. Simplemente eso no dice nada sobre React. Es como contar a
todo el que sabe SQL como cliente de Oracle.

No se borraron: se creó el producto **JavaScript / TypeScript**, que además recibe el tooling
transversal del ecosistema (`Jest`, `Cypress`, `Playwright`, `Vitest`, `ESLint`, `Webpack`,
`Vite`, `Babel`).

| Producto | Cuentas antes | Cuentas ahora |
| --- | ---: | ---: |
| React | 9.947 | 4.403 |
| JavaScript / TypeScript *(nuevo)* | — | 6.747 |

**El diccionario reportaba 9.947 cuentas con React y hay 4.403.** Con 6.747 cuentas,
JavaScript / TypeScript es el producto más grande del diccionario; que no existiera hasta hoy
dice bastante sobre cómo se había armado.

Mismo criterio dos veces más dentro de Java: `WebSphere Application Server` (162) salió a producto
propio (**IBM WebSphere**) y `WebLogic Server` (192) salió porque duplicaba al producto Weblogic
de Oracle.

### Cinco que se salvaron por medirlas

| Keyword | Producto | Señales | Contexto dev | En contra |
| --- | --- | ---: | ---: | ---: |
| `spring` | Spring Boot | 2.466 | 2.162 | 13 |
| `vue` | Vue.js | 923 | 436 | 0 |
| `ruby` | Ruby on Rails | 491 | 306 | 0 |
| `vercel` | Next.js | 103 | 23 | 0 |
| `dart` | Flutter | 89 | 52 | 0 |

`spring` venía marcada como sospechosa desde la auditoría original por "Spring 2024". Trece de
2.466 mencionan temporada. En un corpus de LinkedIn en español, "Spring" sin más es Java.

Quinta vez en siete lotes que la intuición falla en las dos direcciones.

### Falsos positivos medidos en este lote

| Keyword | Sumaba a | Señales | Qué era |
| --- | --- | ---: | --- |
| `Assembler` | Cobol | 152 | Assembly de microprocesadores y embebidos, no mainframe |
| `composer` | PHP | 173 | 19 con contexto dev contra 9 de música. Debajo del umbral |
| `Enterprise Server` | Micro Focus | 55 | 10 de 55 con contexto dev. Igual `Enterprise Developer`, `Enterprise Analyzer`, `Net Express`, `Server Express` |
| `Model Validation` | ASP.NET Core | 40 | Validación de modelos de riesgo: "Corporate Model Risk division of Wells Fargo" |
| `Wheel` | Python | 36 | Cero contexto dev: "Maintenance Engineer CAT machinery. Dozers, excavadoras" |
| `hypothesis testing` | Python | 25 | El método estadístico, no la librería |
| `Theming` | Ionic | 22 | Genérico de front-end (SASS, Drupal) |
| `Observables` | Angular | 21 | Término genérico de programación reactiva |

### Los que arrastraba desde la auditoría

La tabla H2 los marcó hace siete lotes y quedaron pendientes a propósito: cada uno era una
decisión de producto que correspondía a este lote. Todos salieron y entró su versión calificada.

| Producto | Salieron | Señales | Entraron |
| --- | --- | ---: | --- |
| PHP (Laravel) | `Vapor`, `Nova`, `Horizon`, `Scout`, `Fortify` | 1.791 | `Laravel Vapor`, `Laravel Nova`, `Laravel Horizon`, `Laravel Scout`, `Laravel Fortify` |
| ASP.NET Core | `Swagger`, `OpenAPI`, `Dapper`, `IoC`, `Dependency Injection` | 616 | `Dapper ORM`, `ASP.NET MVC`, `Minimal APIs` |
| Django | `ORM`, `Memcached`, `Redis Cache` | 525 | `Django ORM`, `Django REST Framework` |
| Angular | `Subjects` | 487 | `RxJS Subject`, `BehaviorSubject` |
| React | `CRA`, `Relay`, `Emotion` | 359 | `React Hooks`, `Redux Toolkit` |
| Flutter | `Navigator`, `DevTools` | 346 | `Flutter Navigator`, `Flutter DevTools`, `Flutter Bloc` |
| Spring Boot, Next.js, Wordpress | `Flux`, `ISR`, `CPT` | 341 | `Project Reactor`, `Incremental Static Regeneration`, `Custom Post Type` |
| Ruby on Rails | `Rack`, `Devise` | 299 | `Rack Middleware`, `Devise gem` |
| NodeJS | `npm`, `npx` | 236 | `NestJS`, `Fastify`, `TypeORM`, `Prisma ORM` |

**Un patrón que vale nombrar: Laravel.** Cinco de sus productos se llaman `Vapor`, `Nova`,
`Horizon`, `Scout` y `Fortify` — cinco palabras comunes que entre todas metían **1.791 señales
falsas** en PHP, más que cualquier otro grupo del diccionario salvo `Exchange`. Es el mismo
fenómeno que Microsoft con Fabric, Defender, Sentinel y Entra, concentrado en un solo framework.

### Los huecos

**NodeJS no tenía `NestJS`**, que entró con 650 señales de una. **Python no tenía `FastAPI`.**
**Wordpress no tenía `WooCommerce`**, que es la razón principal por la que una cuenta elige
Wordpress. Los tres son el mismo caso que `BigQuery`, `DAX` y `Microsoft Teams`: el diccionario
tenía las variantes del nombre y le faltaba aquello por lo que la gente lo usa.

También entraron `Maven`, `Gradle`, `Jakarta EE`, `Quarkus`, `Micronaut` (Java), `Pandas`,
`NumPy`, `Poetry` (Python), `NgRx`, `Angular Signals` (Angular), `Elementor`, `ACF Pro`
(Wordpress) y `NET MAUI`.

`Pandas` se verificó tras el alta —el riesgo era el animal— y quedó 175 de 199 con contexto de
desarrollo.

### Lo que quedó sin tocar, a propósito

- **Los vendors `Legacy`, `Backend`, `Frontend` y `CMS`** siguen siendo categorías usadas como
  vendors. Se propuso reagruparlos en la auditoría y se decidió no avanzar. Es el último problema
  de taxonomía abierto del diccionario.
- **`WPF` (325), `WinForms` (123), `Windows Forms` (93) y `ADO.NET` (86) dentro de Visual Basic.**
  Son de .NET de escritorio en general, no de VB: inflan el producto con desarrolladores de C#.
  No se movieron porque no hay producto destino y crear un ".NET Desktop" para cuatro keywords es
  peor que el problema.




### Saldo del lote

La columna "antes" es el estado al empezar la auditoría: estos veinte productos no se habían
tocado en los seis lotes anteriores, salvo por las bajas técnicas de la limpieza inicial.

| Producto | Cuentas antes | Cuentas ahora | Señales ahora |
| --- | ---: | ---: | ---: |
| Java | 11.654 | 11.479 | 31.454 |
| Python | 7.778 | 7.861 | 19.512 |
| JavaScript / TypeScript *(nuevo)* | — | 6.893 | 12.955 |
| PHP | 8.133 | 7.214 | 10.351 |
| React | 9.947 | 4.241 | 8.355 |
| Visual Basic | 4.026 | 3.993 | 5.757 |
| Angular | 3.966 | 3.637 | 7.183 |
| NodeJS / Express | 2.425 | 2.489 | 4.509 |
| Spring Boot | 2.169 | 2.119 | 4.288 |
| Wordpress | 1.892 | 1.998 | 2.406 |
| Delphi | 1.825 | 1.784 | 2.444 |
| Vue.js | 1.361 | 1.238 | 1.858 |
| Django | 1.506 | 1.234 | 1.744 |
| Cobol | 1.078 | 966 | 2.215 |
| ASP.NET Core | 925 | 980 | 1.301 |
| Next.js | 842 | 786 | 1.120 |
| Flutter | 1.022 | 758 | 963 |
| Ruby on Rails | 862 | 719 | 1.002 |
| Ionic | 3.006 | 623 | 803 |
| Flask | 553 | 550 | 813 |
| IBM WebSphere *(nuevo)* | — | 425 | 705 |
| Micro Focus | 134 | 81 | 101 |

**Ionic cae de 3.006 cuentas a 623**, y no es de este lote: es de la primera limpieza, cuando
salió `Storage` con sus 5.008 señales de "Data Base Storage" y "Application Server Storage". Es
el ejemplo más extremo de todo el trabajo — una sola palabra genérica sostenía cuatro quintas
partes de un producto.

**NodeJS, Wordpress, Python y ASP.NET suben** pese a haber perdido keywords, por `NestJS` (650),
`WooCommerce` (155), `Pandas` (199) y `FastAPI`. Es el mismo saldo que en IBM Z, Qlik y Microsoft
365: **lo que faltaba valía más que lo que sobraba**, y pasó en cuatro de los siete lotes.

Una corrección chica sobre la marcha: se había agregado `IBM MQ` al producto WebSphere nuevo.
Está mal —es un broker de mensajería que se vende aparte— y se sacó antes de que generara señales.

---

## Cierre

Los siete lotes están aplicados. El diccionario quedó en **90 productos y 3.038 keywords**,
contra los 82 productos y 3.300 keywords del arranque: doce productos nuevos, cuatro fusiones y
alrededor de **47.000 señales falsas eliminadas**.

### El criterio, en una línea

No es la longitud de la sigla ni si la palabra "suena" ambigua: es **la proporción entre señales
identificablemente reales e identificablemente falsas en el corpus, con umbral en ~80:20**.

La intuición falló en las dos direcciones cinco veces. Parecían riesgosas y no lo eran:
`Palo Alto` (77% firewalls), `Lambda` (70/70 con AWS), `OSB` (354/354 con Oracle), `Tableau`
(1.906 contra 1), `spring` (2.162 contra 13). Parecían inocentes y eran ruido: `Fabric`,
`Exchange`, `Data Manager`, `Storage`, `Wheel`.

### Los tres tipos de error que aparecieron

1. **Falso positivo puro** — la keyword matchea algo que no es tecnología. `PAN` era "Pan
   American Energy", `CTS` era "Compensación por Tiempo de Servicios", `SAT` la autoridad fiscal
   mexicana, `Defender` y `Entra` verbos españoles. **Se eliminan.**
2. **Vendor correcto, producto equivocado** — `Microsoft Dynamics` apuntaba más al ERP que al
   CRM; `Copilot` es 56% GitHub. **Se mueven o se renombra el producto**, no se borran.
3. **Nivel equivocado** — el lenguaje cargado dentro del framework (`Javascript` en React), la
   herramienta suelta dentro de la plataforma (`Crystal Reports` en BusinessObjects), el producto
   ajeno dentro del hermano (`Trello` en Jira). **Se crea el producto que faltaba.**

### Lo que quedó abierto al cerrar los siete lotes — y cómo se resolvió

- ~~**Los vendors `Legacy`, `Backend`, `Frontend` y `CMS`** son categorías haciendo de
  vendors.~~ → Resuelto por el rediseño de taxonomía: la categoría pasó a ser un eje propio y
  esos cuatro pseudo-vendors dejaron de existir. Ver `docs/rediseno-taxonomia-diccionario.md`.
- ~~**`WPF`, `WinForms`, `Windows Forms` y `ADO.NET` dentro de Visual Basic**~~ → Resuelto: se
  creó **.NET Framework y escritorio**, marcado `legado`.
- ~~**ELO Digital Office**, con 45 keywords y cero señales en los siete lotes.~~ → Dado de baja.
---

## Co-ocurrencia: recuperar lo que la limpieza tuvo que tirar

Durante los siete lotes hubo una tercera categoría de error que no tenía remedio. No era la
keyword falsa (se borra) ni la mal ubicada (se mueve): era **la keyword que es a la vez la forma
en que la gente nombra el producto y una palabra común**. `Fabric`, `Exchange`, `Commerce Cloud`,
`Pub/Sub`, `Web Forms`. Con las dos únicas herramientas disponibles —dejarla o sacarla— se
eligió sacarlas, y con eso se fueron también las señales buenas.

La co-ocurrencia agrega la tercera opción: **la keyword cuenta solo si el texto cumple una
condición adicional**. Se implementó en `process_dictionary_job` y en el matcher de TypeScript
(`matchTextAgainstDictionary`), con dos campos nuevos en `dictionary_products`.

### Son dos mecanismos, porque son dos errores distintos

Medir el ruido de `Fabric` mostró que venía de dos lugares que necesitan remedios opuestos:

| | Ambigüedad de **dominio** | Ambigüedad de **colocación** |
|---|---|---|
| Qué pasa | La misma palabra en otra industria | La palabra es parte del nombre de otro producto |
| Ejemplos | `Fabric` textil, `Fabric` de redes, `Exchange` bursátil | `Service Fabric`, `Hyperledger Fabric`, `SAP Commerce Cloud` |
| Campo | `keywords_contexto` | `keywords_excluye` |
| Qué hace | Exige que el texto **también** diga algo del dominio correcto | **Enmascara** la frase y exige que la keyword siga apareciendo |
| Alcance | **Entidad**: evidencia sobre el dominio de la persona o la vacante | **Ocurrencia**: es sobre esa mención puntual |

La distinción de alcance no es cosmética. El contexto mira todo el perfil porque un perfil de
redes no dice "Power BI" en ninguna parte, mientras que uno de datos sí, aunque `Fabric` esté en
el headline y "Power BI" en un puesto de 2019. La exclusión, en cambio, tiene que ser por
ocurrencia: **el contexto no filtra las colocaciones**, porque quien escribe "Service Fabric" es
justamente gente de datos que también usa Power BI. Enmascarar en vez de descartar la entidad
entera es lo que permite que un perfil que dice las dos cosas conserve la señal.

Sobre `Fabric`, la exclusión descartó 17 de los 154 perfiles que el contexto solo dejaba pasar.

### Resultado de las cinco primeras keywords

| Keyword | Producto | Crudo | Tras exclusión | Final | Muestra leída |
|---|---|---:|---:|---:|---|
| `Exchange` | Microsoft Exchange Server | 4.927 | 3.814 | 2.238 | 44/45 (98%) |
| `Fabric` | Microsoft Fabric | 556 | 376 | 123 | 43/45 (96%) |
| `Web Forms` | .NET Framework y escritorio | 211 | 211 | 191 | 24/25 (96%) |
| `Commerce Cloud` | Commerce Cloud (Salesforce) | 188 | 127 | 100 | 24/25 (96%) |
| `Pub/Sub` | Google Cloud Platform | 166 | 166 | 140 | contexto GCP, 84% |

Las cinco quedan muy por encima del umbral de 80:20 que se usó en toda la auditoría. En cuentas:

| Producto | Cuentas antes | Cuentas ahora |
|---|---:|---:|
| Microsoft Exchange Server | 903 | **2.118** |
| Microsoft Fabric | 41 | **146** |
| Commerce Cloud | 30 | **69** |
| .NET Framework y escritorio | 2.125 | 2.188 |
| Google Cloud Platform | 2.490 | 2.516 |

Exchange y Fabric son el caso extremo: la keyword que se había borrado por ruidosa aportaba el
67% y el 78% de la cobertura del producto.

### Dos cosas que el método volvió a confirmar

1. **Los términos de contexto también hay que medirlos.** Para `Fabric` se descartaron
   `Business Intelligence`, `Data Engineer` y `Warehouse` aunque sumaban 26 perfiles: al leerlos,
   la mitad eran textiles ("fabric samples", "fabric roll") y Fabric Care de P&G. Un término de
   contexto que ensancha la red sin discriminar no sirve para nada.
2. **Varias exclusiones aparecieron leyendo lo que sobrevivía al primer filtro**, no pensándolas
   de antemano: `Fabric UI` (el CSS de Office), `Fabric Manager` (Cisco), `K2View Fabric`,
   `urban fabric`, `Fabric Controller` (Azure), `e-commerce cloud`. Es la misma lección de los
   lotes anteriores: **medir lo que se agrega, no solo lo que se saca.**

### Cómo se opera

En el ABM del diccionario, cada keyword de un producto tiene un botón de mira (`Crosshair`) que
abre el panel de co-ocurrencia con las dos listas. Las keywords que tienen reglas quedan marcadas
en ámbar en la tabla, porque son las que sin reglas no podrían estar en el diccionario.

Cambiar las reglas de una keyword que ya existe encola **remove + add**: las señales viejas se
generaron con las reglas anteriores y hay que rehacerlas. Los dos jobs van en inserts separados a
propósito — en un solo insert compartirían `created_at`, el desempate quedaría indefinido y un
`add` que corriera antes que su `remove` terminaría borrando la keyword.

### Lo que queda abierto

- **Más keywords candidatas.** Las cinco de este lote eran las que ya estaban identificadas. El
  mismo tratamiento sirve para cualquier término que se haya descartado por ruidoso: la consulta
  de medición está en `scripts/`.
- **Co-ocurrencia en procesos.** Los campos están solo en `dictionary_products`; un job de
  proceso nunca los levanta. Si aparece el caso, es agregar las columnas en
  `dictionary_processes` y una rama más en la función.
