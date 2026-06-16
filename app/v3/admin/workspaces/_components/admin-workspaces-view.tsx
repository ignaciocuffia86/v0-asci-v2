"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Plus, Building2, Users, AlertCircle, Trash2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  createWorkspaceAsSuperAdmin,
  deleteWorkspaceAsSuperAdmin,
  type WorkspaceSummary,
} from "@/app/actions/v3/admin"

interface AdminWorkspacesViewProps {
  initialWorkspaces: WorkspaceSummary[]
  loadError?: string
}

export function AdminWorkspacesView({ initialWorkspaces, loadError }: AdminWorkspacesViewProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [name, setName] = useState("")
  const [domain, setDomain] = useState("")
  const [websiteUrl, setWebsiteUrl] = useState("")
  const [adminEmail, setAdminEmail] = useState("")

  // Estado del dialog de eliminación
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSummary | null>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)

  const handleCreate = async () => {
    if (!name.trim() || !adminEmail.trim() || !domain.trim()) {
      toast({
        title: "Faltan datos",
        description: "Nombre, dominio y email del admin son obligatorios.",
        variant: "destructive",
      })
      return
    }

    setIsSubmitting(true)
    try {
      const result = await createWorkspaceAsSuperAdmin({
        name: name.trim(),
        domain: domain.trim(),
        websiteUrl: websiteUrl.trim() || undefined,
        adminEmail: adminEmail.trim().toLowerCase(),
      })

      if (!result.success) {
        toast({
          title: "No se pudo crear",
          description: result.error ?? "Error desconocido",
          variant: "destructive",
        })
        return
      }

      toast({
        title: "Workspace creado",
        description: result.invited
          ? `Se invitó a ${adminEmail} como admin.${result.emailSent ? " Se envió el email de invitación." : " Copiá el link para compartirlo."}`
          : `Se asignó a ${adminEmail} como admin del workspace.`,
      })

      if (result.inviteUrl && !result.emailSent) {
        await navigator.clipboard.writeText(result.inviteUrl).catch(() => {})
        toast({
          title: "Link de invitación copiado",
          description: result.inviteUrl,
        })
      }

      setName("")
      setDomain("")
      setWebsiteUrl("")
      setAdminEmail("")
      setDialogOpen(false)
      router.refresh()
    } catch (err) {
      toast({
        title: "Error inesperado",
        description: err instanceof Error ? err.message : "Intentá de nuevo.",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return

    setIsDeleting(true)
    try {
      const result = await deleteWorkspaceAsSuperAdmin({
        workspaceId: deleteTarget.id,
        confirmationName: deleteConfirmName.trim(),
      })

      if (!result.success) {
        toast({
          title: "No se pudo eliminar",
          description: result.error ?? "Error desconocido",
          variant: "destructive",
        })
        return
      }

      toast({
        title: "Workspace eliminado",
        description: `Se eliminó "${deleteTarget.name}" y todos sus datos asociados.`,
      })

      setDeleteTarget(null)
      setDeleteConfirmName("")
      router.refresh()
    } catch (err) {
      toast({
        title: "Error inesperado",
        description: err instanceof Error ? err.message : "Intentá de nuevo.",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground text-balance">Workspaces</h1>
          <p className="text-sm text-muted-foreground">
            Administración de tenants. Creá un workspace y asigná su primer administrador.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" />
              Nuevo workspace
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Crear workspace</DialogTitle>
              <DialogDescription>
                Se creará el workspace y se asignará al email indicado como administrador. Si la persona
                aún no tiene cuenta, se generará una invitación pendiente con rol admin.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ws-name">Nombre del workspace</Label>
                <Input
                  id="ws-name"
                  placeholder="Edenor"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ws-domain">Dominio</Label>
                <Input
                  id="ws-domain"
                  placeholder="edenor.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ws-website">Sitio web (opcional)</Label>
                <Input
                  id="ws-website"
                  placeholder="https://edenor.com"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ws-admin">Email del administrador</Label>
                <Input
                  id="ws-admin"
                  type="email"
                  placeholder="juan@edenor.com"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={isSubmitting}>
                {isSubmitting ? "Creando..." : "Crear workspace"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      {loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 py-6 text-sm text-destructive">
            <AlertCircle className="size-4" />
            {loadError}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4 text-muted-foreground" />
              {initialWorkspaces.length} {initialWorkspaces.length === 1 ? "workspace" : "workspaces"}
            </CardTitle>
            <CardDescription>Listado de todos los tenants de la plataforma.</CardDescription>
          </CardHeader>
          <CardContent>
            {initialWorkspaces.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Todavía no hay workspaces. Creá el primero con el botón de arriba.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Dominio</TableHead>
                    <TableHead>Admins</TableHead>
                    <TableHead>Miembros</TableHead>
                    <TableHead>Creado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {initialWorkspaces.map((ws) => (
                    <TableRow key={ws.id}>
                      <TableCell className="font-medium text-foreground">{ws.name}</TableCell>
                      <TableCell>
                        {ws.domain ? (
                          <Badge variant="secondary">{ws.domain}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {ws.admin_emails.length > 0 ? ws.admin_emails.join(", ") : "—"}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Users className="size-3.5" />
                          {ws.member_count}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(ws.created_at), "d MMM yyyy", { locale: es })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            setDeleteTarget(ws)
                            setDeleteConfirmName("")
                          }}
                          aria-label={`Eliminar ${ws.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setDeleteConfirmName("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-5" />
              Eliminar workspace
            </DialogTitle>
            <DialogDescription>
              Esta acción es permanente. Se eliminarán el workspace{" "}
              <strong>{deleteTarget?.name}</strong> y todos sus datos asociados: miembros,
              invitaciones, documentos, campañas y API keys. No se puede deshacer.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="confirm-name">
              Escribí <span className="font-semibold text-foreground">{deleteTarget?.name}</span> para
              confirmar
            </Label>
            <Input
              id="confirm-name"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={deleteTarget?.name ?? ""}
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null)
                setDeleteConfirmName("")
              }}
              disabled={isDeleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting || deleteConfirmName.trim() !== deleteTarget?.name}
            >
              {isDeleting ? "Eliminando..." : "Eliminar definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
