"use client"

// User management dashboard for admin panel
import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Users,
  UserPlus,
  Search,
  MoreHorizontal,
  Mail,
  Shield,
  ShieldAlert,
  ShieldOff,
  Trash2,
  KeyRound,
  Pencil,
  Upload,
  Ban,
  CheckCircle,
  Clock,
  AlertTriangle,
  Copy,
  Loader2,
  RefreshCw,
  Undo2,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { toast } from "sonner"

interface User {
  id: string
  email: string
  email_confirmed_at: string | null
  created_at: string
  last_sign_in_at: string | null
  banned_until: string | null
  scheduled_deletion_at: string | null
  full_name: string | null
  company: string | null
  role: string
  onboarding_status: string | null
  avatar_url: string | null
}

type DialogType = "create" | "bulk" | "edit" | "ban" | "delete" | "reset-password" | null

export function UserManagementDashboard() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  
  // Dialog state
  const [dialogType, setDialogType] = useState<DialogType>(null)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    email: "",
    full_name: "",
    role: "user",
    password: "",
    auto_confirm: true,
    ban_duration: "7d",
    send_email: true,
    bulk_emails: "",
  })
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/users")
      const data = await res.json()
      if (data.users) {
        setUsers(data.users)
      }
    } catch (err) {
      toast.error("Error al cargar usuarios")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  // Filtered users
  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.company?.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesRole = roleFilter === "all" || user.role === roleFilter
    
    const matchesStatus = 
      statusFilter === "all" ||
      (statusFilter === "active" && !user.banned_until) ||
      (statusFilter === "banned" && user.banned_until) ||
      (statusFilter === "unconfirmed" && !user.email_confirmed_at)
    
    return matchesSearch && matchesRole && matchesStatus
  })

  // Stats
  const stats = {
    total: users.length,
    active: users.filter(u => !u.banned_until && u.email_confirmed_at).length,
    banned: users.filter(u => u.banned_until).length,
    unconfirmed: users.filter(u => !u.email_confirmed_at).length,
    admins: users.filter(u => u.role === "superadmin").length,
  }

  const openDialog = (type: DialogType, user?: User) => {
    setSelectedUser(user || null)
    setDialogType(type)
    setGeneratedPassword(null)
    setFormData({
      email: user?.email || "",
      full_name: user?.full_name || "",
      role: user?.role || "user",
      password: "",
      auto_confirm: true,
      ban_duration: "7d",
      send_email: true,
      bulk_emails: "",
    })
  }

  const closeDialog = () => {
    setDialogType(null)
    setSelectedUser(null)
    setGeneratedPassword(null)
  }

  // Actions
  const handleCreateUser = async () => {
    setActionLoading(true)
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          full_name: formData.full_name,
          role: formData.role,
          password: formData.password || undefined,
          auto_confirm: formData.auto_confirm,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success("Usuario creado exitosamente")
        if (data.generated_password) {
          setGeneratedPassword(data.generated_password)
        } else {
          closeDialog()
          fetchUsers()
        }
      } else {
        toast.error(data.error || "Error al crear usuario")
      }
    } catch {
      toast.error("Error de conexion")
    } finally {
      setActionLoading(false)
    }
  }

  const handleBulkImport = async () => {
    const emails = formData.bulk_emails
      .split(/[\n,;]/)
      .map(e => e.trim())
      .filter(e => e)
    
    if (emails.length === 0) {
      toast.error("Ingresa al menos un email")
      return
    }

    setActionLoading(true)
    try {
      const res = await fetch("/api/admin/users/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails,
          default_password: formData.password || undefined,
          auto_confirm: formData.auto_confirm,
          default_role: formData.role,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`Importados: ${data.summary.success} de ${data.summary.total}`)
        if (data.summary.failed > 0) {
          toast.warning(`${data.summary.failed} usuarios fallaron`)
        }
        if (data.generated_password) {
          setGeneratedPassword(data.generated_password)
        } else {
          closeDialog()
          fetchUsers()
        }
      } else {
        toast.error(data.error || "Error en importacion")
      }
    } catch {
      toast.error("Error de conexion")
    } finally {
      setActionLoading(false)
    }
  }

  const handleUpdateUser = async () => {
    if (!selectedUser) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email !== selectedUser.email ? formData.email : undefined,
          full_name: formData.full_name,
          role: formData.role,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success("Usuario actualizado")
        closeDialog()
        fetchUsers()
      } else {
        toast.error(data.error || "Error al actualizar")
      }
    } catch {
      toast.error("Error de conexion")
    } finally {
      setActionLoading(false)
    }
  }

  const handleBanUser = async () => {
    if (!selectedUser) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ban_duration: formData.ban_duration }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success("Usuario bloqueado")
        closeDialog()
        fetchUsers()
      } else {
        toast.error(data.error || "Error al bloquear")
      }
    } catch {
      toast.error("Error de conexion")
    } finally {
      setActionLoading(false)
    }
  }

  const handleUnbanUser = async (user: User) => {
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unban: true }),
      })
      if (res.ok) {
        toast.success("Usuario desbloqueado")
        fetchUsers()
      } else {
        toast.error("Error al desbloquear")
      }
    } catch {
      toast.error("Error de conexion")
    }
  }

  const handleDeleteUser = async () => {
    if (!selectedUser) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: "DELETE",
      })
      const data = await res.json()
      if (res.ok) {
        toast.success("Usuario baneado y programado para eliminacion en 30 dias")
        fetchUsers()
      } else {
        toast.error(data.error || "Error al eliminar")
      }
    } catch {
      toast.error("Error de conexion")
    } finally {
      setActionLoading(false)
      closeDialog()
    }
  }

  const handleRestoreUser = async (user: User) => {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unban: true }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success("Usuario restaurado correctamente")
        fetchUsers()
      } else {
        toast.error(data.error || "Error al restaurar")
      }
    } catch {
      toast.error("Error de conexion")
    } finally {
      setActionLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!selectedUser) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          send_email: formData.send_email,
          new_password: formData.password || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        if (data.method === "email") {
          toast.success("Email de recuperacion enviado")
          closeDialog()
        } else if (data.temporary_password) {
          setGeneratedPassword(data.temporary_password)
          toast.success("Password temporal generado")
        } else {
          toast.success("Password actualizado")
          closeDialog()
        }
        fetchUsers()
      } else {
        toast.error(data.error || "Error al resetear password")
      }
    } catch {
      toast.error("Error de conexion")
    } finally {
      setActionLoading(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success("Copiado al portapapeles")
  }

  const getUserStatus = (user: User) => {
    if (user.scheduled_deletion_at) {
      const deletionDate = new Date(user.scheduled_deletion_at)
      const daysLeft = Math.ceil((deletionDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      return { 
        label: `Eliminacion en ${daysLeft}d`, 
        variant: "destructive" as const, 
        icon: Trash2 
      }
    }
    if (user.banned_until) {
      return { label: "Bloqueado", variant: "destructive" as const, icon: Ban }
    }
    if (!user.email_confirmed_at) {
      return { label: "Sin confirmar", variant: "secondary" as const, icon: Clock }
    }
    return { label: "Activo", variant: "default" as const, icon: CheckCircle }
  }

  const getRoleBadge = (role: string) => {
    if (role === "superadmin") {
      return <Badge variant="default" className="gap-1"><ShieldAlert className="h-3 w-3" />Admin</Badge>
    }
    return <Badge variant="outline" className="gap-1"><Shield className="h-3 w-3" />Usuario</Badge>
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestion de Usuarios</h1>
          <p className="text-muted-foreground mt-1">
            Administra usuarios, permisos y accesos de la plataforma
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openDialog("bulk")}>
            <Upload className="h-4 w-4 mr-2" />
            Importar
          </Button>
          <Button onClick={() => openDialog("create")}>
            <UserPlus className="h-4 w-4 mr-2" />
            Nuevo Usuario
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Activos</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bloqueados</CardTitle>
            <Ban className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.banned}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sin Confirmar</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.unconfirmed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Admins</CardTitle>
            <ShieldAlert className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.admins}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Usuarios</CardTitle>
              <CardDescription>{filteredUsers.length} usuarios encontrados</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={fetchUsers} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por email, nombre o empresa..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Rol" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los roles</SelectItem>
                <SelectItem value="user">Usuario</SelectItem>
                <SelectItem value="superadmin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Activos</SelectItem>
                <SelectItem value="banned">Bloqueados</SelectItem>
                <SelectItem value="unconfirmed">Sin confirmar</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[250px]">Usuario</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Ultimo acceso</TableHead>
                  <TableHead>Registro</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No se encontraron usuarios
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((user) => {
                    const status = getUserStatus(user)
                    const StatusIcon = status.icon
                    return (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{user.full_name || "-"}</p>
                            <p className="text-sm text-muted-foreground">{user.email}</p>
                            {user.company && (
                              <p className="text-xs text-muted-foreground">{user.company}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{getRoleBadge(user.role)}</TableCell>
                        <TableCell>
                          <Badge variant={status.variant} className="gap-1">
                            <StatusIcon className="h-3 w-3" />
                            {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {user.last_sign_in_at
                            ? formatDistanceToNow(new Date(user.last_sign_in_at), { addSuffix: true, locale: es })
                            : "Nunca"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(user.created_at), { addSuffix: true, locale: es })}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => openDialog("edit", user)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openDialog("reset-password", user)}>
                                <KeyRound className="h-4 w-4 mr-2" />
                                Reset Password
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {user.banned_until ? (
                                <DropdownMenuItem onClick={() => handleUnbanUser(user)}>
                                  <ShieldOff className="h-4 w-4 mr-2" />
                                  Desbloquear
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem 
                                  onClick={() => openDialog("ban", user)}
                                  className="text-yellow-600"
                                >
                                  <Ban className="h-4 w-4 mr-2" />
                                  Bloquear
                                </DropdownMenuItem>
  )}
  {user.scheduled_deletion_at && (
  <DropdownMenuItem
    onClick={() => handleRestoreUser(user)}
    className="text-green-600"
    disabled={actionLoading}
  >
    <Undo2 className="h-4 w-4 mr-2" />
    Restaurar usuario
  </DropdownMenuItem>
  )}
  <DropdownMenuItem
    onClick={() => openDialog("delete", user)}
    className="text-destructive"
  >
    <Trash2 className="h-4 w-4 mr-2" />
    {user.scheduled_deletion_at ? "Eliminar ahora" : "Eliminar"}
  </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={dialogType === "create"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear Nuevo Usuario</DialogTitle>
            <DialogDescription>
              Agrega un usuario a la plataforma. Se generara una password si no se especifica.
            </DialogDescription>
          </DialogHeader>
          {generatedPassword ? (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                <p className="text-sm text-green-800 dark:text-green-200 mb-2">Usuario creado exitosamente</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 bg-background rounded text-sm font-mono">
                    {generatedPassword}
                  </code>
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => copyToClipboard(generatedPassword)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Guarda esta password, no se mostrara de nuevo.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={() => { closeDialog(); fetchUsers(); }}>Cerrar</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="usuario@empresa.com"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="full_name">Nombre completo</Label>
                  <Input
                    id="full_name"
                    placeholder="Juan Perez"
                    value={formData.full_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Rol</Label>
                  <Select 
                    value={formData.role} 
                    onValueChange={(value) => setFormData(prev => ({ ...prev, role: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Usuario</SelectItem>
                      <SelectItem value="superadmin">Administrador</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password (opcional)</Label>
                  <Input
                    id="password"
                    type="text"
                    placeholder="Dejar vacio para generar automaticamente"
                    value={formData.password}
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="auto_confirm"
                    checked={formData.auto_confirm}
                    onCheckedChange={(checked) => 
                      setFormData(prev => ({ ...prev, auto_confirm: checked as boolean }))
                    }
                  />
                  <Label htmlFor="auto_confirm" className="text-sm">
                    Auto-confirmar email (no requiere verificacion)
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
                <Button onClick={handleCreateUser} disabled={actionLoading || !formData.email}>
                  {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Crear Usuario
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={dialogType === "bulk"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importacion Masiva</DialogTitle>
            <DialogDescription>
              Ingresa los emails separados por coma, punto y coma, o salto de linea. Maximo 100 usuarios.
            </DialogDescription>
          </DialogHeader>
          {generatedPassword ? (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                <p className="text-sm text-green-800 dark:text-green-200 mb-2">Importacion completada</p>
                <p className="text-sm mb-2">Password generada para todos los usuarios:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 bg-background rounded text-sm font-mono">
                    {generatedPassword}
                  </code>
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => copyToClipboard(generatedPassword)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Guarda esta password, no se mostrara de nuevo.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={() => { closeDialog(); fetchUsers(); }}>Cerrar</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bulk_emails">Emails *</Label>
                  <Textarea
                    id="bulk_emails"
                    placeholder={"usuario1@empresa.com\nusuario2@empresa.com\nusuario3@empresa.com"}
                    rows={6}
                    value={formData.bulk_emails}
                    onChange={(e) => setFormData(prev => ({ ...prev, bulk_emails: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="default_role">Rol por defecto</Label>
                  <Select 
                    value={formData.role} 
                    onValueChange={(value) => setFormData(prev => ({ ...prev, role: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">Usuario</SelectItem>
                      <SelectItem value="superadmin">Administrador</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="default_password">Password (opcional)</Label>
                  <Input
                    id="default_password"
                    type="text"
                    placeholder="Dejar vacio para generar automaticamente"
                    value={formData.password}
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="bulk_auto_confirm"
                    checked={formData.auto_confirm}
                    onCheckedChange={(checked) => 
                      setFormData(prev => ({ ...prev, auto_confirm: checked as boolean }))
                    }
                  />
                  <Label htmlFor="bulk_auto_confirm" className="text-sm">
                    Auto-confirmar emails
                  </Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
                <Button onClick={handleBulkImport} disabled={actionLoading || !formData.bulk_emails.trim()}>
                  {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Importar Usuarios
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={dialogType === "edit"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuario</DialogTitle>
            <DialogDescription>
              Modifica los datos del usuario {selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit_email">Email</Label>
              <Input
                id="edit_email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_full_name">Nombre completo</Label>
              <Input
                id="edit_full_name"
                value={formData.full_name}
                onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_role">Rol</Label>
              <Select 
                value={formData.role} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, role: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Usuario</SelectItem>
                  <SelectItem value="superadmin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
            <Button onClick={handleUpdateUser} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Guardar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ban User Dialog */}
      <Dialog open={dialogType === "ban"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bloquear Usuario</DialogTitle>
            <DialogDescription>
              El usuario {selectedUser?.email} no podra acceder a la plataforma durante el tiempo seleccionado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Duracion del bloqueo</Label>
              <Select 
                value={formData.ban_duration} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, ban_duration: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1d">1 dia</SelectItem>
                  <SelectItem value="7d">7 dias</SelectItem>
                  <SelectItem value="30d">30 dias</SelectItem>
                  <SelectItem value="permanent">Permanente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
            <Button variant="destructive" onClick={handleBanUser} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Bloquear Usuario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Dialog */}
      <Dialog open={dialogType === "delete"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar Usuario</DialogTitle>
            <DialogDescription>
              Esta accion eliminara al usuario {selectedUser?.email}. Los datos se retendran por 30 dias antes de eliminarse permanentemente.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-destructive/10 rounded-lg border border-destructive/20">
            <div className="flex gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
              <div>
                <p className="text-sm font-medium text-destructive">Esta accion no se puede deshacer facilmente</p>
                <p className="text-sm text-muted-foreground mt-1">
                  El usuario perdera acceso inmediatamente. Sus datos asociados (bookmarks, estrategias, etc.) se mantendran.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteUser} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Eliminar Usuario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={dialogType === "reset-password"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resetear Password</DialogTitle>
            <DialogDescription>
              Resetea la password del usuario {selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          {generatedPassword ? (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                <p className="text-sm text-green-800 dark:text-green-200 mb-2">Password temporal generada</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 bg-background rounded text-sm font-mono">
                    {generatedPassword}
                  </code>
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => copyToClipboard(generatedPassword)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Comparte esta password con el usuario de forma segura.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={() => { closeDialog(); fetchUsers(); }}>Cerrar</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 rounded-lg border">
                  <Checkbox
                    id="send_email"
                    checked={formData.send_email}
                    onCheckedChange={(checked) => 
                      setFormData(prev => ({ ...prev, send_email: checked as boolean }))
                    }
                  />
                  <div>
                    <Label htmlFor="send_email" className="text-sm font-medium cursor-pointer">
                      Enviar email de recuperacion
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      El usuario recibira un link para crear una nueva password
                    </p>
                  </div>
                </div>
                
                {!formData.send_email && (
                  <div className="space-y-2">
                    <Label htmlFor="new_password">Nueva password (opcional)</Label>
                    <Input
                      id="new_password"
                      type="text"
                      placeholder="Dejar vacio para generar automaticamente"
                      value={formData.password}
                      onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                    />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
                <Button onClick={handleResetPassword} disabled={actionLoading}>
                  {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {formData.send_email ? "Enviar Email" : "Resetear Password"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
