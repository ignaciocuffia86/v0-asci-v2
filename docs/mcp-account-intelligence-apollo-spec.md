# Especificación técnica: MCP de inteligencia de cuentas y enrichment con Apollo

**Estado:** Diseño funcional y técnico aprobado para planificación  
**Fecha:** 2026-07-22  
**Alcance:** ASCI v3 MCP, gestión de cuentas, investigación client-assisted, contactos y Apollo  
**No implica implementación.** Este documento describe el comportamiento esperado, contratos conceptuales, reglas de seguridad y dependencias que deberá respetar un futuro plan de implementación.

---

## 1. Objetivo

Diseñar un flujo MCP completo en el que Claude pueda:

1. Consultar cualquier empresa del catálogo global de ASCI.
2. Recomendar proactivamente cuentas según el fit entre la propuesta de valor del workspace y la evidencia global de las empresas.
3. Permitir que el usuario guarde cuentas en su workspace, respetando el límite del plan.
4. Investigar cuentas guardadas con los tokens y capacidades de Claude.
5. Publicar inmediatamente los hallazgos válidos como inteligencia global de la empresa.
6. Inferir cargos decisores a partir de señales concretas.
7. Consultar contactos ya conocidos antes de consumir Apollo.
8. Recomendar enrichment únicamente cuando exista cobertura insuficiente o información obsoleta.
9. Buscar y enriquecer hasta diez contactos mediante Apollo, con confirmación explícita.
10. Entregar emails inmediatamente y resolver teléfonos de forma asincrónica, notificando al usuario dentro de ASCI.

Apollo es un proveedor interno financiado por ASCI. El usuario no administra credenciales ni créditos Apollo, pero el sistema debe controlar costos, cuota, idempotencia y abuso.

---

## 2. Principios de diseño

### 2.1 Buscar no equivale a guardar

- `search_companies` consulta el catálogo global.
- Consultar perfil, señales o cobertura no consume cupo de cuentas.
- Ninguna búsqueda global agrega automáticamente la empresa al workspace.

### 2.2 Trabajar una cuenta requiere guardarla

Las operaciones que generan costo, persistencia privada o seguimiento requieren que la empresa exista como cuenta activa del workspace:

- Investigación client-assisted.
- Tech Radar solicitado por el usuario.
- Investigación de noticias.
- Recomendación operativa de cargos.
- Búsqueda y enrichment mediante Apollo.
- Seguimiento y notificaciones de contactos.

Guardar una cuenta consume un cupo del plan. Eliminarla libera el cupo inmediatamente.

### 2.3 Primero evidencia; después personas

Apollo no debe funcionar como búsqueda indiscriminada. El orden esperado es:

```text
propuesta de valor
→ cuenta candidata o buscada
→ cuenta guardada
→ inteligencia existente
→ investigación opcional
→ señales y evidencia
→ roles justificados
→ cobertura de contactos existentes
→ preparación y confirmación
→ Apollo
```

El usuario puede agregar cargos manuales sin evidencia. Deben distinguirse de los recomendados por ASCI y no deben presentarse como derivados de señales.

### 2.4 Cache antes que proveedor

Antes de llamar Apollo se debe consultar la información existente y su frescura. Un contacto o dato de contacto se considera obsoleto a los 90 días.

La vigencia debe evaluarse por dimensión:

- `person_last_verified_at`: la persona sigue en la empresa y cargo.
- `email_last_verified_at`: vigencia del email.
- `phone_last_verified_at`: vigencia del teléfono.

Actualizar una dimensión no renueva automáticamente las demás.

### 2.5 Claude aporta tokens; ASCI aporta control y persistencia

Para investigación client-assisted:

- Claude investiga e interpreta usando sus propios tokens.
- ASCI no llama AI Gateway.
- ASCI entrega contexto, gaps, diccionarios y schemas.
- ASCI valida identidad, fuente, evidencia, fechas y duplicados.
- ASCI persiste los hallazgos válidos.

### 2.6 La inteligencia de empresa es global

Los hallazgos válidos enviados por Claude se vinculan al `company_id` canónico y pasan a formar parte de la inteligencia compartida de la empresa para todo ASCI.

No se muestra públicamente el autor. Sí debe conservarse auditoría interna para seguridad y corrección:

- `workspace_id`
- `user_id`
- `source = claude_mcp`
- `mcp_execution_id`
- fecha de recepción
- URL y hash de fuente
- payload original o hash verificable
- resultado de validación

Esta metadata no forma parte de la experiencia pública de la cuenta.

---

## 3. Contexto técnico existente

### 3.1 Capacidades MCP actuales relevantes

El servidor MCP v3 ya expone capacidades de:

- Búsqueda y perfil global de empresas.
- Señales y resumen consolidado.
- Listado de cuentas del workspace.
- Inteligencia privada materializada.
- Research server-managed.
- Research client-assisted.
- Documentos y perfil de propuesta de valor.
- Recomendación de cuentas por propuesta de valor.

Actualmente no expone un flujo MCP canónico para contactos ni Apollo.

### 3.2 Componentes Apollo reutilizables

La base actual incluye:

- Cliente HTTP con retries, backoff y logging: `lib/apollo/client.ts`.
- Resolución/enrichment de organizaciones.
- Búsqueda de personas por organización, títulos, seniority, departamento y país.
- Enrichment de email y datos básicos.
- Normalización de personas.
- Hash de consulta.
- Caché de contactos.
- Auditoría en `apollo_api_calls`.
- Webhook histórico para teléfonos.

### 3.3 Restricciones y deuda existente

Las funciones legacy no deben registrarse directamente como tools MCP porque:

- Algunas dependen de sesión web/cookies, no del principal OAuth/API key del MCP.
- Algunas están acopladas a bookmarks o campaign accounts.
- Mezclan recomendación, búsqueda, persistencia y consumo en una sola operación.
- Existen variantes de acceso a caché y relaciones por dominio o `company_id`.
- La vigencia actual no aplica uniformemente la regla de 90 días.
- El flujo de teléfono fue deshabilitado en `lib/apollo/enrich.ts` porque el webhook no llegaba de forma confiable y podía dejar estados pendientes consumiendo créditos.
- El webhook histórico todavía contiene lógica útil, pero no constituye garantía de que el contrato actual de Apollo funcione.

La implementación futura debe extraer servicios server-only desacoplados de Server Actions y recibir explícitamente el principal MCP.

---

## 4. Dominio y estados

## 4.1 Empresa global

Entidad canónica de `public.companies`. Se consulta globalmente y concentra:

- Identidad y aliases.
- Noticias.
- Tech Radar.
- Implementaciones.
- Señales de procesos.
- Vacantes.
- Inteligencia aportada por investigaciones.

## 4.2 Cuenta del workspace

Asociación entre un workspace y una empresa global. Estados mínimos:

- `active`: consume cupo y habilita trabajo.
- `archived`: no habilita Apollo; definir si consume cupo según reglas actuales del plan.
- `deleted`: asociación eliminada y cupo liberado.

Eliminar una cuenta no elimina información global, contactos cacheados ni evidencia de la empresa.

## 4.3 Hallazgo de investigación

Tipos iniciales:

- `news`
- `technology`
- `technology_implementation`
- `technology_replacement`
- `process_signal`
- `hiring_signal`
- `business_event`

Estados internos:

- `published`
- `rejected`
- `conflicting`
- `superseded`
- `removed`

La publicación válida es inmediata. Los estados internos permiten trazabilidad y correcciones posteriores.

## 4.4 Contacto

Debe poder diferenciar:

- Identidad global de persona/proveedor.
- Relación actual o histórica con una empresa.
- Resultado de búsqueda Apollo.
- Datos enriquecidos.
- Asociación privada del workspace con la cuenta.

No debe sobrescribirse una relación laboral histórica si Apollo detecta un nuevo empleador.

## 4.5 Ejecución de enrichment

Estados recomendados:

- `prepared`
- `awaiting_confirmation`
- `searching`
- `email_enriching`
- `partially_completed`
- `phone_processing`
- `completed`
- `completed_without_phone`
- `failed`
- `expired`
- `cancelled`

---

## 5. Flujo funcional completo

## 5.1 Entrada A: recomendación proactiva

1. ASCI consolida el perfil documental del workspace.
2. Prefiltra empresas por países, industrias, tecnologías y procesos.
3. Combina señales, implementaciones y vacantes.
4. Devuelve hasta 20 cuentas con evidencia.
5. Claude interpreta el fit y recomienda cuentas.
6. El usuario decide si quiere guardar alguna.
7. Solo después de guardarla se habilitan investigación operativa y Apollo.

La recomendación no guarda cuentas ni consume cupo por sí sola.

## 5.2 Entrada B: búsqueda manual

1. El usuario busca por nombre o dominio.
2. ASCI resuelve empresa canónica y aliases.
3. Claude puede mostrar perfil global e inteligencia existente.
4. Si el usuario quiere trabajarla, Claude debe ofrecer guardarla.
5. Antes de guardar se consulta disponibilidad de cupo.
6. Claude explica que guardarla consume un cupo.
7. Se exige confirmación explícita.
8. La cuenta se agrega a `/v3/accounts`.

## 5.3 Investigación client-assisted

Solo para cuentas guardadas:

1. Claude consulta inteligencia existente.
2. ASCI identifica gaps de Tech Radar, noticias, implementaciones y eventos.
3. Se crea una ejecución client-assisted con package inmutable y hash.
4. Claude investiga con sus tokens.
5. Claude envía resultados estructurados con fuente, fecha, cita y relación con la empresa.
6. ASCI valida cada hallazgo.
7. Los hallazgos válidos se publican inmediatamente en el perfil global.
8. Los inválidos se rechazan y se notifica al usuario.
9. Se recalculan señales, actualidad tecnológica, fit y roles sugeridos.

## 5.4 Recomendación de roles

ASCI deriva roles de:

- Propuesta de valor del workspace.
- Tecnologías detectadas.
- Procesos.
- Implementaciones.
- Vacantes.
- Noticias y eventos.
- Área propietaria del problema.

Cada rol recomendado debe incluir evidencia trazable. El usuario puede editar la lista y agregar cargos manuales.

Límites:

- Máximo 10 cargos combinados por ejecución.
- Normalización case-insensitive.
- Dedupe de aliases evidentes.
- No truncar silenciosamente; pedir priorización.

## 5.5 Cobertura de contactos

Antes de recomendar Apollo:

1. Leer contactos de caché global y asociaciones del workspace.
2. Filtrar por empresa actual, cargos y seniority.
3. Evaluar frescura de persona, email y teléfono con TTL de 90 días.
4. Calcular cobertura por cargo.
5. Identificar cargos sin contactos frescos.
6. Identificar contactos relevantes con email/teléfono faltante u obsoleto.

## 5.6 Preparación de Apollo

La preparación debe:

- Verificar que la cuenta esté guardada y activa.
- Verificar scopes y feature del plan.
- Verificar hasta 10 cargos.
- Separar cargos `signal_derived` y `user_input`.
- Validar que los IDs de evidencia pertenecen a la empresa.
- Consultar cobertura existente.
- Evitar una ejecución equivalente dentro de 90 días salvo refresh explícito permitido.
- Resolver dominio y `apollo_organization_id`.
- Estimar costo interno y reservar presupuesto ASCI.
- Generar un token/ejecución inmutable con expiración.

La respuesta debe explicar por qué se recomienda o no el enrichment.

## 5.7 Confirmación y ejecución

Claude debe mostrar:

- Cuenta.
- Señales que justifican la búsqueda.
- Cargos recomendados.
- Cargos manuales.
- Cobertura existente.
- Cantidad máxima de contactos.
- Que ASCI cubre el enrichment.
- Que emails pueden llegar primero.
- Que teléfonos pueden procesarse en segundo plano.

Solo después de confirmación explícita se ejecuta Apollo.

## 5.8 Resultado asincrónico

La ejecución devuelve hasta 10 contactos.

Respuesta inicial posible:

```json
{
  "status": "partially_completed",
  "contacts": [
    {
      "contact_id": "uuid",
      "full_name": "Ana Pérez",
      "title": "VP Revenue Operations",
      "email": "ana@example.com",
      "email_status": "verified",
      "phone": null,
      "phone_status": "processing",
      "freshness": {
        "person": "fresh",
        "email": "fresh",
        "phone": "pending"
      }
    }
  ],
  "pending_phone_count": 1,
  "enrichment_request_id": "uuid",
  "notification_scheduled": true
}
```

Claude comunica que ASCI notificará al usuario cuando finalicen los teléfonos.

---

## 6. Tools MCP propuestas

Los nombres son contratos conceptuales y pueden ajustarse durante implementación, pero no debe alterarse la separación de responsabilidades.

## 6.1 `search_companies`

**Modo:** read  
**Cuenta guardada requerida:** no  
**Proveedor externo:** no

Busca empresas globales por nombre o dominio. No guarda ni ejecuta IA.

## 6.2 `get_company_profile`

**Modo:** read  
**Cuenta guardada requerida:** no

Devuelve identidad canónica, aliases y cobertura de información global.

## 6.3 `get_company_signal_summary`

**Modo:** read  
**Cuenta guardada requerida:** no

Consolida noticias, señales, tecnologías, procesos, implementaciones y vacantes con evidencia.

## 6.4 `prepare_save_account`

**Modo:** write preparation  
**Confirmación:** requerida

Entrada conceptual:

```json
{ "company_id": "uuid" }
```

Salida:

```json
{
  "status": "ready",
  "company_id": "uuid",
  "already_saved": false,
  "account_limit": { "used": 42, "total": 50, "remaining": 8 },
  "confirmation_token": "opaque",
  "expires_at": "ISO-8601"
}
```

Errores:

- `COMPANY_NOT_FOUND`
- `ACCOUNT_ALREADY_SAVED`
- `ACCOUNT_LIMIT_REACHED`
- `MEMBERSHIP_INACTIVE`

## 6.5 `save_account`

**Modo:** write  
**Confirmación:** explícita  
**Idempotencia:** obligatoria

Solo acepta el token generado por `prepare_save_account`. Agrega la empresa al workspace y consume cupo.

## 6.6 `remove_workspace_account`

**Modo:** destructive write  
**Confirmación:** explícita

Elimina o desactiva la asociación del workspace y libera cupo. Debe advertir asociaciones con campañas/seguimiento. No elimina datos globales.

## 6.7 `prepare_account_research`

**Modo:** client-assisted  
**Cuenta guardada requerida:** sí

Entrega inteligencia existente, gaps, instrucciones, schema, ventana temporal y hash de package.

Tipos solicitables:

- `technologies`
- `implementations`
- `news`
- `hiring`
- `business_events`

## 6.8 `submit_account_research`

**Modo:** client-assisted submit  
**Cuenta guardada requerida:** sí

Publica inmediatamente los hallazgos válidos y devuelve aceptación por ítem:

```json
{
  "published": { "news": 3, "technologies": 2, "implementations": 1 },
  "deduplicated": 2,
  "rejected": [
    {
      "client_item_id": "finding-4",
      "reason": "company_identity_mismatch",
      "message": "La fuente corresponde a otra empresa homónima."
    }
  ],
  "account_profile_updated": true
}
```

## 6.9 `recommend_contact_roles`

**Modo:** client-assisted/read  
**Cuenta guardada requerida:** sí

Devuelve hasta 10 cargos sugeridos, cada uno con:

- Nombre normalizado.
- Aliases opcionales.
- Área.
- Seniority sugerido.
- Evidencias.
- Confianza.
- Origen `signal_derived`.

El usuario puede agregar cargos con origen `user_input`.

## 6.10 `get_company_contacts`

**Modo:** read  
**Cuenta guardada requerida:** sí  
**Proveedor externo:** nunca

Lee contactos existentes y cobertura. No llama Apollo.

Salida mínima:

```json
{
  "contacts": [],
  "coverage": {
    "requested_roles": 4,
    "covered_roles": 1,
    "missing_roles": ["CRM Manager"],
    "fresh_relevant_contacts": 1,
    "stale_relevant_contacts": 2
  },
  "enrichment": {
    "recommended": true,
    "readiness_score": 72,
    "reasons": ["role_not_covered", "contacts_stale"]
  }
}
```

## 6.11 `prepare_contact_enrichment`

**Modo:** write preparation  
**Cuenta guardada requerida:** sí  
**Confirmación:** requerida

Entrada conceptual:

```json
{
  "company_id": "uuid",
  "roles": [
    {
      "title": "Head of Revenue Operations",
      "origin": "signal_derived",
      "evidence_ids": ["uuid"]
    },
    {
      "title": "Chief Transformation Officer",
      "origin": "user_input",
      "evidence_ids": []
    }
  ],
  "seniorities": ["head", "director", "vp"],
  "max_contacts": 10,
  "idempotency_key": "string"
}
```

Reglas:

- Entre 1 y 10 cargos.
- `max_contacts` entre 1 y 10.
- Cargos manuales permitidos.
- Evidencia obligatoria solo para cargos derivados.
- No ejecutar Apollo.

## 6.12 `run_contact_enrichment`

**Modo:** provider write  
**Cuenta guardada requerida:** sí  
**Confirmación:** explícita  
**Proveedor externo:** Apollo

Acepta únicamente una preparación válida e inmutable. Ejecuta:

1. Relectura de caché.
2. Búsqueda de faltantes.
3. Persistencia de resultados de search.
4. Enrichment selectivo de email.
5. Solicitud de teléfono cuando el contrato de Apollo esté validado.
6. Creación de estado asincrónico y notificación programada.

## 6.13 `get_contact_enrichment_status`

**Modo:** read  
**Cuenta guardada requerida:** sí

Devuelve estado, contactos actualizados, teléfonos pendientes, errores y próxima recomendación de polling.

## 6.14 `get_contact_profile`

**Modo:** read  
**Proveedor externo:** nunca

Devuelve el estado canónico ya persistido de un contacto. No ejecuta enrichment implícito.

---

## 7. Readiness de enrichment

ASCI calcula el score; Claude no debe inventarlo.

Ponderación inicial sugerida:

| Condición | Puntos |
|---|---:|
| Señal tecnológica/proceso alineada | +30 |
| Implementación confirmada alineada | +25 |
| Vacante relevante reciente | +15 |
| Fit alto con propuesta de valor | +20 |
| Área responsable identificable | +15 |
| Contactos relevantes y frescos existentes | -30 |
| Enrichment equivalente menor a 90 días | -40 |
| Solo señales indirectas | -15 |

Interpretación:

- `>= 60`: recomendación fuerte.
- `40–59`: recomendación moderada con incertidumbre.
- `< 40`: no recomendar espontáneamente.

El usuario puede solicitar enrichment explícitamente con score bajo si la cuenta está guardada. Claude debe explicar que la evidencia es débil y solicitar confirmación.

---

## 8. Validación de investigación global

Cada hallazgo debe incluir:

- `company_id`
- tipo
- título o afirmación
- fecha del evento
- URL HTTPS
- cita literal
- campos estructurados según tipo
- confianza propuesta por Claude

### 8.1 Validación de identidad

ASCI debe comparar:

- Dominio de la fuente.
- Nombre legal y aliases.
- Dominios conocidos.
- Ubicación.
- Contexto de la cita.
- Identificadores externos cuando existan.

Si se detecta empresa homónima incorrecta:

- Rechazo automático.
- No publicación.
- No recálculo de señales.
- Registro interno.
- Notificación al usuario.

### 8.2 Validación de fuente

- Solo HTTPS.
- URL resoluble.
- Fecha no futura.
- La cita debe aparecer en el contenido o snapshot validado.
- Dedupe por URL, hash, empresa, tipo y evento.
- Clasificación interna de confiabilidad.

### 8.3 Contradicciones

Los hallazgos contradictorios no deben sobrescribirse silenciosamente. Se conserva secuencia temporal y fuente.

### 8.4 Tecnología reemplazada

Si existe confirmación confiable de reemplazo:

1. Crear una noticia/evento `technology_replacement`.
2. Vincular tecnología anterior y nueva.
3. Marcar implementación anterior como histórica/reemplazada, no eliminarla.
4. Registrar fecha efectiva y fuente.
5. Actualizar Tech Radar actual.

Ejemplo:

```text
SAP ECC (historical)
→ replaced_by
SAP S/4HANA (current)
→ source + event_date
```

---

## 9. Persistencia conceptual

Los nombres finales deben ajustarse al schema existente durante planificación.

### 9.1 Ejecuciones de investigación

Campos mínimos:

- `id`
- `workspace_id`
- `user_id`
- `company_id`
- `mode`
- `package_hash`
- `status`
- `requested_types`
- `created_at`
- `completed_at`

### 9.2 Evidencia global

Una entidad o conjunto normalizado debe permitir:

- `company_id`
- `finding_type`
- `event_date`
- `title`
- `summary`
- `source_url`
- `source_hash`
- `quote`
- `confidence`
- `status`
- `raw_payload`
- auditoría interna

### 9.3 Preparaciones de enrichment

- `id`
- `workspace_id`
- `user_id`
- `company_id`
- roles normalizados
- IDs de evidencia
- cobertura snapshot
- readiness score
- query hash
- costo estimado
- estado
- expiración
- confirmación

### 9.4 Ejecuciones Apollo

- `id`
- preparación vinculada
- query hash
- idempotency key
- estado
- contactos solicitados/encontrados/enriquecidos
- emails disponibles
- teléfonos pendientes/disponibles
- costo estimado/real
- timestamps
- error normalizado

### 9.5 Notificaciones

Se requiere una entidad persistente de notificación v3 si no existe una adecuada. Debe contener:

- workspace y usuario destinatario
- tipo
- company y enrichment request
- título y mensaje
- estado leído/no leído
- deep link a `/v3/accounts/{companyId}`
- fecha

---

## 10. Caché e idempotencia

### 10.1 TTL

TTL funcional: 90 días para decidir si reutilizar o refrescar datos de contacto.

No implica borrar datos al vencer; se marcan como obsoletos.

### 10.2 Query hash

Debe incluir al menos:

```text
apollo_organization_id
+ normalized roles sorted
+ seniorities sorted
+ departments sorted
+ location mode/value
+ include similar titles
```

### 10.3 Idempotency key

La ejecución debe ser idempotente por:

```text
workspace
+ company
+ query_hash
+ freshness_window
```

Repetir una confirmación o timeout del cliente no puede duplicar búsquedas, consumo ni contactos.

### 10.4 Caché global vs acceso privado

- Los datos de empresa y persona obtenidos legalmente pueden deduplicarse globalmente.
- La asociación del workspace con una cuenta/contacto sigue siendo privada.
- La respuesta MCP debe validar siempre que la cuenta esté guardada antes de devolver contactos operativos o permitir Apollo.
- Ningún workspace debe recibir metadata de auditoría o acciones de otro workspace.

---

## 11. Apollo: búsqueda, email y teléfono

### 11.1 Búsqueda

Usar organización resuelta con prioridad:

1. `apollo_organization_id`.
2. Dominio canónico.
3. Fallbacks controlados de dominio.

Buscar únicamente faltantes y hasta el límite confirmado.

### 11.2 Email

El enrichment debe revelar y persistir email inmediatamente cuando Apollo lo entregue. Debe conservar:

- valor
- status
- fuente
- fecha de verificación

### 11.3 Teléfono asincrónico

Este requisito necesita una fase de validación técnica previa porque el código actual deshabilitó phone reveal por falta de entrega confiable del webhook.

La implementación no debe asumir que el webhook histórico funciona. Debe:

1. Confirmar el contrato vigente de Apollo para `reveal_phone_number`.
2. Verificar si flags y `webhook_url` van en query params o body.
3. Probar respuesta sincrónica.
4. Probar callback asincrónico real en staging.
5. Confirmar autenticación/firma admitida por Apollo.
6. Verificar retry y payloads observados.
7. Medir casos sin teléfono y timeout.
8. Recién entonces reactivar el flujo.

Estados por contacto:

- `not_requested`
- `processing`
- `available`
- `not_available`
- `failed`
- `expired`

### 11.4 Polling

Claude usa `get_contact_enrichment_status`. La tool debe devolver `check_after_seconds` y evitar polling agresivo.

### 11.5 Notificación de plataforma

Al finalizar el teléfono:

- Actualizar contacto y ejecución.
- Crear notificación dentro de ASCI.
- Indicar disponibilidad total, parcial o ausencia de teléfonos.
- Vincular al perfil de cuenta.

Si el callback nunca llega, un reconciliador debe cerrar el estado como `completed_without_phone` o `failed`, no dejarlo pendiente eternamente.

---

## 12. Autorización y scopes MCP

Scopes conceptuales:

- `companies:read`
- `signals:read`
- `accounts:read`
- `accounts:write`
- `research:prepare`
- `research:submit`
- `contacts:read`
- `contacts:enrich`
- `notifications:read` si luego se expone

Reglas:

- Principal MCP siempre ligado a `workspace_id` y `user_id` activos.
- Búsqueda/perfil global: read.
- Guardar/eliminar cuenta: scope de escritura y confirmación.
- Research: cuenta guardada.
- Contactos: cuenta guardada.
- Apollo: cuenta guardada, scope específico y preparación confirmada.
- No reutilizar Server Actions que dependan de cookies.

---

## 13. Cuotas y costos

Apollo es financiado por ASCI, pero requiere controles internos:

- Feature habilitada por plan.
- Presupuesto mensual por workspace/plan.
- Rate limits por workspace y usuario.
- Máximo 10 contactos por ejecución.
- Máximo 10 cargos.
- Reserva antes de ejecutar.
- Reconciliación de costo real.
- Sin doble cargo por callback telefónico.
- Reutilización de caché válida.
- Protección contra rotación abusiva de cuentas y ejecuciones repetidas.

La experiencia puede decir “incluido en tu plan”. El costo Apollo no tiene que exponerse, pero sí registrarse internamente.

---

## 14. Errores normalizados

Errores funcionales mínimos:

- `COMPANY_NOT_FOUND`
- `COMPANY_RESOLUTION_REQUIRED`
- `COMPANY_IDENTITY_MISMATCH`
- `ACCOUNT_NOT_SAVED`
- `ACCOUNT_ALREADY_SAVED`
- `ACCOUNT_LIMIT_REACHED`
- `ACCOUNT_INACTIVE`
- `ACCOUNT_ASSOCIATION_CONFLICT`
- `RESEARCH_VALIDATION_FAILED`
- `SOURCE_UNREACHABLE`
- `SOURCE_DUPLICATED`
- `ROLE_LIMIT_EXCEEDED`
- `CONTACT_LIMIT_EXCEEDED`
- `NO_ENRICHMENT_NEEDED`
- `ENRICHMENT_RECENTLY_COMPLETED`
- `ENRICHMENT_CONFIRMATION_REQUIRED`
- `ENRICHMENT_PREPARATION_EXPIRED`
- `APOLLO_ORGANIZATION_NOT_FOUND`
- `APOLLO_RATE_LIMITED`
- `APOLLO_SEARCH_FAILED`
- `APOLLO_EMAIL_ENRICHMENT_FAILED`
- `APOLLO_PHONE_PROCESSING`
- `APOLLO_PHONE_NOT_AVAILABLE`
- `PLAN_PROVIDER_BUDGET_EXCEEDED`
- `MEMBERSHIP_INACTIVE`
- `INSUFFICIENT_SCOPE`

Las respuestas deben indicar una próxima acción accionable para Claude.

---

## 15. Edge cases

### Cuenta

- Empresa homónima: pedir resolución si la búsqueda es ambigua.
- Sin dominio ni Apollo org ID: bloquear Apollo con mensaje accionable.
- Cuenta guardada en varias campañas: eliminarla debe advertir dependencias.
- Cuenta eliminada mientras Apollo procesa: finalizar caché global, pero no crear asociación privada nueva; decidir destino de la notificación.
- Dos usuarios guardan la misma cuenta: asociación idempotente por workspace.

### Investigación

- Fuente de otra empresa: rechazo automático y notificación.
- Fuente inaccesible: rechazo o retry según error.
- Hallazgo duplicado: devolver `deduplicated`.
- Tecnología reemplazada: evento temporal, no borrado.
- Información contradictoria sin reemplazo confirmado: coexistir como conflicto.
- Investigación concurrente: dedupe por fuente/evento.

### Roles

- Más de 10: pedir priorización.
- Alias duplicados: consolidar.
- Solo caracteres especiales: rechazar.
- Cargo manual sin señal: permitir y etiquetar.
- Cargo recomendado con evidencia inválida: rechazar preparación.

### Contactos

- Persona cambió de empresa: no mostrarla como actual sin verificación.
- Email fresco y teléfono vencido: refrescar solo teléfono si Apollo lo permite.
- Resultado search sin email: enriquecer selectivamente.
- Apollo devuelve más de 10: persistir/retornar solo según contrato definido; no superar alcance confirmado.
- Cero resultados: cachear miss con TTL para evitar loops.
- Webhook duplicado: idempotente.
- Webhook sin identificador: registrar e ignorar.
- Teléfono inline: persistir sin esperar webhook.
- Teléfono nunca llega: cerrar por timeout y notificar resultado parcial.

---

## 16. Observabilidad y auditoría

Cada tool mutante debe registrar:

- request ID
- principal MCP
- workspace
- company
- tool
- modo
- idempotency key
- duración
- estado
- error normalizado
- unidades/costo interno

Cada llamada Apollo debe registrar:

- endpoint lógico y path real
- query hash
- request sanitizado
- status
- retries
- latencia
- cantidad de resultados
- email/phone solicitado
- costo estimado/real
- respuesta sanitizada o diagnóstico

No registrar API keys, tokens de confirmación ni datos sensibles sin protección.

Métricas recomendadas:

- Search → save conversion.
- Research acceptance/rejection/dedupe.
- Enrichment readiness distribution.
- Cache hit rate.
- Apollo calls por contacto útil.
- Email success rate.
- Phone inline/webhook/no-result rate.
- Tiempo hasta teléfono.
- Estados pendientes vencidos.
- Costos por workspace/plan.

---

## 17. Seguridad y privacidad

- Mantener separación entre inteligencia global y asociaciones privadas.
- Aplicar RLS y filtros server-side por workspace.
- No confiar solo en descripciones de tools; validar todas las precondiciones en backend.
- Tokens de preparación opacos, de corta duración y uso único.
- Confirmación explícita para guardar, eliminar y ejecutar Apollo.
- Validar URLs y evitar SSRF en investigación.
- Sanitizar payloads y respuestas Apollo en logs.
- Auditar quién aportó evidencia aunque no se muestre como autor.
- Permitir remoción administrativa de información global inválida.

---

## 18. Estrategia de implementación futura

El plan técnico posterior debería dividirse en fases dependientes:

### Fase A: dominio y contratos

- Auditar schema real de cuentas, contactos, señales y notificaciones.
- Definir modelos canónicos y migrations v3 aisladas.
- Extraer servicios de cuentas/contactos sin cookies.
- Formalizar schemas Zod y errores MCP.

### Fase B: lifecycle de cuentas

- `prepare_save_account` / `save_account`.
- Verificación de cupos.
- Eliminación y liberación de cupo.
- Precondición reutilizable `requireSavedAccount`.

### Fase C: investigación global client-assisted

- Package de investigación por gaps.
- Validación de identidad/fuentes.
- Publicación global inmediata.
- Eventos de reemplazo tecnológico.
- Notificación de rechazos.

### Fase D: roles y cobertura

- Motor de roles con evidencia.
- Cargos manuales.
- Vista canónica de contactos.
- TTL por campo de 90 días.
- Readiness score.

### Fase E: Apollo sin teléfono

- Preparación/confirmación/idempotencia.
- Búsqueda de hasta 10 contactos.
- Enrichment de email.
- Caché y auditoría.
- Status MCP.

### Fase F: teléfono asincrónico

- Contract tests reales de Apollo.
- Reactivación controlada del phone reveal.
- Callback seguro e idempotente.
- Reconciliador/timeout.
- Notificaciones v3.

### Fase G: endurecimiento

- Cuotas internas.
- Rate limiting.
- E2E MCP.
- Métricas y alertas.
- Runbook operativo.

No debe implementarse el teléfono antes de validar el contrato real actual de Apollo.

---

## 19. Estrategia de pruebas

### Unitarias

- Normalización de roles y aliases.
- Readiness score.
- TTL por campo.
- Query hash.
- Dedupe de evidencia.
- Validación de identidad.
- Tecnología reemplazada.
- Estados de enrichment.

### Integración

- Buscar no guarda.
- Guardar consume cupo.
- Eliminar libera cupo.
- Research requiere cuenta guardada.
- Hallazgo válido se publica globalmente.
- Empresa incorrecta se rechaza y notifica.
- Apollo no se llama desde `get_company_contacts`.
- Preparación no consume Apollo.
- Ejecución exige confirmación.
- Caché menor a 90 días evita llamada.
- Máximo 10 cargos/contactos.
- Idempotencia ante retry.

### Contract tests Apollo

- Organización por ID/dominio.
- Búsqueda por títulos.
- Enrichment email.
- Phone inline.
- Phone async callback.
- Payload sin teléfono.
- Retry/rate limit.

### E2E MCP

1. Búsqueda manual → perfil sin guardar.
2. Guardar con confirmación.
3. Research Claude → publicación.
4. Roles sugeridos + manuales.
5. Cobertura caché.
6. Preparación Apollo.
7. Confirmación.
8. Email inmediato.
9. Teléfono pendiente.
10. Webhook/reconciliación.
11. Notificación y status final.

---

## 20. Criterios de aceptación del diseño

Una implementación conforme debe garantizar:

1. Buscar una empresa nunca la guarda automáticamente.
2. Apollo solo opera sobre cuentas activas del workspace.
3. Guardar consume cupo y eliminar lo libera.
4. Research client-assisted solo usa tokens del usuario.
5. Hallazgos válidos se publican globalmente de inmediato.
6. Hallazgos de empresa incorrecta se rechazan y notifican.
7. Los reemplazos tecnológicos conservan historial y fuente.
8. Los roles recomendados tienen evidencia.
9. Los roles manuales son permitidos y etiquetados.
10. No se aceptan más de 10 cargos ni se devuelven más de 10 contactos por ejecución.
11. Se consulta caché antes de Apollo.
12. La obsolescencia se calcula a 90 días por campo.
13. Apollo exige preparación y confirmación explícita.
14. ASCI absorbe costos, con controles internos.
15. Email y teléfono se muestran en cuanto estén disponibles.
16. El teléfono pendiente no bloquea la conversación.
17. La plataforma notifica al finalizar el procesamiento telefónico.
18. Retries y webhooks no duplican costos ni resultados.
19. La inteligencia global no expone atribución del usuario.
20. La auditoría interna conserva trazabilidad suficiente.

---

## 21. Decisiones cerradas

- ASCI absorbe los costos Apollo.
- TTL de contactos/datos: 90 días.
- Email se revela inmediatamente.
- Teléfono se procesa de forma asincrónica.
- ASCI notifica en plataforma al completar teléfonos.
- Research de Claude alimenta la inteligencia global de la empresa.
- La atribución no se muestra públicamente.
- Empresa incorrecta detectada: rechazo automático y notificación.
- Apollo requiere cuenta guardada.
- Buscar no guarda.
- Eliminar cuenta libera cupo.
- Máximo 10 cargos y 10 contactos por ejecución.
- El usuario puede agregar cargos manuales.
- Reemplazo tecnológico confirmado se registra como evento/noticia con fuente e historial.

## 22. Decisiones que deben verificarse técnicamente durante el plan

No son decisiones funcionales pendientes; son verificaciones de implementación:

1. Schema canónico definitivo para contacto global vs asociación de workspace.
2. Tabla/servicio de notificaciones v3 existente o a crear.
3. Semántica exacta de cuenta archivada respecto del cupo.
4. Contrato vigente de phone reveal/webhook de Apollo.
5. Presupuesto interno por plan y rate limits.
6. Política de retención de auditoría y payloads originales.
7. Fuente canónica para noticias y Tech Radar existentes.
8. Estrategia de moderación/remoción de evidencia global inválida.

Este documento debe ser la fuente funcional para producir el próximo plan de implementación; cualquier desviación debe explicitarse y aprobarse antes de programar.
