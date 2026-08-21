"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ExternalLink, Linkedin, Loader2, Mail, Phone, Star, TrendingDown } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import type { AccountReport } from "@/lib/v3/services/account-report"
import { STATUS_EMOJI, STATUS_LABEL, type AccountStatus } from "@/lib/v3/services/account-report-rules"
import type { ChannelKind } from "@/lib/v3/services/personnel-movements-rules"

// ═══════════════════════════════════════════════════════════
// Fase 9 · La radiografía comercial en pantalla (diseño H).
//
// Es un INFORME, no un tablero: se lee de arriba a abajo en el mismo orden que
// el documento que se entrega a los clientes, con índice para saltar.
// ═══════════════════════════════════════════════════════════

export const REPORT_SECTIONS = [
  { id: "resumen", label: "Resumen ejecutivo" },
  { id: "scorecard", label: "Scorecard de señales" },
  { id: "personas", label: "Movimientos de personal" },
  { id: "vacantes", label: "Búsquedas laborales" },
  { id: "noticias", label: "Radar de noticias" },
  { id: "angulos", label: "Ángulos de entrada" },
  { id: "riesgos", label: "Riesgos" },
  { id: "decisores", label: "Decisores" },
  { id: "metodo", label: "Método y limitaciones" },
] as const

const STATUS_STYLE: Record<AccountStatus, string> = {
  abordar: "border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400",
  seguir_de_cerca: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  sin_senal: "border-muted-foreground/30 bg-muted text-muted-foreground",
}

function fecha(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })
}

function relativo(iso: string | null): string {
  if (!iso) return "nunca"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "nunca"
  return formatDistanceToNow(d, { addSuffix: true, locale: es })
}

/**
 * Fechas de refresco de la cuenta.
 *
 * Reemplaza al CTA "Investigar", que le pedía al usuario una acción para algo
 * que el sistema ya hace solo: al marcar el bookmark se buscan vacantes y
 * noticias, y el cron las refresca al mes. Lo único que el usuario necesita
 * saber es cuán fresco es lo que está leyendo y cuándo se renueva.
 */
export function DataFreshness({ method }: { method: AccountReport["method"] }) {
  const corridas = [
    { at: method.jobsLastScrapedAt, cada: method.jobsRefreshDays },
    { at: method.newsLastScrapedAt, cada: method.newsRefreshDays },
  ].filter((c): c is { at: string; cada: number } => !!c.at && !Number.isNaN(new Date(c.at).getTime()))

  // Todavía no corrió ninguna fuente: el kick del alta o el cron la levantan.
  if (corridas.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Datos en preparación: se buscan solos al seguir la cuenta.
      </p>
    )
  }

  // La más reciente manda para "actualizado"; para "próxima" manda la que
  // vence ANTES, que es cuando el informe efectivamente cambia.
  const ultima = Math.max(...corridas.map((c) => new Date(c.at).getTime()))
  const proxima = Math.min(
    ...corridas.map((c) => new Date(c.at).getTime() + c.cada * 24 * 60 * 60 * 1000),
  )
  // Si alguna fuente nunca corrió, su refresco está pendiente ya mismo.
  const faltaAlguna = corridas.length < 2
  const proximaIso = new Date(proxima).toISOString()

  return (
    <p className="text-xs text-muted-foreground">
      Actualizado {relativo(new Date(ultima).toISOString())} ({fecha(new Date(ultima).toISOString())})
      {" · "}
      {faltaAlguna || proxima <= Date.now()
        ? "próxima actualización: en las próximas horas"
        : `próxima actualización: ${fecha(proximaIso)}`}
    </p>
  )
}

const CHANNEL_STYLE: Record<ChannelKind, string> = {
  // El corporativo es el canal legítimo de una primera aproximación comercial:
  // se resalta. El personal es el respaldo y se muestra apagado, para que la
  // diferencia se vea antes de hacer clic.
  corporativo: "border-primary/40 bg-primary/10 text-foreground",
  personal: "border-muted-foreground/25 bg-muted text-muted-foreground",
}

/** Canal de contacto de una persona, rotulado como corporativo o personal. */
function ContactChip({
  href,
  icon,
  label,
  kind,
  ariaLabel,
}: {
  href: string
  icon: React.ReactNode
  label: string
  kind: ChannelKind | null
  ariaLabel: string
}) {
  const estilo = CHANNEL_STYLE[kind ?? "personal"]
  return (
    <a
      href={href}
      aria-label={ariaLabel}
      title={label}
      className={`inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] hover:brightness-110 ${estilo}`}
    >
      {icon}
      <span className="truncate">{label}</span>
      <span className="shrink-0 font-semibold uppercase tracking-wide opacity-70">
        {kind === "corporativo" ? "corp" : "pers"}
      </span>
    </a>
  )
}

/** Chip de estado para el encabezado de la cuenta. */
export function StatusBadge({ status }: { status: AccountStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}>
      <span aria-hidden>{STATUS_EMOJI[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  )
}

function Section({
  id,
  title,
  count,
  children,
}: {
  id: string
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    // scroll-mt deja aire para el encabezado sticky al saltar desde el índice.
    <section id={id} className="scroll-mt-24">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {title}
            {typeof count === "number" && <Badge variant="secondary">{count}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  )
}

/** Cada cuánto se re-consulta mientras hay una búsqueda de noticias en vuelo. */
const POLL_MS = 8000
/**
 * Techo de espera: ~8 minutos. Son dos bundles en paralelo (~1-2 min) más el
 * chequeo de links vivos; el margen cubre una corrida lenta sin llegar a los 15
 * minutos que el runner usa para dar un scrape por colgado. Pasado esto, el
 * cartel lo dice en vez de girar para siempre.
 */
const MAX_POLLS = 60

/**
 * Vacantes con señal que se muestran sin desplegar. Con más que esto la sección
 * se come el informe y lo que viene abajo (noticias, ángulos, riesgos) queda
 * fuera de pantalla.
 */
const MAX_SIGNAL_JOBS = 5

export function AccountReportView({
  report,
  decisionMakersSlot,
}: {
  report: AccountReport
  /**
   * La sección de decisores. Viaja como slot porque necesita datos que NO son
   * del informe (los cargos sugeridos salen de las señales fit y los contactos
   * de Apollo), y meterlos en `AccountReport` mezclaría dos cosas que se
   * refrescan distinto.
   */
  decisionMakersSlot?: React.ReactNode
}) {
  const router = useRouter()
  const [showOtherJobs, setShowOtherJobs] = useState(false)
  const [showAllSignalJobs, setShowAllSignalJobs] = useState(false)
  const [showNoise, setShowNoise] = useState(false)
  const [polls, setPolls] = useState(0)
  const [prevBuscando, setPrevBuscando] = useState(false)

  const vacantesVisibles = showAllSignalJobs
    ? report.jobs.withSignal
    : report.jobs.withSignal.slice(0, MAX_SIGNAL_JOBS)
  const vacantesOcultas = report.jobs.withSignal.length - MAX_SIGNAL_JOBS

  // Buscando AHORA: se muestra spinner y se refresca solo.
  const buscandoNoticias = report.newsScrapeStatus === "pending" || report.newsScrapeStatus === "running"
  // En cola: la levanta el cron, que corre cada 30 min. Acá NO se poletea —
  // 8 minutos de polling terminarían mostrando "está demorando" para algo que
  // simplemente todavía no le tocó el turno.
  const enColaNoticias = report.newsScrapeStatus === "queued"

  // Las noticias entran por un scrape que corre en background (~30-60 s), así
  // que el informe se refresca solo: sin esto el usuario veía "sin noticias" y
  // tenía que recargar a mano para enterarse de que sí había.
  useEffect(() => {
    if (!buscandoNoticias || polls >= MAX_POLLS) return
    const timer = setTimeout(() => {
      setPolls((n) => n + 1)
      router.refresh()
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [buscandoNoticias, polls, router])

  // Al llegar las noticias el estado pasa a "idle": se reinicia el contador
  // para que un refresh posterior (otra cuenta, otro ciclo) vuelva a esperar.
  //
  // Se ajusta DURANTE el render comparando con el valor anterior, que es el
  // patrón que React documenta para "estado derivado de props". Hacerlo en un
  // efecto provoca un render extra con el contador viejo.
  if (prevBuscando !== buscandoNoticias) {
    setPrevBuscando(buscandoNoticias)
    if (!buscandoNoticias) setPolls(0)
  }

  const noticiasRelevantes = report.news.items.filter((n) => n.relevanceType !== "ruido")
  const noticiasRuido = report.news.items.filter((n) => n.relevanceType === "ruido")

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      {/* Índice: sticky en desktop, chips scrolleables en mobile */}
      <nav className="lg:sticky lg:top-20 lg:h-fit lg:w-48 lg:shrink-0" aria-label="Secciones del informe">
        <div className="flex gap-1.5 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
          {REPORT_SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="shrink-0 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:text-sm"
            >
              {s.label}
            </a>
          ))}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {/* 1. Resumen ejecutivo */}
        <Section id="resumen" title="Resumen ejecutivo">
          <div className={`mb-3 rounded-md border px-3 py-2 text-sm ${STATUS_STYLE[report.status.status]}`}>
            {report.status.loweredByContraction && <TrendingDown className="mr-1.5 inline size-4" />}
            {report.status.reason}
          </div>
          {report.summaryPoints.length === 0 ? (
            <p className="text-sm text-muted-foreground text-pretty">
              Todavía no hay datos suficientes para el resumen. Se arma solo cuando entren vacantes o noticias.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {report.summaryPoints.map((punto) => (
                <li key={punto} className="flex gap-2 text-sm text-pretty">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  {punto}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 2. Scorecard de señales */}
        <Section id="scorecard" title="Scorecard de señales">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Fuente de señal</th>
                  <th className="pb-2 pr-3 text-right font-medium">Vol.</th>
                  <th className="pb-2 font-medium">Lectura</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.scorecard.map((row) => (
                  <tr key={row.source}>
                    <td className="py-2 pr-3 align-top">{row.source}</td>
                    <td className="py-2 pr-3 text-right align-top tabular-nums font-semibold">{row.volume}</td>
                    <td className="py-2 align-top text-muted-foreground text-pretty">{row.reading}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* 3. Movimientos de personal */}
        <Section
          id="personas"
          title={`Movimientos de personal (${report.method.movementsWindowMonths} meses)`}
          count={report.movements.counts.total}
        >
          {report.movements.movements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-pretty">
              Sin ingresos ni rotaciones registradas en la ventana.
            </p>
          ) : (
            <ul className="divide-y">
              {report.movements.movements.map((m) => (
                <li key={m.contactId} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{m.fullName}</span>
                      <Badge variant={m.type === "ingreso_nuevo" ? "secondary" : "outline"} className="text-[10px]">
                        {m.type === "ingreso_nuevo" ? "Ingreso nuevo" : "Rotación interna"}
                      </Badge>
                      {m.focus === "decisor" && <Badge className="text-[10px]">Decisor</Badge>}
                      {m.focus === "perfil_objetivo" && (
                        <Badge variant="secondary" className="text-[10px]">Perfil objetivo</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {m.title ?? "Sin cargo"} · desde {fecha(m.startedOn)}
                      {m.matchedTerms.length > 0 && ` · ${m.matchedTerms.join(", ")}`}
                    </span>
                  </div>
                  {/* Canales de contacto. El corporativo va primero (lo decide
                      pickEmail/pickPhone) y cada uno dice CUÁL es: escribirle al
                      mail particular sin saberlo es un problema distinto que
                      escribirle al de la empresa. */}
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {m.email && (
                      <ContactChip
                        href={`mailto:${m.email}`}
                        icon={<Mail className="size-3.5" />}
                        label={m.email}
                        kind={m.emailKind}
                        ariaLabel={`Enviar email a ${m.fullName}`}
                      />
                    )}
                    {m.phone && (
                      <ContactChip
                        href={`tel:${m.phone.replace(/[^\d+]/g, "")}`}
                        icon={<Phone className="size-3.5" />}
                        label={m.phone}
                        kind={m.phoneKind}
                        ariaLabel={`Llamar a ${m.fullName}`}
                      />
                    )}
                    {m.linkedinUrl && (
                      <a
                        href={m.linkedinUrl.startsWith("http") ? m.linkedinUrl : `https://${m.linkedinUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={`Ver LinkedIn de ${m.fullName}`}
                      >
                        <Linkedin className="size-4" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 4. Búsquedas laborales: con señal primero, resto colapsado */}
        <Section id="vacantes" title="Búsquedas laborales activas" count={report.jobs.total}>
          {!report.hasVendorProfile && (
            <p className="mb-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-pretty">
              Sin propuesta de valor cargada no se puede separar qué avisos tienen señal para vos.
            </p>
          )}
          {report.jobs.withSignal.length === 0 ? (
            <p className="text-sm text-muted-foreground text-pretty">
              {report.jobs.total === 0
                ? "Sin avisos en el scrape del período."
                : `${report.jobs.total} avisos activos, ninguno menciona lo que vendés.`}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {vacantesVisibles.map(({ posting, matchedTerms, snippet }) => (
                <li key={posting.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {posting.url ? (
                      <a
                        href={posting.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                      >
                        {posting.title}
                        <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                      </a>
                    ) : (
                      <span className="text-sm font-medium">{posting.title}</span>
                    )}
                    {matchedTerms.slice(0, 3).map((t) => (
                      <Badge key={t} className="text-[10px]">{t}</Badge>
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {[posting.location, posting.experienceLevel, fecha(posting.postedAt)].filter(Boolean).join(" · ")}
                  </span>
                  {snippet && (
                    // El fragmento del aviso: es lo que convierte "tiene señal"
                    // en "mirá dónde lo dice".
                    <p className="mt-2 border-l-2 border-primary/40 bg-muted/40 py-1.5 pl-3 text-xs italic text-muted-foreground text-pretty">
                      …{snippet}…
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Con muchas vacantes con señal el informe se vuelve un listado y se
              pierde todo lo que viene después. Se muestran las primeras y el
              resto queda a un clic. */}
          {vacantesOcultas > 0 && (
            <button
              type="button"
              onClick={() => setShowAllSignalJobs((v) => !v)}
              className="mt-3 text-xs font-medium text-primary hover:underline"
              aria-expanded={showAllSignalJobs}
            >
              {showAllSignalJobs
                ? `Ver solo las primeras ${MAX_SIGNAL_JOBS}`
                : `Ver ${vacantesOcultas} vacante${vacantesOcultas === 1 ? "" : "s"} más con señal`}
            </button>
          )}

          {report.jobs.others.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowOtherJobs((v) => !v)}
                className="text-xs font-medium text-primary hover:underline"
                aria-expanded={showOtherJobs}
              >
                {showOtherJobs
                  ? "Ocultar el resto"
                  : `Ver las otras ${report.jobs.others.length} vacantes sin señal`}
              </button>
              {showOtherJobs && (
                <ul className="mt-2 max-h-72 divide-y overflow-y-auto rounded-md border">
                  {report.jobs.others.map((p) => (
                    <li key={p.id} className="px-3 py-2 text-sm">
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {p.title}
                        </a>
                      ) : (
                        p.title
                      )}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {[p.location, fecha(p.postedAt)].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>

        {/* 5. Radar de noticias */}
        <Section
          id="noticias"
          title={`Radar de noticias (${report.method.newsWindowMonths} meses)`}
          count={noticiasRelevantes.length}
        >
          {/* Búsqueda en vuelo: se avisa en vez de mostrar un vacío que parece
              un error. El informe se actualiza solo cuando llegan. */}
          {buscandoNoticias && polls < MAX_POLLS && (
            <div className="mb-3 flex items-center gap-2.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
              <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
              <p className="text-pretty">
                Buscando noticias de los últimos {report.method.newsWindowMonths} meses… suele tardar entre 1 y 2
                minutos. Aparecen acá solas, no hace falta recargar.
              </p>
            </div>
          )}
          {buscandoNoticias && polls >= MAX_POLLS && (
            <div className="mb-3 rounded-md border px-3 py-2.5 text-sm text-muted-foreground text-pretty">
              La búsqueda está demorando más de lo normal. Recargá la página en unos minutos; si sigue igual, la
              corrida quedó registrada y se reintenta sola.
            </div>
          )}
          {/* Turno pendiente, no búsqueda en vuelo: no gira nada porque no hay
              nada corriendo todavía. */}
          {enColaNoticias && (
            <div className="mb-3 rounded-md border px-3 py-2.5 text-sm text-muted-foreground text-pretty">
              Esta cuenta todavía no tiene una búsqueda de noticias hecha. Está en cola: el refresco la levanta en su
              próxima corrida, dentro de la hora, y aparecen acá solas.
            </div>
          )}

          {noticiasRelevantes.length === 0 ? (
            !buscandoNoticias &&
            !enColaNoticias && (
              <p className="text-sm text-muted-foreground text-pretty">
                Sin noticias con relevancia en la ventana.
              </p>
            )
          ) : (
            <ul className="flex flex-col gap-3">
              {noticiasRelevantes.map((n) => (
                <li key={n.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {n.relevanceType === "propuesta" ? (
                      <Badge className="gap-1 text-[10px]">
                        <Star className="size-3" />
                        Para tu propuesta
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Contexto de negocio</Badge>
                    )}
                    {n.direction === "contraccion" && (
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <TrendingDown className="size-3" />
                        Contracción
                      </Badge>
                    )}
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">{n.eventType}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-pretty">{n.title}</p>
                  {n.whyItMatters && (
                    <p className="mt-1 text-sm text-muted-foreground text-pretty">
                      <span className="font-medium text-foreground">Por qué te importa:</span> {n.whyItMatters}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{n.sourceName ?? "Fuente"} · {fecha(n.publishedAt)}</span>
                    {n.sourceUrl && (
                      <a
                        href={n.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        ver fuente
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                    {n.matchedTerms.length > 0 && <span>· {n.matchedTerms.join(", ")}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {noticiasRuido.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowNoise((v) => !v)}
                className="text-xs font-medium text-primary hover:underline"
                aria-expanded={showNoise}
              >
                {showNoise ? "Ocultar" : `${noticiasRuido.length} noticias sin relevancia para tu propuesta`}
              </button>
              {showNoise && (
                <ul className="mt-2 divide-y rounded-md border">
                  {noticiasRuido.map((n) => (
                    <li key={n.id} className="px-3 py-2 text-sm">
                      {n.sourceUrl ? (
                        <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {n.title}
                        </a>
                      ) : (
                        n.title
                      )}
                      <span className="ml-2 text-xs text-muted-foreground">{fecha(n.publishedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Nota de cobertura: la diferencia entre "no hay nada" y "no buscamos" */}
          {report.news.uncovered.length > 0 && (
            <p className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground text-pretty">
              <span className="font-medium text-foreground">Nota de cobertura:</span> sin evidencia pública en la
              ventana sobre {report.news.uncovered.slice(0, 6).join(", ")}
              {report.news.uncovered.length > 6 && ` y ${report.news.uncovered.length - 6} términos más`}.
            </p>
          )}
        </Section>

        {/* 6. Ángulos de entrada */}
        <Section id="angulos" title="Ángulos de entrada comercial">
          {report.entryAngles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-pretty">
              Sin ángulos derivables de la evidencia actual.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {report.entryAngles.map((a) => (
                <li key={a} className="flex gap-2 text-sm text-pretty">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  {a}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 7. Riesgos */}
        <Section id="riesgos" title="Riesgos a mitigar antes de abordar">
          {report.risks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-pretty">Sin riesgos identificados en la evidencia.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {report.risks.map((r) => (
                <li key={r} className="flex gap-2 text-sm text-pretty">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                  {r}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* La única acción del informe: a quién llamarle. */}
        {decisionMakersSlot}

        {/* 8. Método y limitaciones — sin IA, todo metadatos reales */}
        <Section id="metodo" title="Método y limitaciones">
          <ul className="flex flex-col gap-2 text-xs text-muted-foreground">
            <li className="text-pretty">
              <span className="font-medium text-foreground">Vacantes:</span> scrape de LinkedIn Jobs vía Apify,
              última corrida {relativo(report.method.jobsLastScrapedAt)}
              {report.method.jobsLastScrapedAt && ` (${fecha(report.method.jobsLastScrapedAt)})`}. Se refresca cada{" "}
              {report.method.jobsRefreshDays} días. Es una foto del período, no un histórico.
            </li>
            <li className="text-pretty">
              <span className="font-medium text-foreground">Noticias:</span> búsqueda web sobre fuentes públicas,
              ventana de {report.method.newsWindowMonths} meses, última corrida{" "}
              {relativo(report.method.newsLastScrapedAt)}
              {report.method.newsLastScrapedAt && ` (${fecha(report.method.newsLastScrapedAt)})`}. Se refresca cada{" "}
              {report.method.newsRefreshDays} días. Donde no hubo evidencia se declara explícitamente en vez de
              rellenar.
            </li>
            <li className="text-pretty">
              <span className="font-medium text-foreground">Movimientos de personal:</span> base propia de perfiles,
              filtrada por fecha de ingreso al puesto dentro de los últimos{" "}
              {report.method.movementsWindowMonths} meses. &quot;Rotación interna&quot; significa que la empresa
              anterior del perfil es la misma que la actual; &quot;ingreso nuevo&quot;, que venía de otra empresa o
              no tiene empresa previa registrada.
            </li>
            <li className="text-pretty">
              <span className="font-medium text-foreground">Contacto:</span> los emails se listan solo cuando la base
              los marca con estado válido. Los teléfonos no tienen etiqueta de celular en el origen: hay que
              validarlos antes de llamar.
            </li>
            <li className="text-pretty">
              Este informe se apoya solo en información pública y en la base propia. No reemplaza la verificación en
              la primera conversación con la cuenta.
            </li>
          </ul>
        </Section>
      </div>
    </div>
  )
}
