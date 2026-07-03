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
  const { company, followedAccount, scorecard, previousScore, findings, icebreakers, digests } = detail

  const isFollowed = !!followedAccount

  const { explicitByType, inferredFindings } = useMemo(() => {
    const explicit = new Map<string, Finding[]>()
    const inferred: Finding[] = []
    for (const f of findings) {
      if (f.evidence_level === "explicit") {
        const list = explicit.get(f.radar_type) ?? []
        list.push(f)
        explicit.set(f.radar_type, list)
      } else {
        inferred.push(f)
      }
    }
    return { explicitByType: explicit, inferredFindings: inferred }
  }, [findings])

  const explicitCount = findings.length - inferredFindings.length

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
    scorecard && previousScore !== null ? scorecard.score - previousScore : null

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
              {scorecard && <ScoreBadge score={scorecard.score} />}
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
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <Star className="size-4 shrink-0 text-primary" />
          <p className="text-pretty">
            No seguís esta cuenta: la información no se refresca automáticamente ni recibís su
            digest mensual. Seguila para mantenerla al día.
          </p>
        </div>
      )}

      {/* Scorecard */}
      {scorecard && <ScorecardCard scorecard={scorecard} findingsCount={findings.length} />}

      {/* Tabs: Hallazgos | Señales | Contexto | Icebreakers | Historial */}
      <Tabs defaultValue="findings">
        <TabsList>
          <TabsTrigger value="findings">
            Hallazgos {explicitCount > 0 && `(${explicitCount})`}
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

        {/* Hallazgos: solo explícitos, colapsables por tipo, con citas */}
        <TabsContent value="findings" className="flex flex-col gap-4">
          {explicitCount === 0 ? (
            <EmptyState text="Sin hallazgos verificables todavía. Investigá esta cuenta desde el chat para generar el radar." />
          ) : (
            <Accordion
              type="multiple"
              defaultValue={[Array.from(explicitByType.keys())[0] ?? ""]}
              className="flex flex-col gap-3"
            >
              {Array.from(explicitByType.entries()).map(([type, items]) => {
                const config = RADAR_CONFIG[type] ?? { label: type, icon: Cpu }
                const Icon = config.icon
                return (
                  <AccordionItem key={type} value={type} className="rounded-lg border px-4 last:border-b">
                    <AccordionTrigger className="hover:no-underline">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Icon className="size-4" />
                        {config.label}
                        <Badge variant="secondary">{items.length}</Badge>
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
                    {f.summary && (
                      <p className="text-sm text-muted-foreground text-pretty">{f.summary}</p>
                    )}
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

/** Hallazgo explícito con cita: Verificado (con URL) o Declarado (solo fuente). */
function FindingCard({ finding: f }: { finding: Finding }) {
  const hasUrl = !!f.url
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-pretty">{f.title}</p>
        {hasUrl ? (
          <Badge className="shrink-0 gap-1">
            <ShieldCheck className="size-3" />
            Verificado
          </Badge>
        ) : (
          <Badge variant="secondary" className="shrink-0">
            Declarado
          </Badge>
        )}
      </div>
      {f.summary && <p className="text-sm text-muted-foreground text-pretty">{f.summary}</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="capitalize">{f.category.replaceAll("-", " ")}</span>
        {f.source_date && (
          <span>
            · {new Date(f.source_date).toLocaleDateString("es", { month: "short", year: "numeric" })}
          </span>
        )}
        {hasUrl ? (
          <a
            href={f.url!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
          >
            {f.source_name ?? "Ver fuente"} <ArrowUpRight className="size-3" />
          </a>
        ) : (
          f.source_name && <span>· Fuente declarada: {f.source_name}</span>
        )}
      </div>
    </div>
  )
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
          <ScorePillar label="Fit con tu oferta" value={scorecard.fit_score} tooltip={fitTooltip} />
          <ScorePillar label="Señales de compra" value={scorecard.buying_signals_score} tooltip={signalsTooltip} />
          <ScorePillar label="Accesibilidad" value={scorecard.accessibility_score} tooltip={accessTooltip} />
          <ScorePillar label="Timing" value={scorecard.timing_score} tooltip={timingTooltip} />
        </div>
        {scorecard.rationale && (
          <p className="text-sm text-muted-foreground text-pretty">{scorecard.rationale}</p>
        )}
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
