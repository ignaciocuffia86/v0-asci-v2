"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { MessageSquare, Search, Star, StarOff, Users, FlaskConical, Plus } from "lucide-react"
import {
  toggleDigestSubscription,
  unfollowAccountAction,
  followAccountAction,
  type ResearchedAccount,
} from "@/app/actions/v3/accounts"
import type { FollowedAccountWithCompany } from "@/lib/v3/services/accounts"
import { ScoreBadge } from "@/components/v3/score-badge"

interface AccountsViewProps {
  accounts: FollowedAccountWithCompany[]
  researched?: ResearchedAccount[]
}

export function AccountsView({ accounts, researched = [] }: AccountsViewProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [isPending, startTransition] = useTransition()
  const [unfollowTarget, setUnfollowTarget] = useState<FollowedAccountWithCompany | null>(null)

  const filtered = accounts.filter((a) => {
    const q = search.toLowerCase()
    return (
      !q ||
      a.company?.name?.toLowerCase().includes(q) ||
      a.company?.website?.toLowerCase().includes(q) ||
      a.company?.industry?.toLowerCase().includes(q)
    )
  })

  const handleToggleDigest = (account: FollowedAccountWithCompany) => {
    startTransition(async () => {
      await toggleDigestSubscription(account.id, !account.isSubscribed)
      router.refresh()
    })
  }

  const handleUnfollow = () => {
    if (!unfollowTarget) return
    startTransition(async () => {
      await unfollowAccountAction(unfollowTarget.company_id)
      setUnfollowTarget(null)
      router.refresh()
    })
  }

  const handleFollowResearched = (companyId: string) => {
    startTransition(async () => {
      await followAccountAction(companyId)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cuentas seguidas</h1>
          <p className="text-sm text-muted-foreground">
            {accounts.length === 0
              ? "Aún no seguís ninguna cuenta"
              : `${accounts.length} ${accounts.length === 1 ? "cuenta seguida" : "cuentas seguidas"} · refresh mensual automático`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Buscar cuenta..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 pl-8"
            />
          </div>
          <Button asChild>
            <Link href="/v3/chat">
              <MessageSquare data-icon="inline-start" />
              Investigar
            </Link>
          </Button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Star className="size-10 text-muted-foreground" />
            <div>
              <p className="font-medium">Todavía no seguís ninguna cuenta</p>
              <p className="text-sm text-muted-foreground text-pretty">
                Investigá empresas desde el chat y seguí las que te interesen para recibir
                novedades mensuales por correo.
              </p>
            </div>
            <Button asChild>
              <Link href="/v3/chat">Ir al chat</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cuenta</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead className="hidden md:table-cell">Industria</TableHead>
                  <TableHead className="hidden md:table-cell">Último refresh</TableHead>
                  <TableHead className="text-center">
                    <span className="inline-flex items-center gap-1">
                      Digest
                    </span>
                  </TableHead>
                  <TableHead className="hidden text-center lg:table-cell">
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" /> Suscriptos
                    </span>
                  </TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell>
                      <Link
                        href={`/v3/accounts/${account.company_id}`}
                        className="flex flex-col hover:underline"
                      >
                        <span className="font-medium">{account.company?.name ?? "Sin nombre"}</span>
                        <span className="text-xs text-muted-foreground">
                          {account.company?.website ?? ""}
                          {account.company?.country ? ` · ${account.company.country}` : ""}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-center">
                      <ScoreBadge score={account.latestScore} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {account.company?.industry ? (
                        <Badge variant="secondary">{account.company.industry}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {account.last_refreshed_at
                        ? new Date(account.last_refreshed_at).toLocaleDateString("es", {
                            day: "numeric",
                            month: "short",
                          })
                        : "Pendiente"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={account.isSubscribed}
                        onCheckedChange={() => handleToggleDigest(account)}
                        disabled={isPending}
                        aria-label={`Suscripción al digest de ${account.company?.name ?? "cuenta"}`}
                      />
                    </TableCell>
                    <TableCell className="hidden text-center text-sm lg:table-cell">
                      {account.subscriberCount}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setUnfollowTarget(account)}
                        aria-label={`Dejar de seguir ${account.company?.name ?? "cuenta"}`}
                      >
                        <StarOff className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      Sin resultados para &quot;{search}&quot;
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {researched.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <FlaskConical className="size-4 text-muted-foreground" />
              Investigadas recientemente
            </h2>
            <p className="text-sm text-muted-foreground">
              Empresas investigadas en los últimos 30 días que todavía no seguís
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {researched.map((r) => (
              <Card key={r.companyId}>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/v3/accounts/${r.companyId}`}
                      className="flex flex-col hover:underline"
                    >
                      <span className="font-medium">{r.companyName}</span>
                      <span className="text-xs text-muted-foreground">
                        {[r.industry, r.country].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </Link>
                    <Badge variant="secondary" className="shrink-0">
                      {new Date(r.researchedAt).toLocaleDateString("es", {
                        day: "numeric",
                        month: "short",
                      })}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="text-muted-foreground">
                      {r.totalSignals} {r.totalSignals === 1 ? "señal" : "señales"}
                    </span>
                    {r.fitCount > 0 && (
                      <Badge variant="outline" className="border-primary/40 text-primary">
                        {r.fitCount} fit
                      </Badge>
                    )}
                  </div>
                  {r.topMatches.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.topMatches.slice(0, 4).map((term) => (
                        <Badge key={term} variant="secondary" className="text-xs font-normal">
                          {term}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="mt-auto flex items-center gap-2">
                    <Button asChild size="sm" variant="outline" className="flex-1 bg-transparent">
                      <Link href={`/v3/accounts/${r.companyId}`}>Ver detalle</Link>
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={isPending}
                      onClick={() => handleFollowResearched(r.companyId)}
                    >
                      <Plus data-icon="inline-start" />
                      Seguir
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <AlertDialog open={!!unfollowTarget} onOpenChange={(open) => !open && setUnfollowTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Dejar de seguir esta cuenta?</AlertDialogTitle>
            <AlertDialogDescription>
              {unfollowTarget?.subscriberCount && unfollowTarget.subscriberCount > 1
                ? `Hay ${unfollowTarget.subscriberCount} personas suscriptas al digest de ${unfollowTarget?.company?.name}. Al dejar de seguirla, nadie del workspace recibirá más novedades.`
                : `Se dejará de refrescar la información de ${unfollowTarget?.company?.name} y no se enviarán más digests.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleUnfollow} disabled={isPending}>
              Dejar de seguir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
