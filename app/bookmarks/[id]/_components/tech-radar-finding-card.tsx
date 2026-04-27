"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ExternalLink,
  Trash2,
  Building2,
  Cpu,
  TrendingUp,
  Calendar,
  Layers,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Quote,
} from "lucide-react"
import { MICRO_AGENT_LABELS, type MicroAgent } from "@/lib/tech-radar-constants"
import type { Implementation } from "./types"

interface Props {
  finding: Implementation
  isSuperAdmin: boolean
  onDelete: (id: string) => void
}

const AREA_LABELS: Record<string, string> = {
  finanzas: "Finanzas",
  ventas: "Ventas",
  logistica: "Logística",
  rrhh: "RRHH",
  it: "IT",
  ciberseguridad: "Ciberseguridad",
  ecommerce: "eCommerce",
  operaciones: "Operaciones",
}

const EVIDENCE_META: Record<
  string,
  { label: string; Icon: typeof ShieldCheck; variant: "default" | "secondary" | "outline" }
> = {
  directa: { label: "Evidencia directa", Icon: ShieldCheck, variant: "default" },
  convergente: { label: "Convergente", Icon: ShieldAlert, variant: "secondary" },
  inferencia: { label: "Inferencia", Icon: ShieldQuestion, variant: "outline" },
}

function microAgentLabel(agent: string | null): string {
  if (!agent) return "Sin clasificar"
  return MICRO_AGENT_LABELS[agent as MicroAgent] ?? agent
}

function parseSupportingUrls(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.length > 0)
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
    } catch {
      return []
    }
  }
  return []
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function TechRadarFindingCard({ finding, isSuperAdmin, onDelete }: Props) {
  const supportingUrls = parseSupportingUrls(finding.supporting_source_urls)
  const evidenceKey = (finding.evidence_level ?? "").toLowerCase()
  const evidence = EVIDENCE_META[evidenceKey]
  const convergentCount = Number(finding.convergent_sources ?? 0)

  return (
    <Card className="group transition-colors hover:bg-muted/30">
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* Top row: micro-agente + evidencia */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1 text-[11px] font-medium">
                <Layers className="h-3 w-3" />
                {microAgentLabel(finding.micro_agent)}
              </Badge>
              {evidence ? (
                <Badge variant={evidence.variant} className="gap-1 text-[11px]">
                  <evidence.Icon className="h-3 w-3" />
                  {evidence.label}
                </Badge>
              ) : null}
              {convergentCount > 1 ? (
                <Badge variant="outline" className="text-[11px]">
                  {convergentCount} fuentes
                </Badge>
              ) : null}
            </div>

            {/* Título */}
            {finding.source_url ? (
              <a
                href={finding.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-start gap-1 font-medium leading-snug text-foreground hover:text-primary hover:underline"
              >
                <span className="text-pretty">{finding.title}</span>
                <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 opacity-50" />
              </a>
            ) : (
              <h4 className="font-medium leading-snug">{finding.title}</h4>
            )}

            {/* Metadata: vendor / tech / area / fuente / fecha */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {finding.provider_name && finding.provider_name !== "N/A" ? (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  {finding.provider_name}
                </span>
              ) : null}
              {finding.technology && finding.technology !== "N/A" ? (
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  <Cpu className="h-3.5 w-3.5" />
                  {finding.technology}
                </span>
              ) : null}
              {finding.area ? (
                <Badge variant="outline" className="text-[11px]">
                  {AREA_LABELS[finding.area] ?? finding.area}
                </Badge>
              ) : null}
              {finding.source_name ? (
                <span className="text-xs opacity-70">vía {finding.source_name}</span>
              ) : null}
              {finding.published_at ? (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(finding.published_at).toLocaleDateString("es-AR", {
                    year: "numeric",
                    month: "short",
                  })}
                </span>
              ) : null}
            </div>

            {/* Summary */}
            {finding.summary ? (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{finding.summary}</p>
            ) : null}

            {/* Evidence detail (cita textual del prompt) */}
            {finding.evidence_detail ? (
              <div className="mt-2 rounded-md border-l-2 border-muted-foreground/20 bg-muted/30 px-3 py-2">
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Quote className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="italic leading-relaxed">{finding.evidence_detail}</span>
                </div>
              </div>
            ) : null}

            {/* Resultados cuantificados */}
            {finding.results ? (
              <div className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="h-3.5 w-3.5" />
                {finding.results}
              </div>
            ) : null}

            {/* Supporting sources */}
            {supportingUrls.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Otras fuentes:</span>
                {supportingUrls.slice(0, 5).map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                  >
                    {safeHostname(url)}
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          {isSuperAdmin ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              onClick={() => onDelete(finding.id)}
              aria-label="Eliminar hallazgo"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
