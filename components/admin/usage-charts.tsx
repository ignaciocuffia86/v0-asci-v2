"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartTooltipContent } from "@/components/ui/chart"

// -- Colors (computed, not CSS vars) --
const COLORS = {
  primary: "#2563eb",
  secondary: "#8b5cf6",
  accent: "#f59e0b",
  success: "#10b981",
  danger: "#ef4444",
  muted: "#94a3b8",
  sky: "#0ea5e9",
  pink: "#ec4899",
  orange: "#f97316",
  indigo: "#6366f1",
}

const ONBOARDING_COLORS = {
  completed: COLORS.success,
  in_progress: COLORS.primary,
  skipped: COLORS.accent,
  pending: COLORS.muted,
}

// -- Types --
export interface UserActivityData {
  email: string
  bookmarks: number
  contacts: number
  news: number
  implementations: number
  strategies: number
  icebreakers: number
  briefs: number
  documents: number
}

export interface OnboardingStatusData {
  name: string
  value: number
  color: string
}

export interface FeatureUsageData {
  name: string
  count: number
  color: string
}

export interface WeeklyActivityData {
  week: string
  bookmarks: number
  contacts: number
  icebreakers: number
  briefs: number
  documents: number
}

// -- 1. User Activity Bar Chart --
export function UserActivityChart({ data }: { data: UserActivityData[] }) {
  // Sort by total activity descending
  const sorted = [...data]
    .map((d) => ({
      ...d,
      total: d.bookmarks + d.contacts + d.news + d.implementations + d.strategies + d.icebreakers + d.briefs + d.documents,
      name: d.email,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Actividad por Usuario</CardTitle>
        <CardDescription>Top 15 usuarios por acciones totales en la plataforma</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sorted} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10 }}
                angle={-40}
                textAnchor="end"
                height={80}
                interval={0}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                content={({ active, payload, label }) => (
                  <ChartTooltipContent active={active} payload={payload as never} label={label} />
                )}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="bookmarks" name="Bookmarks" fill={COLORS.primary} stackId="a" radius={[0, 0, 0, 0]} />
              <Bar dataKey="contacts" name="Prospectos" fill={COLORS.secondary} stackId="a" />
              <Bar dataKey="icebreakers" name="Icebreakers" fill={COLORS.accent} stackId="a" />
              <Bar dataKey="briefs" name="Briefs" fill={COLORS.success} stackId="a" />
              <Bar dataKey="strategies" name="Estrategias" fill={COLORS.sky} stackId="a" />
              <Bar dataKey="news" name="Noticias" fill={COLORS.orange} stackId="a" />
              <Bar dataKey="implementations" name="Impl." fill={COLORS.pink} stackId="a" />
              <Bar dataKey="documents" name="Docs" fill={COLORS.indigo} stackId="a" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// -- 2. Onboarding Status Pie Chart --
export function OnboardingPieChart({ data }: { data: OnboardingStatusData[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Estado de Onboarding</CardTitle>
        <CardDescription>Distribucion de usuarios por estado del tour</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={3}
                dataKey="value"
                labelLine={false}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} stroke={entry.color} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const item = payload[0]
                  const entry = data.find((d) => d.name === item.name)
                  return (
                    <div className="rounded-lg border border-border/50 bg-background px-3 py-2 text-xs shadow-xl">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry?.color }} />
                        <span className="font-medium">{item.name}</span>
                        <span className="font-mono font-medium ml-auto">
                          {String(item.value)} ({total > 0 ? Math.round((Number(item.value) / total) * 100) : 0}%)
                        </span>
                      </div>
                    </div>
                  )
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        {/* Custom legend with proper colors */}
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center gap-1.5 text-xs">
              <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
              <span className="text-muted-foreground">{entry.name}</span>
              <span className="font-mono font-medium text-foreground">{entry.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// -- 3. Feature Usage Horizontal Bar Chart --
export function FeatureUsageChart({ data }: { data: FeatureUsageData[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Uso de Features</CardTitle>
        <CardDescription>Total de acciones por feature en toda la plataforma</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={100} />
              <Tooltip
                content={({ active, payload, label }) => (
                  <ChartTooltipContent active={active} payload={payload as never} label={label} />
                )}
              />
              <Bar dataKey="count" name="Total" radius={[0, 4, 4, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// -- 4. Weekly Activity Area Chart --
export function WeeklyActivityChart({ data }: { data: WeeklyActivityData[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Actividad Semanal</CardTitle>
        <CardDescription>Evolucion de acciones en las ultimas 8 semanas</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="gradBookmarks" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradContacts" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.secondary} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.secondary} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradIcebreakers" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.accent} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.accent} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradBriefs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.success} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradDocuments" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.indigo} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={COLORS.indigo} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                content={({ active, payload, label }) => (
                  <ChartTooltipContent active={active} payload={payload as never} label={label} />
                )}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="bookmarks" name="Bookmarks" stroke={COLORS.primary} fill="url(#gradBookmarks)" strokeWidth={2} />
              <Area type="monotone" dataKey="contacts" name="Prospectos" stroke={COLORS.secondary} fill="url(#gradContacts)" strokeWidth={2} />
              <Area type="monotone" dataKey="icebreakers" name="Icebreakers" stroke={COLORS.accent} fill="url(#gradIcebreakers)" strokeWidth={2} />
              <Area type="monotone" dataKey="briefs" name="Briefs" stroke={COLORS.success} fill="url(#gradBriefs)" strokeWidth={2} />
              <Area type="monotone" dataKey="documents" name="Documentos" stroke={COLORS.indigo} fill="url(#gradDocuments)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

export { COLORS, ONBOARDING_COLORS }
