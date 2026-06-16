"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import {
  Users,
  Mail,
  Shield,
  MoreVertical,
  UserPlus,
  Trash2,
  Loader2,
  Copy,
  Ban,
  User as UserIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  inviteMember,
  changeMemberRole,
  removeMember,
  revokeMemberInvitation,
} from "@/app/actions/v3/workspace"
import type { WorkspaceMemberWithIdentity, WorkspaceRole, Workspace } from "@/lib/v3/workspace"
import type { InvitationWithInviter } from "@/lib/v3/invitations"
import { toast } from "sonner"

interface WorkspaceSettingsViewProps {
  workspace: Workspace
  members: WorkspaceMemberWithIdentity[]
  pendingInvitations: InvitationWithInviter[]
  currentUserId: string
  isAdmin: boolean
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  admin: "Admin",
  member: "Miembro",
}

export function WorkspaceSettingsView({
  workspace,
  members,
  pendingInvitations,
  currentUserId,
  isAdmin,
}: WorkspaceSettingsViewProps) {
  const router = useRouter()
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member")
  const [loading, setLoading] = useState(false)

  const activeMembers = members.filter((m) => m.status === "active")

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setLoading(true)
    try {
      const result = await inviteMember(inviteEmail.trim().toLowerCase(), inviteRole)
      if (!result.success) {
        toast.error(result.error || "No se pudo invitar")
        return
      }

      if (result.emailSent) {
        toast.success("Invitación enviada por email")
      } else if (result.inviteUrl) {
        await navigator.clipboard.writeText(result.inviteUrl).catch(() => {})
        toast.success("Invitación creada. Link copiado al portapapeles", {
          description: result.error ? `Email no enviado: ${result.error}` : result.inviteUrl,
        })
      } else {
        toast.success("Invitación creada")
      }

      setInviteEmail("")
      setInviteRole("member")
      setInviteDialogOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error inesperado")
    } finally {
      setLoading(false)
    }
  }

  const handleRoleChange = async (memberId: string, newRole: WorkspaceRole) => {
    const result = await changeMemberRole(memberId, newRole)
    if (result.success) {
      toast.success("Rol actualizado")
      router.refresh()
    } else {
      toast.error(result.error || "Error al actualizar rol")
    }
  }

  const handleRemove = async (memberId: string) => {
    const result = await removeMember(memberId)
    if (result.success) {
      toast.success("Miembro removido")
      router.refresh()
    } else {
      toast.error(result.error || "Error al remover")
    }
  }

  const handleRevoke = async (invitationId: string) => {
    const result = await revokeMemberInvitation(invitationId)
    if (result.success) {
      toast.success("Invitación revocada")
      router.refresh()
    } else {
      toast.error(result.error || "Error al revocar")
    }
  }

  const handleCopyInvite = async (token: string) => {
    const url = `${window.location.origin}/invite/${token}`
    await navigator.clipboard.writeText(url).catch(() => {})
    toast.success("Link copiado al portapapeles")
  }

  const getInitials = (name: string | null, email: string | null) => {
    if (name) {
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    }
    return (email || "??").slice(0, 2).toUpperCase()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Workspace</h2>
          <p className="text-sm text-muted-foreground">Gestiona los miembros de {workspace.name}</p>
        </div>

        {isAdmin && (
          <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus className="mr-2 size-4" />
                Invitar
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invitar miembro</DialogTitle>
                <DialogDescription>
                  Se enviará un email con el link de invitación. La persona puede ser de cualquier
                  dominio.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={`usuario@${workspace.domain}`}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="role">Rol</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as WorkspaceRole)}>
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Miembro</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleInvite} disabled={loading || !inviteEmail}>
                  {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Enviar invitación
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">
            <Users className="mr-2 size-4" />
            Miembros ({activeMembers.length})
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="invitations">
              <Mail className="mr-2 size-4" />
              Invitaciones ({pendingInvitations.length})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="members">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4 text-muted-foreground" />
                Miembros activos
              </CardTitle>
              <CardDescription>
                Todos los miembros pueden crear y editar campañas y documentos. Los admins además
                gestionan miembros e invitaciones.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {activeMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9">
                        <AvatarFallback className="text-xs">
                          {getInitials(member.full_name, member.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {member.full_name || member.email || "Usuario"}
                          </p>
                          {member.user_id === currentUserId && (
                            <Badge variant="outline" className="text-xs">
                              Tú
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={member.role === "admin" ? "default" : "secondary"}>
                        {ROLE_LABELS[member.role]}
                      </Badge>

                      {isAdmin && member.user_id !== currentUserId && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                              <MoreVertical className="size-4" />
                              <span className="sr-only">Acciones</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {member.role === "member" ? (
                              <DropdownMenuItem onClick={() => handleRoleChange(member.id, "admin")}>
                                <Shield className="mr-2 size-4" />
                                Hacer admin
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => handleRoleChange(member.id, "member")}>
                                <UserIcon className="mr-2 size-4" />
                                Hacer miembro
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleRemove(member.id)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 size-4" />
                              Remover del workspace
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="invitations">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="size-4 text-muted-foreground" />
                  Invitaciones pendientes
                </CardTitle>
                <CardDescription>
                  Personas invitadas que todavía no aceptaron. El link expira a los 7 días.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {pendingInvitations.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No hay invitaciones pendientes.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {pendingInvitations.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between rounded-lg border border-border p-3"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="size-9">
                            <AvatarFallback className="text-xs">
                              {(inv.email || "??").slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium text-foreground">{inv.email}</p>
                            <p className="text-xs text-muted-foreground">
                              Invitado {format(new Date(inv.created_at), "d MMM yyyy", { locale: es })}
                              {inv.inviter_name ? ` por ${inv.inviter_name}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={inv.role === "admin" ? "default" : "secondary"}>
                            {ROLE_LABELS[inv.role]}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleCopyInvite(inv.token)}
                            title="Copiar link"
                          >
                            <Copy className="size-4" />
                            <span className="sr-only">Copiar link de invitación</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            onClick={() => handleRevoke(inv.id)}
                            title="Revocar"
                          >
                            <Ban className="size-4" />
                            <span className="sr-only">Revocar invitación</span>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
