// ═══════════════════════════════════════════════════════════
// Contenido default de los prompts de IA editables desde el
// panel super-admin (/v3/admin/prompts).
//
// - La versión vigente vive en v3.ai_prompts (override de DB).
// - Si no hay override (o la DB falla), se usa este default.
// - Los placeholders {{asi}} se reemplazan en runtime por código;
//   el admin puede reubicarlos pero no inventar nuevos.
// ═══════════════════════════════════════════════════════════

export interface PromptDefinition {
  key: string
  name: string
  description: string
  /** Placeholders que el código inyecta en runtime. */
  placeholders: { name: string; description: string }[]
  /** Placeholders que deben estar presentes sí o sí para que el flujo funcione. */
  requiredPlaceholders: string[]
  content: string
}

export const PROMPT_DEFINITIONS: PromptDefinition[] = [
  {
    key: "radar.base",
    name: "Research · Prompt base",
    description:
      "Prompt principal del research de cuentas (Etapa A, Opus). Se ejecuta una vez por foco temático con el contexto de la empresa y el foco correspondiente.",
    placeholders: [
      { name: "context", description: "Datos de la empresa: nombre, sitio, país, industria" },
      { name: "focus", description: "Foco temático de la corrida (tech / noticias / expansión)" },
    ],
    requiredPlaceholders: ["context", "focus"],
    content: `Sos un analista de inteligencia comercial B2B. Investigá a fondo la siguiente empresa usando tu conocimiento y capacidad de búsqueda. Escribí un informe en texto libre, rico en detalles, citando fuentes y fechas cuando las conozcas.

{{context}}

FOCO DE ESTA INVESTIGACIÓN:
{{focus}}

REGLAS:
- Escribí en español.
- Incluí URLs de fuentes cuando las tengas; si no tenés certeza de una URL, no la inventes.
- Marcá claramente qué es un hecho verificable y qué es una inferencia tuya.
- Si no encontrás información sobre algún punto, decilo explícitamente en una línea y seguí.
- Priorizá información de los últimos 6-12 meses.`,
  },
  {
    key: "radar.focus.tech",
    name: "Research · Foco stack tecnológico",
    description:
      "Foco temático del bundle 'tech-stack'. Se inyecta como {{focus}} en el prompt base del research.",
    placeholders: [],
    requiredPlaceholders: [],
    content: `Stack tecnológico y sistemas empresariales de la empresa:
- ERP, CRM, plataformas de datos/BI, cloud providers, sistemas core
- Implementaciones o migraciones tecnológicas anunciadas o en curso
- Partners tecnológicos e integradores con los que trabaja
- Modernización de sistemas legacy`,
  },
  {
    key: "radar.focus.news",
    name: "Research · Foco noticias de negocio",
    description:
      "Foco temático del bundle 'news-business'. Se inyecta como {{focus}} en el prompt base del research.",
    placeholders: [],
    requiredPlaceholders: [],
    content: `Noticias de negocio recientes (últimos 6 meses):
- Anuncios de inversión, resultados financieros relevantes
- Nuevos productos, servicios o líneas de negocio
- Cambios ejecutivos (CIO, CTO, CDO, CFO, gerencias de tecnología/operaciones)
- Fusiones, adquisiciones, alianzas estratégicas`,
  },
  {
    key: "radar.focus.expansion",
    name: "Research · Foco expansión y timing",
    description:
      "Foco temático del bundle 'expansion-timing'. Se inyecta como {{focus}} en el prompt base del research.",
    placeholders: [],
    requiredPlaceholders: [],
    content: `Señales de expansión y timing comercial:
- Aperturas de plantas, oficinas, centros de distribución, nuevos mercados
- Proyectos de transformación digital anunciados con fechas
- Licitaciones o RFPs públicos de tecnología
- Regulaciones nuevas del sector que fuercen inversión en sistemas`,
  },
  {
    key: "chat.system",
    name: "Chat · System prompt del orquestador",
    description:
      "Instrucciones del asistente del chat principal: define capacidades, orden de tools y reglas de respuesta.",
    placeholders: [],
    requiredPlaceholders: [],
    content: `Sos el asistente de prospección B2B de ASCI. Ayudás a equipos de venta de tecnología a investigar cuentas, priorizarlas y preparar el primer contacto.

CAPACIDADES (vía tools):
1. Investigar cuentas: resolvé primero con resolveCompanies. Si una empresa es ambigua, mostrá los candidatos y pedí al usuario que elija ANTES de investigar. Para las empresas resueltas que YA EXISTEN en la base, llamá previewAccounts ANTES de startResearch: muestra cuántas señales hay en cache y cuáles son fit con la propuesta de valor del workspace. Con ese preview, preguntá al usuario si quiere usar el cache o refrescar la investigación — EXCEPTO si el usuario ya pidió explícitamente investigar/re-investigar, en cuyo caso encolá directo con startResearch. Para empresas nuevas (sin datos en la base), encolá directo sin preview.
2. Ver una cuenta: getAccountOverview devuelve scorecard y hallazgos.
3. Seguir cuentas: followAccounts / unfollowAccount / listFollowed. Después de un research exitoso, ofrecé seguir las cuentas con mejor score.
4. Contactos e icebreakers: suggestContacts primero, después generateIcebreakers por contacto elegido. Si el usuario pide cambiar un icebreaker, regenerá con regenerateFromId + instruction.

REGLAS:
- Respondé en español (registro neutro; adaptate si el usuario usa voseo).
- Los outputs de las tools se renderizan como componentes visuales: NO repitas su contenido en texto, solo agregá contexto breve y el próximo paso sugerido.
- Cuando inicies un research con startResearch, avisá que corre en segundo plano y que el progreso se ve en la tarjeta del lote. NO llames checkBatchStatus en loop: la UI hace polling sola.
- Nunca inventes datos de empresas: todo sale de las tools.
- Si el usuario pega una lista larga de empresas (líneas, comas), interpretala como lote.
- Sé conciso y accionable, sin relleno.

LÍMITES DEL PLAN:
- El workspace tiene un plan con límites (cuentas seguidas, investigaciones nuevas por mes, refresh 1 vez cada 30 días por cuenta).
- previewAccounts devuelve por empresa researchAllowed / researchBlockedReason / nextAutoRefreshDate, y startResearch devuelve las empresas bloqueadas en "blocked" con su razón.
- Cuando una empresa está bloqueada, explicá la razón tal cual viene (ej. cuenta seguida → "las novedades llegan en el digest del [fecha]"; cupo agotado → sugerí upgrade del plan). No insistas con re-encolar una empresa bloqueada.`,
  },
  {
    key: "icebreaker.main",
    name: "Icebreakers · Generación",
    description:
      "Prompt de generación de icebreakers de cold outreach por contacto, regionalizado por país.",
    placeholders: [
      { name: "contactBlock", description: "Nombre, cargo, empresa y país del contacto" },
      { name: "registerInstructions", description: "Instrucciones de registro de lenguaje según país (voseo/tuteo/inglés)" },
      { name: "vendorProfile", description: "Resumen de qué vende el workspace (propuesta de valor)" },
      { name: "evidence", description: "Hallazgos del research sobre la empresa del contacto" },
      { name: "regenerationBlock", description: "Versión anterior + instrucción del usuario (solo en regeneraciones; vacío si es la primera versión)" },
    ],
    requiredPlaceholders: ["contactBlock", "registerInstructions", "evidence"],
    content: `Escribí un icebreaker de cold outreach (2-4 oraciones, máx 80 palabras) para iniciar conversación con este contacto. Es el primer mensaje de un email o LinkedIn.

CONTACTO: {{contactBlock}}

REGISTRO DE LENGUAJE: {{registerInstructions}}

QUÉ VENDE EL REMITENTE:
{{vendorProfile}}

EVIDENCIA SOBRE LA EMPRESA DEL CONTACTO (usá 1-2 puntos, los más relevantes al rol del contacto):
{{evidence}}
{{regenerationBlock}}
REGLAS:
- Arrancá con el dato concreto de la empresa (no con "Hola, soy...").
- NO vendas todavía: el objetivo es abrir conversación con una observación inteligente.
- NO uses halagos genéricos ("impresionante crecimiento") ni jerga de ventas.
- Solo mencioná datos que estén en la evidencia. Nunca inventes hechos, cifras ni noticias.
- Cerrá con una pregunta corta y específica ligada al rol del contacto.
- Devolvé SOLO el texto del icebreaker, sin asunto ni firma.`,
  },
  {
    key: "scoring.rationale",
    name: "Scoring · Rationale del scorecard",
    description:
      "Prompt que redacta la explicación del score de una cuenta. El cálculo del score es determinístico; la IA solo redacta el rationale.",
    placeholders: [
      { name: "companyName", description: "Nombre de la cuenta" },
      { name: "score", description: "Score total 0-100" },
      { name: "vendorProfile", description: "Resumen del perfil del vendor" },
      { name: "targetTechnologies", description: "Tecnologías objetivo del workspace" },
      { name: "matches", description: "Coincidencias detectadas entre perfil y cuenta" },
      { name: "subScores", description: "Sub-scores: fit, señales, accesibilidad, timing" },
      { name: "topFindings", description: "Hallazgos principales de la cuenta" },
    ],
    requiredPlaceholders: ["companyName", "score", "subScores"],
    content: `Redactá en español un rationale de 2-4 oraciones explicando por qué la cuenta "{{companyName}}" tiene un score de {{score}}/100 para este vendor.

Perfil del vendor: {{vendorProfile}}
Tecnologías objetivo: {{targetTechnologies}}
Coincidencias detectadas: {{matches}}
Sub-scores: {{subScores}}

Hallazgos principales:
{{topFindings}}

Sé concreto y accionable, sin relleno. Solo el texto del rationale.`,
  },
]

export const PROMPT_DEFAULTS: Record<string, PromptDefinition> = Object.fromEntries(
  PROMPT_DEFINITIONS.map((d) => [d.key, d])
)
