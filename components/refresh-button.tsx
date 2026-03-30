"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

interface RefreshButtonProps {
  canRefresh: boolean
  lastSearchDate: string | null
  daysUntilRefresh: number
  isSuperadmin: boolean
  onRefresh: () => Promise<void> | void
  isLoading: boolean
  showLabel?: boolean
}

export function RefreshButton({
  canRefresh,
  lastSearchDate,
  daysUntilRefresh,
  isSuperadmin,
  onRefresh,
  isLoading,
  showLabel = true,
}: RefreshButtonProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }

  const isDisabled = !canRefresh || isLoading || isRefreshing

  return (
    <div className="flex items-center gap-2">
      {lastSearchDate && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Última búsqueda:{" "}
          {formatDistanceToNow(new Date(lastSearchDate), {
            addSuffix: true,
            locale: es,
          })}
        </span>
      )}

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isDisabled}
                className={cn(
                  "gap-2",
                  isDisabled && "opacity-50 cursor-not-allowed"
                )}
              >
                <RefreshCw
                  className={cn(
                    "h-4 w-4",
                    isRefreshing && "animate-spin"
                  )}
                />
                {showLabel && "Refrescar"}
              </Button>
            </div>
          </TooltipTrigger>
          {!canRefresh && (
            <TooltipContent>
              <div className="text-sm space-y-1">
                <p>Disponible en {daysUntilRefresh} día{daysUntilRefresh !== 1 ? "s" : ""}</p>
                <p className="text-xs text-muted-foreground">
                  Se puede refrescar una vez al mes
                </p>
                {isSuperadmin && (
                  <p className="text-xs text-amber-600 font-medium">
                    Como superadmin, puedes forzar refresh con force_refresh=true
                  </p>
                )}
              </div>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}
