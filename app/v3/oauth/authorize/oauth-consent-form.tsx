"use client"

import { useEffect, useState, useTransition } from "react"
import { ShieldCheck } from "lucide-react"
import { getOAuthConsentContext, approveOAuthConsent } from "@/app/actions/v3/mcp-oauth"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MCP_SCOPE_GROUPS, MCP_RESOURCE_SERVERS } from "@/lib/v3/mcp-oauth"

type Workspace = { id: string; name: string; role: string }
// Todo grupo de MCP_SCOPE_GROUPS tiene que estar acá. Faltaban accounts,
// contacts y documents: sus scopes existían en el catálogo pero ningún usuario
// podía tildarlos, así que ningún token OAuth llegaba a tenerlos y las tools
// correspondientes fallaban con "scope insuficiente" por más que se reconectara.
// Después faltaron explore y profiles (los MCP Explore y Perfiles): sin su grupo
// acá, un token OAuth nunca podía llevar explore:read / profiles:read y esos MCP
// solo funcionaban con API key.
const groups: { id: string; label: string; description: string; scopes: string[] }[] = [
  { id: "read", label: "Lectura", description: "Empresas, señales, cuentas y uso", scopes: [...MCP_SCOPE_GROUPS.read] },
  { id: "explore", label: "Explore", description: "Explorar empresas y personas por tecnología sobre la base cruda (país → industria → empresa). Solo lectura; las capas pagas usan Research / Guardar cuentas / Contactos.", scopes: [...MCP_SCOPE_GROUPS.explore] },
  { id: "profiles", label: "Perfiles", description: "Buscar personas por skill y experiencia, con su contacto personal (email, teléfono) y LinkedIn. Solo lectura.", scopes: [...MCP_SCOPE_GROUPS.profiles] },
  { id: "accounts", label: "Guardar cuentas", description: "Guardar y quitar cuentas del workspace. Ocupa lugares del plan.", scopes: [...MCP_SCOPE_GROUPS.accounts] },
  { id: "research", label: "Research", description: "Preparar, ejecutar y guardar investigaciones", scopes: [...MCP_SCOPE_GROUPS.research] },
  { id: "icebreakers", label: "Icebreakers", description: "Preparar, generar y guardar icebreakers", scopes: [...MCP_SCOPE_GROUPS.icebreakers] },
  { id: "contacts", label: "Contactos", description: "Buscar tomadores de decisión en Apollo. Gasta créditos de enrichment.", scopes: [...MCP_SCOPE_GROUPS.contacts] },
  { id: "documents", label: "Documentos", description: "Cargar documentación comercial y pedir cuentas recomendadas", scopes: [...MCP_SCOPE_GROUPS.documents] },
]

/**
 * Permisos pre-tildados según a QUÉ MCP te estás conectando. Prioridad:
 *   1. `resource` (RFC 8707): cada MCP publica /api/v3/mcp/<server>/... como su
 *      resource, así que el segmento identifica el server y su grupo base.
 *   2. `scope` solicitado: se tilda un grupo solo si TODOS sus scopes fueron pedidos
 *      (subset), para que pedir [profiles:read, usage:read] tilde Perfiles y no Lectura.
 *   3. Fallback histórico: Lectura.
 * Si el cliente no manda ninguna señal, cae en Lectura y no rompe nada.
 */
function initialGroups(resource: string, requestedScope: string): string[] {
  const byResource = resource.match(/\/api\/v3\/mcp\/([a-z]+)\b/)?.[1]
  if (byResource && byResource in MCP_RESOURCE_SERVERS) {
    return [...MCP_RESOURCE_SERVERS[byResource as keyof typeof MCP_RESOURCE_SERVERS].consentGroups]
  }
  const requested = requestedScope.split(/\s+/).filter(Boolean)
  if (requested.length) {
    const matched = groups.filter((group) => group.scopes.length > 0 && group.scopes.every((scope) => requested.includes(scope))).map((group) => group.id)
    if (matched.length) return matched
  }
  return ["read"]
}

export function OAuthConsentForm(props: { clientId: string; redirectUri: string; state?: string; codeChallenge: string; requestedScope: string; resource: string }) {
  const [clientName, setClientName] = useState("Claude")
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState("")
  const [selected, setSelected] = useState<string[]>(() => initialGroups(props.resource, props.requestedScope))
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()

  useEffect(() => { getOAuthConsentContext(props.clientId).then((result) => { if (!result.success) return setError("No se pudo validar el cliente OAuth"); setClientName(result.clientName || "Claude"); setWorkspaces(result.workspaces || []); setWorkspaceId(result.workspaces?.[0]?.id || "") }) }, [props.clientId])

  function authorize() {
    startTransition(async () => {
      const scopes = groups.filter((group) => selected.includes(group.id)).flatMap((group) => group.scopes)
      const result = await approveOAuthConsent({ clientId: props.clientId, redirectUri: props.redirectUri, state: props.state, codeChallenge: props.codeChallenge, workspaceId, scopes })
      if (!result.success || !result.redirectTo) return setError(result.error || "No se pudo autorizar")
      window.location.assign(result.redirectTo)
    })
  }

  return <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4"><Card className="w-full max-w-xl"><CardHeader><div className="flex items-center gap-3"><ShieldCheck className="size-8 text-primary" /><div><CardTitle className="text-balance">Autorizar acceso a ASCI</CardTitle><CardDescription>{clientName} solicita conectar herramientas MCP.</CardDescription></div></div></CardHeader><CardContent className="flex flex-col gap-6">{error ? <Alert variant="destructive"><AlertTitle>No se pudo continuar</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}<div className="flex flex-col gap-2"><Label htmlFor="oauth-workspace">Workspace</Label><Select value={workspaceId} onValueChange={setWorkspaceId}><SelectTrigger id="oauth-workspace"><SelectValue placeholder="Selecciona un workspace" /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>Tus workspaces activos</SelectLabel>{workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.role}</SelectItem>)}</SelectGroup></SelectContent></Select></div><div className="flex flex-col gap-3"><Label>Permisos</Label>{groups.map((group) => <label key={group.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-4"><Checkbox checked={selected.includes(group.id)} onCheckedChange={(checked) => setSelected((current) => checked ? [...current, group.id] : current.filter((id) => id !== group.id))} /><span className="flex flex-col gap-1"><span className="font-medium">{group.label}</span><span className="text-sm text-muted-foreground">{group.description}</span></span></label>)}</div><Alert><AlertTitle>Control de acceso</AlertTitle><AlertDescription>Claude solo podrá operar en el workspace seleccionado y con estos permisos. Podrás revocar la conexión más adelante.</AlertDescription></Alert></CardContent><CardFooter className="flex justify-end gap-2"><Button variant="outline" onClick={() => window.history.back()}>Cancelar</Button><Button disabled={pending || !workspaceId || !selected.length} onClick={authorize}>{pending ? "Autorizando..." : "Autorizar conexión"}</Button></CardFooter></Card></main>
}
