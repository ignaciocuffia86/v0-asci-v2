"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ArrowLeft,
  ArrowUpRight,
  Briefcase,
  Cpu,
  ExternalLink,
  Info,
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

const RADAR_CONFIG: Record<string, { label: string; icon: typeof Cpu }> = {
  tech: { label: "Tecnología", icon: Cpu },
  news: { label: "Noticias", icon: Newspaper },
  "jobs-interpretation": { label: "Vacantes", icon: Briefcase },
}

type Finding = AccountDetail["findings"][number]

export function AccountDetailView({
  detail,
  signals,
}: {
  detail: AccountDetail
  signals: AccountSignalsData | null
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
              {typeof scorecard?.score === "number" ? (
                <ScoreBadge score={scorecard.score} />
              ) : scorecard?.fit_status === "fit_not_evaluated" ? (
                <Badge variant="secondary">Fit no evaluado</Badge>
              ) : null}
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

      {!isFollowed && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <Star className="size-4 shrink-0 text-primary" />
          <p className="text-pretty">Cuenta no seguida: sin refresh automático ni digest mensual.</p>
        </div>
      )}

      {/* Account Brief: quick win preliminar o resultado final */}
      {brief && <AccountBriefCard brief={brief} scorecardRationale={scorecard?.rationale ?? null} />}

      {/* Scorecard */}
      {scorecard?.fit_status === "evaluated" && <ScorecardCard scorecard={scorecard} findingsCount={findings.length} />}
      {scorecard?.fit_status === "fit_not_evaluated" && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-1">
              <p className="font-medium">Fit no evaluado</p>
              <p className="text-sm text-muted-foreground text-pretty">
                La evidencia de la cuenta está disponible, pero necesitamos tu propuesta de valor para calcular el encaje.
              </p>
            </div>
            <Button asChild>
              <Link href="/v3/documents">Completá tu propuesta de valor</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tabs: Hallazgos | Señales | Contexto | Icebreakers | Historial */}
      <Tabs defaultValue="findings">
        <TabsList>
          <TabsTrigger value="findings">
            Radiografía {explicitCount > 0 && `(${explicitCount})`}
          </TabsTrigger>
          <TabsTrigger value="signals">
            Señales {signals && signals.fitSignals.length > 0 && `(${signals.fitSignals.length})`}
          </TabsTrigger>
          <TabsTrigger value="context">
            Contexto {inferredFindings.length > 0 && `(${inferredFindings.length})`}
          </TabsTrigger>
          <TabsTrigger value="icebreakers">
            Icebreakers {icebreakers.length > 0 && `(${icebreakers.length})`}
          </TabsTrigger>
          <TabsTrigger value="history">
            Historial {digests.length > 0 && `(${digests.length})`}
          </TabsTrigger>
        </TabsList>

        {/* Radiografía: hallazgos verificados agrupados por área, con fuentes visibles */}
        <TabsContent value="findings" className="flex flex-col gap-4">
          {explicitCount === 0 ? (
            <EmptyState text="Sin hallazgos verificables todavía. Investigá esta cuenta desde el chat para generar el radar." />
          ) : (
            <>
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
                className="flex flex-col gap-3"
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
            </>
          )}
        </TabsContent>

        {/* Señales fit + personas + decisores recomendados */}
        <TabsContent value="signals">
          <SignalsTab companyId={company.id} signals={signals} />
        </TabsContent>

        {/* Contexto: inferidos por la IA */}
        <TabsContent value="context" className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-muted-foreground text-pretty">
              Interpretaciones de la IA a partir de evidencia indirecta (vacantes publicadas,
              patrones del sector). No son hechos verificados: usalas como hipótesis para la
              conversación, no como afirmaciones.
            </p>
          </div>
          {inferredFindings.length === 0 ? (
            <EmptyState text="Sin contexto inferido para esta cuenta." />
          ) : (
            <div className="flex flex-col gap-3">
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
          )}
        </TabsContent>

        <TabsContent value="icebreakers" className="flex flex-col gap-3">
          {icebreakers.length === 0 ? (
            <EmptyState text="Sin icebreakers generados. Pedile al chat que genere icebreakers para los contactos de esta cuenta." />
          ) : (
            icebreakers.map((ib) => <IcebreakerCard key={ib.id} icebreaker={ib} />)
          )}
        </TabsContent>

        <TabsContent value="history" className="flex flex-col gap-3">
          {digests.length === 0 ? (
            <EmptyState text="Sin digests enviados todavía. El primer refresh mensual generará el primer digest." />
          ) : (
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
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * Rediseño de legibilidad (feature-v3-experiencia-cuentas-y-chat.md, B):
 * - brief.headline NO se renderiza: narrativa que duplica lo que el score y los
 *   chips ya dicen (el título de la página identifica la cuenta).
 * - En modo server-managed, fit_summary ES scorecard.rationale
 *   (final-account-brief.ts): si son el mismo texto, el Encaje no se repite acá.
 * - La prosa larga queda detrás de "Ver más" (ClampText), datos por delante.
 */
function AccountBriefCard({
  brief,
  scorecardRationale,
}: {
  brief: NonNullable<AccountDetail["brief"]>
  scorecardRationale: string | null
}) {
  const coverage = brief.coverage ?? {}
  const contacts = brief.recommended_contacts ?? []
  const fitDuplicatesRationale =
    !!brief.fit_summary && !!scorecardRationale && brief.fit_summary.trim() === scorecardRationale.trim()
  const showFit = !!brief.fit_summary && !fitDuplicatesRationale
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Análisis de la cuenta</CardTitle>
          <Badge variant={brief.stage === "final" ? "default" : "secondary"}>
            {brief.stage === "final" ? "Final" : "Preliminar"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-5">
        <div className={`grid gap-4 ${showFit ? "md:grid-cols-2" : ""}`}>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Por qué ahora</p>
            <ClampText
              text={brief.why_now || "No hay señales recientes suficientes para evaluar el timing."}
              className="text-sm text-foreground"
            />
          </div>
          {showFit && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Encaje</p>
              <ClampText text={brief.fit_summary!} className="text-sm text-foreground" />
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{coverage.signals ?? 0} señales</Badge>
          <Badge variant="outline">{coverage.jobPostings ?? 0} vacantes</Badge>
          <Badge variant="outline">{coverage.technologies ?? 0} tecnologías</Badge>
          <Badge variant="outline">{contacts.length} contactos</Badge>
        </div>
        {brief.next_actions.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Próximos pasos</p>
            <ul className="flex flex-col gap-1 text-sm">
              {brief.next_actions.slice(0, 3).map((action) => <li key={action}>· {action}</li>)}
            </ul>
          </div>
        )}
        {brief.stage === "preliminary" && (
          <p className="rounded-md bg-primary/5 px-3 py-2 text-xs text-muted-foreground text-pretty">
            Este resultado usa los datos que ASCI ya tenía. La investigación web continúa automáticamente y puede sumar evidencia.
          </p>
        )}
      </CardContent>
    </Card>
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

// ─── Scorecard con tooltips explicativos por pilar ───────────

interface TimingEventEntry {
  title: string
  eventType: string
  points: number
}

interface SnapshotBreakdown {
  fit?: {
    target_total?: number
    matches?: string[]
    detected_technologies?: string[]
    no_profile?: boolean
  }
  signals?: { explicit?: number; inferred?: number; legacy?: number; formula?: string }
  accessibility?: { contacts?: number; senior?: number; formula?: string }
  timing?: { events?: TimingEventEntry[]; total_events?: number }
}

function ScorecardCard({
  scorecard,
  findingsCount,
}: {
  scorecard: NonNullable<AccountDetail["scorecard"]>
  findingsCount: number
}) {
  const snapshot = (scorecard.signals_snapshot ?? {}) as { breakdown?: SnapshotBreakdown }
  const breakdown = snapshot.breakdown

  const fitTooltip = breakdown?.fit ? (
    breakdown.fit.no_profile ? (
      <p>
        Sin perfil de propuesta de valor definido: el fit es neutro basado en el stack detectado (
        {(breakdown.fit.detected_technologies ?? []).slice(0, 5).join(", ") || "sin tecnologías"}).
      </p>
    ) : (
      <div className="flex flex-col gap-1">
        <p>
          {breakdown.fit.matches?.length ?? 0} de {breakdown.fit.target_total ?? 0} objetivos de tu
          propuesta detectados en la cuenta.
        </p>
        {(breakdown.fit.matches?.length ?? 0) > 0 && (
          <p className="text-muted-foreground">Coincidencias: {breakdown.fit.matches!.join(", ")}</p>
        )}
      </div>
    )
  ) : (
    <p>Porcentaje de tus tecnologías y procesos objetivo detectados en la cuenta.</p>
  )

  const signalsTooltip = breakdown?.signals ? (
    <p>{breakdown.signals.formula}</p>
  ) : (
    <p>Hallazgos explícitos ×12 + inferidos ×5. Los hechos verificables pesan más.</p>
  )

  const accessTooltip = breakdown?.accessibility ? (
    <p>
      {breakdown.accessibility.contacts ?? 0} contactos en cache, {breakdown.accessibility.senior ?? 0}{" "}
      senior (C-level/VP/Director). Fórmula: {breakdown.accessibility.formula}
    </p>
  ) : (
    <p>Contactos disponibles en el cache de Apollo, ponderando los perfiles senior.</p>
  )

  const timingEvents = breakdown?.timing?.events ?? []
  const timingTooltip =
    timingEvents.length > 0 ? (
      <div className="flex flex-col gap-1">
        <p className="font-medium">Eventos que suman al timing (peso × recencia):</p>
        <ul className="flex flex-col gap-0.5">
          {timingEvents.slice(0, 5).map((e, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="truncate">
                {e.eventType}: {e.title}
              </span>
              <span className="shrink-0 tabular-nums">+{e.points}</span>
            </li>
          ))}
        </ul>
        {(breakdown?.timing?.total_events ?? 0) > 5 && (
          <p className="text-muted-foreground">
            y {breakdown!.timing!.total_events! - 5} eventos más…
          </p>
        )}
      </div>
    ) : (
      <p>
        Suma ponderada de eventos recientes: expansión/inversión ×25, cambio ejecutivo ×20,
        implementación tech ×15, noticia ×8; decae con la antigüedad (30/60/90 días).
      </p>
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Scorecard</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <ScorePillar label="Fit con tu oferta" value={scorecard.fit_score ?? 0} tooltip={fitTooltip} />
          <ScorePillar label="Señales de compra" value={scorecard.buying_signals_score ?? 0} tooltip={signalsTooltip} />
          <ScorePillar label="Accesibilidad" value={scorecard.accessibility_score ?? 0} tooltip={accessTooltip} />
          <ScorePillar label="Timing" value={scorecard.timing_score ?? 0} tooltip={timingTooltip} />
        </div>
        {scorecard.rationale && <ClampText text={scorecard.rationale} />}
        <p className="text-xs text-muted-foreground">
          Calculado el{" "}
          {new Date(scorecard.created_at).toLocaleDateString("es", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}{" "}
          · {findingsCount} hallazgos considerados · score = 35% fit + 35% señales + 15%
          accesibilidad + 15% timing
        </p>
      </CardContent>
    </Card>
  )
}

function ScorePillar({
  label,
  value,
  tooltip,
}: {
  label: string
  value: number
  tooltip: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex cursor-help flex-col gap-1 rounded-md border p-3">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {label}
            <Info className="size-3" />
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xl font-semibold tabular-nums">{value}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
              />
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
    </Tooltip>
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

function EmptyState({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground text-pretty">
        {text}
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
