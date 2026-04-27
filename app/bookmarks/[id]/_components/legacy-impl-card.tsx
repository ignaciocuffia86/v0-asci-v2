"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExternalLink, Trash2, Building2, Cpu, TrendingUp, Calendar } from "lucide-react"
import type { Implementation } from "./types"

interface Props {
  item: Implementation
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

// Mapeo legacy strong/medium/weak -> etiquetas en español, retro-compat con
// registros previos a la migracion 161.
const LEGACY_EVIDENCE_LABEL: Record<string, string> = {
  strong: "Verificado",
  medium: "Probable",
  weak: "Inferido",
  directa: "Directa",
  convergente: "Convergente",
  inferencia: "Inferencia",
}

export function LegacyImplCard({ item, isSuperAdmin, onDelete }: Props) {
  return (
    <Card className="group transition-colors hover:bg-muted/30">
      <CardContent className="py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {item.source_url ? (
                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium hover:text-primary hover:underline"
                >
                  {item.title}
                  <ExternalLink className="h-3.5 w-3.5 opacity-50" />
                </a>
              ) : (
                <h4 className="text-sm font-medium">{item.title}</h4>
              )}
              {item.evidence_level ? (
                <Badge variant="outline" className="text-[10px]">
                  {LEGACY_EVIDENCE_LABEL[item.evidence_level.toLowerCase()] ?? item.evidence_level}
                </Badge>
              ) : null}
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {item.provider_name && item.provider_name !== "N/A" ? (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {item.provider_name}
                </span>
              ) : null}
              {item.technology && item.technology !== "N/A" ? (
                <span className="inline-flex items-center gap-1">
                  <Cpu className="h-3 w-3" />
                  {item.technology}
                </span>
              ) : null}
              {item.area ? (
                <Badge variant="outline" className="text-[10px]">
                  {AREA_LABELS[item.area] ?? item.area}
                </Badge>
              ) : null}
              {item.source_name ? <span className="opacity-70">vía {item.source_name}</span> : null}
              {item.published_at ? (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(item.published_at).toLocaleDateString("es-AR", { year: "numeric", month: "short" })}
                </span>
              ) : null}
            </div>

            {item.summary ? (
              <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{item.summary}</p>
            ) : null}

            {item.results ? (
              <div className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="h-3 w-3" />
                {item.results}
              </div>
            ) : null}
          </div>

          {isSuperAdmin ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              onClick={() => onDelete(item.id)}
              aria-label="Eliminar"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
