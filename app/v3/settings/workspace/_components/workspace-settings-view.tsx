"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { 
  Users, 
  Mail, 
  Shield, 
  Clock, 
  MoreVertical,
  UserPlus,
  Trash2,
  Loader2,
  CheckCircle,
  XCircle
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { changeMemberRole, approveAccessRequest, rejectAccessRequest } from "@/app/actions/v3/workspace"
import { toast } from "sonner"

interface WorkspaceSettingsViewProps {
  workspace: {
    id: string
    name: string
    domain: string
  }
  members: Array<{
    id: string
    user_id: string
    role: string
    status: string
    created_at: string
    profiles?: {
      email: string
      full_name: string | null
    } | null
  }>
  currentUserId: string
  isAdmin: boolean
}

export function WorkspaceSettingsView({ 
  workspace, 
  members, 
  currentUserId, 
  isAdmin 
}: WorkspaceSettingsViewProps) {
  const router = useRouter()
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor")
  const [loading, setLoading] = useState(false)
  
  const activeMembers = members.filter(m => m.status === "active")
  const pendingMembers = members.filter(m => m.status === "pending")
  
  const handleInvite = async () => {
    // TODO: Implementar inviteMember action
    toast.info("Funcionalidad de invitacion en desarrollo")
    setInviteDialogOpen(false)
  }
  
  const handleRoleChange = async (memberId: string, newRole: string) => {
    const result = await changeMemberRole(memberId, newRole as "admin" | "editor" | "viewer")
    if (result.success) {
      toast.success("Rol actualizado")
      router.refresh()
    } else {
      toast.error(result.error || "Error al actualizar rol")
    }
  }
  
  const handleAccept = async (memberId: string) => {
    const result = await approveAccessRequest(memberId)
    if (result.success) {
      toast.success("Solicitud aceptada")
      router.refresh()
    } else {
      toast.error(result.error || "Error al aceptar")
    }
  }
  
  const handleReject = async (memberId: string) => {
    const result = await rejectAccessRequest(memberId)
    if (result.success) {
      toast.success("Solicitud rechazada")
      router.refresh()
    } else {
      toast.error(result.error || "Error al rechazar")
    }
  }
  
  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin": return "default"
      case "editor": return "secondary"
      default: return "outline"
    }
  }
  
  const getInitials = (name: string | null, email: string) => {
    if (name) {
      return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    }
    return email.slice(0, 2).toUpperCase()
  }
  
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Workspace</h2>
          <p className="text-sm text-muted-foreground">
            Gestiona los miembros de {workspace.name}
          </p>
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
                  Envia una invitacion a un nuevo miembro del workspace
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
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "editor" | "viewer")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
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
                  Enviar invitacion
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      
      {/* Pending Requests */}
      {pendingMembers.length > 0 && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="size-4" />
              Solicitudes pendientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              {pendingMembers.map((member) => (
                <div key={member.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-9">
                      <AvatarFallback className="text-xs">
                        {getInitials(member.profiles?.full_name || null, member.profiles?.email || "")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">
                        {member.profiles?.full_name || member.profiles?.email || "Usuario"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {member.profiles?.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => handleReject(member.id)}
                    >
                      <XCircle className="mr-1 size-4" />
                      Rechazar
                    </Button>
                    <Button 
                      size="sm"
                      onClick={() => handleAccept(member.id)}
                    >
                      <CheckCircle className="mr-1 size-4" />
                      Aceptar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Active Members */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" />
            Miembros activos ({activeMembers.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {activeMembers.map((member) => (
              <div key={member.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="flex items-center gap-3">
                  <Avatar className="size-9">
                    <AvatarFallback className="text-xs">
                      {getInitials(member.profiles?.full_name || null, member.profiles?.email || "")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">
                        {member.profiles?.full_name || "Usuario"}
                      </p>
                      {member.user_id === currentUserId && (
                        <Badge variant="outline" className="text-xs">Tu</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {member.profiles?.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={getRoleBadgeVariant(member.role)}>
                    {member.role}
                  </Badge>
                  
                  {isAdmin && member.user_id !== currentUserId && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleRoleChange(member.id, "admin")}>
                          <Shield className="mr-2 size-4" />
                          Hacer admin
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRoleChange(member.id, "editor")}>
                          <Mail className="mr-2 size-4" />
                          Hacer editor
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRoleChange(member.id, "viewer")}>
                          <Users className="mr-2 size-4" />
                          Hacer viewer
                        </DropdownMenuItem>
                        {/* TODO: Implementar removeMember action
                        <DropdownMenuItem 
                          onClick={() => toast.info("Funcionalidad en desarrollo")}
                          className="text-destructive"
                        >
                          <Trash2 className="mr-2 size-4" />
                          Remover
                        </DropdownMenuItem>
                        */}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
