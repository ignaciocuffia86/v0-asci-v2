"use client"

import { useMemo, useState, useTransition } from "react"
import { setMemberStatus, type AdminUserRow } from "@/app/actions/v3/admin-users"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Search, ShieldCheck, UserX, UserCheck, Loader2 } from "lucide-react"
import { toast } from "sonner"

export function AdminUsersView({
  initialUsers,
  loadError,
}: {
  initialUsers: AdminUserRow[]
  loadError?: string
}) {
  const [users, setUsers] = useState(initialUsers)
  const [query, setQuery] = useState("")
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return users
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.workspaceName.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q),
    )
  }, [users, query])

  const toggleStatus = (u: AdminUserRow) => {
    const nextStatus = u.status === "active" ? "disabled" : "active"
    const key = `${u.userId}:${u.workspaceId}`
    setPendingKey(key)
    startTransition(async () => {
      const result = await setMemberStatus({
        userId: u.userId,
        workspaceId: u.workspaceId,
        status: nextStatus,
      })
      if (result.success) {
        setUsers((prev) =>
          prev.map((x) =>
            x.userId === u.userId && x.workspaceId === u.workspaceId ? { ...x, status: nextStatus } : x,
          ),
        )
        toast.success(nextStatus === "active" ? "Usuario activado" : "Usuario desactivado")
      } else {
        toast.error(result.error ?? "Error al actualizar el estado")
      }
      setPendingKey(null)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {loadError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por email, workspace o rol…"
            className="pl-9"
            aria-label="Buscar usuarios"
          />
        </div>
        <p className="shrink-0 text-sm text-muted-foreground">
          {filtered.length} de {users.length} membresías
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No se encontraron usuarios.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Alta</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => {
                  const key = `${u.userId}:${u.workspaceId}`
                  const isPending = pendingKey === key
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-1.5">
                          {u.email}
                          {u.isSuperAdmin && (
                            <ShieldCheck
                              className="size-3.5 text-primary"
                              aria-label="Super administrador"
                            />
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{u.workspaceName}</TableCell>
                      <TableCell>
                        <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.status === "active" ? "outline" : "destructive"}>
                          {u.status === "active" ? "activo" : u.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(u.joinedAt).toLocaleDateString("es-AR", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => toggleStatus(u)}
                          aria-label={
                            u.status === "active"
                              ? `Desactivar a ${u.email}`
                              : `Activar a ${u.email}`
                          }
                        >
                          {isPending ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : u.status === "active" ? (
                            <>
                              <UserX className="size-4" aria-hidden="true" />
                              Desactivar
                            </>
                          ) : (
                            <>
                              <UserCheck className="size-4" aria-hidden="true" />
                              Activar
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
