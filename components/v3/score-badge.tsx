import { cn } from "@/lib/utils"

/**
 * Badge de score 0-100 con semáforo:
 * ≥70 verde (caliente), 40-69 ámbar (tibia), <40 gris (fría).
 */
export function ScoreBadge({ score, className }: { score: number | null; className?: string }) {
  if (score === null || score === undefined) {
    return <span className={cn("text-sm text-muted-foreground", className)}>—</span>
  }

  const tone =
    score >= 70
      ? "bg-green-500/15 text-green-600 dark:text-green-400"
      : score >= 40
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : "bg-muted text-muted-foreground"

  return (
    <span
      className={cn(
        "inline-flex min-w-9 items-center justify-center rounded-full px-2 py-0.5 text-sm font-semibold tabular-nums",
        tone,
        className
      )}
    >
      {score}
    </span>
  )
}
