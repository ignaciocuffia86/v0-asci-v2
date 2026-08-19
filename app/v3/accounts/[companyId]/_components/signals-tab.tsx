"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Briefcase,
  ChevronDown,
  ExternalLink,
  Linkedin,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  Users,
} from "lucide-react"
import {
  searchAccountDecisionMakers,
  refreshAccountJobPostings,
  type AccountSignalsData,
} from "@/app/actions/v3/accounts"
import type { UiJobPosting } from "@/lib/v3/services/job-posting-provider"

/** Resalta los términos matcheados dentro de un título. */
function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>
  const pattern = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean)
    .join("|")
  if (!pattern) return <>{text}</>
  const parts = text.split(new RegExp(`(${pattern})`, "gi"))
  return (
    <>
      {parts.map((part, i) =>
        terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
          <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

const SENIORITY_LABEL: Record<string, string> = {
  c_suite: "C-Level",
  vp: "VP",
  director: "Director",
  head: "Head",
  manager: "Manager",
  owner: "Owner",
  founder: "Founder",
  senior: "Senior",
  entry: "Entry",
}

export function SignalsTab({
  companyId,
  signals,
}: {
  companyId: string
  signals: AccountSignalsData | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirmRole, setConfirmRole] = useState<string | null>(null)
  const [searchingRole, setSearchingRole] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ role: string; message: string; ok: boolean } | null>(null)
  // Transición propia para el refresco de vacantes: si compartiera `isPending`
  // con Apollo, buscar vacantes deshabilitaría también los botones de decisores.
  const [isRefreshingJobs, startJobsTransition] = useTransition()
  const [confirmJobs, setConfirmJobs] = useState(false)
  const [jobsFeedback, setJobsFeedback] = useState<{ message: string; ok: boolean } | null>(null)

  if (!signals) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground text-pretty">
          No se pudieron calcular las señales de esta cuenta. Reintentá más tarde.
        </CardContent>
      </Card>
    )
  }

  const handleSearch = (role: string) => {
    setConfirmRole(null)
    setSearchingRole(role)
    setFeedback(null)
    startTransition(async () => {
      const result = await searchAccountDecisionMakers(companyId, role)
      setSearchingRole(null)
      if (result.success) {
        setFeedback({
          role,
          ok: true,
          message:
            result.found > 0
              ? `${result.found} contacto${result.found === 1 ? "" : "s"} encontrado${result.found === 1 ? "" : "s"} y guardado${result.found === 1 ? "" : "s"}.`
              : "Apollo no encontró personas con ese rol en esta empresa.",
        })
        router.refresh()
      } else {
        setFeedback({ role, ok: false, message: result.error ?? "Error en la búsqueda" })
      }
    })
  }

  const handleRefreshJobs = () => {
    setConfirmJobs(false)
    setJobsFeedback(null)
    startJobsTransition(async () => {
      const result = await refreshAccountJobPostings(companyId)
      if (!result.success) {
        setJobsFeedback({ ok: false, message: result.error ?? "No se pudieron traer las vacantes." })
        return
      }
      // El descarte por pertenencia se informa siempre que ocurra: es normal que
      // sea alto y sin explicarlo el número de vacantes cargadas parece un error.
      const partes = [
        result.queued
          ? `${result.queued} vacante${result.queued === 1 ? "" : "s"} en cola de importación.`
          : "No se encontraron vacantes nuevas de esta empresa.",
        ...(result.warnings ?? []),
      ]
      setJobsFeedback({ ok: true, message: partes.join(" ") })
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {!signals.hasVendorProfile && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <Sparkles className="size-4 shrink-0 text-primary" />
          <p className="text-pretty">
            Tu workspace no tiene documentos de propuesta de valor procesados. Las señales se
            calculan solo con el diccionario global; subí documentos en Ajustes para un fit
            personalizado.
          </p>
        </div>
      )}

      {/* Señales fit */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="size-4" />
            Señales fit con tu propuesta
            <Badge variant="secondary">{signals.fitSignals.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {signals.fitSignals.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground text-pretty">
              Ningún hallazgo de esta cuenta matchea tu propuesta de valor o el diccionario.
            </p>
          ) : (
            signals.fitSignals.map((s) => (
              <div key={s.id} className="flex flex-col gap-1.5 rounded-md border p-3">
                <p className="text-sm font-medium text-pretty">
                  <HighlightedText text={s.title} terms={s.matchedTerms} />
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {s.matchedTerms.slice(0, 4).map((term) => (
                    <Badge key={term} variant="secondary" className="text-xs">
                      {term}
                    </Badge>
                  ))}
                  <span className="text-xs text-muted-foreground">
                    {s.matchSource.includes("vendor-profile")
                      ? "· matchea tu propuesta de valor"
                      : "· matchea el diccionario"}
                    {s.sourceDate &&
                      ` · ${new Date(s.sourceDate).toLocaleDateString("es", { month: "short", year: "numeric" })}`}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Vacantes de LinkedIn: el cache global de la cuenta + refresh on-demand.
          Se listan las vacantes CRUDAS a propósito: es el feedback inmediato de
          que el scraping funcionó, independiente de que el research (que llena
          las señales fit de arriba) haya corrido. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Briefcase className="size-4" />
            Vacantes de LinkedIn
            <Badge variant="secondary">{signals.jobPostingsTotal}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-prose text-xs text-muted-foreground text-pretty">
              Vacantes publicadas por esta empresa, según el último scraping. Refrescar consume
              créditos, así que se permite una vez cada 12 horas; tarda hasta un minuto y las
              señales fit de arriba se recalculan cuando corre el research de la cuenta.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={isRefreshingJobs}
              onClick={() => setConfirmJobs(true)}
              className="shrink-0"
            >
              {isRefreshingJobs ? (
                <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              {isRefreshingJobs ? "Buscando vacantes…" : "Refrescar vacantes"}
            </Button>
          </div>
          {jobsFeedback && (
            <p
              className={`text-xs ${jobsFeedback.ok ? "text-green-600" : "text-red-600"} text-pretty`}
              role="status"
            >
              {jobsFeedback.message}
            </p>
          )}
          <JobPostingsList postings={signals.jobPostings} total={signals.jobPostingsTotal} />
        </CardContent>
      </Card>

      {/* Personas relacionadas a las señales */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" />
            Personas vinculadas a las señales
            <Badge variant="secondary">{signals.relatedContacts.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {signals.relatedContacts.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground text-pretty">
              No hay contactos en cache vinculados a estas señales. Usá las búsquedas recomendadas
              de abajo para encontrar decisores.
            </p>
          ) : (
            signals.relatedContacts.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{c.fullName}</span>
                    {c.seniority && (
                      <Badge variant="outline" className="text-xs">
                        {SENIORITY_LABEL[c.seniority.toLowerCase()] ?? c.seniority}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {c.title ?? "Sin título"}
                    {c.country ? ` · ${c.country}` : ""}
                  </span>
                  {c.relatedTerms.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Vinculado a: {c.relatedTerms.join(", ")}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {c.email && (
                    <a
                      href={`mailto:${c.email}`}
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`Enviar email a ${c.fullName}`}
                    >
                      <Mail className="size-4" />
                    </a>
                  )}
                  {c.linkedinUrl && (
                    <a
                      href={c.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`Ver LinkedIn de ${c.fullName}`}
                    >
                      <Linkedin className="size-4" />
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Decisores recomendados a buscar */}
      {signals.recommendedRoles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="size-4" />
              Decisores recomendados
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground text-pretty">
              Roles que suelen decidir sobre las señales detectadas. Los que no están en tu cache
              podés buscarlos en Apollo (consume créditos, 1 búsqueda por rol por día).
            </p>
            {signals.recommendedRoles.map((r) => (
              <div key={r.role} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{r.role}</span>
                    {r.inCache && (
                      <Badge variant="secondary" className="text-xs">
                        Ya en cache
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">Por señal: {r.reason}</span>
                  {feedback?.role === r.role && (
                    <span className={`text-xs ${feedback.ok ? "text-green-600" : "text-red-600"}`}>
                      {feedback.message}
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending || r.searchedToday}
                  onClick={() => setConfirmRole(r.role)}
                  className="shrink-0"
                >
                  {searchingRole === r.role ? (
                    <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
                  ) : (
                    <Search data-icon="inline-start" />
                  )}
                  {r.searchedToday ? "Buscado hoy" : "Buscar en Apollo"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmJobs} onOpenChange={setConfirmJobs}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refrescar vacantes de LinkedIn</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción scrapea las vacantes publicadas por la empresa y consume créditos. Las
              vacantes entran por el importador de ASCI, así que quedan visibles también en la app
              principal. ¿Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRefreshJobs}>Refrescar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRole !== null} onOpenChange={(open) => !open && setConfirmRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buscar &quot;{confirmRole}&quot; en Apollo</AlertDialogTitle>
            <AlertDialogDescription>
              Esta búsqueda consulta la API de Apollo y puede consumir créditos de tu cuenta. Los
              contactos encontrados se guardan en el cache del equipo. ¿Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRole && handleSearch(confirmRole)}>
              Buscar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════
// Listado de vacantes: búsqueda + orden cronológico + filas expandibles.
//
// Decisiones de diseño (con el archivo real de YPF: 100 vacantes, descripciones
// de 3-6k chars):
//  - La fila compacta muestra TODO lo accionable (título, ubicación, seniority,
//    contrato, área, postulantes, fecha relativa) y la descripción queda detrás
//    de un expand: es lo único que satura.
//  - Búsqueda y orden son client-side sobre lo ya cargado (hasta 100): no hay
//    round-trip por tecla y el server manda un solo payload con extractos.
//  - La lista scrollea dentro de la card para no empujar las secciones de abajo.
// ═══════════════════════════════════════════════════════════

/** Normaliza para búsqueda: minúsculas y sin acentos. */
function searchable(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/** "hace 12 días", o null si la vacante no trae fecha. */
function relativeDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return formatDistanceToNow(date, { addSuffix: true, locale: es })
}

const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function JobPostingsList({ postings, total }: { postings: UiJobPosting[]; total: number }) {
  const [query, setQuery] = useState("")
  const [newestFirst, setNewestFirst] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = searchable(query).trim()
    const base = q
      ? postings.filter((p) =>
          [p.title, p.location, p.area, p.contractType, p.experienceLevel]
            .some((field) => searchable(field).includes(q)),
        )
      : [...postings]
    // Sin fecha van siempre al final: una vacante sin posted_at no puede
    // competir en un orden cronológico.
    return base.sort((a, b) => {
      const ta = a.postedAt ? new Date(a.postedAt).getTime() : Number.NEGATIVE_INFINITY
      const tb = b.postedAt ? new Date(b.postedAt).getTime() : Number.NEGATIVE_INFINITY
      if (ta === tb) return 0
      if (ta === Number.NEGATIVE_INFINITY) return 1
      if (tb === Number.NEGATIVE_INFINITY) return -1
      return newestFirst ? tb - ta : ta - tb
    })
  }, [postings, query, newestFirst])

  if (postings.length === 0) {
    return (
      <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground text-pretty">
        Todavía no hay vacantes cargadas de esta cuenta. Usá «Refrescar vacantes» para traerlas de
        LinkedIn.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por puesto, ubicación o área…"
            className="h-8 pl-8 text-sm"
            aria-label="Buscar vacantes"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          onClick={() => setNewestFirst((v) => !v)}
          aria-label={`Ordenar por fecha, ${newestFirst ? "más antiguas primero" : "más recientes primero"}`}
        >
          {newestFirst ? (
            <ArrowDownWideNarrow className="size-4" data-icon="inline-start" />
          ) : (
            <ArrowUpNarrowWide className="size-4" data-icon="inline-start" />
          )}
          {newestFirst ? "Más recientes" : "Más antiguas"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {query.trim()
          ? `${filtered.length} de ${postings.length} vacantes matchean la búsqueda`
          : total > postings.length
            ? `Mostrando las ${postings.length} más recientes de ${total}`
            : `${postings.length} vacante${postings.length === 1 ? "" : "s"}`}
      </p>

      <ScrollArea className="max-h-96 rounded-md border">
        <ul className="divide-y">
          {filtered.map((job) => {
            const expanded = expandedId === job.id
            const isNew =
              job.postedAt && Date.now() - new Date(job.postedAt).getTime() <= NEW_WINDOW_MS
            const meta = [job.location, job.experienceLevel, job.contractType, job.area, job.applicants]
              .filter(Boolean)
              .join(" · ")
            return (
              <li key={job.id} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {job.url ? (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                        >
                          <span className="min-w-0 break-words">{job.title}</span>
                          <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                        </a>
                      ) : (
                        <span className="text-sm font-medium">{job.title}</span>
                      )}
                      {isNew && (
                        <Badge variant="secondary" className="text-[10px] uppercase">
                          nueva
                        </Badge>
                      )}
                    </div>
                    {meta && <span className="text-xs text-muted-foreground text-pretty">{meta}</span>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {relativeDate(job.postedAt) && (
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {relativeDate(job.postedAt)}
                      </span>
                    )}
                    {job.descriptionExcerpt && (
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : job.id)}
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Ocultar" : "Ver"} descripción de ${job.title}`}
                      >
                        <ChevronDown
                          className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                        />
                      </button>
                    )}
                  </div>
                </div>
                {expanded && job.descriptionExcerpt && (
                  <div className="mt-2 flex flex-col gap-2 rounded-md bg-muted/40 p-3">
                    <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                      {job.descriptionExcerpt}
                    </p>
                    {job.url && (
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        Ver completa en LinkedIn
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                )}
              </li>
            )
          })}
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              Ninguna vacante matchea «{query.trim()}».
            </li>
          )}
        </ul>
      </ScrollArea>
    </div>
  )
}
