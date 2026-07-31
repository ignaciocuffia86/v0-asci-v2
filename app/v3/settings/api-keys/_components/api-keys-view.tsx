"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, Clock, Copy, Key, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { toast } from "sonner"
import { generateApiKey, listApiKeyOwners, listApiKeys, revokeApiKey, type ApiKeyListItem, type ApiKeyOwnerOption, type ApiKeyWorkspaceOption } from "@/app/actions/v3/api-keys"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { McpSetupWizard } from "./mcp-setup-wizard"

/** Única superficie MCP. La vieja (`/api/v3/mcp` + `/api/v3/mcp/tools/*`) se eliminó. */
const MCP_SERVER_URL = "https://bot.bigua.lat/api/v3/mcp/server/mcp"

interface ApiKeysViewProps {
  workspaces: ApiKeyWorkspaceOption[]
  defaultWorkspaceId: string
  isSuperAdmin: boolean
}

export function ApiKeysView({ workspaces, defaultWorkspaceId, isSuperAdmin }: ApiKeysViewProps) {
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId)
  const [workspaceName, setWorkspaceName] = useState(workspaces.find((item) => item.id === defaultWorkspaceId)?.name ?? "")
  const [keys, setKeys] = useState<ApiKeyListItem[]>([])
  const [owners, setOwners] = useState<ApiKeyOwnerOption[]>([])
  const [ownerUserId, setOwnerUserId] = useState("")
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyListItem | null>(null)
  const [revoking, setRevoking] = useState(false)

  const availableOwners = useMemo(
    () => owners.filter((owner) => !keys.some((key) => key.owner_user_id === owner.id)),
    [keys, owners]
  )

  const loadWorkspaceData = useCallback(async (selectedWorkspaceId: string) => {
    setLoading(true)
    const [keyResult, ownerResult] = await Promise.all([
      listApiKeys(selectedWorkspaceId),
      listApiKeyOwners(selectedWorkspaceId),
    ])

    if (!keyResult.success || !ownerResult.success) {
      toast.error(keyResult.error ?? ownerResult.error ?? "No se pudo cargar el workspace")
      setKeys([])
      setOwners([])
      setCanManage(false)
    } else {
      setKeys(keyResult.keys ?? [])
      setOwners(ownerResult.owners ?? [])
      setCanManage(ownerResult.canManage ?? false)
      setWorkspaceName(ownerResult.workspaceName ?? "")
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadWorkspaceData(workspaceId)
  }, [loadWorkspaceData, workspaceId])

  useEffect(() => {
    if (!availableOwners.some((owner) => owner.id === ownerUserId)) {
      setOwnerUserId(availableOwners[0]?.id ?? "")
    }
  }, [availableOwners, ownerUserId])

  async function handleCreateKey() {
    if (!newKeyName.trim() || !ownerUserId) return
    setCreating(true)
    const result = await generateApiKey(newKeyName, workspaceId, ownerUserId)
    setCreating(false)
    if (!result.success || !result.key) {
      toast.error(result.error ?? "No se pudo generar la API key")
      return
    }
    setNewKey(result.key)
    setNewKeyName("")
    await loadWorkspaceData(workspaceId)
  }

  async function handleRevokeKey() {
    if (!keyToRevoke) return
    setRevoking(true)
    const result = await revokeApiKey(keyToRevoke.id, workspaceId)
    setRevoking(false)
    if (!result.success) {
      toast.error(result.error ?? "No se pudo revocar la API key")
      return
    }
    setKeyToRevoke(null)
    toast.success("API key revocada")
    await loadWorkspaceData(workspaceId)
  }

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-balance">API Keys</h1>
          {isSuperAdmin && <Badge variant="secondary"><ShieldCheck data-icon="inline-start" />Superadmin</Badge>}
        </div>
        <p className="text-muted-foreground">Gestiona las credenciales personales para conectar agentes externos al MCP Server de ASCI.</p>
      </header>

      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Workspace administrado</CardTitle>
            <CardDescription>Como superadmin puedes administrar las API keys de cualquier workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex max-w-md flex-col gap-2">
              <Label htmlFor="workspace-selector">Workspace</Label>
              <Select value={workspaceId} onValueChange={setWorkspaceId}>
                <SelectTrigger id="workspace-selector"><SelectValue placeholder="Selecciona un workspace" /></SelectTrigger>
                <SelectContent><SelectGroup><SelectLabel>Workspaces</SelectLabel>{workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Key />MCP Server</CardTitle>
          <CardDescription>Los agentes acceden exclusivamente a la información de {workspaceName || "este workspace"}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-4 rounded-lg border bg-muted/50 p-4">
            <code className="flex-1 text-sm break-all">{MCP_SERVER_URL}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(MCP_SERVER_URL)
                  toast.success("URL del MCP copiada")
                } catch {
                  toast.error("No se pudo copiar la URL")
                }
              }}
            >
              <Copy data-icon="inline-start" />Copiar
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">El workspace y el usuario se resuelven automáticamente desde la API key. No debes enviar sus IDs.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>{canManage ? "API Keys del workspace" : "Tu API Key"}</CardTitle>
            <CardDescription>{keys.length === 0 ? "No hay API keys activas" : `${keys.length} ${keys.length === 1 ? "key activa" : "keys activas"}`}</CardDescription>
          </div>
          {canManage && availableOwners.length > 0 && <Button onClick={() => setCreateDialogOpen(true)}><Plus data-icon="inline-start" />Generar API Key</Button>}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Key className="size-10 text-muted-foreground" />
              <div><p className="font-medium">Sin API Keys</p><p className="text-sm text-muted-foreground">{canManage ? "Genera una key para un miembro activo del workspace." : "Contacta al admin del workspace para generar tu API key."}</p></div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {keys.map((key) => (
                <div key={key.id} className="flex flex-col justify-between gap-4 rounded-lg border p-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{key.name}</span><Badge variant="outline" className="font-mono text-xs">{key.key_prefix}...</Badge></div>
                    <p className="text-sm text-muted-foreground">Propietario: {key.owner_name || key.owner_email || key.owner_user_id}</p>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground"><span className="flex items-center gap-1"><Clock />Creada {formatDistanceToNow(new Date(key.created_at), { addSuffix: true, locale: es })}</span><span className="flex items-center gap-1"><Activity />{key.request_count} requests</span>{key.last_used_at && <span>Último uso: {formatDistanceToNow(new Date(key.last_used_at), { addSuffix: true, locale: es })}</span>}</div>
                  </div>
                  {canManage && <Button variant="ghost" size="icon" aria-label={`Revocar ${key.name}`} onClick={() => setKeyToRevoke(key)}><Trash2 /></Button>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createDialogOpen && !newKey} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Generar nueva API Key</DialogTitle><DialogDescription>La credencial quedará vinculada al workspace y al miembro seleccionado.</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2"><Label htmlFor="key-name">Nombre</Label><Input id="key-name" placeholder="Ej: Claude Desktop" value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} /></div>
            <div className="flex flex-col gap-2"><Label htmlFor="key-owner">Propietario</Label><Select value={ownerUserId} onValueChange={setOwnerUserId}><SelectTrigger id="key-owner"><SelectValue placeholder="Selecciona un miembro" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>Miembros activos sin key</SelectLabel>{availableOwners.map((owner) => <SelectItem key={owner.id} value={owner.id}>{owner.fullName ? `${owner.fullName} · ` : ""}{owner.email ?? owner.id} ({owner.role})</SelectItem>)}</SelectGroup></SelectContent></Select></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancelar</Button><Button onClick={handleCreateKey} disabled={!newKeyName.trim() || !ownerUserId || creating}>{creating ? "Generando..." : "Generar key"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <McpSetupWizard apiKey={newKey} onComplete={() => { setNewKey(null); setCreateDialogOpen(false) }} />

      <AlertDialog open={Boolean(keyToRevoke)} onOpenChange={(open) => !open && setKeyToRevoke(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Revocar API Key</AlertDialogTitle><AlertDialogDescription>La key &quot;{keyToRevoke?.name}&quot; dejará de funcionar inmediatamente.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={handleRevokeKey} disabled={revoking}>{revoking ? "Revocando..." : "Revocar key"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
