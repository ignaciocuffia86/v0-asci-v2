"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { 
  Key, 
  Plus, 
  Trash2, 
  Copy, 
  Check, 
  AlertTriangle,
  Clock,
  Activity,
  ExternalLink
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { generateApiKey, listApiKeys, revokeApiKey } from "@/app/actions/v3/api-keys"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  request_count: number
}

interface ApiKeysViewProps {
  workspaceName: string
  isAdmin: boolean
}

export function ApiKeysView({ workspaceName, isAdmin }: ApiKeysViewProps) {
  const router = useRouter()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false)
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null)
  const [revoking, setRevoking] = useState(false)
  
  useEffect(() => {
    loadKeys()
  }, [])
  
  const loadKeys = async () => {
    setLoading(true)
    const result = await listApiKeys()
    if (result.success && result.keys) {
      setKeys(result.keys)
    }
    setLoading(false)
  }
  
  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return
    
    setCreating(true)
    const result = await generateApiKey(newKeyName.trim())
    setCreating(false)
    
    if (result.success && result.key) {
      setNewKey(result.key)
      setNewKeyName("")
      loadKeys()
    } else {
      alert(result.error || "Error al crear API key")
    }
  }
  
  const handleCopyKey = async () => {
    if (newKey) {
      await navigator.clipboard.writeText(newKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  
  const handleCloseNewKeyDialog = () => {
    setNewKey(null)
    setCreateDialogOpen(false)
  }
  
  const handleRevokeKey = async () => {
    if (!keyToRevoke) return
    
    setRevoking(true)
    const result = await revokeApiKey(keyToRevoke.id)
    setRevoking(false)
    
    if (result.success) {
      setRevokeDialogOpen(false)
      setKeyToRevoke(null)
      loadKeys()
    } else {
      alert(result.error || "Error al revocar API key")
    }
  }
  
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">API Keys</h1>
        <p className="text-muted-foreground">
          Gestiona las API keys para conectar agentes externos al MCP Server de ASCI
        </p>
      </div>
      
      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="size-5" />
            MCP Server
          </CardTitle>
          <CardDescription>
            Permite que agentes de IA externos accedan a la inteligencia de ventas de {workspaceName}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-4 rounded-lg border bg-muted/50 p-4">
            <code className="flex-1 text-sm">
              https://bot.bigua.lat/api/v3/mcp
            </code>
            <Button variant="outline" size="sm" asChild>
              <a href="/api/v3/mcp" target="_blank">
                <ExternalLink className="mr-2 size-4" />
                Ver Manifest
              </a>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Usa esta URL como MCP Server en tu cliente de IA (Claude, etc.)
          </p>
        </CardContent>
      </Card>
      
      {/* API Keys List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Tus API Keys</CardTitle>
            <CardDescription>
              {keys.length === 0 
                ? "No tienes API keys activas" 
                : `${keys.length} key${keys.length !== 1 ? "s" : ""} activa${keys.length !== 1 ? "s" : ""}`}
            </CardDescription>
          </div>
          {isAdmin && keys.length === 0 && (
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="mr-2 size-4" />
              Generar API Key
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              Cargando...
            </div>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
              <div className="rounded-full bg-muted p-4">
                <Key className="size-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">Sin API Keys</p>
                <p className="text-sm text-muted-foreground">
                  {isAdmin 
                    ? "Genera una API key para conectar agentes externos"
                    : "Contacta al admin del workspace para generar una API key"}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{key.name}</span>
                      <Badge variant="outline" className="font-mono text-xs">
                        {key.key_prefix}...
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        Creada {formatDistanceToNow(new Date(key.created_at), { addSuffix: true, locale: es })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Activity className="size-3" />
                        {key.request_count} requests
                      </span>
                      {key.last_used_at && (
                        <span>
                          Ultimo uso: {formatDistanceToNow(new Date(key.last_used_at), { addSuffix: true, locale: es })}
                        </span>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setKeyToRevoke(key)
                        setRevokeDialogOpen(true)
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Create Dialog */}
      <Dialog open={createDialogOpen && !newKey} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generar nueva API Key</DialogTitle>
            <DialogDescription>
              La API key se mostrara solo una vez. Guardala en un lugar seguro.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Nombre de la key</Label>
              <Input
                id="name"
                placeholder="Ej: Claude Desktop, MCP Client"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateKey} disabled={!newKeyName.trim() || creating}>
              {creating ? "Generando..." : "Generar Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Show New Key Dialog */}
      <Dialog open={!!newKey} onOpenChange={handleCloseNewKeyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key generada</DialogTitle>
            <DialogDescription>
              Copia esta key ahora. No podras verla de nuevo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Importante</AlertTitle>
              <AlertDescription>
                Esta es la unica vez que veras la key completa. Guardala en un lugar seguro.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border bg-muted p-3 text-sm break-all">
                {newKey}
              </code>
              <Button variant="outline" size="icon" onClick={handleCopyKey}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleCloseNewKeyDialog}>
              Ya la copie
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Revoke Confirmation */}
      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revocar API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Esta seguro de revocar la key &quot;{keyToRevoke?.name}&quot;? 
              Los agentes que la usen dejaran de funcionar inmediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeKey}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revoking}
            >
              {revoking ? "Revocando..." : "Revocar Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
