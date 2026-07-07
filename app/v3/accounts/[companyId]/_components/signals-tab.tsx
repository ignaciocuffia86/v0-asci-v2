"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { Linkedin, Loader2, Mail, Search, Sparkles, Target, Users } from "lucide-react"
import {
  searchAccountDecisionMakers,
  type AccountSignalsData,
} from "@/app/actions/v3/accounts"

/** Resalta los términos matcheados dentro de un título. */
function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>
  const pattern = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean)
    .join("|")
  if (!pattern) return <>{text}</>
  const parts = text.split(new RegExp(`(${pattern})`, "gi"))
  return (
    <>
      {parts.map((part, i) =>
        terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
          <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

const SENIORITY_LABEL: Record<string, string> = {
  c_suite: "C-Level",
  vp: "VP",
  director: "Director",
  head: "Head",
  manager: "Manager",
  owner: "Owner",
  founder: "Founder",
  senior: "Senior",
  entry: "Entry",
}

export function SignalsTab({
  companyId,
  signals,
}: {
  companyId: string
  signals: AccountSignalsData | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirmRole, setConfirmRole] = useState<string | null>(null)
  const [searchingRole, setSearchingRole] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ role: string; message: string; ok: boolean } | null>(null)

  if (!signals) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground text-pretty">
          No se pudieron calcular las señales de esta cuenta. Reintentá más tarde.
        </CardContent>
      </Card>
    )
  }

  const handleSearch = (role: string) => {
    setConfirmRole(null)
    setSearchingRole(role)
    setFeedback(null)
    startTransition(async () => {
      const result = await searchAccountDecisionMakers(companyId, role)
      setSearchingRole(null)
      if (result.success) {
        setFeedback({
          role,
          ok: true,
          message:
            result.found > 0
              ? `${result.found} contacto${result.found === 1 ? "" : "s"} encontrado${result.found === 1 ? "" : "s"} y guardado${result.found === 1 ? "" : "s"}.`
              : "Apollo no encontró personas con ese rol en esta empresa.",
        })
        router.refresh()
      } else {
        setFeedback({ role, ok: false, message: result.error ?? "Error en la búsqueda" })
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {!signals.hasVendorProfile && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <Sparkles className="size-4 shrink-0 text-primary" />
          <p className="text-pretty">
            Tu workspace no tiene documentos de propuesta de valor procesados. Las señales se
            calculan solo con el diccionario global; subí documentos en Ajustes para un fit
            personalizado.
          </p>
        </div>
      )}

      {/* Señales fit */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="size-4" />
            Señales fit con tu propuesta
            <Badge variant="secondary">{signals.fitSignals.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {signals.fitSignals.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground text-pretty">
              Ningún hallazgo de esta cuenta matchea tu propuesta de valor o el diccionario.
            </p>
          ) : (
            signals.fitSignals.map((s) => (
              <div key={s.id} className="flex flex-col gap-1.5 rounded-md border p-3">
                <p className="text-sm font-medium text-pretty">
                  <HighlightedText text={s.title} terms={s.matchedTerms} />
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {s.matchedTerms.slice(0, 4).map((term) => (
                    <Badge key={term} variant="secondary" className="text-xs">
                      {term}
                    </Badge>
                  ))}
                  <span className="text-xs text-muted-foreground">
                    {s.matchSource.includes("vendor-profile")
                      ? "· matchea tu propuesta de valor"
                      : "· matchea el diccionario"}
                    {s.sourceDate &&
                      ` · ${new Date(s.sourceDate).toLocaleDateString("es", { month: "short", year: "numeric" })}`}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Personas relacionadas a las señales */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" />
            Personas vinculadas a las señales
            <Badge variant="secondary">{signals.relatedContacts.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {signals.relatedContacts.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground text-pretty">
              No hay contactos en cache vinculados a estas señales. Usá las búsquedas recomendadas
              de abajo para encontrar decisores.
            </p>
          ) : (
            signals.relatedContacts.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{c.fullName}</span>
                    {c.seniority && (
                      <Badge variant="outline" className="text-xs">
                        {SENIORITY_LABEL[c.seniority.toLowerCase()] ?? c.seniority}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {c.title ?? "Sin título"}
                    {c.country ? ` · ${c.country}` : ""}
                  </span>
                  {c.relatedTerms.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Vinculado a: {c.relatedTerms.join(", ")}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {c.email && (
                    <a
                      href={`mailto:${c.email}`}
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`Enviar email a ${c.fullName}`}
                    >
                      <Mail className="size-4" />
                    </a>
                  )}
                  {c.linkedinUrl && (
                    <a
                      href={c.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`Ver LinkedIn de ${c.fullName}`}
                    >
                      <Linkedin className="size-4" />
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Decisores recomendados a buscar */}
      {signals.recommendedRoles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="size-4" />
              Decisores recomendados
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground text-pretty">
              Roles que suelen decidir sobre las señales detectadas. Los que no están en tu cache
              podés buscarlos en Apollo (consume créditos, 1 búsqueda por rol por día).
            </p>
            {signals.recommendedRoles.map((r) => (
              <div key={r.role} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{r.role}</span>
                    {r.inCache && (
                      <Badge variant="secondary" className="text-xs">
                        Ya en cache
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">Por señal: {r.reason}</span>
                  {feedback?.role === r.role && (
                    <span className={`text-xs ${feedback.ok ? "text-green-600" : "text-red-600"}`}>
                      {feedback.message}
                    </span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending || r.searchedToday}
                  onClick={() => setConfirmRole(r.role)}
                  className="shrink-0"
                >
                  {searchingRole === r.role ? (
                    <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
                  ) : (
                    <Search data-icon="inline-start" />
                  )}
                  {r.searchedToday ? "Buscado hoy" : "Buscar en Apollo"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmRole !== null} onOpenChange={(open) => !open && setConfirmRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buscar &quot;{confirmRole}&quot; en Apollo</AlertDialogTitle>
            <AlertDialogDescription>
              Esta búsqueda consulta la API de Apollo y puede consumir créditos de tu cuenta. Los
              contactos encontrados se guardan en el cache del equipo. ¿Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRole && handleSearch(confirmRole)}>
              Buscar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
