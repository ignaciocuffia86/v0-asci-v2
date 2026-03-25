import type { OnboardingTrack } from "@/app/actions/onboarding"

export interface OnboardingStep {
  id: string
  track: OnboardingTrack
  stepIndex: number
  targetSelector: string // data-onboarding="value" attribute
  title: string
  content: string
  position: "top" | "bottom" | "left" | "right"
  route: string // page where this step lives
  highlightPadding?: number
  /**
   * If true, the step pauses the tour (no blocking overlay), shows a floating hint,
   * and waits for the user to perform an action. The tour auto-advances
   * when the targetSelector element appears in the DOM.
   */
  waitForAction?: boolean
  /** Short CTA text shown in the floating hint for action steps */
  actionHint?: string
  /** Optional fallback content when the required data doesn't exist (e.g. no bookmarks) */
  noDataFallback?: {
    content: string
    actionHint: string
    /** CSS selector - if this element contains "No tienes" or is empty, show fallback */
    checkSelector?: string
  }
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  // ============================================
  // TRACK 1: SEGMENTACION (8 pasos) - /search
  // ============================================
  {
    id: "seg-1-signals-intro",
    track: "segmentacion",
    stepIndex: 0,
    targetSelector: "search-header",
    title: "Bienvenido a ASCI",
    content: "En ASCI, una senal es la aparicion de un keyword que indica que un proceso o tecnologia esta presente en una compania. Esto lo detectamos porque un empleado actual o pasado lo menciona en su perfil, o aparece en una busqueda laboral reciente.",
    position: "bottom",
    route: "/search",
  },
  {
    id: "seg-2-tab-proceso",
    track: "segmentacion",
    stepIndex: 1,
    targetSelector: "search-tab-proceso",
    title: "Busqueda por Proceso",
    content: "Esta tab es de discovery: explora que companias tienen presente cada proceso de negocio. Ideal para encontrar cuentas nuevas que esten adoptando o transformando un proceso especifico.",
    position: "bottom",
    route: "/search",
  },
  {
    id: "seg-3-tab-tecnologia",
    track: "segmentacion",
    stepIndex: 2,
    targetSelector: "search-tab-tecnologia",
    title: "Busqueda por Tecnologia",
    content: "Busca empresas por tecnologia usando una o varias tecnologias a la vez. Escribi en el buscador para filtrar opciones y agregalas como tags. Podes combinar varias para ampliar o afinar la cobertura.",
    position: "bottom",
    route: "/search",
  },
  {
    id: "seg-4-tab-company",
    track: "segmentacion",
    stepIndex: 3,
    targetSelector: "search-tab-company",
    title: "Busqueda por Compania",
    content: "Usa esta tab cuando ya tenes una cuenta seleccionada o haces ABM. Aca ves todas las senales de una compania en un solo lugar: procesos, tecnologias, personas y busquedas laborales.",
    position: "bottom",
    route: "/search",
  },
  {
    id: "seg-5-filters",
    track: "segmentacion",
    stepIndex: 4,
    targetSelector: "search-filters",
    title: "Filtros de Proceso y Tecnologia",
    content: "Recomendamos usar estos filtros al buscar. Ayudan a dar contexto a las senales y la IA tendra informacion mas certera, con menos ruido. Selecciona un proceso o tecnologia y hace clic en Buscar.",
    position: "right",
    route: "/search",
    waitForAction: true,
    actionHint: "Realiza una busqueda para continuar",
  },
  // TODO: implementar data-onboarding="search-tech-match-mode" en technology-search.tsx (ya existe el atributo)
  // Este paso aparece solo cuando hay 2+ tecnologias seleccionadas en la busqueda por tecnologia
  {
    id: "seg-5b-multitech-mode",
    track: "segmentacion",
    stepIndex: 5,
    targetSelector: "search-tech-match-mode",
    title: "Modo de coincidencia entre tecnologias",
    content: "Cuando seleccionas mas de una tecnologia, podes elegir como se combinan los resultados. 'Al menos una' muestra empresas que usan cualquiera de ellas (OR) — ideal para ampliar la cobertura. 'Todas a la vez' muestra solo empresas que usan todas las tecnologias seleccionadas (AND) — ideal para detectar convivencia de stack especifica.",
    position: "bottom",
    route: "/search",
    // TODO: activar cuando el paso anterior se complete con 2+ tecnologias seleccionadas
    // Por ahora se puede dejar desactivado o con waitForAction en false
  },
  {
    id: "seg-6-results",
    track: "segmentacion",
    stepIndex: 6,
    targetSelector: "search-results",
    title: "Resultados de Busqueda",
    content: "Estas son las companias que coinciden con tu busqueda. Cada card muestra senales detectadas, cantidad de empleados y busquedas laborales activas. Hace clic en una compania para ver su detalle.",
    position: "top",
    route: "/search",
    waitForAction: true,
    actionHint: "Hace clic en una compania para abrir el detalle",
  },
  {
    id: "seg-7-drawer",
    track: "segmentacion",
    stepIndex: 7,
    targetSelector: "company-drawer",
    title: "Panel de Detalle",
    content: "Este panel lateral muestra toda la informacion de la compania: resumen general, senales detectadas por personas y busquedas laborales, datos de la empresa y acciones rapidas.",
    position: "left",
    route: "/search",
  },
  // TODO: implementar data-onboarding="drawer-tag-cloud" en company-drawer.tsx sobre el bloque de tags de senales
  {
    id: "seg-7b-tag-filter",
    track: "segmentacion",
    stepIndex: 8,
    targetSelector: "drawer-tag-cloud",
    title: "Filtrar senales por tag",
    content: "Los tags de senales en el resumen son clickeables. Al hacer clic en uno filtras empleados actuales, alumni y busquedas laborales en las 3 tabs simultaneamente. Util cuando buscaste por multiples tecnologias y queres ver cada una por separado.",
    position: "left",
    route: "/search",
  },
  {
    id: "seg-8-bookmark",
    track: "segmentacion",
    stepIndex: 9,
    targetSelector: "bookmark-button",
    title: "Guardar en Bookmarks",
    content: "Desde aca podes guardar la compania como bookmark para trabajarla luego. Al bookmarkear, se crea un workspace con todo lo necesario para desarrollar la cuenta. Esto cierra el track de Segmentacion!",
    position: "left",
    route: "/search",
  },

  // ============================================
  // TRACK 2: DOCUMENTACION (5 pasos) - /docs
  // ============================================
  {
    id: "doc-1-intro",
    track: "documentacion",
    stepIndex: 0,
    targetSelector: "docs-header",
    title: "Centro de Documentacion",
    content: "Aca podes subir la documentacion de tu empresa: casos de exito, propuestas de valor, brochures, y mas. Estos documentos alimentan a la IA para generar estrategias y contenido personalizado.",
    position: "bottom",
    route: "/docs",
  },
  {
    id: "doc-2-upload",
    track: "documentacion",
    stepIndex: 1,
    targetSelector: "docs-upload",
    title: "Subir Documentos",
    content: "Podes subir archivos PDF, Word, PowerPoint o crear carpetas para organizar tu documentacion. Cuanta mas informacion subas, mejor va a ser la calidad de las estrategias que genera la IA.",
    position: "bottom",
    route: "/docs",
  },
  {
    id: "doc-3-folders",
    track: "documentacion",
    stepIndex: 2,
    targetSelector: "docs-folders",
    title: "Organizacion por Carpetas",
    content: "Organiza tus documentos en carpetas tematicas: por producto, por industria, por tipo de caso. Esto ayuda a la IA a encontrar el contexto mas relevante para cada cuenta.",
    position: "right",
    route: "/docs",
  },
  {
    id: "doc-4-tags",
    track: "documentacion",
    stepIndex: 3,
    targetSelector: "docs-tags",
    title: "Tags de Documentos",
    content: "Los tags vinculan tus documentos con los procesos y tecnologias del diccionario de senales. Asi la IA sabe que caso de exito usar para cada tipo de cuenta segun sus senales.",
    position: "bottom",
    route: "/docs",
  },
  {
    id: "doc-5-strategy",
    track: "documentacion",
    stepIndex: 4,
    targetSelector: "docs-list",
    title: "Para que sirven tus Documentos",
    content: "Los documentos que subas se usan para: generar propuestas de valor personalizadas, crear estrategias de abordaje, y preparar icebreakers con contexto real de tu empresa. Esto cierra el track de Documentacion!",
    position: "top",
    route: "/docs",
  },

  // ============================================
  // TRACK 3: PROSPECCION (8 pasos) - /bookmarks
  // ============================================
  {
    id: "pro-1-bookmarks-intro",
    track: "prospeccion",
    stepIndex: 0,
    targetSelector: "bookmarks-header",
    title: "Panel de Bookmarks",
    content: "Aca gestionas todas tus cuentas guardadas. Podes verlas en formato Kanban (por estado) o Lista. Modifica el tier y estado de cada cuenta para organizar tu pipeline de cuentas.",
    position: "bottom",
    route: "/bookmarks",
  },
  {
    id: "pro-2-views",
    track: "prospeccion",
    stepIndex: 1,
    targetSelector: "bookmarks-view-toggle",
    title: "Vistas: Kanban y Lista",
    content: "Alterna entre vista Kanban (arrastra cuentas entre estados) y vista Lista (mas compacta para ver muchas cuentas). Usa la que te resulte mas comoda para tu flujo de trabajo.",
    position: "bottom",
    route: "/bookmarks",
  },
  {
    id: "pro-3-tiers",
    track: "prospeccion",
    stepIndex: 2,
    targetSelector: "bookmarks-tier-filter",
    title: "Tiers y Estados",
    content: "Clasifica tus cuentas por tier (T1, T2, T3) segun prioridad, y por estado (Nueva, En Analisis, Contactada, etc.). Hace clic en una cuenta para entrar a su workspace.",
    position: "bottom",
    route: "/bookmarks",
    waitForAction: true,
    actionHint: "Hace clic en una cuenta para continuar",
    noDataFallback: {
      content: "Todavia no tenes cuentas guardadas. Podes ir a la seccion de Busqueda para encontrar y guardar tu primera cuenta, o saltar este paso.",
      actionHint: "Guarda una cuenta desde Busqueda primero",
    },
  },
  {
    id: "pro-4-workspace-overview",
    track: "prospeccion",
    stepIndex: 3,
    targetSelector: "workspace-tabs",
    title: "Workspace de una Cuenta",
    content: "Cada bookmark tiene su workspace con varias tabs: Resumen, Posiciones, Noticias, Implementaciones, Estrategia, Prospectos, Icebreakers y Brief. Vamos a recorrer las mas importantes.",
    position: "bottom",
    route: "/bookmarks/[id]",
    highlightPadding: 8,
  },
  // TODO: implementar data-onboarding="workspace-tab-overview" en el tab de Resumen del workspace
  {
    id: "pro-4b-signals-panel",
    track: "prospeccion",
    stepIndex: 4,
    targetSelector: "workspace-tab-overview",
    title: "Panel de Senales",
    content: "La tab Resumen muestra el panel de senales de la empresa: empleados actuales, alumni, y sus keywords detectados. Hace clic en los tags de senales para filtrar y ver solo los contactos relevantes a esa tecnologia o proceso.",
    position: "bottom",
    route: "/bookmarks/[id]",
  },
  // TODO: implementar data-onboarding="bookmark-scope-button" en el boton de scope del workspace header
  {
    id: "pro-4c-scope-editor",
    track: "prospeccion",
    stepIndex: 5,
    targetSelector: "bookmark-scope-button",
    title: "Definir el Scope del Bookmark",
    content: "Cada bookmark puede tener un scope especifico: en lugar de trabajar la empresa en general, podes definir que senales son las relevantes. Esto hace que la estrategia, los icebreakers y el brief sean mas enfocados al contexto real de tu producto.",
    position: "bottom",
    route: "/bookmarks/[id]",
  },
  // TODO: implementar data-onboarding="workspace-export-button" en el boton de exportar del workspace header
  {
    id: "pro-4d-export",
    track: "prospeccion",
    stepIndex: 6,
    targetSelector: "workspace-export-button",
    title: "Exportar Contactos",
    content: "Desde el boton Exportar descargás un Excel con todos los contactos del bookmark filtrados por el scope activo. Incluye empleados actuales, alumni, datos de contacto y el contexto de las senales detectadas.",
    position: "bottom",
    route: "/bookmarks/[id]",
  },
  {
    id: "pro-5-news",
    track: "prospeccion",
    stepIndex: 7,
    targetSelector: "workspace-tab-news",
    title: "Tab de Noticias",
    content: "Aca se muestran las noticias recientes de la compania. Podes filtrar por relevancia y marcar las que te interesen. Las noticias seleccionadas alimentan directamente los Icebreakers y el Brief Ejecutivo, dandoles contexto actualizado.",
    position: "bottom",
    route: "/bookmarks/[id]",
  },
  {
    id: "pro-6-implementations",
    track: "prospeccion",
    stepIndex: 8,
    targetSelector: "workspace-tab-implementations",
    title: "Tab de Implementaciones",
    content: "A diferencia de las noticias, las implementaciones son proyectos concretos que la compania realizo o esta realizando. Son senales mas solidas de inversion y prioridad. Tambien impactan en los Icebreakers y el Brief.",
    position: "bottom",
    route: "/bookmarks/[id]",
  },
  {
    id: "pro-7-strategy",
    track: "prospeccion",
    stepIndex: 9,
    targetSelector: "workspace-tab-strategy",
    title: "Tab de Estrategia",
    content: "La estrategia se genera con IA usando tus documentos, las senales, noticias e implementaciones de la cuenta. Una cuenta bookmarkeada desde un proceso especifico ayuda a que la IA sea mas precisa y menos generalista.",
    position: "bottom",
    route: "/bookmarks/[id]",
  },
  {
    id: "pro-8-prospects",
    track: "prospeccion",
    stepIndex: 10,
    targetSelector: "workspace-tab-prospects",
    title: "Tab de Prospectos",
    content: "Busca prospectos en Apollo.io directamente desde aca. La IA sugiere job titles relevantes basandose en las senales. Podes filtrar por pais para apuntar mejor a las filiales locales de multinacionales.",
    position: "bottom",
    route: "/bookmarks/[id]",
  },
  {
    id: "pro-9-icebreakers",
    track: "prospeccion",
    stepIndex: 11,
    targetSelector: "workspace-tab-icebreakers",
    title: "Tab de Icebreakers",
    content: "Genera mensajes de apertura personalizados con IA. Usa el contexto de senales, noticias, implementaciones, documentos y la estrategia. Filtra por pais para multinacionales y genera distintos tipos de mensajes segun el contacto.",
    position: "bottom",
    route: "/bookmarks/[id]",
  },
  {
    id: "pro-10-brief",
    track: "prospeccion",
    stepIndex: 12,
    targetSelector: "workspace-tab-brief",
    title: "Tab de Brief Ejecutivo",
    content: "El brief consolida todo: senales, noticias, implementaciones, estrategia, prospectos e icebreakers en un documento ejecutivo. Recorda que bookmarkear desde un proceso ayuda a que el brief sea mas enfocado. Esto cierra el Onboarding!",
    position: "bottom",
    route: "/bookmarks/[id]",
  },
]

export function getTrackSteps(track: OnboardingTrack): OnboardingStep[] {
  return ONBOARDING_STEPS.filter((s) => s.track === track)
}

export function getStepByTrackAndIndex(track: OnboardingTrack, index: number): OnboardingStep | undefined {
  return ONBOARDING_STEPS.find((s) => s.track === track && s.stepIndex === index)
}

export function getTrackStepCount(track: OnboardingTrack): number {
  return ONBOARDING_STEPS.filter((s) => s.track === track).length
}

export const TRACK_LABELS: Record<OnboardingTrack, string> = {
  segmentacion: "Segmentacion",
  documentacion: "Documentacion",
  prospeccion: "Prospeccion",
}

export const TRACK_ORDER: OnboardingTrack[] = ["segmentacion", "documentacion", "prospeccion"]
