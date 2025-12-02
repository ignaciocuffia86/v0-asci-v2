"use client"

import { Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type ScoreTooltipProps = {
  totalScore: number
  currentScore: number
  alumniScore: number
  jobPostingsScore: number
  currentCount: number
  alumniCount: number
  jobPostingsCount: number
  className?: string
}

export function ScoreTooltip({
  totalScore,
  currentScore,
  alumniScore,
  jobPostingsScore,
  currentCount,
  alumniCount,
  jobPostingsCount,
  className,
}: ScoreTooltipProps) {
  const getScoreColor = (score: number) => {
    if (score >= 70) return "bg-green-500"
    if (score >= 40) return "bg-yellow-500"
    return "bg-gray-300"
  }

  const getPercentile = (score: number) => {
    if (score >= 90) return "top 10%"
    if (score >= 70) return "top 30%"
    if (score >= 50) return "promedio"
    return "por debajo del promedio"
  }

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button className={cn("inline-flex items-center gap-1.5 group", className)}>
            <span className="font-bold text-lg">{Math.round(totalScore)}</span>
            <Info className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="w-72 p-4">
          <div className="space-y-4">
            <div>
              <p className="font-semibold text-sm mb-1">Desglose del Score: {Math.round(totalScore)}</p>
              <p className="text-xs text-muted-foreground">
                Esta empresa está en el {getPercentile(totalScore)} de relevancia
              </p>
            </div>

            {/* Empleados Actuales */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span>Empleados actuales</span>
                <span className="font-medium">
                  {Math.round(currentScore * 0.4)}/40 ({currentCount})
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", getScoreColor(currentScore))}
                  style={{ width: `${Math.min(currentScore, 100)}%` }}
                />
              </div>
            </div>

            {/* Alumni */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span>Alumni</span>
                <span className="font-medium">
                  {Math.round(alumniScore * 0.3)}/30 ({alumniCount})
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", getScoreColor(alumniScore))}
                  style={{ width: `${Math.min(alumniScore, 100)}%` }}
                />
              </div>
            </div>

            {/* Búsquedas Laborales */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span>Búsquedas activas</span>
                <span className="font-medium">
                  {Math.round(jobPostingsScore * 0.3)}/30 ({jobPostingsCount})
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", getScoreColor(jobPostingsScore))}
                  style={{ width: `${Math.min(jobPostingsScore, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

type ScoringExplanationProps = {
  className?: string
}

export function ScoringExplanation({ className }: ScoringExplanationProps) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors",
              className,
            )}
          >
            <Info className="h-4 w-4" />
            <span>Cómo calculamos el Score</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="w-80 p-4">
          <div className="space-y-3">
            <p className="font-semibold text-sm">El score combina 3 señales:</p>

            <ul className="space-y-2 text-sm">
              <li className="flex gap-2">
                <span className="font-medium text-primary">40%</span>
                <div>
                  <span className="font-medium">Empleados actuales</span>
                  <p className="text-xs text-muted-foreground">Personas usando la tecnología HOY</p>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="font-medium text-primary">30%</span>
                <div>
                  <span className="font-medium">Alumni</span>
                  <p className="text-xs text-muted-foreground">Ex-empleados con experiencia previa</p>
                </div>
              </li>
              <li className="flex gap-2">
                <span className="font-medium text-primary">30%</span>
                <div>
                  <span className="font-medium">Búsquedas laborales</span>
                  <p className="text-xs text-muted-foreground">Contratando activamente (últimos 6 meses)</p>
                </div>
              </li>
            </ul>

            <p className="text-xs text-muted-foreground border-t pt-2">
              Un score de 50 es el promedio. Mayor score = más señales detectadas vs otras empresas.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

type ProvidersFilterTooltipProps = {
  className?: string
}

export function ProvidersFilterTooltip({ className }: ProvidersFilterTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Info className={cn("h-4 w-4 text-muted-foreground hover:text-foreground cursor-help", className)} />
        </TooltipTrigger>
        <TooltipContent side="right" align="start" className="w-64 p-3">
          <div className="space-y-2">
            <p className="font-semibold text-sm">Excluye estas industrias:</p>
            <ul className="text-xs space-y-1 text-muted-foreground">
              <li>• Information Technology & Services</li>
              <li>• Management Consulting</li>
              <li>• Computer Software</li>
              <li>• Staffing & Recruiting</li>
              <li>• Accounting</li>
            </ul>
            <p className="text-xs text-muted-foreground border-t pt-2">
              Útil para encontrar clientes finales, no competidores o consultoras.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
