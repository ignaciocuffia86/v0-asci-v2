"use client"

import { useState, useEffect, useRef } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Users,
  Loader2,
  Linkedin,
  Mail,
  Phone,
  Search,
  X,
  Plus,
  CheckCircle2,
  Target,
  Trash2,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  CheckSquare,
  Square,
  AlertCircle,
  Info,
  Code,
  Copy,
} from "lucide-react"
import {
  searchApolloProspects,
  removeProspect,
  restoreProspect,
  revealProspectPhone,
  getProspectPhoneStatus,
  markPhoneTimedOut,
  type ApolloSearchStats,
  type ProspectsTabData,
} from "@/app/actions/apollo"
import Link from "next/link"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { validateTitle } from "@/lib/apollo/title-validator"

// Countries LATAM + Spain + US - label in Spanish, value in English for Apollo API
const APOLLO_COUNTRIES = [
  { label: "Argentina", value: "Argentina" },
  { label: "Bolivia", value: "Bolivia" },
  { label: "Brasil", value: "Brazil" },
  { label: "Chile", value: "Chile" },
  { label: "Colombia", value: "Colombia" },
  { label: "Costa Rica", value: "Costa Rica" },
  { label: "Cuba", value: "Cuba" },
  { label: "Ecuador", value: "Ecuador" },
  { label: "El Salvador", value: "El Salvador" },
  { label: "Espana", value: "Spain" },
  { label: "Estados Unidos", value: "United States" },
  { label: "Guatemala", value: "Guatemala" },
  { label: "Honduras", value: "Honduras" },
  { label: "Mexico", value: "Mexico" },
  { label: "Nicaragua", value: "Nicaragua" },
  { label: "Panama", value: "Panama" },
  { label: "Paraguay", value: "Paraguay" },
  { label: "Peru", value: "Peru" },
  { label: "Puerto Rico", value: "Puerto Rico" },
  { label: "Rep. Dominicana", value: "Dominican Republic" },
  { label: "Uruguay", value: "Uruguay" },
  { label: "Venezuela", value: "Venezuela" },
]
import { exportToCSV, exportToExcel, prepareProspectsForExport } from "@/lib/export-utils"
import { Globe } from "lucide-react"

// Grupos predefinidos de job titles por area
const PREDEFINED_JOB_TITLE_GROUPS = [
  {
    label: "Operaciones",
    titles: [
      "Director de Operaciones",
      "COO",
      "VP Operaciones",
      "Gerente de Operaciones",
      "Head of Operations",
    ],
  },
  {
    label: "TI / Sistemas",
    titles: [
      "Director de TI",
      "Director de Sistemas",
      "CTO",
      "IT Manager",
      "Gerente de Sistemas",
      "Jefe de Sistemas",
      "VP IT",
    ],
  },
  {
    label: "Innovacion / Transformacion",
    titles: [
      "Director de Innovacion",
      "Chief Innovation Officer",
      "Director de Transformacion Digital",
      "Head of Innovation",
      "Gerente de Innovacion",
    ],
  },
]

function proxyImageUrl(url: string | undefined | null): string {
  if (!url) return ""
  // Proxy external images to avoid CORS issues
  if (url.includes("salesql.s3") || url.includes("d2ojpxxtu63wzl") || url.includes("licdn.com")) {
    return `/api/proxy-image?url=${encodeURIComponent(url)}`
  }
  return url
}

interface Prospect {
  id: string
  full_name: string
  first_name?: string
  last_name?: string
  role?: string
  headline?: string
  email?: string
  email_status?: string
  phone?: string
  mobile_phone?: string
  phone_status?: "not_requested" | "pending" | "received" | "not_available" | null
  phone_requested_at?: string | null
  apollo_person_id?: string | null
  linkedin_url?: string
  profile_picture_url?: string
  seniority?: string
  city?: string
  country?: string
  source?: string
  is_decision_maker?: boolean
  created_at?: string
  status?: string
  }

interface ProspectsTabProps {
  bookmarkId: string
  companyName: string
  companyWebsite?: string
  defaultCountry?: string
  /**
   * Se incrementa en el padre cuando cambia el scope del bookmark (industrias,
   * technologies, processes). Lo usamos como parte de la key de SWR para forzar
   * un re-fetch sin remontar el componente entero (evita el loop de mount).
   */
  scopeVersion?: number
}

const swrFetcher = (url: string) =>
  fetch(url, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json() as Promise<ProspectsTabData>
  })

export function ProspectsTab({
  bookmarkId,
  companyName,
  companyWebsite,
  defaultCountry,
  scopeVersion = 0,
}: ProspectsTabProps) {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [removedProspects, setRemovedProspects] = useState<Prospect[]>([])
  const [showRemoved, setShowRemoved] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  // Selección para exportación
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState(false)

  // isLoading ahora se deriva de SWR (definido más abajo); no hace falta estado local.
  const [isSearching, setIsSearching] = useState(false)

  // Map a country name (possibly in Spanish or from DB) to the Apollo English value
  const mapToApolloCountry = (country: string): string => {
    if (!country) return ""
    // Check if it's already an Apollo value
    const directMatch = APOLLO_COUNTRIES.find(c => c.value.toLowerCase() === country.toLowerCase())
    if (directMatch) return directMatch.value
    // Check if it matches a label (Spanish name)
    const labelMatch = APOLLO_COUNTRIES.find(c => c.label.toLowerCase() === country.toLowerCase())
    if (labelMatch) return labelMatch.value
    // Partial match
    const partialMatch = APOLLO_COUNTRIES.find(c => 
      c.label.toLowerCase().includes(country.toLowerCase()) || 
      c.value.toLowerCase().includes(country.toLowerCase())
    )
    if (partialMatch) return partialMatch.value
    return country
  }

  // Country filter for Apollo search
  const [prospectCountry, setProspectCountry] = useState(() => mapToApolloCountry(defaultCountry || ""))

  // Sync with parent country filter changes
  useEffect(() => {
    if (defaultCountry !== undefined) {
      setProspectCountry(mapToApolloCountry(defaultCountry))
    }
  }, [defaultCountry])

  // Contexto de búsqueda
  const [technologies, setTechnologies] = useState<string[]>([])
  const [processes, setProcesses] = useState<string[]>([])
  const [company, setCompany] = useState<{ name: string; website?: string; linkedin_url?: string } | null>(null)

  // Job titles
  const [selectedJobTitles, setSelectedJobTitles] = useState<string[]>([])
  const [customJobTitle, setCustomJobTitle] = useState("")

  // UX: validación del input custom (feedback en vivo)
  const [customTitleHint, setCustomTitleHint] = useState<{
    kind: "error" | "warning" | null
    message: string
  }>({ kind: null, message: "" })

  // UX: opciones avanzadas (opt-in de reveals)
  const [revealEmail, setRevealEmail] = useState(true)
  const [useOrganizationLocation, setUseOrganizationLocation] = useState(false)
  // Default OFF: evita falsos positivos ("IT Manager" -> "Key Account Manager")
  const [includeSimilarTitles, setIncludeSimilarTitles] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showDebugPayload, setShowDebugPayload] = useState(false)

  // UX: stats de la última búsqueda
  const [lastSearchStats, setLastSearchStats] = useState<ApolloSearchStats | null>(null)
  const [lastSearchError, setLastSearchError] = useState<string | null>(null)

  // Copiar al portapapeles
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Estado del reveal de telefono por contacto. revealingId mantiene la card
  // que esta loading; pollingTimers guarda los intervals por id para limpiar
  // si el usuario navega antes de que llegue el webhook.
  const [revealingId, setRevealingId] = useState<string | null>(null)
  const pollingTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  // Limpiar intervals al desmontar
  useEffect(() => {
    const timers = pollingTimersRef.current
    return () => {
      for (const id of Object.keys(timers)) clearInterval(timers[id])
    }
  }, [])

  // Aplica un patch sobre un prospecto en el state local (active list).
  // Lo usamos para updates optimistas y para reflejar lo que devuelve el
  // polling sin tener que revalidar todo SWR.
  const patchProspect = (id: string, patch: Partial<Prospect>) => {
    setProspects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    )
  }

  /**
   * Inicia un polling cada 5s sobre el status del telefono. Para cuando:
   *  - Pega 'received'                  -> toast success.
   *  - Pega 'not_available' (server)    -> toast info.
   *  - Se cumple el timeout (5 min)     -> marcamos not_available en DB
   *    via `markPhoneTimedOut` y mostramos toast informando que Apollo
   *    acepto el waterfall pero no entrego datos. Esto desbloquea al usuario
   *    en vez de dejarlo en "Buscando..." infinito.
   */
  const startPhonePolling = (prospectId: string) => {
    if (pollingTimersRef.current[prospectId]) return
    const startedAt = Date.now()
    // Apollo waterfall enrichment puede tardar varios minutos cuando consulta
    // proveedores externos. 5 min es un buen balance entre paciencia y UX.
    const TIMEOUT_MS = 5 * 60 * 1000
    const POLL_MS = 5_000

    const stop = () => {
      clearInterval(pollingTimersRef.current[prospectId])
      delete pollingTimersRef.current[prospectId]
    }

    pollingTimersRef.current[prospectId] = setInterval(async () => {
      try {
        const res = await getProspectPhoneStatus(prospectId)
        if (!res.ok) return
        if (res.phone_status === "received") {
          patchProspect(prospectId, {
            phone_status: "received",
            phone: res.phone ?? undefined,
            mobile_phone: res.mobile_phone ?? undefined,
          })
          stop()
          toast.success("Telefono recibido")
        } else if (res.phone_status === "not_available") {
          patchProspect(prospectId, { phone_status: "not_available" })
          stop()
          toast.info("Apollo no encontro telefono para este contacto")
        } else if (Date.now() - startedAt > TIMEOUT_MS) {
          // Pasaron 5 min sin webhook: Apollo acepto el waterfall pero los
          // proveedores externos no respondieron a tiempo (o el plan no
          // tiene waterfall activo). Marcamos not_available en DB para
          // desbloquear al usuario y respetar el cooldown.
          stop()
          const mark = await markPhoneTimedOut(prospectId)
          if (mark.ok && mark.changed) {
            patchProspect(prospectId, { phone_status: "not_available" })
            toast.info("Apollo no entrego el telefono", {
              description:
                "El waterfall enrichment fue aceptado pero no llegaron datos en 5 min. Reintenta despues del cooldown.",
              duration: 8000,
            })
          } else {
            // El estado ya cambio entre el ultimo poll y ahora (race), refrescamos.
            const fresh = await getProspectPhoneStatus(prospectId)
            if (fresh.ok && fresh.phone_status) {
              patchProspect(prospectId, {
                phone_status: fresh.phone_status as Prospect["phone_status"],
                phone: fresh.phone ?? undefined,
                mobile_phone: fresh.mobile_phone ?? undefined,
              })
            }
          }
        }
      } catch (err) {
        console.warn("[v0] phone poll failed:", err)
      }
    }, POLL_MS)
  }

  const handleRevealPhone = async (prospect: Prospect) => {
    if (revealingId) return // un reveal a la vez para evitar racing
    setRevealingId(prospect.id)
    // Optimista: pintamos pending de inmediato
    patchProspect(prospect.id, { phone_status: "pending" })

    try {
      const result = await revealProspectPhone(prospect.id)
      if (!result.ok) {
        // Revertir si fue cooldown / error
        patchProspect(prospect.id, {
          phone_status:
            result.status === "cooldown"
              ? "not_available"
              : prospect.phone_status ?? "not_requested",
        })
        if (result.status === "cooldown") {
          toast.info(result.message)
        } else if (result.status === "already_received") {
          toast.info(result.message)
        } else {
          toast.error("No se pudo revelar el telefono", {
            description: result.message,
          })
        }
        return
      }

      if (result.status === "received") {
        patchProspect(prospect.id, {
          phone_status: "received",
          [result.isMobile ? "mobile_phone" : "phone"]: result.phone,
        } as Partial<Prospect>)
        toast.success("Telefono revelado", {
          description: result.phone,
        })
      } else if (result.status === "pending") {
        // Apollo acepto el waterfall enrichment, polleamos hasta que llegue
        // el webhook o se cumpla el timeout (5 min).
        toast.info("Buscando telefono", {
          description:
            "Apollo esta consultando proveedores externos. Si no llega en 5 min, te avisamos que no se pudo.",
          duration: 6000,
        })
        startPhonePolling(prospect.id)
      } else if (result.status === "not_available") {
        // Apollo respondio 200 pero no tiene telefono para este contacto.
        // Marcamos not_available directo y damos feedback claro al usuario.
        patchProspect(prospect.id, { phone_status: "not_available" })
        toast.info("Apollo no encontro telefono", {
          description: result.message,
        })
      }
    } catch (err) {
      console.error("[v0] revealProspectPhone failed:", err)
      patchProspect(prospect.id, {
        phone_status: prospect.phone_status ?? "not_requested",
      })
      toast.error("Error al pedir el telefono")
    } finally {
      setRevealingId(null)
    }
  }

  // Fetching con SWR: evita el loop que provocaba el patrón fetch-en-useEffect
  // + remount del TabsContent con key dinámica. SWR deduplica requests, cachea
  // la respuesta y nos da un `mutate` para revalidar manualmente tras acciones.
  //
  // La key incluye scopeVersion: cuando el padre incrementa scopeVersion por
  // cambios en el scope del bookmark, SWR re-fetchea sin remontar el tab.
  const swrKey = bookmarkId
    ? `/api/bookmarks/${bookmarkId}/prospects-data?v=${scopeVersion}`
    : null
  const {
    data: tabData,
    error: tabError,
    isLoading: isLoadingTab,
    mutate: mutateTab,
  } = useSWR<ProspectsTabData>(swrKey, swrFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 10_000,
    shouldRetryOnError: false,
  })

  // Sincronizar el estado local con la data remota. Mantenemos los useState
  // locales para poder hacer updates optimistas en remove/restore sin tener
  // que revalidar con el server en cada acción.
  useEffect(() => {
    if (!tabData) return
    setTechnologies(tabData.context.technologies)
    setProcesses(tabData.context.processes)
    setCompany(tabData.context.company)
    setProspects(tabData.active as Prospect[])
    setRemovedProspects(tabData.removed as Prospect[])
  }, [tabData])

  // Feedback de error (una vez, no en cada render)
  useEffect(() => {
    if (tabError) {
      console.error("[v0] prospects-tab SWR error", tabError)
      toast.error("No se pudieron cargar los prospectos", {
        description: tabError instanceof Error ? tabError.message : "Error desconocido",
      })
    }
  }, [tabError])

  const isLoading = isLoadingTab && !tabData

  // Toggle selección de job title
  const toggleJobTitle = (title: string) => {
    setSelectedJobTitles((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]))
  }

  // Validación en vivo al tipear en el input custom
  const handleCustomTitleChange = (value: string) => {
    setCustomJobTitle(value)
    if (!value.trim()) {
      setCustomTitleHint({ kind: null, message: "" })
      return
    }
    const result = validateTitle(value)
    if (!result.valid) {
      setCustomTitleHint({ kind: "error", message: result.reason })
      return
    }
    // Dup contra seleccionados (case-insensitive)
    const lower = value.trim().toLowerCase()
    if (selectedJobTitles.some((t) => t.toLowerCase() === lower)) {
      setCustomTitleHint({ kind: "warning", message: "Ya está en la lista" })
      return
    }
    if (result.warning) {
      setCustomTitleHint({ kind: "warning", message: result.warning })
      return
    }
    setCustomTitleHint({ kind: null, message: "" })
  }

  // Agregar job title personalizado (con validación)
  const addCustomJobTitle = () => {
    const trimmed = customJobTitle.trim()
    if (!trimmed) return
    const result = validateTitle(trimmed)
    if (!result.valid) {
      setCustomTitleHint({ kind: "error", message: result.reason })
      return
    }
    const lower = trimmed.toLowerCase()
    if (selectedJobTitles.some((t) => t.toLowerCase() === lower)) {
      setCustomTitleHint({ kind: "warning", message: "Ya está en la lista" })
      return
    }
    setSelectedJobTitles((prev) => [...prev, trimmed])
    setCustomJobTitle("")
    setCustomTitleHint({ kind: null, message: "" })
  }

  // Buscar en Apollo
  const handleSearch = async () => {
    if (selectedJobTitles.length === 0) return

    setIsSearching(true)
    setLastSearchError(null)
    setLastSearchStats(null)
    try {
      const result = await searchApolloProspects(
        bookmarkId,
        selectedJobTitles,
        undefined,
        prospectCountry || undefined,
        {
          revealEmail,
          useOrganizationLocation,
          includeSimilarTitles,
        },
      )

      if (result.stats) {
        setLastSearchStats(result.stats)
      }

      if (result.success) {
        // Revalidamos la data vía SWR. Como ya tenemos `tabData` en cache, SWR
        // hace la refetch en background SIN togglear el skeleton (isLoadingTab
        // queda en false mientras haya data previa).
        await mutateTab()
      } else {
        setLastSearchError(result.error || "No se pudieron encontrar prospectos")
      }
    } catch (error) {
      console.error("Error searching:", error)
      setLastSearchError(error instanceof Error ? error.message : "Error desconocido")
    }
    setIsSearching(false)
  }

  const handleRemoveProspect = async (prospectId: string) => {
    setRemovingId(prospectId)
    const result = await removeProspect(prospectId)
    if (result.success) {
      // Mover de prospects a removedProspects
      const removed = prospects.find((p) => p.id === prospectId)
      if (removed) {
        setProspects((prev) => prev.filter((p) => p.id !== prospectId))
        setRemovedProspects((prev) => [{ ...removed, status: "removed" }, ...prev])
      }
    }
    setRemovingId(null)
  }

  const handleRestoreProspect = async (prospectId: string) => {
    setRestoringId(prospectId)
    const result = await restoreProspect(prospectId)
    if (result.success) {
      // Mover de removedProspects a prospects
      const restored = removedProspects.find((p) => p.id === prospectId)
      if (restored) {
        setRemovedProspects((prev) => prev.filter((p) => p.id !== prospectId))
        setProspects((prev) => [{ ...restored, status: "active" }, ...prev])
      }
    }
    setRestoringId(null)
  }

  // Funciones de selección
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(new Set(prospects.map((p) => p.id)))
  }

  const deselectAll = () => {
    setSelectedIds(new Set())
  }

  const isAllSelected = prospects.length > 0 && selectedIds.size === prospects.length

  // Funciones de exportación
  const handleExportCSV = () => {
    setIsExporting(true)
    try {
      const selectedProspects = prospects.filter((p) => selectedIds.has(p.id))
      const exportData = prepareProspectsForExport(selectedProspects, {
        name: companyName,
        website: companyWebsite,
      })
      exportToCSV(exportData, companyName)
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportExcel = () => {
    setIsExporting(true)
    try {
      const selectedProspects = prospects.filter((p) => selectedIds.has(p.id))
      const exportData = prepareProspectsForExport(selectedProspects, {
        name: companyName,
        website: companyWebsite,
      })
      exportToExcel(exportData, companyName)
    } finally {
      setIsExporting(false)
    }
  }

  // Nota: NO bloqueamos el render con un spinner global. El formulario (país,
  // job titles, búsqueda) no depende de la data remota y debe mostrarse de
  // inmediato. Solo el bloque de "Lista de prospectos" más abajo usa isLoading.

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Target className="h-5 w-5" />
          Prospectos - Tomadores de Decisión
        </h2>
        <p className="text-sm text-muted-foreground">
          Encuentra los decision makers relevantes para tu contexto de búsqueda usando Apollo.io
        </p>
      </div>

      {/* Pais de busqueda - resaltado */}
      <Card className="border-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 shrink-0">
              <Globe className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm font-medium">Pais de busqueda</span>
            </div>
            <Select
              value={prospectCountry || "_all"}
              onValueChange={(val) => setProspectCountry(val === "_all" ? "" : val)}
            >
              <SelectTrigger className="max-w-[240px] border-blue-300 dark:border-blue-700 bg-background">
                <SelectValue placeholder="Todos los paises" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">Todos los paises</SelectItem>
                {APOLLO_COUNTRIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!prospectCountry && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                Selecciona un pais para acotar los resultados de Apollo
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Job Titles - seleccion por grupo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Selecciona los cargos a buscar</CardTitle>
          <p className="text-xs text-muted-foreground">
            Hace clic en los cargos relevantes para buscar decision makers en {companyName}. Podes seleccionar de los grupos o agregar manualmente.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Grupos predefinidos */}
          {PREDEFINED_JOB_TITLE_GROUPS.map((group) => {
            const allSelected = group.titles.every((t) => selectedJobTitles.includes(t))
            const someSelected = group.titles.some((t) => selectedJobTitles.includes(t))

            return (
              <div key={group.label} className="space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
                    onClick={() => {
                      if (allSelected) {
                        setSelectedJobTitles((prev) => prev.filter((t) => !group.titles.includes(t)))
                      } else {
                        setSelectedJobTitles((prev) => [...new Set([...prev, ...group.titles])])
                      }
                    }}
                  >
                    {group.label}
                  </button>
                  {someSelected && !allSelected && (
                    <span className="text-[10px] text-muted-foreground">
                      ({group.titles.filter((t) => selectedJobTitles.includes(t)).length}/{group.titles.length})
                    </span>
                  )}
                  {allSelected && (
                    <CheckCircle2 className="h-3 w-3 text-green-600" />
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.titles.map((title) => (
                    <Badge
                      key={title}
                      variant={selectedJobTitles.includes(title) ? "default" : "outline"}
                      className="cursor-pointer transition-colors text-xs"
                      onClick={() => toggleJobTitle(title)}
                    >
                      {title}
                      {selectedJobTitles.includes(title) && <CheckCircle2 className="h-3 w-3 ml-1" />}
                    </Badge>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Títulos custom agregados (que no son de los grupos predefinidos) */}
          {selectedJobTitles.filter(
            (t) => !PREDEFINED_JOB_TITLE_GROUPS.some((g) => g.titles.includes(t))
          ).length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Personalizados
              </span>
              <div className="flex flex-wrap gap-1.5">
                {selectedJobTitles
                  .filter((t) => !PREDEFINED_JOB_TITLE_GROUPS.some((g) => g.titles.includes(t)))
                  .map((title) => (
                    <Badge
                      key={title}
                      variant="default"
                      className="cursor-pointer transition-colors text-xs"
                      onClick={() => toggleJobTitle(title)}
                    >
                      {title}
                      <X className="h-3 w-3 ml-1" />
                    </Badge>
                  ))}
              </div>
            </div>
          )}

          {/* Agregar job title personalizado */}
          <div className="pt-2 border-t">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Agregar cargo manualmente
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="Ej: VP de Compras, CIO, Gerente de Logistica..."
                value={customJobTitle}
                onChange={(e) => handleCustomTitleChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustomJobTitle()}
                className={`flex-1 ${
                  customTitleHint.kind === "error"
                    ? "border-destructive focus-visible:ring-destructive"
                    : customTitleHint.kind === "warning"
                      ? "border-amber-400 focus-visible:ring-amber-400"
                      : ""
                }`}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={addCustomJobTitle}
                disabled={!customJobTitle.trim() || customTitleHint.kind === "error"}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {customTitleHint.message && (
              <p
                className={`mt-1.5 text-xs flex items-start gap-1.5 ${
                  customTitleHint.kind === "error" ? "text-destructive" : "text-amber-600 dark:text-amber-400"
                }`}
              >
                <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>{customTitleHint.message}</span>
              </p>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Tip: Apollo funciona mejor con títulos de 2-4 palabras. &quot;IT Director&quot; traerá más
              resultados que &quot;Director de Tecnología y Transformación Digital&quot;.
            </p>
          </div>

          {/* Opciones avanzadas */}
          <div className="pt-2 border-t">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Opciones avanzadas
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <label htmlFor="reveal-email" className="text-sm font-medium">
                      Revelar email personal
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Consume 1 crédito Apollo por contacto.
                    </p>
                  </div>
                  <Switch id="reveal-email" checked={revealEmail} onCheckedChange={setRevealEmail} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <label htmlFor="use-org-location" className="text-sm font-medium">
                      Filtrar por país de la empresa
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Por default filtramos por ubicación del contacto. Activá esto si querés incluir
                      expats que trabajan para la empresa pero viven en otro país.
                    </p>
                  </div>
                  <Switch
                    id="use-org-location"
                    checked={useOrganizationLocation}
                    onCheckedChange={setUseOrganizationLocation}
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <label htmlFor="similar-titles" className="text-sm font-medium">
                      Incluir cargos similares
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Expande los cargos seleccionados a variantes parecidas. Desactivado trae
                      resultados más precisos (recomendado). Activar sólo si faltan resultados.
                    </p>
                  </div>
                  <Switch
                    id="similar-titles"
                    checked={includeSimilarTitles}
                    onCheckedChange={setIncludeSimilarTitles}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Resumen + Boton de busqueda */}
          <div className="pt-3 border-t">
            {selectedJobTitles.length > 0 && (
              <p className="text-xs text-muted-foreground mb-3">
                {selectedJobTitles.length} cargo{selectedJobTitles.length !== 1 ? "s" : ""} seleccionado{selectedJobTitles.length !== 1 ? "s" : ""}
                {prospectCountry && (
                  <> en <span className="font-medium">{APOLLO_COUNTRIES.find(c => c.value === prospectCountry)?.label || prospectCountry}</span></>
                )}
              </p>
            )}
            <Button
              onClick={handleSearch}
              disabled={isSearching || selectedJobTitles.length === 0}
              className="w-full"
              size="lg"
            >
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Buscar en Apollo
              {selectedJobTitles.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {selectedJobTitles.length} cargo{selectedJobTitles.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error de la última búsqueda */}
      {lastSearchError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No se pudo completar la búsqueda</AlertTitle>
          <AlertDescription>{lastSearchError}</AlertDescription>
        </Alert>
      )}

      {/* Stats de la última búsqueda */}
      {lastSearchStats && (
        <Card className="border-muted">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              Resultado de la búsqueda
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Warnings de la organización */}
            {lastSearchStats.warnings.length > 0 && (
              <div className="space-y-1.5">
                {lastSearchStats.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                    <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <span>{w}</span>
                  </p>
                ))}
              </div>
            )}

            {/* Titles rechazados */}
            {lastSearchStats.rejectedTitles.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50/50 p-2 dark:border-amber-900 dark:bg-amber-950/20">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1">
                  {lastSearchStats.rejectedTitles.length} cargo
                  {lastSearchStats.rejectedTitles.length !== 1 ? "s" : ""} rechazado
                  {lastSearchStats.rejectedTitles.length !== 1 ? "s" : ""}:
                </p>
                <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-0.5">
                  {lastSearchStats.rejectedTitles.slice(0, 5).map((r, i) => (
                    <li key={i}>
                      &quot;{r.input}&quot;: {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Métricas en grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
              <div className="rounded-md border p-2">
                <p className="text-xl font-semibold">{lastSearchStats.totalEntries}</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  En Apollo
                </p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-xl font-semibold">{lastSearchStats.apiReturned}</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Traídos</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-xl font-semibold">{lastSearchStats.enrichedOk}</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Enriquecidos
                </p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-xl font-semibold">{lastSearchStats.saved}</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Guardados</p>
              </div>
            </div>

            {/* Mensajes contextuales */}
            {lastSearchStats.fromCache && (
              <p className="text-xs text-muted-foreground">
                Resultados servidos desde cache. Activá &quot;Forzar refresh&quot; en opciones avanzadas
                para traer datos frescos.
              </p>
            )}
            {lastSearchStats.apolloCalled && lastSearchStats.totalEntries === 0 && (
              <p className="text-xs text-muted-foreground">
                Apollo no encontró contactos con estos filtros. Probá relajar el país, ampliar cargos o
                activar &quot;Filtrar por país de la empresa&quot; en opciones avanzadas.
              </p>
            )}
            {lastSearchStats.apolloCalled &&
              lastSearchStats.apiReturned > 0 &&
              lastSearchStats.saved === 0 && (
                <p className="text-xs text-muted-foreground">
                  Todos los contactos ya estaban en tu lista ({lastSearchStats.skippedDuplicates}{" "}
                  duplicados).
                </p>
              )}
            {lastSearchStats.enrichedFailed > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {lastSearchStats.enrichedFailed} contacto
                {lastSearchStats.enrichedFailed !== 1 ? "s" : ""} no se pudo enriquecer (Apollo 429/5xx).
              </p>
            )}
            {/* Preview del payload */}
            {lastSearchStats.requestPreview && (
              <div className="pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowDebugPayload((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Code className="h-3 w-3" />
                  {showDebugPayload ? "Ocultar" : "Ver"} query enviada a Apollo
                </button>
                {showDebugPayload && (
                  <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed">
                    {JSON.stringify(lastSearchStats.requestPreview, null, 2)}
                  </pre>
                )}
                <p className="mt-1.5 text-[10px] text-muted-foreground font-mono">
                  query_hash: {lastSearchStats.queryHash}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Lista de prospectos — skeleton granular: solo esta sección espera la data */}
      {isLoading ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 space-y-3 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Cargando prospectos...</p>
          </CardContent>
        </Card>
      ) : prospects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 space-y-4 text-center">
            <div className="bg-muted p-3 rounded-full">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-medium">No hay prospectos encontrados</h3>
              <p className="text-sm text-muted-foreground max-w-sm mt-1">
                Usa la búsqueda de Apollo.io para encontrar tomadores de decisión relevantes para esta cuenta.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {prospects.length} prospecto{prospects.length !== 1 ? "s" : ""} encontrado
              {prospects.length !== 1 ? "s" : ""}
            </h3>

            {/* Barra de selección y exportación */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={isAllSelected ? deselectAll : selectAll}
                className="h-8 gap-1.5 text-xs"
              >
                {isAllSelected ? (
                  <>
                    <CheckSquare className="h-3.5 w-3.5" />
                    Deseleccionar todos
                  </>
                ) : (
                  <>
                    <Square className="h-3.5 w-3.5" />
                    Seleccionar todos
                  </>
                )}
              </Button>

              {selectedIds.size > 0 && (
                <>
                  <span className="text-xs text-muted-foreground px-2 border-l">
                    {selectedIds.size} seleccionado{selectedIds.size !== 1 ? "s" : ""}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportCSV}
                    disabled={isExporting}
                    className="h-8 gap-1.5 text-xs"
                  >
                    {isExporting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportExcel}
                    disabled={isExporting}
                    className="h-8 gap-1.5 text-xs"
                  >
                    {isExporting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                    )}
                    Excel
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <TooltipProvider>
              {prospects.map((prospect) => (
                <Card 
                  key={prospect.id} 
                  className={`group hover:border-primary/50 transition-colors ${
                    selectedIds.has(prospect.id) ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Checkbox de selección */}
                      <Checkbox
                        checked={selectedIds.has(prospect.id)}
                        onCheckedChange={() => toggleSelect(prospect.id)}
                        className="mt-1 flex-shrink-0"
                      />

                      {/* Avatar — loading=lazy evita que el proxy se sature con
                          requests paralelos cuando hay muchas tarjetas.
                          decoding=async libera el hilo principal mientras decodifica. */}
                      <Avatar className="h-12 w-12 flex-shrink-0">
                        <AvatarImage
                          src={proxyImageUrl(prospect.profile_picture_url)}
                          loading="lazy"
                          decoding="async"
                        />
                        <AvatarFallback>
                          {prospect.first_name?.[0]}
                          {prospect.last_name?.[0]}
                        </AvatarFallback>
                      </Avatar>

                      {/* Info principal */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium truncate">{prospect.full_name}</h4>
                          <Badge variant="secondary" className="text-[10px] px-1.5 flex-shrink-0">
                            DM
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{prospect.role}</p>
                        {prospect.headline && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{prospect.headline}</p>
                        )}

                        {/* Ubicación */}
                        {(prospect.city || prospect.country) && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {[prospect.city, prospect.country].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveProspect(prospect.id)}
                            disabled={removingId === prospect.id}
                          >
                            {removingId === prospect.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Quitar del brief</TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Acciones */}
                    <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t">
                      {/* LinkedIn */}
                      {prospect.linkedin_url && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-transparent" asChild>
                              <Link href={prospect.linkedin_url} target="_blank">
                                <Linkedin className="h-3.5 w-3.5 text-[#0077b5]" />
                                LinkedIn
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Ver perfil de LinkedIn</TooltipContent>
                        </Tooltip>
                      )}

                      {/* Email — visible con estado de verificacion y click para copiar.
                         Apollo devuelve el email priorizando corporativo (work_email);
                         email_status posibles: "verified" | "extrapolated" | otros. */}
                      {prospect.email && (() => {
                        const isVerified = prospect.email_status === "verified"
                        const isExtrapolated =
                          prospect.email_status === "extrapolated" ||
                          prospect.email_status === "guessed"
                        const isCopied = copiedId === `email-${prospect.id}`
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() =>
                                  copyToClipboard(prospect.email!, `email-${prospect.id}`)
                                }
                                className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm transition-colors hover:bg-muted"
                                aria-label={`Copiar email ${prospect.email}`}
                              >
                                <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="max-w-[240px] truncate font-mono text-xs">
                                  {prospect.email}
                                </span>
                                {isVerified && (
                                  <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                                    <CheckCircle2 className="h-2.5 w-2.5" />
                                    Verificado
                                  </span>
                                )}
                                {isExtrapolated && (
                                  <span className="inline-flex items-center gap-1 rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                    <AlertCircle className="h-2.5 w-2.5" />
                                    Estimado
                                  </span>
                                )}
                                {isCopied ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="font-mono text-xs">{prospect.email}</p>
                              <p className="text-xs text-muted-foreground">
                                {isVerified
                                  ? "Email corporativo verificado por Apollo"
                                  : isExtrapolated
                                    ? "Email extrapolado (no verificado) — usar con precaucion"
                                    : "Click para copiar"}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        )
                      })()}

                      {/* Telefono: 4 estados.
                          - received + dato: boton para copiar.
                          - pending: spinner + "Buscando..."
                          - not_available: gris + boton "Reintentar" (sujeto a cooldown 7d).
                          - not_requested / null: CTA "Revelar telefono - 5 creditos" */}
                      {(() => {
                        const phoneStatus = prospect.phone_status ?? "not_requested"
                        const phoneVal = prospect.mobile_phone || prospect.phone || ""
                        const isLoading = revealingId === prospect.id

                        if (phoneStatus === "received" && phoneVal) {
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-1.5 bg-transparent"
                                  onClick={() =>
                                    copyToClipboard(phoneVal, `phone-${prospect.id}`)
                                  }
                                >
                                  {copiedId === `phone-${prospect.id}` ? (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                  ) : (
                                    <Phone className="h-3.5 w-3.5" />
                                  )}
                                  Tel
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{phoneVal}</p>
                                <p className="text-xs text-muted-foreground">
                                  Click para copiar
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          )
                        }

                        if (phoneStatus === "pending" || isLoading) {
                          return (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 bg-transparent"
                              disabled
                            >
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Buscando...
                            </Button>
                          )
                        }

                        if (phoneStatus === "not_available") {
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 gap-1.5 bg-transparent text-muted-foreground"
                                  onClick={() => handleRevealPhone(prospect)}
                                  disabled={!!revealingId}
                                >
                                  <Phone className="h-3.5 w-3.5" />
                                  Reintentar
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Apollo no encontro telefono en el ultimo intento.</p>
                                <p className="text-xs text-muted-foreground">
                                  Reintento sujeto a cooldown de 7 dias. Costo: 5 creditos.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          )
                        }

                        // not_requested o null
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5 bg-transparent"
                                onClick={() => handleRevealPhone(prospect)}
                                disabled={!!revealingId}
                              >
                                <Phone className="h-3.5 w-3.5" />
                                Revelar telefono
                                <span className="ml-1 text-xs text-muted-foreground">
                                  5 cred.
                                </span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Pide a Apollo el telefono de este contacto.</p>
                              <p className="text-xs text-muted-foreground">
                                Costo: 5 creditos. Cooldown: 7 dias.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        )
                      })()}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TooltipProvider>
          </div>
        </div>
      )}

      {removedProspects.length > 0 && (
        <div className="border-t pt-4">
          <button
            onClick={() => setShowRemoved(!showRemoved)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {showRemoved ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            <span>
              {removedProspects.length} prospecto{removedProspects.length !== 1 ? "s" : ""} eliminado
              {removedProspects.length !== 1 ? "s" : ""}
            </span>
          </button>

          {showRemoved && (
            <div className="mt-4 space-y-2">
              <TooltipProvider>
                {removedProspects.map((prospect) => (
                  <div
                    key={prospect.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg opacity-60"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={proxyImageUrl(prospect.profile_picture_url)} />
                        <AvatarFallback className="text-xs">
                          {prospect.first_name?.[0]}
                          {prospect.last_name?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{prospect.full_name}</p>
                        <p className="text-xs text-muted-foreground">{prospect.role}</p>
                      </div>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5"
                          onClick={() => handleRestoreProspect(prospect.id)}
                          disabled={restoringId === prospect.id}
                        >
                          {restoringId === prospect.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Restaurar
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Volver a incluir en el brief</TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </TooltipProvider>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
