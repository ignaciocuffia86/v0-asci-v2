"use client"

import { useState } from "react"
import useSWR from "swr"
import {
  Check,
  Copy,
  Star,
  AlertTriangle,
  Loader2,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  User,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { setIcebreakerFeedback } from "@/app/actions/v3/icebreakers"

type SendMessageFn = (message: { text: string }) => void

// Los outputs de tools llegan serializados; tipamos de forma laxa y defensiva
/* eslint-disable @typescript-eslint/no-explicit-any */

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400"
  if (score >= 50) return "text-amber-600 dark:text-amber-400"
  return "text-orange-600 dark:text-orange-400"
}

function scoreBg(score: number): string {
  if (score >= 70) return "bg-emerald-500"
  if (score >= 50) return "bg-amber-500"
  return "bg-orange-500"
}

// ─────────────────────────────────────────────
// resolveCompanies
// ─────────────────────────────────────────────
export function ResolutionCard({
  output,
  sendMessage,
  isBusy,
}: {
  output: any
  sendMessage: SendMessageFn
  isBusy: boolean
}) {
  const resolutions: any[] = output?.resolutions ?? []
  if (resolutions.length === 0) return null

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
        Empresas resueltas ({resolutions.length})
      </div>
      <div className="divide-y divide-border">
        {resolutions.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="font-medium">{r.name ?? r.input}</span>
            {r.domain && <span className="text-xs text-muted-foreground">{r.domain}</span>}
            {r.country && (
              <Badge variant="outline" className="text-xs">
                {r.country}
              </Badge>
            )}
            {r.candidates?.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                <AlertTriangle className="size-3.5 text-amber-500" />
                <span className="text-xs text-muted-foreground">Ambigua:</span>
                {r.candidates.map((c: any) => (
                  <Button
                    key={c.companyId}
                    variant="outline"
                    size="sm"
                    className="h-6 bg-transparent px-2 text-xs"
                    disabled={isBusy}
                    onClick={() => sendMessage({ text: `Para "${r.input}" me refiero a ${c.name} (${c.domain ?? c.companyId})` })}
                  >
                    {c.name} {c.domain ? `· ${c.domain}` : ""}
                  </Button>
                ))}
              </span>
            )}
            {!r.companyId && r.candidates?.length === 0 && (
              <Badge variant="secondary" className="text-xs">
                Nueva (se creará)
              </Badge>
            )}
            {r.cacheFresh && (
              <Badge variant="secondary" className="text-xs">
                Cache fresco
              </Badge>
            )}
            {r.alreadyFollowed && (
              <Badge className="gap-1 text-xs">
                <Star className="size-3" /> Seguida
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// startResearch / checkBatchStatus (con polling)
// ─────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function BatchProgressCard({
  output,
  sendMessage,
  isBusy,
  static: isStatic = false,
}: {
  output: any
  sendMessage: SendMessageFn
  isBusy: boolean
  static?: boolean
}) {
  if (output?.error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {output.error}
      </div>
    )
  }

  const batchId: string | null = output?.batchId ?? null
  const initialJobs: any[] = output?.jobs ?? []

  return <BatchProgressInner batchId={batchId} initialJobs={initialJobs} sendMessage={sendMessage} isBusy={isBusy} isStatic={isStatic} />
}

function BatchProgressInner({
  batchId,
  initialJobs,
  sendMessage,
  isBusy,
  isStatic,
}: {
  batchId: string | null
  initialJobs: any[]
  sendMessage: SendMessageFn
  isBusy: boolean
  isStatic: boolean
}) {
  const [notified, setNotified] = useState(false)

  const initialDone =
    initialJobs.length > 0 && initialJobs.every((j) => ["completed", "failed", "cancelled"].includes(j.status))

  const { data } = useSWR(
    batchId && !isStatic && !initialDone ? `/api/v3/research/batch/${batchId}` : null,
    fetcher,
    {
      refreshInterval: (latest: any) => (latest?.done ? 0 : 3500),
      revalidateOnFocus: true,
    }
  )

  const jobs: any[] = data?.jobs ?? initialJobs
  const done = data?.done ?? initialDone
  const completed = jobs.filter((j) => j.status === "completed")
  const failed = jobs.filter((j) => j.status === "failed")

  // Al terminar, avisar al modelo una sola vez para que presente resultados
  if (done && !isStatic && !notified && !isBusy && completed.length > 0 && data) {
    setNotified(true)
    const names = completed.map((j: any) => j.companyInput).join(", ")
    setTimeout(() => sendMessage({ text: `El research terminó (${names}). Mostrame el resumen de cada cuenta.` }), 400)
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          Research {done ? "finalizado" : "en curso"} · {completed.length}/{jobs.length} cuentas
        </span>
        {!done && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="divide-y divide-border">
        {jobs.map((j) => (
          <div key={j.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{j.companyInput}</span>
            {j.status === "completed" ? (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Check className="size-3" /> Lista
              </Badge>
            ) : j.status === "failed" ? (
              <span className="flex items-center gap-2">
                <Badge variant="destructive" className="text-xs">
                  Falló
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 bg-transparent px-2 text-xs"
                  disabled={isBusy}
                  onClick={() => sendMessage({ text: `Reintentá el research de ${j.companyInput}` })}
                >
                  Reintentar
                </Button>
              </span>
            ) : (
              <span className="flex w-40 items-center gap-2">
                <Progress value={j.progress ?? 0} className="h-1.5" />
                <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{j.currentStep ?? "En cola"}</span>
              </span>
            )}
          </div>
        ))}
      </div>
      {!done && (
        <div className="border-t border-border bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
          Podés cerrar esta pestaña: el proceso continúa en segundo plano.
        </div>
      )}
      {failed.length > 0 && done && (
        <div className="border-t border-border bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          {failed.length} cuenta{failed.length > 1 ? "s" : ""} con error: {failed.map((j: any) => j.error).filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// getAccountOverview (scorecard + señales)
// ─────────────────────────────────────────────
export function AccountOverviewCard({
  output,
  sendMessage,
  isBusy,
}: {
  output: any
  sendMessage: SendMessageFn
  isBusy: boolean
}) {
  const company = output?.company
  const scorecard = output?.scorecard
  const findings: any[] = output?.findings ?? []
  if (!company) return null

  const dims = scorecard
    ? [
        { label: "Fit PV", value: scorecard.fit },
        { label: "Señales compra", value: scorecard.buyingSignals },
        { label: "Accesibilidad", value: scorecard.accessibility },
        { label: "Timing", value: scorecard.timing },
      ]
    : []

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/* Header con score */}
      <div className="flex items-start justify-between gap-3 border-b border-border bg-muted/40 p-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{company.name}</h3>
          <p className="text-xs text-muted-foreground">
            {[company.website, company.industry, company.country].filter(Boolean).join(" · ")}
          </p>
        </div>
        {scorecard && (
          <div className="flex flex-col items-center">
            <span className={cn("text-2xl font-bold tabular-nums", scoreColor(scorecard.score))}>
              {scorecard.score}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Score</span>
          </div>
        )}
      </div>

      {/* Dimensiones */}
      {dims.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-border p-3 sm:grid-cols-4">
          {dims.map((d) => (
            <div key={d.label} className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-xs text-muted-foreground">
                {d.label}
                <span className="font-medium text-foreground tabular-nums">{d.value}</span>
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", scoreBg(d.value))} style={{ width: `${d.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {scorecard?.rationale && (
        <p className="border-b border-border p-3 text-sm text-muted-foreground text-pretty">{scorecard.rationale}</p>
      )}

      {/* Señales */}
      {findings.length > 0 && (
        <div className="divide-y divide-border">
          {findings.slice(0, 6).map((f, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2">
              <Badge
                variant={f.evidenceLevel === "explicit" ? "default" : "secondary"}
                className="mt-0.5 shrink-0 text-[10px]"
              >
                {f.radarType === "news" ? "Noticia" : f.radarType === "tech" ? "Tech" : "Vacantes"}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">{f.title}</p>
                {f.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{f.summary}</p>}
                {f.url && (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {f.sourceName ?? "Fuente"} <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Acciones */}
      <div className="flex flex-wrap gap-2 border-t border-border bg-muted/20 p-3">
        <Button
          size="sm"
          disabled={isBusy}
          onClick={() => sendMessage({ text: `Seguí la cuenta ${company.name}` })}
          className="gap-1.5"
        >
          <Star className="size-3.5" /> Seguir cuenta
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isBusy}
          className="bg-transparent"
          onClick={() => sendMessage({ text: `Mostrame los contactos sugeridos de ${company.name}` })}
        >
          Ver contactos
        </Button>
        <Button size="sm" variant="outline" className="ml-auto bg-transparent" asChild>
          <Link href={`/v3/accounts/${company.id}`}>Ver cuenta completa</Link>
        </Button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// followAccounts
// ─────────────────────────────────────────────
export function FollowResultCard({ output }: { output: any }) {
  const results: any[] = output?.results ?? []
  const ok = results.filter((r) => r.success).length
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
      <Star className="size-4 text-primary" />
      {ok} cuenta{ok !== 1 ? "s" : ""} seguida{ok !== 1 ? "s" : ""}. Entra al refresh mensual con digest por email.
      <Link href="/v3/accounts" className="ml-auto text-xs text-primary hover:underline">
        Ver cuentas seguidas
      </Link>
    </div>
  )
}

// ─────────────────────────────────────────────
// listFollowed
// ─────────────────────────────────────────────
export function FollowedListCard({
  output,
  sendMessage,
  isBusy,
}: {
  output: any
  sendMessage: SendMessageFn
  isBusy: boolean
}) {
  const accounts: any[] = output?.accounts ?? []
  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        Todavía no siguen ninguna cuenta. Investigá empresas y seguilas para recibir el digest mensual.
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
        Cuentas seguidas ({accounts.length})
      </div>
      <div className="divide-y divide-border">
        {accounts.map((a) => (
          <button
            key={a.companyId}
            type="button"
            disabled={isBusy}
            onClick={() => sendMessage({ text: `Mostrame el resumen de ${a.name}` })}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
            {a.industry && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{a.industry}</span>}
            {typeof a.score === "number" && (
              <span className={cn("font-semibold tabular-nums", scoreColor(a.score))}>{a.score}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// suggestContacts
// ─────────────────────────────────────────────
export function ContactsCard({
  output,
  sendMessage,
  isBusy,
}: {
  output: any
  sendMessage: SendMessageFn
  isBusy: boolean
}) {
  const contacts: any[] = output?.contacts ?? []
  if (contacts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        No hay contactos en cache para esta cuenta. Pedime buscar contactos nuevos cuando la integración de Apollo esté
        activa.
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
        Contactos sugeridos
      </div>
      <div className="divide-y divide-border">
        {contacts.map((c, i) => (
          <div key={c.apolloId ?? i} className="flex items-center gap-3 px-3 py-2 text-sm">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <User className="size-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{c.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[c.title, c.country].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 bg-transparent px-2 text-xs"
              disabled={isBusy}
              onClick={() => sendMessage({ text: `Generá un icebreaker para ${c.name} (${c.title ?? "sin cargo"})` })}
            >
              Icebreaker
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// generateIcebreakers
// ─────────────────────────────────────────────
export function IcebreakerCard({
  output,
  sendMessage,
  isBusy,
}: {
  output: any
  sendMessage: SendMessageFn
  isBusy: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<number | null>(null)

  if (output?.error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {output.error}
      </div>
    )
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleFeedback = async (value: 1 | -1) => {
    setFeedback(value)
    void setIcebreakerFeedback(output.icebreakerId, value)
  }

  const registerLabel: Record<string, string> = {
    "es-AR": "Español AR (voseo)",
    "es-CL": "Español CL",
    "es-CO": "Español CO",
    "es-MX": "Español MX",
    "es-neutral": "Español neutro",
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          Icebreaker · {output.contactName}
          {output.contactTitle ? ` (${output.contactTitle})` : ""}
        </span>
        <Badge variant="outline" className="text-[10px]">
          {registerLabel[output.register] ?? output.register} · v{output.version}
        </Badge>
      </div>
      <p className="whitespace-pre-wrap p-3 text-sm leading-relaxed">{output.content}</p>
      <div className="flex items-center gap-1 border-t border-border bg-muted/20 px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 px-2", feedback === 1 && "text-emerald-600")}
          onClick={() => handleFeedback(1)}
          aria-label="Me sirve"
        >
          <ThumbsUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 px-2", feedback === -1 && "text-destructive")}
          onClick={() => handleFeedback(-1)}
          aria-label="No me sirve"
        >
          <ThumbsDown className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          disabled={isBusy}
          onClick={() =>
            sendMessage({
              text: `Regenerá el icebreaker ${output.icebreakerId} para ${output.contactName} de ${output.companyName}: hacelo más corto y directo`,
            })
          }
        >
          <RefreshCw className="size-3.5" /> Regenerar
        </Button>
        <Button variant="outline" size="sm" className="ml-auto h-7 gap-1 bg-transparent px-2 text-xs" onClick={handleCopy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
    </div>
  )
}
