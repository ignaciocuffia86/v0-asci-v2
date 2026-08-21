"use client"

import { Suspense, use, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  ArrowLeft,
  Briefcase,
  ChevronDown,
  Cpu,
  ExternalLink,
  Lightbulb,
  Link2,
  MessageSquare,
  Newspaper,
  ShieldCheck,
  Star,
  StarOff,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react"
import {
  followAccountAction,
  toggleDigestSubscription,
  unfollowAccountAction,
  type AccountDetail,
  type AccountSignalsData,
} from "@/app/actions/v3/accounts"
import { setIcebreakerFeedback } from "@/app/actions/v3/icebreakers"
import { ScoreBadge } from "@/components/v3/score-badge"
import { SignalsTab } from "./signals-tab"
import { AccountReportView, DataFreshness, StatusBadge } from "./account-report-view"
import { ReportSkeleton } from "./report-skeleton"
import type { AccountReport } from "@/lib/v3/services/account-report"

const RADAR_CONFIG: Record<string, { label: string; icon: typeof Cpu }> = {
  tech: { label: "Tecnología", icon: Cpu },
  news: { label: "Noticias", icon: Newspaper },
  "jobs-interpretation": { label: "Vacantes", icon: Briefcase },
}

type Finding = AccountDetail["findings"][number]

export function AccountDetailView({
  detail,
  signals,
  reportPromise,
}: {
  detail: AccountDetail
  signals: AccountSignalsData | null
  /**
   * La radiografía, sin resolver. Se consume con `use()` dentro de los
   * `Suspense` de abajo, así el encabezado y el resto de la cuenta se pintan
   * sin esperarla. Por contrato NUNCA rechaza: el error ya se convirtió en
   * null en el server component.
   */
  reportPromise: Promise<AccountReport | null>
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { company, followedAccount, scorecard, brief, previousScore, findings, agentLabels, icebreakers, digests } = detail

  const isFollowed = !!followedAccount

  // Radiografía: hallazgos verificados agrupados por ÁREA (micro-agente).
  // Los inferidos van a la solapa Contexto.
  const { explicitByArea, inferredFindings } = useMemo(() => {
    const explicit = new Map<string, Finding[]>()
    const inferred: Finding[] = []
    for (const f of findings) {
      if (f.evidence_level === "explicit") {
        const areaKey = f.micro_agent ?? f.radar_type
        const list = explicit.get(areaKey) ?? []
        list.push(f)
        explicit.set(areaKey, list)
      } else {
        inferred.push(f)
      }
    }
    // Ordenar áreas por cantidad de hallazgos (las más ricas primero).
    const sorted = new Map(
      [...explicit.entries()].sort((a, b) => b[1].length - a[1].length)
    )
    return { explicitByArea: sorted, inferredFindings: inferred }
  }, [findings])

  const explicitCount = findings.length - inferredFindings.length
  const areaLabel = (key: string) =>
    agentLabels[key] ?? RADAR_CONFIG[key]?.label ?? key.replaceAll("-", " ").replaceAll("_", " ")

  const handleFollowToggle = () => {
    if (!company) return
    startTransition(async () => {
      if (isFollowed) {
        await unfollowAccountAction(company.id)
      } else {
        await followAccountAction(company.id)
      }
      router.refresh()
    })
  }

  const handleDigestToggle = () => {
    if (!followedAccount) return
    startTransition(async () => {
      await toggleDigestSubscription(followedAccount.id, !followedAccount.isSubscribed)
      router.refresh()
    })
  }

  if (!company) return null

  const scoreDelta =
    scorecard?.score !== null && scorecard?.score !== undefined && previousScore !== null
      ? scorecard.score - previousScore
      : null

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" asChild className="w-fit -ml-2">
          <Link href="/v3/accounts">
            <ArrowLeft data-icon="inline-start" />
            Cuentas seguidas
          </Link>
        </Button>

        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
              {/* El semáforo reemplaza al score 0-100 en la vista (Fase 9, H.2):
                  "abordar / seguir de cerca / sin señal" es accionable; un 78
                  sobre 100 no dice qué hacer. El score sigue existiendo para
                  ordenar listados. */}
              {/* El chip llega con el informe. Sin fallback: un esqueleto
                  pegado al título salta más de lo que aporta. */}
              <Suspense fallback={null}>
                <StatusBadgeSlot promise={reportPromise} />
              </Suspense>
              {scoreDelta !== null && scoreDelta !== 0 && (
                <Badge variant={scoreDelta > 0 ? "default" : "secondary"} className="tabular-nums">
                  {scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta} vs. anterior
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {company.website && (
                <a
                  href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  {company.website}
                  <ExternalLink className="size-3" />
                </a>
              )}
              {company.country && <span>· {company.country}</span>}
              {company.industry && <Badge variant="secondary">{company.industry}</Badge>}
            </div>
            {/* Reemplaza al CTA "Investigar": los datos se buscan solos al
                seguir la cuenta y el cron los refresca al mes, así que lo único
                que hace falta decir es cuán fresco es esto. */}
            {isFollowed ? (
              <Suspense
                fallback={<p className="text-xs text-muted-foreground">Cargando estado de los datos…</p>}
              >
                <FreshnessSlot promise={reportPromise} />
              </Suspense>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {isFollowed && (
              <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                <span className="text-sm text-muted-foreground">Digest mensual</span>
                <Switch
                  checked={followedAccount.isSubscribed}
                  onCheckedChange={handleDigestToggle}
                  disabled={isPending}
                  aria-label="Suscripción al digest mensual"
                />
              </div>
            )}
            <Button variant={isFollowed ? "outline" : "default"} onClick={handleFollowToggle} disabled={isPending}>
              {isFollowed ? (
                <>
                  <StarOff data-icon="inline-start" />
                  Dejar de seguir
                </>
              ) : (
                <>
                  <Star data-icon="inline-start" />
                  Seguir cuenta
                </>
              )}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/v3/chat">
                <MessageSquare data-icon="inline-start" />
                Chat
              </Link>
            </Button>
          </div>
        </div>
      </div>


      {/* LA RADIOGRAFÍA (Fase 9): el informe se lee de arriba a abajo, en el
          mismo orden que el documento que se entrega al cliente. */}
      <Suspense fallback={<ReportSkeleton />}>
        <ReportSlot promise={reportPromise} />
      </Suspense>

      {/* El respaldo del informe, en la MISMA vista. Antes eran pestañas al pie
          del bookmark, y ahí se perdían: quedaban debajo de todo el informe y
          nadie bajaba. Ahora son secciones colapsadas —el detalle está a un
          clic— y las que no tienen contenido NO se renderizan, así el informe no
          arrastra empty states pidiendo acciones al usuario. */}
      {explicitCount > 0 && (
        <DetailSection title="Hallazgos verificables" count={explicitCount}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-primary" />
              <span className="font-medium text-foreground">Convergente</span>: confirmado por 2+ fuentes
            </span>
            <span className="flex items-center gap-1.5">
              <Link2 className="size-3.5" />
              <span className="font-medium text-foreground">Directa</span>: 1 fuente verificable
            </span>
            <span className="text-pretty">Cada hallazgo enlaza a la fuente web real donde se detectó.</span>
          </div>
          <Accordion
            type="multiple"
            defaultValue={[Array.from(explicitByArea.keys())[0] ?? ""]}
            className="mt-3 flex flex-col gap-3"
          >
            {Array.from(explicitByArea.entries()).map(([areaKey, items]) => {
              const convergent = items.filter((f) => (f.convergent_sources ?? 1) >= 2).length
              return (
                <AccordionItem key={areaKey} value={areaKey} className="rounded-lg border px-4 last:border-b">
                  <AccordionTrigger className="hover:no-underline">
                    <span className="flex flex-1 items-center gap-2 text-sm font-medium">
                      <Cpu className="size-4 shrink-0 text-muted-foreground" />
                      <span className="capitalize">{areaLabel(areaKey)}</span>
                      <Badge variant="secondary">{items.length}</Badge>
                      {convergent > 0 && (
                        <Badge className="gap-1">
                          <ShieldCheck className="size-3" />
                          {convergent} convergente{convergent > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="flex flex-col gap-3">
                    {items.map((f) => (
                      <FindingCard key={f.id} finding={f} />
                    ))}
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        </DetailSection>
      )}

      {signals && signals.fitSignals.length > 0 && (
        <DetailSection title="Señales fit" count={signals.fitSignals.length}>
          <SignalsTab companyId={company.id} signals={signals} />
        </DetailSection>
      )}

      {inferredFindings.length > 0 && (
        <DetailSection title="Contexto inferido" count={inferredFindings.length}>
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-muted-foreground text-pretty">
              Interpretaciones de la IA a partir de evidencia indirecta (vacantes publicadas,
              patrones del sector). No son hechos verificados: usalas como hipótesis para la
              conversación, no como afirmaciones.
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {inferredFindings.map((f) => (
              <Card key={f.id}>
                <CardContent className="flex flex-col gap-2 pt-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-pretty">{f.title}</p>
                    {typeof f.confidence === "number" && (
                      <Badge variant="outline" className="shrink-0 tabular-nums">
                        Confianza {Math.round(f.confidence * 100)}%
                      </Badge>
                    )}
                  </div>
                  {f.summary && <ClampText text={f.summary} />}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="capitalize">{f.category.replaceAll("-", " ")}</span>
                    <span>
                      · Inferido de{" "}
                      {f.radar_type === "jobs-interpretation" ? "vacantes publicadas" : "señales indirectas"}
                    </span>
                    <span>
                      · {new Date(f.detected_at).toLocaleDateString("es", { month: "short", year: "numeric" })}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </DetailSection>
      )}

      {icebreakers.length > 0 && (
        <DetailSection title="Icebreakers" count={icebreakers.length}>
          <div className="flex flex-col gap-3">
            {icebreakers.map((ib) => (
              <IcebreakerCard key={ib.id} icebreaker={ib} />
            ))}
          </div>
        </DetailSection>
      )}

      {digests.length > 0 && (
        <DetailSection title="Historial de digests" count={digests.length}>
          <Card>
            <CardContent className="flex flex-col divide-y p-0">
              {digests.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-4 p-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {new Date(d.sent_at).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {Array.isArray(d.recipients) ? `${d.recipients.length} destinatarios` : "Digest enviado"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm tabular-nums">
                    <ScoreBadge score={d.score_before} />
                    <span className="text-muted-foreground">→</span>
                    <ScoreBadge score={d.score_after} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </DetailSection>
      )}
    </div>
  )
}

/** Hallazgo verificado con todas sus fuentes reales visibles y trazables. */
function FindingCard({ finding: f }: { finding: Finding }) {
  // Fuentes verificadas: usar el array supporting_sources; caer a la URL primaria.
  const sources =
    f.supporting_sources && f.supporting_sources.length > 0
      ? f.supporting_sources
      : f.url
        ? [{ url: f.url, title: f.source_name, date: f.source_date }]
        : []
  const isConvergent = (f.convergent_sources ?? sources.length) >= 2
  const techs = f.payload?.technologies ?? []

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-pretty">{f.title}</p>
        {isConvergent ? (
          <Badge className="shrink-0 gap-1">
            <ShieldCheck className="size-3" />
            Convergente
          </Badge>
        ) : (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Link2 className="size-3" />
            Directa
          </Badge>
        )}
      </div>
      {/* El dato antes que la prosa: chips de tecnologías arriba del summary */}
      {techs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {techs.slice(0, 6).map((t) => (
            <Badge key={t} variant="outline" className="text-xs font-normal">
              {t}
            </Badge>
          ))}
        </div>
      )}

      {f.summary && <ClampText text={f.summary} />}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="capitalize">{f.category.replaceAll("-", " ")}</span>
        {f.source_date && (
          <span>
            · {new Date(f.source_date).toLocaleDateString("es", { month: "short", year: "numeric" })}
          </span>
        )}
      </div>

      {/* Fuentes verificadas — todas visibles y clickeables */}
      {sources.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-2">
          <span className="text-xs font-medium text-muted-foreground">
            {sources.length === 1 ? "Fuente" : `${sources.length} fuentes`}
          </span>
          {sources.map((s, i) => (
            <a
              key={`${s.url}-${i}`}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="mt-0.5 size-3 shrink-0" />
              <span className="text-pretty break-all">{s.title || hostnameOf(s.url) || s.url}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

/** Extrae el hostname legible de una URL. */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

/**
 * Resumen ejecutivo (doc B.2): brief + scorecard fusionados en UNA card corta,
 * con layout de "infografía": tiles de sub-scores arriba, dos bloques en grilla
 * (Por qué ahora + evidencia | Próximos pasos del funnel con CTA directo) y la
 * prosa completa detrás del collapse "Ver análisis completo", cerrado por
 * defecto. Los próximos pasos son deterministas y siguen el mismo funnel que el
 * MCP: seguir → investigar → decisores → icebreaker → contactar.
 */
/**
 * Consumidores de la radiografía.
 *
 * Cada uno desenvuelve la MISMA promesa con `use()` dentro de su propio
 * `Suspense`, así el chip de estado, las fechas de refresco y el informe
 * aterrizan sin bloquearse entre sí ni bloquear el encabezado. `use()` sobre
 * una promesa ya resuelta no vuelve a suspender, así que compartirla entre los
 * tres no cuesta tres cálculos.
 */
function StatusBadgeSlot({ promise }: { promise: Promise<AccountReport | null> }) {
  const report = use(promise)
  return report ? <StatusBadge status={report.status.status} /> : null
}

function FreshnessSlot({ promise }: { promise: Promise<AccountReport | null> }) {
  const report = use(promise)
  return report ? <DataFreshness method={report.method} /> : null
}

function ReportSlot({ promise }: { promise: Promise<AccountReport | null> }) {
  const report = use(promise)
  return report ? <AccountReportView report={report} /> : null
}

/**
 * Bloque de respaldo del informe: colapsado por defecto, se abre a un clic.
 *
 * Reemplaza a las pestañas que vivían al pie del bookmark. El problema no era
 * el contenido sino el lugar: quedaban debajo de todo el informe, así que nadie
 * las veía. Colapsadas ocupan una línea y siguen estando.
 */
function DetailSection({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/40"
      >
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        {title}
        {typeof count === "number" && <Badge variant="secondary">{count}</Badge>}
      </button>
      {open && <div className="border-t px-4 py-4">{children}</div>}
    </section>
  )
}

/** Etiqueta de sección estilo infografía: corta, uppercase y en color de acento. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-primary">{children}</p>
  )
}

function IcebreakerCard({
  icebreaker,
}: {
  icebreaker: AccountDetail["icebreakers"][number]
}) {
  const [feedback, setFeedback] = useState<number | null>(icebreaker.feedback)
  const [isPending, startTransition] = useTransition()

  const handleFeedback = (value: 1 | -1) => {
    const next = feedback === value ? null : value
    setFeedback(next)
    startTransition(async () => {
      if (next !== null) {
        await setIcebreakerFeedback(icebreaker.id, next as 1 | -1)
      }
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <span className="font-medium text-sm">{icebreaker.contact_name}</span>
            <span className="text-xs text-muted-foreground">
              {icebreaker.contact_title ?? ""}
              {icebreaker.contact_country ? ` · ${icebreaker.contact_country}` : ""}
              {icebreaker.version > 1 ? ` · v${icebreaker.version}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleFeedback(1)}
              disabled={isPending}
              aria-label="Marcar icebreaker como útil"
              className={feedback === 1 ? "text-green-600" : ""}
            >
              <ThumbsUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleFeedback(-1)}
              disabled={isPending}
              aria-label="Marcar icebreaker como no útil"
              className={feedback === -1 ? "text-red-600" : ""}
            >
              <ThumbsDown className="size-4" />
            </Button>
          </div>
        </div>
        <p className="whitespace-pre-wrap text-sm text-pretty">{icebreaker.content}</p>
        <p className="text-xs text-muted-foreground">
          {new Date(icebreaker.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * Prosa de IA acotada: 2 líneas visibles + "Ver más" (principio "datos > prosa"
 * del rediseño de la cuenta). El umbral evita mostrar el toggle en textos que
 * ya entran completos en dos líneas.
 */
function ClampText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  const collapsible = text.length > 170
  return (
    <div>
      <p className={`${className ?? "text-sm text-muted-foreground"} text-pretty ${!expanded && collapsible ? "line-clamp-2" : ""}`}>
        {text}
      </p>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "Ver menos" : "Ver más"}
        </button>
      )}
    </div>
  )
}
