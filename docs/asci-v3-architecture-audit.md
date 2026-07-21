# Auditoría de arquitectura y producto — ASCI v3

**Fecha:** 13 de julio de 2026  
**Alcance:** arquitectura de solución, IA y tokens, procesamiento de datos, multitenancy, confiabilidad, observabilidad y experiencia de usuario.  
**Objetivo prioritario:** mejorar la calidad percibida de los insights y la adopción de la plataforma.  
**Método:** revisión estática del repositorio y consultas agregadas, de solo lectura, sobre Supabase. No se modificaron datos ni comportamiento productivo.

---

## 1. Resumen ejecutivo

ASCI v3 está bien encaminada conceptualmente: migra desde una experiencia centrada en tablas hacia una experiencia centrada en cuentas, evidencia y acciones comerciales. La separación entre cache global y datos tenant-specific es una decisión sólida; también lo son el score determinístico, la trazabilidad por fuentes, el uso de documentos del workspace para personalizar el research y la distinción visual entre hechos explícitos e inferencias.

Sin embargo, hoy hay una diferencia importante entre una **arquitectura funcional para validar el producto** y una **arquitectura operable a escala**. Los principales riesgos no están en la idea del producto, sino en cuatro puntos:

1. **Research costoso y redundante:** el radar ejecuta varios micro-agentes con Opus y web search; el historial observado concentra aproximadamente el 90% del costo total en esta etapa. Las llamadas `radar-tech` promedian 58.372 tokens de entrada y las `radar-news`, 20.674. Parte de ese volumen se explica por contextos de búsqueda que se vuelven a enviar en múltiples pasos y por investigar focos separados que pueden consultar las mismas fuentes.
2. **Jobs no durables:** el pipeline depende de ejecución en background desde una request y de estados manuales en `research_jobs`. En la muestra hay un job `running` estancado desde hace más de 10 días. No hay leases, heartbeat, intentos por etapa, watchdog ni recuperación automática robusta.
3. **Insights valiosos pero dispersos:** la vista de cuenta explica bien evidencia, fuentes y score, pero obliga al usuario a construir mentalmente la respuesta a tres preguntas clave: “¿por qué importa ahora?”, “¿qué puedo venderle?” y “¿a quién contacto?”. La información está distribuida en scorecard, Radiografía, Señales, Contexto e Icebreakers.
4. **Observabilidad insuficiente para optimizar:** se registran tokens y costo para radar, chat y scoring, pero no latencia, cache hit, outcome de negocio, calidad evaluada, versión efectiva del prompt, cantidad de búsquedas ni costo de todos los flujos. El procesamiento documental usa IA pero no aparece en `ai_usage_log`.

### Recomendación principal

Evolucionar hacia una arquitectura de **evidence-first account intelligence**:

- recolectar evidencia web una sola vez por cuenta y ventana temporal;
- normalizarla como objetos verificables y reutilizables;
- ejecutar clasificadores/micro-agentes baratos sobre ese corpus común;
- reservar modelos premium para síntesis final o casos de baja confianza;
- persistir un “account brief” orientado a decisión y no solo una colección de findings;
- ejecutar el pipeline con jobs durables, etapas idempotentes y recuperación automática.

Esta dirección mejora simultáneamente costo, latencia, consistencia, explicabilidad y UX.

---

## 2. Estado actual observado

### 2.1 Volumen y madurez de la muestra

La instancia v3 todavía tiene poco volumen, por lo que los datos sirven para detectar patrones, no para proyectar costos definitivos:

- 3 workspaces.
- 2 miembros activos.
- 4 documentos.
- 3 campañas y 11 cuentas de campaña.
- 3 research jobs: 2 completados y 1 `running` estancado.
- 2 scorecards.
- 2 cuentas seguidas.
- 28 registros de uso de IA.
- 12 mensajes de chat.
- 146 sugerencias de términos de diccionario.

Los dos jobs completados demoraron en promedio **549 segundos**, con un p95 observado de **795 segundos**. Aun con una muestra pequeña, una espera de 9–13 minutos requiere una experiencia explícitamente asíncrona, confiable y recuperable.

### 2.2 Consumo de IA observado

| Feature | Modelo | Llamadas | Input tokens | Output tokens | Costo observado | Promedio input | Promedio output |
|---|---|---:|---:|---:|---:|---:|---:|
| radar-tech | Claude Opus 4.5 | 7 | 408.606 | 25.215 | USD 1,6040 | 58.372 | 3.602 |
| radar-news | Claude Opus 4.5 | 4 | 82.697 | 13.233 | USD 0,4466 | 20.674 | 3.308 |
| chat | Claude Sonnet 4.5 | 4 | 37.984 | 1.280 | USD 0,1332 | 9.496 | 320 |
| radar-tech | Gemini 2.5 Flash | 7 | 28.729 | 20.218 | USD 0,0592 | 4.104 | 2.888 |
| radar-news | Gemini 2.5 Flash | 4 | 12.836 | 10.702 | USD 0,0306 | 3.209 | 2.676 |
| scoring | Gemini 2.5 Flash | 2 | 1.347 | 22 | USD 0,0005 | 674 | 11 |

**Lectura:**

- El research premium representa aproximadamente **90% del costo observado**.
- El estructurador consume muchos tokens de salida: devuelve objetos ricos para cada micro-agente. Hay margen para esquemas más compactos y menos repetición.
- El chat envía en promedio casi 9.500 tokens para producir 320. El ratio input/output sugiere historiales y tool outputs grandes reenviados en cada turno.
- El scoring es correctamente barato: cálculo determinístico y IA limitada al rationale.
- No hay medición de tokens/costo del procesamiento documental ni, en la muestra, de icebreakers y otros flujos.

---

## 3. Arquitectura actual

### 3.1 Capas

```text
Usuario
  ├─ Documentos del workspace
  ├─ Chat / MCP
  ├─ Cuentas seguidas
  └─ Vista de cuenta
       │
       ▼
Next.js v3
  ├─ Auth + workspace guards
  ├─ Tools del chat
  ├─ Research pipeline
  ├─ Score determinístico
  ├─ Contactos / icebreakers
  └─ Digest mensual
       │
       ├──────────────┐
       ▼              ▼
Supabase v3       Cache global public
(tenant data)     (compartido con v2)
  ├─ workspaces      ├─ companies
  ├─ documents       ├─ radar runs/findings
  ├─ profiles        ├─ signals
  ├─ jobs            ├─ job postings
  ├─ scorecards      └─ Apollo cache
  └─ chat
       │
       ▼
AI Gateway
  ├─ Opus + web search
  ├─ Gemini structurer/scoring
  └─ Sonnet chat/writer
```

### 3.2 Fronteras v2/v3

La regla de convivencia está bien definida:

- v3 escribe sus datos tenant-specific en el schema `v3`.
- Reutiliza caches globales de `public`.
- No debe ejecutar cambios destructivos sobre v2.
- Los findings de radar son globales y reutilizables; score, seguimiento, documentos y conversaciones son tenant-specific.

Esta división es adecuada, pero requiere formalizar el contrato del cache global. Actualmente algunos servicios consultan contactos por `company_id` y otros por dominio normalizado; esta inconsistencia puede producir score de accesibilidad distinto de la lista real de contactos.

---

## 4. Fortalezas

### 4.1 Diseño de producto

- **Cuenta-céntrico:** la unidad de decisión comercial es la empresa, no la señal aislada.
- **Evidencia visible:** fuentes reales, niveles `explicit`/`inferred` y convergencia son una ventaja competitiva.
- **Score explicable:** los cuatro pilares y el snapshot de cálculo permiten auditoría.
- **Personalización por documentos:** vincula lo que vende el tenant con lo que se detecta en la cuenta.
- **Follow + digest:** transforma un análisis puntual en hábito recurrente.
- **Chat con tools:** reduce la necesidad de aprender filtros y pantallas complejas.
- **MCP:** abre un canal de integración para clientes avanzados.

### 4.2 Diseño técnico

- Cache global reutilizable entre tenants.
- Score numérico determinístico; la IA solo redacta el rationale.
- Dedupe de findings por hash.
- Persistencia del raw research para reestructurarlo sin repetir búsqueda.
- Selección dinámica de micro-agentes según perfil y documentos.
- Cuotas por plan y cooldown de refresh.
- RLS habilitado en casi todas las tablas tenant-specific.
- Separación de fuentes verificadas e inferencias.

---

## 5. Hallazgos prioritarios

## P0 — Resolver antes de escalar

### P0.1 Jobs no durables y un job estancado

**Evidencia**

- Hay 3 jobs: 2 completos y 1 `running` desde hace más de 10 días.
- `runResearchJob` cambia estados y ejecuta pasos secuenciales dentro del proceso de aplicación.
- No existen heartbeat, lease expiration, `attempt_count`, `next_retry_at`, timeout por etapa ni reconciliador.
- Un fallo después de persistir una parte puede dejar trabajo parcial y estado ambiguo.

**Impacto**

- El usuario ve un progreso que nunca termina.
- Consume cupo aunque el resultado no llegue.
- Los refresh mensuales pueden degradarse silenciosamente.
- Reintentar puede duplicar costos o trabajo.

**Recomendación**

Modelar cada etapa como unidad durable e idempotente:

```text
resolve_company
→ collect_evidence
→ classify_evidence
→ interpret_jobs
→ compute_score
→ publish_brief
→ notify
```

Cada etapa debe registrar:

- `status`, `attempt_count`, `started_at`, `heartbeat_at`, `finished_at`;
- `input_version` e `output_version`;
- `error_code`, `error_message`, `retryable`;
- clave idempotente `workspace/company/data_version/stage`;
- lease con expiración.

Usar Workflow SDK o un worker/cron con claiming atómico (`FOR UPDATE SKIP LOCKED`). Agregar watchdog que recupere `running` sin heartbeat.

### P0.2 Contrato inconsistente para contactos

**Evidencia**

- `services/contacts.ts` resuelve contactos por dominio de la empresa.
- `scoring.ts` mide accesibilidad en `apollo_contacts_cache` por `company_id`.
- `cache-reader.ts` también usa `company_id`.

**Impacto**

El score puede reportar baja accesibilidad mientras la pestaña de contactos sí encuentra decisores, o viceversa.

**Recomendación**

Definir una única estrategia:

1. resolver compañía → set de identidades (`company_id`, dominio primario, aliases, LinkedIn);
2. consultar contactos mediante una función/repositorio único;
3. opcionalmente backfillear `company_id` en el cache usando ese resolver;
4. usar exactamente el mismo conjunto para score, UI, MCP e icebreakers.

### P0.3 Historial de chat crece sin compactación

**Evidencia**

- El endpoint pasa `convertToModelMessages(messages)` con todo el historial recibido.
- Los tool outputs visuales se guardan completos.
- En cada respuesta se borra y reinserta todo `chat_messages`.
- El chat observado promedia 9.496 tokens de entrada para 320 de salida.

**Impacto**

- Costo y latencia crecen linealmente con la conversación.
- Reescribir todo el historial aumenta writes y ventana de inconsistencia.
- Tool results viejos dominan el contexto aunque ya no sean necesarios.

**Recomendación**

- Persistencia append-only por `message.id`.
- Ventana de contexto: últimos 6–10 mensajes + resumen de conversación.
- Guardar tool outputs completos para UI, pero enviar al modelo una representación compacta.
- Mantener `conversation_summary`, `active_entities`, `decisions` y `pending_actions`.
- Eliminar del contexto resultados reemplazados o ya materializados en DB.

**Objetivo inicial:** bajar input promedio del chat de ~9.500 a menos de 4.000 tokens sin pérdida de task success.

### P0.4 Revisión de policies `ALL` sin `WITH CHECK` explícito

RLS está habilitado en casi todas las tablas. Sin embargo, varias policies tenant usan `FOR ALL` con `USING` y `with_check` nulo. PostgreSQL puede derivar el check desde `USING`, pero para una plataforma multitenant conviene evitar semántica implícita y verificar cada operación con tests automatizados.

Además, `radar_micro_agents` no tiene RLS. Puede ser intencional como catálogo global, pero debe documentarse y limitar grants de escritura al service role/super-admin.

**Recomendación**

- policies separadas por `SELECT`, `INSERT`, `UPDATE`, `DELETE`;
- `WITH CHECK (workspace_id = user_workspace_id(auth.uid()))` explícito;
- tests de aislamiento entre dos tenants para cada tabla y RPC;
- nunca aceptar `workspaceId` del cliente como autoridad sin resolverlo desde sesión.

---

## P1 — Alto impacto en calidad, adopción y costo

### P1.1 La búsqueda web se repite por micro-agente

Actualmente cada micro-agente ejecuta una investigación premium independiente con hasta 5 web searches y luego una segunda llamada para estructurar. Los focos son útiles, pero comparten fuentes y contexto.

**Problema:** se paga varias veces por descubrir y leer las mismas páginas.

**Arquitectura recomendada: evidence harvesting compartido**

1. **Plan de búsqueda barato:** genera queries deduplicadas para la cuenta y los agentes seleccionados.
2. **Recolección única:** ejecuta búsquedas y guarda documentos/fuentes normalizadas.
3. **Extracción:** genera `evidence_items` pequeños: claim, quote/snippet, fecha, URL, tipo y entidades.
4. **Clasificación multi-label:** cada micro-agente clasifica el mismo corpus con un modelo barato.
5. **Escalamiento selectivo:** modelo premium solo para evidencia contradictoria, insuficiente o para síntesis ejecutiva.

Esto preserva especialización sin repetir navegación.

### P1.2 Opus como default para todo research

La calidad premium puede ser valiosa, pero usarla en todos los focos no es una política de routing. Conviene decidir por dificultad y riesgo.

**Routing propuesto**

| Tarea | Modelo/clase sugerida |
|---|---|
| query planning, clasificación, dedupe | modelo rápido/barato |
| extracción estructurada desde texto | modelo rápido con structured output |
| síntesis de cuenta con evidencia suficiente | modelo medio |
| conflicto entre fuentes / empresa ambigua / evidencia débil | modelo premium |
| rationale del score | plantilla determinística o modelo barato |
| chat de navegación y operaciones simples | modelo rápido |
| mensaje comercial final | modelo medio, solo bajo demanda |

No fijar esta política a IDs eternos: mantener un registry versionado por capacidad, costo y evaluación.

### P1.3 Estructuración demasiado verbosa por agente

Cada research libre se transforma en un objeto amplio; el estructurador promedia aproximadamente 2.700–2.900 tokens de salida. Es mucho para metadata que después se deduplica.

**Recomendación**

- separar `evidence_item` de `account_insight`;
- limitar cada evidence item a campos canónicos y snippets breves;
- usar IDs de diccionario, no repetir nombres extensos;
- agrupar fuentes a nivel claim;
- imponer límites: máximo de claims por categoría y solo evidencia relevante;
- usar structured output validado en vez de parseo libre donde aún aplique;
- no pedir resúmenes largos en cada micro-agente; sintetizar una vez al final.

### P1.4 Análisis documental envía texto y diccionarios completos

`analyzeDocumentV3` incluye:

- hasta 30.000 caracteres del documento;
- hasta 500 productos;
- hasta 500 procesos;
- taxonomía de industrias;
- una respuesta JSON grande;
- parseo manual con regex.

Además, este flujo no registra usage.

**Riesgos**

- costo fijo alto aunque el documento sea corto;
- truncado por los primeros 30.000 caracteres: puede perder conclusiones o anexos relevantes;
- listas gigantes distraen al modelo;
- errores de JSON se convierten silenciosamente en análisis vacío;
- al reprocesar se borran tags antes de asegurar que la nueva versión terminó bien.

**Recomendación**

Pipeline documental en dos etapas:

1. extraer/chunkear y resumir secciones relevantes;
2. recuperar top-K términos candidatos del diccionario por trigram/embeddings/keywords;
3. enviar al modelo solo candidatos relevantes;
4. usar structured output + validación;
5. persistir nueva versión y hacer swap atómico al completar;
6. registrar tokens, costo, latencia, hash del documento y versión del prompt.

### P1.5 Score correcto en enfoque, incompleto en calibración

El score determinístico es una fortaleza, pero hoy las ponderaciones son reglas globales:

- 35% fit;
- 35% buying signals;
- 15% accesibilidad;
- 15% timing.

**Riesgos observados**

- El fit usa substring entre nombres, no IDs/ontología exclusivamente.
- Sin perfil se asignan valores neutrales que pueden parecer precisión real.
- Se limita a 100 findings/señales sin una política explícita de muestreo temporal.
- Muchas señales similares pueden inflar buying signals.
- No existe calibración con outcomes comerciales.

**Recomendación**

- mostrar `confidence/completeness` separado del score;
- usar IDs canónicos y relaciones de diccionario;
- cap por categoría/familia para evitar volumen duplicado;
- definir ventanas temporales por señal;
- versionar fórmula (`score_version`);
- construir dataset de feedback: cuenta aceptada/descartada, contacto abierto, reunión, oportunidad;
- calibrar pesos cuando haya volumen suficiente, sin convertir el score en caja negra.

### P1.6 La UX muestra información, no una decisión consolidada

La vista de cuenta es rica y transparente, pero el usuario debe recorrer tabs para obtener la respuesta comercial.

**Recomendación: encabezado “Account Brief”**

Antes de los tabs, mostrar:

1. **Prioridad:** score + confianza/completitud + variación.
2. **Por qué ahora:** 1–3 triggers recientes con fuente.
3. **Qué encaja:** proceso/tecnología/dolor relacionado con la propuesta del workspace.
4. **A quién contactar:** 1–3 roles/contactos sugeridos.
5. **Próxima acción:** seguir, generar mensaje, compartir/exportar o descartar.

Los tabs quedan como evidencia y profundidad, no como mecanismo para descubrir la conclusión.

### P1.7 Falta feedback sobre la calidad del insight principal

Hay feedback en icebreakers, pero no en score, findings o recomendación de cuenta.

Agregar acciones de baja fricción:

- útil / no útil;
- incorrecto / desactualizado / irrelevante;
- “esta cuenta sí/no es fit”;
- “contacté / reunión / oportunidad”.

Guardar contexto: workspace, compañía, versión de score/prompt, finding y motivo. Esto habilita evaluación y mejora real, no solo optimización por costo.

---

## P2 — Mejoras de escalabilidad y mantenibilidad

### P2.1 Resolución de empresas con búsquedas poco escalables

El resolver usa `ILIKE '%dominio%'` y `ILIKE '%nombre%'`, con límites defensivos. A mayor volumen puede ser lento y ambiguo.

Recomendación:

- tabla de identidades/aliases de empresa;
- dominio normalizado como columna indexada;
- índice trigram sobre nombre normalizado;
- score de resolución y razones;
- no crear empresa global solo con nombre sin confirmación de dominio cuando la ambigüedad sea alta.

### P2.2 Distribución aleatoria de refresh

`refresh_day` se asigna con `Math.random()`. Distribuye aproximadamente, pero no controla capacidad ni backlog.

Recomendación:

- elegir el día con menor carga estimada;
- registrar `next_refresh_at` en vez de derivarlo;
- claim atómico y límites de concurrencia/costo;
- prioridades según valor, novedad esperada y antigüedad;
- jitter para evitar picos horarios.

### P2.3 N+1 en identidades de usuarios y emails

`getSubscriberEmails` y resolución de identidades hacen llamadas admin por usuario. Es aceptable con pocos seats, pero escala mal.

Recomendación: mantener un perfil mínimo sincronizado (`user_id`, email, nombre) o resolver por lotes en una función segura.

### P2.4 Polling frecuente

Documentos hacen polling cada 3 segundos; research también depende de polling de UI. Con volumen puede generar tráfico innecesario.

Recomendación:

- Supabase Realtime o SSE para estado de jobs;
- fallback con backoff exponencial;
- detener polling en tab oculta;
- enviar eventos por etapa y porcentaje real.

### P2.5 Código duplicado y contratos divergentes

Hay servicios recientes (`services/contacts.ts`) y un `cache-reader.ts` con tipos/campos alternativos. Esto aumenta riesgo de drift.

Recomendación:

- repositorios únicos: `CompanyRepository`, `ContactRepository`, `EvidenceRepository`;
- DTOs canónicos;
- eliminar/deprecar lectores duplicados tras migrar callers;
- contract tests contra schema real.

### P2.6 Registro de prompts sin evaluación

El panel de prompts y versiones es útil, pero editar prompts sin evaluación puede degradar calidad global.

Agregar:

- estado draft/published;
- suite de casos dorados;
- comparación A/B offline;
- métricas por `prompt_version`;
- rollback de un click;
- required placeholders validados al publicar.

---

## 6. Arquitectura objetivo propuesta

```text
                    ┌────────────────────────────┐
                    │ User / Chat / MCP / Cron   │
                    └──────────────┬─────────────┘
                                   │ command
                                   ▼
                    ┌────────────────────────────┐
                    │ Research Orchestrator      │
                    │ durable + idempotent       │
                    └──────────────┬─────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
┌──────────────────┐    ┌────────────────────┐   ┌──────────────────┐
│ Company identity │    │ Evidence collector │   │ Existing caches  │
│ aliases/domain   │    │ search/fetch once  │   │ jobs/signals/etc │
└──────────────────┘    └──────────┬─────────┘   └─────────┬────────┘
                                   │ normalized evidence    │
                                   ▼                        │
                       ┌────────────────────────┐            │
                       │ Global Evidence Store  │◄───────────┘
                       │ claim/source/date/hash │
                       └──────────┬─────────────┘
                                  │
                     ┌────────────┴─────────────┐
                     ▼                          ▼
          ┌────────────────────┐     ┌────────────────────┐
          │ Cheap classifiers  │     │ Premium escalation │
          │ taxonomy/relevance │     │ only if uncertain  │
          └─────────┬──────────┘     └─────────┬──────────┘
                    └────────────┬──────────────┘
                                 ▼
                    ┌────────────────────────────┐
                    │ Workspace interpretation   │
                    │ fit + score + why-now      │
                    └──────────────┬─────────────┘
                                   ▼
                    ┌────────────────────────────┐
                    │ Account Brief + actions    │
                    │ UI / digest / chat / MCP   │
                    └────────────────────────────┘
```

### 6.1 Entidades nuevas o evolucionadas

**Globales (`public`, compartidas):**

- `company_identities`: dominio, LinkedIn, alias, país, confianza.
- `evidence_sources`: URL canónica, título, fecha, fetch status, content hash.
- `evidence_items`: claim, excerpt, event date, entities, evidence level, dedupe hash.
- `evidence_classifications`: taxonomy IDs, classifier version, confidence.

**Tenant (`v3`):**

- `research_stage_runs`: etapa, lease, intento, output ref.
- `account_briefs`: resumen orientado a decisión, versión y vigencia.
- `insight_feedback`: útil/incorrecto/resultado comercial.
- `conversation_memory`: resumen y estado activo.
- `score_versions`: fórmula/config vigente.

No es necesario migrar todo al inicio. Se puede introducir `evidence_items` y stages detrás de los servicios actuales.

---

## 7. Estrategia de optimización de IA y tokens

### 7.1 Principios

1. **No enviar datos que el modelo no necesita.**
2. **Buscar una vez, clasificar muchas.**
3. **Persistir resultados intermedios reutilizables.**
4. **Modelos premium solo por incertidumbre o valor.**
5. **Separar evidencia, interpretación y redacción.**
6. **Medir calidad junto con costo.**

### 7.2 Budget por operación

Definir budgets configurables por plan/feature:

| Operación | Budget inicial recomendado |
|---|---:|
| turno de chat | 4k input / 800 output |
| planificación de research | 2k / 500 |
| extracción por fuente | 4k / 800 |
| clasificación de corpus | 8k / 2k |
| síntesis account brief | 8k / 1,2k |
| scoring rationale | 1,5k / 250 |
| icebreaker | 3k / 300 |
| documento por chunk | 6k / 1,2k |

Cuando se supere el budget: resumir, truncar por relevancia o dividir, nunca enviar silenciosamente contextos ilimitados.

### 7.3 Cache semántico y por versión

Clave sugerida:

```text
hash(company_identity + evidence_window + agent_config_version + prompt_version + model_policy_version)
```

Reutilizar:

- fuentes por compañía y ventana;
- extracción de una URL por content hash;
- clasificación por evidencia + taxonomy version;
- account brief por workspace value profile version;
- score por evidence version + profile version + score version.

### 7.4 Evaluación antes de cambiar modelos

Crear un set de 20–50 cuentas representativas con evaluación humana:

- factualidad y fuente correcta;
- relevancia para propuesta de valor;
- novedad;
- claridad del “por qué ahora”;
- siguiente acción útil;
- precisión de taxonomía;
- contacto/rol recomendado.

Comparar variantes por calidad, costo y latencia. No hacer downgrade de modelo solo por precio sin medir pérdida en adoption-driving quality.

### 7.5 Ahorro esperado

Con la muestra actual, Opus research es el target principal. Una estrategia de harvesting compartido + routing podría aspirar inicialmente a:

- **40–70% menos tokens premium**;
- **30–60% menos costo por cuenta**;
- menor latencia total al evitar búsquedas repetidas;
- mayor consistencia entre agentes al operar sobre el mismo corpus.

Estos rangos son hipótesis a validar con la suite de evaluación y una muestra mayor.

---

## 8. Mejoras de UX y adopción

### 8.1 Journey recomendado

```text
1. Subir documentos / confirmar propuesta de valor
2. Ver perfil inferido y corregirlo
3. Buscar o importar cuentas
4. Obtener account brief priorizado
5. Validar evidencia
6. Elegir contacto y acción
7. Seguir cuenta / recibir novedades
8. Registrar outcome para mejorar recomendaciones
```

### 8.2 Onboarding

Hoy “tener al menos un documento ready” equivale a onboarded. Eso valida una condición técnica, no que el perfil sea correcto.

Cambiar por checklist:

- documento procesado;
- propuesta de valor revisada;
- industrias objetivo confirmadas;
- tecnologías/procesos confirmados;
- buyer persona y cargos confirmados;
- primera cuenta investigada.

Mostrar qué aprendió ASCI y permitir editarlo antes de gastar research premium.

### 8.3 Documentos

La pantalla es completa, pero puede ser demasiado operativa para pocos documentos. Priorizar:

- “ASCI entendió esto de tu negocio” como bloque principal;
- conflictos entre documentos;
- términos no reconocidos/sugeridos;
- impacto del documento sobre perfil y recomendaciones;
- versionado visible al reprocesar;
- explicación de por qué un tag fue inferido.

### 8.4 Cuentas

La lista de seguidas debería priorizar decisión, no administración:

- ordenar por aumento de score, nuevos triggers y urgencia;
- mostrar “novedades desde tu última visita”;
- permitir filtros por prioridad, industria, dueño, novedad y estado comercial;
- incluir un estado de pipeline comercial liviano: revisar, contactar, trabajando, descartada;
- búsqueda server-side cuando crezca el número de cuentas.

### 8.5 Detalle de cuenta

Mantener los tabs actuales, pero precederlos con Account Brief. Agregar:

- timestamp y frescura de cada fuente;
- completitud del research;
- cobertura: cuántos agentes/fuentes se ejecutaron;
- motivo de selección de micro-agentes;
- acciones contextuales junto a cada insight;
- compartir/exportar brief;
- marcar insight como incorrecto o irrelevante.

### 8.6 Chat

El chat funciona bien como orquestador, pero no debe ser la única puerta de entrada.

Mejoras:

- starters según estado: “investigar cuentas”, “qué cambió”, “priorizar seguidas”;
- memoria compacta visible/editable;
- botón para cancelar/reintentar research;
- progreso por etapas con ETA cualitativa, no porcentaje artificial;
- resultados accesibles desde Cuentas aunque se cierre la conversación;
- en móvil, acceso a conversaciones mediante drawer (hoy el sidebar se oculta).

### 8.7 Confianza

Diferenciar siempre:

- hecho verificado;
- corroborado por múltiples fuentes;
- inferencia;
- dato histórico/posiblemente desactualizado;
- ausencia de evidencia.

Agregar “por qué ASCI lo considera relevante para vos”, ligado explícitamente al documento/perfil del workspace.

---

## 9. Procesamiento de datos y performance

### 9.1 Índices y consultas

La base v3 es aún pequeña. Las optimizaciones deben enfocarse en patrones futuros:

- índice parcial para `research_jobs(status, created_at)` en pending/running;
- índice para lease/heartbeat;
- `account_scorecards(workspace_id, company_id, created_at desc)`;
- `followed_accounts(workspace_id, is_active, next_refresh_at)`;
- `ai_usage_log(workspace_id, created_at, feature)`;
- `chat_messages(conversation_id, created_at/id)`;
- GIN donde se consulten arrays/JSONB, evitando usarlos como reemplazo de relaciones frecuentes;
- trigram/alias para resolución de compañías.

Validar con `EXPLAIN ANALYZE` cuando haya volumen representativo.

### 9.2 Idempotencia

Toda escritura derivada debería tener constraint o key idempotente:

- research stage por versión;
- finding por company/source/claim hash;
- scorecard por workspace/company/input version;
- digest por followed account/period;
- AI usage por provider request ID si existe;
- document analysis por document hash/version.

### 9.3 Consistencia al reprocesar documentos

No borrar tags activos antes de terminar el nuevo análisis. Usar:

1. crear `document_analysis_version` processing;
2. generar tags asociados a esa versión;
3. validar;
4. marcar versión activa en una transacción;
5. conservar versión anterior para rollback.

### 9.4 Cache global y privacidad

El cache global aporta eficiencia, pero debe distinguir:

- evidencia pública reutilizable;
- interpretación tenant-specific;
- información derivada de documentos privados, que nunca debe ir al cache global;
- datos licenciados con restricciones de redistribución.

Documentar lineage por cada insight y evitar que un prompt de un tenant termine persistido en outputs globales.

---

## 10. Observabilidad y operación

### 10.1 Métricas mínimas por llamada IA

Agregar:

- `latency_ms` y time-to-first-token;
- provider request ID;
- cache hit/miss;
- prompt version y model policy version;
- stage/job/batch;
- número de tool calls y búsquedas;
- fuentes recuperadas/usadas;
- resultado validado o parse error;
- retry count;
- input bytes antes/después de compactación;
- evaluación/feedback asociado.

### 10.2 Métricas de producto

- tiempo a primer insight útil;
- research completado / iniciado;
- cuenta seguida / investigada;
- cuenta abierta después del digest;
- generación de contacto/icebreaker;
- feedback positivo de insight;
- cuenta contactada;
- reunión/oportunidad atribuida;
- retención semanal por workspace.

### 10.3 SLOs iniciales

- 99% de jobs sin quedar estancados más de 15 minutos;
- 95% de retries automáticos sin intervención;
- preview cacheado <2 s;
- account brief disponible <15 min para research nuevo;
- chat simple TTFT <2,5 s;
- 100% de claims explícitos con fuente válida;
- 100% de costos IA asociados a feature/workspace/job.

### 10.4 Alertas

- job running sin heartbeat;
- tasa de failure por etapa/modelo;
- costo por cuenta fuera de budget;
- caída de findings por research;
- parse/validation failures;
- digest sin envío;
- incremento de términos sugeridos sin resolver;
- RLS test fallido.

---

## 11. Roadmap priorizado

## Quick wins — 1 a 2 semanas

| Acción | Impacto | Esfuerzo | Riesgo | Resultado esperado |
|---|---|---|---|---|
| Watchdog para jobs `running` estancados + retry/cancel manual | Muy alto | Bajo | Bajo | elimina estados infinitos |
| Añadir heartbeat, attempt count y error code al job | Muy alto | Medio | Bajo | diagnósticos y recuperación |
| Compactar contexto del chat y tool outputs | Alto | Medio | Medio | bajar input tokens >50% |
| Persistencia append-only de chat | Medio | Bajo | Bajo | menos writes y menor riesgo |
| Instrumentar IA documental, icebreakers y latencia | Alto | Bajo | Bajo | costo total visible |
| Unificar acceso a contactos | Muy alto | Medio | Bajo | score/UI consistentes |
| Account Brief encima de tabs | Muy alto | Medio | Bajo | mejor time-to-value |
| Feedback útil/no útil e incorrecto | Alto | Bajo | Bajo | dataset de calidad |
| Mostrar frescura/completitud/confianza | Alto | Bajo | Bajo | confianza del usuario |
| Revisión y tests RLS multitenant | Muy alto | Medio | Bajo | reduce riesgo de aislamiento |
| Limitar contexto documental y registrar parse errors | Medio | Bajo | Bajo | evita fallos silenciosos |

## Primeros 30 días

1. **Durabilidad básica del pipeline**
   - claiming atómico;
   - leases y heartbeat;
   - retries por etapa;
   - watchdog;
   - idempotency keys.

2. **Token budgets y telemetría completa**
   - budget por feature;
   - contexto compactado;
   - dashboards por workspace/modelo/feature;
   - alertas de costo.

3. **Account Brief v1**
   - why now;
   - fit con propuesta;
   - evidencia principal;
   - contacto/rol sugerido;
   - acción siguiente.

4. **Perfil del workspace editable**
   - revisar/corregir inferencias de documentos;
   - versionar perfil;
   - recalcular score sin repetir research global.

5. **Suite de evaluación**
   - 20–50 cuentas;
   - rúbricas de factualidad, relevancia y acción;
   - baseline de modelos/prompts actuales.

## Días 31–60

1. **Evidence store compartido**
   - normalizar fuentes y claims;
   - dedupe por content/claim hash;
   - separar evidencia de interpretación.

2. **Search once, classify many**
   - query planner;
   - harvesting compartido;
   - micro-agentes sobre corpus común;
   - clasificación barata multi-label.

3. **Model router**
   - policy por tarea y confidence;
   - escalamiento premium;
   - fallback y circuit breaker;
   - evaluación por versión.

4. **Pipeline documental v2**
   - chunking;
   - retrieval top-K del diccionario;
   - structured output;
   - versionado atómico.

5. **UX de cuentas priorizada**
   - ranking por novedad/urgencia;
   - estados comerciales;
   - novedades no vistas;
   - búsqueda/filtros server-side.

## Días 61–90

1. **Orquestación durable completa** con Workflow SDK o worker equivalente.
2. **Refresh inteligente** por `next_refresh_at`, valor y capacidad.
3. **Digest orientado a cambio**: solo novedades, comparación y acción sugerida.
4. **Outcome loop**: contacto, reunión, oportunidad, descarte y motivos.
5. **Calibración del score** con feedback y outcomes manteniendo explicabilidad.
6. **Hardening multitenant**: contract tests, RLS tests, lineage y auditoría.
7. **MCP production readiness**: rate limits, scopes, rotación de claves y observabilidad.

---

## 12. KPIs para validar el roadmap

### IA/costo

- costo medio y p95 por cuenta investigada;
- tokens premium por cuenta;
- ratio de cache hit;
- búsquedas web por fuente útil;
- costo por insight marcado útil;
- input/output ratio del chat.

### Calidad

- porcentaje de claims explícitos con fuente;
- links válidos;
- findings útiles por cuenta;
- tasa de correcciones del usuario;
- precisión de taxonomía;
- agreement humano del score/priority.

### Operación

- completion rate de jobs;
- tiempo por etapa;
- jobs stale;
- retries y recovery rate;
- duplicados evitados por idempotencia.

### Adopción

- tiempo hasta primera cuenta útil;
- research → follow;
- account brief → contacto/icebreaker;
- apertura de digest → visita de cuenta;
- cuentas contactadas por workspace;
- retención semanal/mensual.

---

## 13. Decisiones recomendadas

### Mantener

- enfoque cuenta-céntrico;
- cache global + interpretación tenant;
- score determinístico y explicable;
- evidencia visible;
- micro-agentes configurables;
- documentos para personalización;
- follow/digest;
- AI Gateway como capa unificada.

### Cambiar pronto

- ejecución background best-effort → jobs durables;
- búsquedas por micro-agente → harvesting compartido;
- Opus por defecto → routing por dificultad/confianza;
- historial completo de chat → memoria compacta;
- tags documentales con diccionario completo → retrieval top-K;
- detalle fragmentado → Account Brief orientado a acción;
- observabilidad de costo → observabilidad de costo + calidad + outcome.

### No hacer todavía

- entrenar un modelo propio;
- reemplazar el score por ML opaco;
- introducir embeddings en todos los flujos sin caso medido;
- migrar masivamente caches de v2;
- agregar más micro-agentes antes de reducir redundancia;
- optimizar índices prematuramente sin volumen/planes reales.

---

## 14. Riesgos y dependencias

- **Muestra pequeña:** validar hipótesis de ahorro con más cuentas.
- **Calidad vs. costo:** bajar de modelo sin eval puede degradar la propuesta central.
- **Cache compartido:** cambios en `public` deben seguir siendo aditivos y compatibles con v2.
- **Fuentes web:** disponibilidad, robots, fecha y licensing deben formar parte del lineage.
- **AI Gateway/provider:** implementar fallbacks y no acoplar lógica de negocio a un modelo.
- **Datos personales:** contactos, emails y prompts requieren minimización y controles de acceso.
- **Adopción:** más datos no implican más valor; el brief y la acción siguiente son prioritarios.

---

## 15. Conclusión

ASCI v3 tiene una base de producto diferenciada: combina evidencia verificable, personalización por propuesta de valor, seguimiento continuo y asistencia conversacional. La mayor oportunidad no es agregar más agentes o más datos, sino **hacer que la misma evidencia se recolecte una vez, se interprete de forma eficiente y termine en una decisión comercial clara**.

La secuencia recomendada es:

1. confiabilidad y observabilidad;
2. compactación de chat y budgets;
3. Account Brief y feedback;
4. evidence store compartido;
5. routing de modelos y pipeline durable;
6. calibración con outcomes.

Con ese orden, v3 puede reducir costo y latencia sin sacrificar calidad, mientras mejora la métrica más importante: cuántos insights terminan en una acción comercial útil.
