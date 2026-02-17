"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Users, Building2, Zap, Briefcase } from "lucide-react"

interface StatsOverviewProps {
  contacts: number
  companies: number
  signals: number
  signalsByType: { process: number; technology: number }
  jobPostings?: number
}

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export function StatsOverview({ contacts, companies, signals, signalsByType, jobPostings }: StatsOverviewProps) {
  const stats = [
    {
      label: "Contactos",
      value: formatNumber(contacts),
      icon: Users,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      label: "Companias",
      value: formatNumber(companies),
      icon: Building2,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Senales",
      value: formatNumber(signals),
      icon: Zap,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-500/10",
      sub: `${formatNumber(signalsByType.process)} procesos / ${formatNumber(signalsByType.technology)} tecnologias`,
    },
    {
      label: "Job Postings",
      value: formatNumber(jobPostings ?? 0),
      icon: Briefcase,
      color: "text-violet-600 dark:text-violet-400",
      bg: "bg-violet-500/10",
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label}>
          <CardContent className="flex items-start gap-3 p-4">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${s.bg}`}>
              <s.icon className={`h-5 w-5 ${s.color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold tracking-tight">{s.value}</p>
              {s.sub && <p className="truncate text-xs text-muted-foreground">{s.sub}</p>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
