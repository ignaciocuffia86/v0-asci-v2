"use client"

import * as React from "react"

// Minimal chart tooltip for Recharts
export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>
  label?: string
  labelFormatter?: (label: string) => string
  valueFormatter?: (value: number) => string
}) {
  if (!active || !payload?.length) return null

  const formattedLabel = labelFormatter ? labelFormatter(label || "") : label

  return (
    <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
      {formattedLabel && (
        <div className="mb-1.5 font-medium text-foreground">{formattedLabel}</div>
      )}
      <div className="grid gap-1">
        {payload.map((item, index) => (
          <div key={index} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-muted-foreground">{item.name}</span>
            </div>
            <span className="font-mono font-medium tabular-nums text-foreground">
              {valueFormatter && item.value !== undefined
                ? valueFormatter(item.value)
                : item.value?.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
