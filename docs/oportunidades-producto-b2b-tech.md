# Qué más podría hacer ASCI para empresas B2B tecnológicas

Fecha: 2026-08-17
Método: revisión del mapa de arquitectura (`docs/architecture-map.json`), el schema
(`scripts/*.sql`), las 36 tools del MCP y los planes existentes (`ROADMAP.md`,
`asci-v3-architecture-audit.md`) para proponer sólo cosas que **no estén ya hechas
ni ya planificadas**, y que se apoyen en activos que **ya existen en la base**.

---

## 1. Punto de partida: los activos que ya tenés

Antes de proponer, vale enumerar qué hay, porque las ideas buenas salen de acá y no
de mirar qué hace Apollo:

| Activo | Dónde vive | Por qué importa |
|---|---|---|
| **488k empresas LATAM** con país normalizado | `public.companies` | Es el moat. Apollo y ZoomInfo son flojos en LATAM. |
| **Diccionario vendor → producto → proceso** (6 tablas) | `public.dictionary_*` | Es lo más raro que tenés. Nadie más mapea "tecnología ↔ señal" en español. |
| **Radar findings con producto tipado** | `public.radar_findings` — `dictionary_product_ids uuid[]` **con índice GIN**, `source_date`, `evidence_level`, `confidence` | Ya es, de hecho, una tabla de *install base*. Sólo falta leerla al revés. |
| **Vacantes con fecha** | `public.job_postings` — `company_id`, `title`, `description`, `posted_at`, `is_active` | Serie temporal de contratación por empresa: el leading indicator más barato que existe. |
| **Noticias por empresa** | `public.company_news` | Timing. |
| **Contactos**: ETL propio + cache Apollo + base cruda de perfiles por skill | `public.contacts`, `apollo_contacts_cache`, MCP Perfiles | Contacto personal (mail/teléfono/LinkedIn) buscable **por lo que la persona sabe**. |
| **Motor de research** collect → structure → verify con fuentes citadas | `svc_research_engine` | Reusable para cualquier pregunta nueva, no sólo cuentas. |
| **Docs del tenant** → propuesta de valor, casos de éxito, industrias target | `v3.workspace_documents` | Personalización. |
| **MCP server con OAuth + 36 tools** | `app/api/v3/mcp/**` | Canal de distribución ya construido. |
| **Scoring determinístico y explicable** | `svc_v3_scoring` | Auditable, no caja negra. |

**La lectura estratégica:** hoy todo eso se usa en una sola dirección —
*cuenta → señales → contacto → icebreaker*. Casi todas las oportunidades que siguen
son **leer los mismos datos en otra dirección** o **sobre otro sujeto**, no ingerir
datos nuevos.

---

## 2. Las oportunidades, ordenadas por ROI

### 🥇 A. Install base competitivo y radar de desplazamiento

**Qué es.** Para una B2B tech, la pregunta que paga la cuota es: *"¿qué empresas usan
a mi competidor y están en ventana de cambio?"*. Hoy ASCI responde
"¿qué usa esta cuenta?"; falta el reverso: **"¿qué cuentas usan esto?"**.

Producto: elegís un vendor del diccionario (SAP, Salesforce, Oracle, un competidor
tuyo) y obtenés la lista de empresas donde se detectó, con fecha de detección,
nivel de evidencia y fuente. Encima de eso, un **score de ventana de reemplazo**:
antigüedad de la implementación + vacantes que mencionan migración + noticias de
licitación o cambio de CTO.

**Qué reutiliza.** Prácticamente todo: `radar_findings.dictionary_product_ids` ya
tiene índice GIN (la query reversa es inmediata), `dictionary_products → vendors`
ya relaciona producto con proveedor, `source_date` da antigüedad, `evidence_level`
y `confidence` dan la calidad. `svc_v3_capability` ya hace búsqueda inversa por
capacidad — esto es la misma idea pero por **vendor**, que es como piensa un
vendedor B2B tech.

**Qué falta.** Una vista/RPC de agregación (`install_base_by_product`), la UI de
lista, y la heurística de "ventana" (calibrable, no IA). Nada de research nuevo:
se sirve de lo ya recolectado.

**Esfuerzo:** medio (1,5–2 semanas). **Por qué para B2B tech:** el displacement es
*el* motion de venta de software B2B. Y es la feature que convierte a ASCI de
"herramienta de prospección" en "sistema de inteligencia competitiva", que se cobra
distinto.

---

### 🥈 B. Intent score por contratación (hiring signals)

**Qué es.** Hoy las vacantes entran como insumo del diccionario y se pierden como
producto. Pero `job_postings` tiene `posted_at` y `is_active`: eso es una **serie
temporal**. Una empresa que abre 3 vacantes de "Data Engineer / Snowflake" en 60
días está por invertir en data, y eso se sabe 3–6 meses antes de que salga la
licitación.

Producto: un **índice de intención por empresa y por dominio tecnológico**, con
tendencia (subiendo/estable/bajando), y alertas: *"Falabella pasó de 0 a 4 vacantes
de ciberseguridad en 45 días"*.

**Qué reutiliza.** `job_postings` + `dictionary_jobs` + `dictionary_job_matches`
(el matching título→tecnología ya existe) + `radar_findings.supporting_job_posting_ids`
(la trazabilidad ya está modelada).

**Qué falta.** Una agregación temporal (ventanas de 30/60/90 días), umbrales, y el
scheduler de alertas. El cron `v3-enrich-companies-linkedin` ya corre cada 10 min.

**Esfuerzo:** bajo-medio (1 semana). **Por qué para B2B tech:** es el intent data
que Bombora y G2 venden carísimo en EE.UU. y que no existe para LATAM. Y acá sale
de datos propios, sin pagar un proveedor.

---

### 🥉 C. Mapa de canal y partners (ecosystem intelligence)

**Qué es.** Buena parte del software B2B en LATAM se vende **vía partners e
integradores**. Nadie tiene el mapa de qué SI implementa qué tecnología y en qué
cuentas. Vos casi lo tenés: las vacantes de las consultoras dicen literalmente
*"buscamos consultor SAP S/4HANA para proyecto en [industria/cliente]"*.

Producto: para un vendor dado, el ranking de integradores activos por país y
tecnología, con qué cuentas tocan. Sirve para dos cosas: reclutar canal, y
detectar quién te está desplazando en una cuenta.

**Qué reutiliza.** `job_postings` (descripciones), diccionario, `companies`
(los SI también son empresas del universo de 488k), motor de research para el
drilldown.

**Qué falta.** Clasificar empresas como "integrador/consultora" (una vez, con IA
barata sobre la descripción + vacantes), y extraer la relación
consultora→tecnología→cliente. Es la idea con más incertidumbre de las tres primeras.

**Esfuerzo:** medio-alto (2–3 semanas, con un spike previo de validación).
**Por qué para B2B tech:** el canal es un problema real y sin herramienta. Diferenciación
alta, competencia nula en la región.

---

### D. TAM, territorio y whitespace (analítica sobre lo que ya hay)

**Qué es.** El vendedor usa ASCI cuenta por cuenta. El **CRO** compra otra cosa:
*"¿cuántas empresas en LATAM califican para mi producto, dónde están, cuánto cubrí
y qué me falta?"*. Con 488k empresas + señales tipadas eso es una query, no un
producto nuevo.

Producto: dado el perfil de fit del workspace (que **ya se infiere** de los
documentos, `svc_v3_scoring`), un panel con: universo direccionable por país /
industria / tamaño / tecnología, cuentas ya seguidas, y el whitespace. Exportable.

**Qué reutiliza.** `companies`, `signals`, `radar_findings`, el perfil de fit del
workspace, y los patrones de export de v2 (`svc_export_v2`, RPC + streaming).

**Qué falta.** Agregaciones y UI. Cero ingesta.

**Esfuerzo:** bajo-medio (1–1,5 semanas). **Por qué:** es lo que justifica el
presupuesto anual y mueve la conversación del usuario individual al comité de compra.
También es el mejor material de venta para el propio ASCI.

---

### E. Monitoreo de cuentas existentes: expansión y churn

**Qué es.** `v3.followed_accounts` hoy sirve para prospectar. Las mismas señales
sobre **clientes actuales** del tenant responden otra pregunta: *"¿qué cliente mío
está en riesgo o listo para expandir?"*. Cambio de CTO, adopción de un competidor,
layoffs, caída en contratación técnica.

**Qué reutiliza.** Todo el pipeline tal cual está. Sólo hace falta un flag de
relación en la cuenta (`prospect | customer | churned`) y un digest distinto.

**Esfuerzo:** bajo (3–5 días). **Por qué:** para una B2B tech el 70–80% del revenue
es renovación y expansión. Duplica la superficie de valor sin construir nada nuevo,
y baja el churn del propio ASCI (la herramienta sigue siendo útil cuando el vendedor
no está prospectando).

---

### F. Champions y aliados internos (el activo Perfiles, bien usado)

**Qué es.** El MCP de Perfiles busca personas **por lo que saben**. Cruzado con una
cuenta objetivo, contesta algo que ninguna herramienta de prospección contesta:
*"¿quién adentro de esta cuenta ya sabe usar mi tecnología?"* — es decir, tu champion
natural. Y el reverso: *"¿quién trabajó en una empresa que ya es mi cliente y ahora
está en una cuenta que quiero?"* — la referencia caliente.

**Qué reutiliza.** `profiles_search` con `includePast:true` (el historial laboral ya
se indexa), `public.contacts`, `apollo_contacts_cache`.

**Qué falta.** El cruce cuenta ↔ skill ↔ propuesta de valor del tenant, y la UI.
**Ojo:** son datos personales sensibles; hay que acotar el uso al contacto
profesional y dejarlo explícito (el propio MCP ya lo advierte).

**Esfuerzo:** medio (1,5 semanas). **Por qué:** es el ángulo más difícil de copiar,
porque depende de la base cruda de perfiles.

---

### G. Battlecards y proof-point matching automáticos

**Qué es.** Ya cruzás documentos del tenant con señales de la cuenta para el
icebreaker (`svc_v3_icebreakers`, `prepare_company_success_cases`). El paso natural:
cuando el radar detecta un **competidor** instalado en la cuenta, generar el
battlecard — en qué perdés, en qué ganás, qué caso de éxito tuyo aplica, qué
preguntas hacer.

**Qué reutiliza.** Documentos del tenant, radar findings, motor de research, la
capa de prompts versionados (`v3.ai_prompts`).

**Esfuerzo:** bajo-medio (1 semana), **pero depende de A** (necesita saber qué
competidor está instalado). Es el complemento comercial natural de la idea A.

---

## 3. Qué haría y en qué orden

**Recomendación: A → B → E.** Las tres se apoyan en datos ya recolectados, no
agregan costo de IA (que es el 90% del gasto según la auditoría) y cada una abre un
motion de venta distinto:

1. **A (install base competitivo)** — reposiciona el producto y es casi todo query,
   no research. El índice GIN ya está puesto.
2. **B (intent por contratación)** — la más barata en relación al valor; convierte
   un dato que hoy es sólo insumo interno en producto vendible.
3. **E (clientes actuales)** — 3–5 días para duplicar la superficie de uso.

Después, según a quién le quieras vender: **D** si el objetivo es subir en la
organización del cliente (CRO/dirección), **C o F** si el objetivo es diferenciación
defendible. **G** cuando A esté andando.

### Lo que NO haría todavía

- **Vender la data cruda como API/DaaS.** Canibaliza el producto, y los 488k
  registros más contactos personales abren un frente legal (PII) que no conviene
  hasta tener el contrato de datos y el lineage que pide la auditoría (§9.4, §14).
- **Agregar más micro-agentes de research.** La auditoría es explícita: primero
  reducir redundancia (search once, classify many), después ampliar. Todas las ideas
  de arriba están elegidas justamente para **no** sumar research.
- **Embeddings / búsqueda semántica en todo.** Mismo criterio de la auditoría: sin
  caso medido, no.
- **Salir de LATAM.** El moat es regional; competir con Apollo en EE.UU. con 488k
  empresas es perder.

### Precondición honesta

Nada de esto rinde si el pipeline sigue teniendo jobs que quedan `running` para
siempre y research que cuesta 90% del presupuesto. Los P0 de la auditoría
(durabilidad, watchdog, compactación de chat) siguen yendo primero — pero conviene
notar que **A, B, D y E casi no dependen del pipeline de research**: leen datos ya
persistidos. Se pueden construir en paralelo mientras se arregla lo de abajo.
