"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Mail, CheckCircle2, XCircle, Clock, ArrowRight, Loader2, LogIn } from "lucide-react"
import { acceptWorkspaceInvitation } from "@/app/actions/v3/workspace"

type InvitationState = "valid" | "not_found" | "used" | "revoked" | "expired"

interface InviteViewProps {
  token: string
  invitationState: InvitationState
  invitedEmail: string | null
  role: "admin" | "member" | null
  workspaceName: string | null
  currentEmail: string | null
  isAuthenticated: boolean
  emailMatches: boolean
}

export function InviteView({
  token,
  invitationState,
  invitedEmail,
  role,
  workspaceName,
  currentEmail,
  isAuthenticated,
  emailMatches,
}: InviteViewProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Estados inválidos ──────────────────────────────────────────────
  if (invitationState !== "valid") {
    const config: Record<
      Exclude<InvitationState, "valid">,
      { title: string; description: string; icon: React.ReactNode }
    > = {
      not_found: {
        title: "Invitación no encontrada",
        description: "El link de invitación no es válido o fue eliminado.",
        icon: <XCircle className="size-6 text-destructive" />,
      },
      used: {
        title: "Invitación ya utilizada",
        description: "Esta invitación ya fue aceptada. Iniciá sesión para entrar.",
        icon: <CheckCircle2 className="size-6 text-primary" />,
      },
      revoked: {
        title: "Invitación revocada",
        description: "El administrador revocó esta invitación.",
        icon: <XCircle className="size-6 text-destructive" />,
      },
      expired: {
        title: "Invitación expirada",
        description: "Esta invitación venció. Pedile al administrador que te invite de nuevo.",
        icon: <Clock className="size-6 text-muted-foreground" />,
      },
    }
    const c = config[invitationState]
    return (
      <Card className="border-border/50">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            {c.icon}
          </div>
          <CardTitle className="text-2xl text-balance">{c.title}</CardTitle>
          <CardDescription className="text-base text-pretty">{c.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/auth/login">Ir a iniciar sesión</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const roleLabel = role === "admin" ? "administrador" : "miembro"

  async function handleAccept() {
    setIsLoading(true)
    setError(null)
    const result = await acceptWorkspaceInvitation(token)
    if (result.success) {
      router.push("/v3")
    } else {
      setError(result.error || "Error al aceptar la invitación")
      setIsLoading(false)
    }
  }

  // ── No autenticado: pedir login/registro con el email invitado ──────
  if (!isAuthenticated) {
    const next = encodeURIComponent(`/v3/invite/${token}`)
    return (
      <Card className="border-border/50">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Mail className="size-6 text-primary" />
          </div>
          <CardTitle className="text-2xl text-balance">
            Te invitaron a {workspaceName ?? "un workspace"}
          </CardTitle>
          <CardDescription className="text-base text-pretty">
            La invitación es para <strong>{invitedEmail}</strong> con rol de {roleLabel}.
            Iniciá sesión o creá tu cuenta con ese email para aceptarla.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button asChild className="w-full" size="lg">
            <Link href={`/auth/login?next=${next}`}>
              <LogIn data-icon="inline-start" />
              Iniciar sesión
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full" size="lg">
            <Link href={`/auth/sign-up?next=${next}`}>Crear cuenta</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── Autenticado pero con otro email ─────────────────────────────────
  if (!emailMatches) {
    return (
      <Card className="border-border/50">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <XCircle className="size-6 text-destructive" />
          </div>
          <CardTitle className="text-2xl text-balance">Email distinto</CardTitle>
          <CardDescription className="text-base text-pretty">
            Esta invitación es para <strong>{invitedEmail}</strong>, pero iniciaste sesión
            como <strong>{currentEmail}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Cerrá sesión e ingresá con el email invitado para aceptar la invitación.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/auth/login">Cambiar de cuenta</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── Autenticado con el email correcto: aceptar ──────────────────────
  return (
    <Card className="border-border/50">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
          <Mail className="size-6 text-primary" />
        </div>
        <CardTitle className="text-2xl text-balance">
          Unirte a {workspaceName ?? "el workspace"}
        </CardTitle>
        <CardDescription className="text-base text-pretty">
          Vas a unirte como <strong>{roleLabel}</strong> con la cuenta {currentEmail}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
        <Button onClick={handleAccept} disabled={isLoading} className="w-full" size="lg">
          {isLoading ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <ArrowRight data-icon="inline-end" />
          )}
          {isLoading ? "Uniéndote..." : "Aceptar invitación"}
        </Button>
      </CardContent>
    </Card>
  )
}
