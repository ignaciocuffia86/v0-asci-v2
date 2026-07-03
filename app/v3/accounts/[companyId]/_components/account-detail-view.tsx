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
  ArrowLeft,
  ArrowUpRight,
  Briefcase,
  Cpu,
  ExternalLink,
  MessageSquare,
  Newspaper,
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
} from "@/app/actions/v3/accounts"
import { setIcebreakerFeedback } from "@/app/actions/v3/icebreakers"
import { ScoreBadge } from "@/components/v3/score-badge"

const RADAR_CONFIG: Record<string, { label: string; icon: typeof Cpu }> = {
  tech: { label: "Tecnología", icon: Cpu },
  news: { label: "Noticias", icon: Newspaper },
  "jobs-interpretation": { label: "Vacantes", icon: Briefcase },
}

export function AccountDetailView({ detail }: { detail: AccountDetail }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { company, followedAccount, scorecard, previousScore, findings, icebreakers, digests } = detail

  const isFollowed = !!followedAccount

  const findingsByType = useMemo(() => {
    const map = new Map<string, AccountDetail["findings"]>()
    for (const f of findings) {
      const list = map.get(f.radar_type) ?? []
      list.push(f)
      map.set(f.radar_type, list)
    }
    return map
  }, [findings])

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
      {scorecard && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scorecard</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <ScorePillar label="Fit con tu oferta" value={scorecard.fit_score} />
              <ScorePillar label="Señales de compra" value={scorecard.buying_signals_score} />
              <ScorePillar label="Accesibilidad" value={scorecard.accessibility_score} />
              <ScorePillar label="Timing" value={scorecard.timing_score} />
            </div>
            {scorecard.rationale && (
              <p className="text-sm text-muted-foreground text-pretty">{scorecard.rationale}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Calculado el {new Date(scorecard.created_at).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tabs: hallazgos / icebreakers / historial */}
      <Tabs defaultValue="findings">
        <TabsList>
          <TabsTrigger value="findings">
            Hallazgos {findings.length > 0 && `(${findings.length})`}
          </TabsTrigger>
          <TabsTrigger value="icebreakers">
            Icebreakers {icebreakers.length > 0 && `(${icebreakers.length})`}
          </TabsTrigger>
          <TabsTrigger value="history">
            Historial {digests.length > 0 && `(${digests.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="findings" className="flex flex-col gap-4">
          {findings.length === 0 ? (
            <EmptyState text="Sin hallazgos todavía. Investigá esta cuenta desde el chat para generar el radar." />
          ) : (
            Array.from(findingsByType.entries()).map(([type, items]) => {
              const config = RADAR_CONFIG[type] ?? { label: type, icon: Cpu }
              const Icon = config.icon
              return (
                <Card key={type}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Icon className="size-4" />
                      {config.label}
                      <Badge variant="secondary">{items.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {items.map((f) => (
                      <div key={f.id} className="flex flex-col gap-1 rounded-md border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm text-pretty">{f.title}</p>
                          <Badge variant={f.evidence_level === "explicit" ? "default" : "secondary"} className="shrink-0">
                            {f.evidence_level === "explicit" ? "Explícito" : "Inferido"}
                          </Badge>
                        </div>
                        {f.summary && (
                          <p className="text-sm text-muted-foreground text-pretty">{f.summary}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="capitalize">{f.category.replaceAll("-", " ")}</span>
                          {f.source_name && <span>· {f.source_name}</span>}
                          {f.source_date && (
                            <span>· {new Date(f.source_date).toLocaleDateString("es", { month: "short", year: "numeric" })}</span>
                          )}
                          {f.url && (
                            <a
                              href={f.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-primary hover:underline"
                            >
                              Fuente <ArrowUpRight className="size-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )
            })
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

function ScorePillar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
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
