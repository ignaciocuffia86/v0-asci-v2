"use client"

import { useMemo, useState } from "react"
import { AlertCircle, Check, CheckCircle2, Clipboard, Cloud, Copy, ExternalLink, Laptop, Loader2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface McpSetupWizardProps {
  apiKey: string | null
  onComplete: () => void
}

type CopyTarget = "key" | "url" | "header" | "json"

function CopyButton({ label, copied, onCopy }: { label: string; copied: boolean; onCopy: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onCopy} aria-label={`Copiar ${label}`}>
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied ? "Copiado" : "Copiar"}
    </Button>
  )
}

function CopyField({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-3 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
        <CopyButton label={label} copied={copied} onCopy={onCopy} />
      </div>
    </div>
  )
}

export function McpSetupWizard({ apiKey, onComplete }: McpSetupWizardProps) {
  const [copiedTargets, setCopiedTargets] = useState<Set<CopyTarget>>(new Set())
  const [testing, setTesting] = useState(false)
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">("idle")
  const serverUrl = typeof window === "undefined" ? "https://bot.bigua.lat/api/v3/mcp/server/mcp" : `${window.location.origin}/api/v3/mcp/server/mcp`
  const authorization = `Bearer ${apiKey ?? ""}`
  const desktopConfig = useMemo(() => JSON.stringify({
    mcpServers: {
      asci: {
        command: "npx",
        args: ["-y", "mcp-remote", serverUrl, "--header", `Authorization: ${authorization}`],
      },
    },
  }, null, 2), [authorization, serverUrl])

  async function copy(target: CopyTarget, value: string) {
    await navigator.clipboard.writeText(value)
    setCopiedTargets((current) => new Set(current).add(target))
    toast.success("Copiado al portapapeles")
  }

  async function testConnection() {
    if (!apiKey) return
    setTesting(true)
    setTestStatus("idle")
    try {
      const response = await fetch(serverUrl, {
        method: "POST",
        headers: {
          Authorization: authorization,
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "asci-settings", version: "1.0.0" } } }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setTestStatus("success")
      toast.success("Conexión MCP verificada")
    } catch {
      setTestStatus("error")
      toast.error("No se pudo verificar la conexión")
    } finally {
      setTesting(false)
    }
  }

  function handleOpenChange(open: boolean) {
    if (open) return
    if (!copiedTargets.has("key")) {
      toast.error("Copia la API key antes de cerrar: no podrás verla nuevamente")
      return
    }
    onComplete()
  }

  if (!apiKey) return null

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Conecta ASCI con tu asistente</DialogTitle>
          <DialogDescription>Guarda la credencial y sigue la guía del cliente que quieras usar.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] pr-4">
          <div className="flex flex-col gap-5 py-2">
            <Alert>
              <ShieldCheck />
              <AlertTitle>La API key identifica tu acceso</AlertTitle>
              <AlertDescription>No ingreses usuario, contraseña, workspace ID ni user ID. ASCI resuelve tu identidad y workspace desde esta key.</AlertDescription>
            </Alert>

            <CopyField label="API key — visible una sola vez" value={apiKey} copied={copiedTargets.has("key")} onCopy={() => copy("key", apiKey)} />
            <CopyField label="URL del MCP Server" value={serverUrl} copied={copiedTargets.has("url")} onCopy={() => copy("url", serverUrl)} />

            <Tabs defaultValue="claude-web">
              <TabsList className="grid h-auto w-full grid-cols-1 sm:grid-cols-3">
                <TabsTrigger value="claude-web"><Cloud data-icon="inline-start" />Claude Web</TabsTrigger>
                <TabsTrigger value="claude-desktop"><Laptop data-icon="inline-start" />Claude Desktop</TabsTrigger>
                <TabsTrigger value="chatgpt"><Clipboard data-icon="inline-start" />ChatGPT</TabsTrigger>
              </TabsList>

              <TabsContent value="claude-web" className="flex flex-col gap-4 pt-3">
                <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-muted-foreground">
                  <li>Abre Claude y entra en Settings → Connectors.</li>
                  <li>Selecciona Add custom connector e ingresa la URL del MCP Server.</li>
                  <li>Configura la autenticación con el header <code className="text-foreground">Authorization</code> y el valor Bearer indicado abajo.</li>
                  <li>Guarda el conector y habilítalo en una conversación nueva.</li>
                </ol>
                <CopyField label="Valor del header Authorization" value={authorization} copied={copiedTargets.has("header")} onCopy={() => copy("header", authorization)} />
                <Alert><AlertCircle /><AlertTitle>Disponibilidad</AlertTitle><AlertDescription>Los conectores personalizados y headers pueden depender del plan y de las políticas de tu organización en Claude.</AlertDescription></Alert>
              </TabsContent>

              <TabsContent value="claude-desktop" className="flex flex-col gap-4 pt-3">
                <p className="text-sm text-muted-foreground">Puedes usar el conector remoto como en Claude Web. Si tu versión requiere configuración local, agrega este bloque al archivo de configuración de Claude Desktop y reinicia la aplicación.</p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">claude_desktop_config.json</p><CopyButton label="configuración JSON" copied={copiedTargets.has("json")} onCopy={() => copy("json", desktopConfig)} /></div>
                  <pre className="overflow-x-auto rounded-lg border bg-muted p-4 text-xs"><code>{desktopConfig}</code></pre>
                </div>
                <Alert><AlertCircle /><AlertTitle>La key queda en el archivo local</AlertTitle><AlertDescription>Protege ese archivo y no lo subas a Git. Esta alternativa necesita Node.js para ejecutar <code>npx mcp-remote</code>.</AlertDescription></Alert>
              </TabsContent>

              <TabsContent value="chatgpt" className="flex flex-col gap-4 pt-3">
                <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-muted-foreground">
                  <li>Activa Developer Mode en Settings → Apps &amp; Connectors → Advanced settings.</li>
                  <li>Crea un conector MCP personalizado e ingresa la URL del servidor.</li>
                  <li>Selecciona autenticación Bearer e ingresa la API key.</li>
                  <li>Guarda, publica o habilita el conector y selecciónalo en una conversación nueva.</li>
                </ol>
                <CopyField label="Bearer token" value={apiKey} copied={copiedTargets.has("key")} onCopy={() => copy("key", apiKey)} />
                <Alert><AlertCircle /><AlertTitle>Requiere Developer Mode</AlertTitle><AlertDescription>La opción puede no aparecer según tu plan de ChatGPT o los permisos administrados de tu workspace. Si ChatGPT exige OAuth y no permite Bearer, esta conexión todavía no es compatible.</AlertDescription></Alert>
              </TabsContent>
            </Tabs>

            <div className="flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                {testStatus === "success" ? <CheckCircle2 className="text-primary" /> : <ExternalLink className="text-muted-foreground" />}
                <div><p className="text-sm font-medium">Verificar credencial</p><p className="text-xs text-muted-foreground">Comprueba que el servidor reconoce esta API key.</p></div>
              </div>
              <Button variant="outline" onClick={testConnection} disabled={testing}>
                {testing && <Loader2 className="animate-spin" data-icon="inline-start" />}
                {testStatus === "success" ? "Conectado" : testStatus === "error" ? "Reintentar" : "Probar conexión"}
              </Button>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button onClick={onComplete} disabled={!copiedTargets.has("key")}>Terminar configuración</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
