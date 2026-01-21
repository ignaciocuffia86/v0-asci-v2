// Bookmark status types and configuration
// This file is shared between client and server

export type BookmarkStatus = 'nuevo' | 'investigando' | 'contactado' | 'respondio' | 'reunion' | 'descartado'

export const BOOKMARK_STATUS_CONFIG = {
  nuevo: { label: 'Nuevo', color: 'bg-gray-100 text-gray-800', order: 0 },
  investigando: { label: 'Investigando', color: 'bg-blue-100 text-blue-800', order: 1 },
  contactado: { label: 'Contactado', color: 'bg-yellow-100 text-yellow-800', order: 2 },
  respondio: { label: 'Respondió', color: 'bg-green-100 text-green-800', order: 3 },
  reunion: { label: 'Reunión', color: 'bg-purple-100 text-purple-800', order: 4 },
  descartado: { label: 'Descartado', color: 'bg-red-100 text-red-800', order: 5 },
} as const

export const PRIORITY_CONFIG = {
  alta: { label: "Alta", color: "bg-red-50 text-red-700 border-red-200" },
  transaccional: { label: "Transaccional", color: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  baja: { label: "Baja", color: "bg-green-50 text-green-700 border-green-200" },
} as const
