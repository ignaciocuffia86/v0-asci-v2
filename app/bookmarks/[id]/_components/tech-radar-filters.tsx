"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MICRO_AGENT_LABELS, type MicroAgent } from "@/lib/tech-radar"

export type EvidenceFilter = "todos" | "directa" | "convergente" | "inferencia"

interface Props {
  agentCounts: Record<string, number>
  evidenceCounts: Record<EvidenceFilter, number>
  selectedAgent: string | null
  selectedEvidence: EvidenceFilter
  onAgentChange: (agent: string | null) => void
  onEvidenceChange: (evidence: EvidenceFilter) => void
}

const EVIDENCE_OPTIONS: { value: EvidenceFilter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "directa", label: "Directa" },
  { value: "convergente", label: "Convergente" },
  { value: "inferencia", label: "Inferencia" },
]

export function TechRadarFilters({
  agentCounts,
  evidenceCounts,
  selectedAgent,
  selectedEvidence,
  onAgentChange,
  onEvidenceChange,
}: Props) {
  // Mostrar solo micro-agentes con al menos 1 hallazgo, ordenados por cantidad desc.
  const visibleAgents = Object.entries(agentCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-col gap-3">
      {/* Filtro por nivel de evidencia */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidencia</span>
        {EVIDENCE_OPTIONS.map((opt) => {
          const count = evidenceCounts[opt.value] ?? 0
          const active = selectedEvidence === opt.value
          return (
            <Button
              key={opt.value}
              size="sm"
              variant={active ? "default" : "outline"}
              className="h-7 gap-1.5 px-2.5 text-xs"
              onClick={() => onEvidenceChange(opt.value)}
            >
              {opt.label}
              <Badge
                variant={active ? "secondary" : "outline"}
                className="h-4 px-1.5 text-[10px] font-normal"
              >
                {count}
              </Badge>
            </Button>
          )
        })}
      </div>

      {/* Filtro por micro-agente */}
      {visibleAgents.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Categoría</span>
          <Button
            size="sm"
            variant={selectedAgent === null ? "default" : "outline"}
            className="h-7 px-2.5 text-xs"
            onClick={() => onAgentChange(null)}
          >
            Todas
          </Button>
          {visibleAgents.map(([agent, count]) => {
            const active = selectedAgent === agent
            const label = MICRO_AGENT_LABELS[agent as MicroAgent] ?? agent
            return (
              <Button
                key={agent}
                size="sm"
                variant={active ? "default" : "outline"}
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={() => onAgentChange(agent)}
              >
                {label}
                <Badge
                  variant={active ? "secondary" : "outline"}
                  className="h-4 px-1.5 text-[10px] font-normal"
                >
                  {count}
                </Badge>
              </Button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
