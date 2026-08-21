"use client"

import { useState, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Linkedin, Loader2, Mail, Phone, Plus, Search, Sparkles, X } from "lucide-react"
import { toast } from "sonner"
import {
  APOLLO_COUNTRIES,
  PREDEFINED_JOB_TITLE_GROUPS,
  mapToApolloCountry,
} from "@/lib/shared/apollo-title-groups"
import { searchDecisionMakersAction, type DecisionMaker } from "@/app/actions/v3/apollo"

// ═══════════════════════════════════════════════════════════
// Decisores de la cuenta (Apollo), dentro del informe.
//
// Va entre "Riesgos a mitigar" y "Método y limitaciones" porque es la ÚNICA
// acción del bookmark: todo lo demás se busca solo. El resto del informe dice
// qué está pasando en la cuenta; esto es a quién llamarle.
//
// La búsqueda es la misma que la del tab de prospectos de v2
// (lib/shared/apollo-decision-makers) y los cargos sugeridos salen de las
// señales fit que ya calcula la cuenta, así que el usuario arranca con una
// selección razonable en vez de una lista vacía.
// ═══════════════════════════════════════════════════════════

/** Chip de canal, con el mismo criterio que los movimientos de personal. */
function Canal({
  href,
  icon,
  label,
  destacado,
}: {
  href: string
  icon: React.ReactNode
  label: string
  destacado: boolean
}) {
  return (
    <a
      href={href}
      title={label}
      className={`inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] hover:brightness-110 ${
        destacado
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-muted-foreground/25 bg-muted text-muted-foreground"
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </a>
  )
}

export function DecisionMakersSection({
  companyId,
  companyCountry,
  recommendedRoles,
  initialContacts,
}: {
  companyId: string
  companyCountry: string | null
  /** Cargos que las señales de la cuenta sugieren buscar. */
  recommendedRoles: Array<{ role: string; reason: string; inCache: boolean }>
  initialContacts: DecisionMaker[]
}) {
  const [contacts, setContacts] = useState(initialContacts)
  const [isPending, startTransition] = useTransition()
  const [abierto, setAbierto] = useState(initialContacts.length === 0)

  // Arranca con los cargos que las señales sugieren y que NO están cubiertos:
  // buscar de nuevo lo que ya tenemos es gastar una llamada al pedo.
  const [titulos, setTitulos] = useState<string[]>(() =>
    recommendedRoles.filter((r) => !r.inCache).map((r) => r.role),
  )
  const [tituloLibre, setTituloLibre] = useState("")
  const [pais, setPais] = useState(() => mapToApolloCountry(companyCountry))

  const [avanzadas, setAvanzadas] = useState(false)
  const [titulosSimilares, setTitulosSimilares] = useState(false)
  const [ubicacionDeLaEmpresa, setUbicacionDeLaEmpresa] = useState(false)

  const toggleTitulo = (t: string) =>
    setTitulos((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))

  const agregarLibre = () => {
    const t = tituloLibre.trim()
    if (!t) return
    if (!titulos.includes(t)) setTitulos((prev) => [...prev, t])
    setTituloLibre("")
  }

  const buscar = () => {
    if (titulos.length === 0) {
      toast.error("Elegí al menos un cargo para buscar.")
      return
    }
    startTransition(async () => {
      const res = await searchDecisionMakersAction(companyId, titulos, pais || null, {
        includeSimilarTitles: titulosSimilares,
        useOrganizationLocation: ubicacionDeLaEmpresa,
      })
      setContacts(res.contacts)

      if (!res.success) {
        toast.error(res.error ?? "No se pudo buscar en Apollo.")
        return
      }
      // Las advertencias importan aunque la búsqueda haya salido bien: "empresa
      // no indexada" explica por qué los resultados pueden ser flojos.
      for (const w of res.stats?.warnings ?? []) toast.warning(w)

      if (res.count === 0) {
        toast.info(
          res.stats?.skippedDuplicates
            ? `Sin decisores nuevos: los ${res.stats.skippedDuplicates} encontrados ya estaban.`
            : "Apollo no encontró decisores con esos cargos.",
        )
      } else {
        toast.success(`${res.count} decisor${res.count === 1 ? "" : "es"} nuevo${res.count === 1 ? "" : "s"}.`)
      }
    })
  }

  return (
    <section id="decisores" className="scroll-mt-24">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            Decisores
            {contacts.length > 0 && <Badge variant="secondary">{contacts.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-pretty">
              Todavía no hay decisores cargados para esta cuenta. Buscalos por cargo y quedan guardados.
            </p>
          ) : (
            <ul className="divide-y">
              {contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{c.fullName}</span>
                      {c.seniority && (
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {c.seniority.replaceAll("_", " ")}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {[c.title, [c.city, c.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ") ||
                        "Sin cargo"}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {c.email && (
                      <Canal
                        href={`mailto:${c.email}`}
                        icon={<Mail className="size-3.5" />}
                        label={c.email}
                        // Apollo marca el estado del email: uno sin verificar
                        // rebota, y conviene saberlo antes de escribir.
                        destacado={c.emailStatus === "verified"}
                      />
                    )}
                    {c.phone && (
                      <Canal
                        href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
                        icon={<Phone className="size-3.5" />}
                        label={c.phone}
                        destacado={false}
                      />
                    )}
                    {c.linkedinUrl && (
                      <a
                        href={c.linkedinUrl.startsWith("http") ? c.linkedinUrl : `https://${c.linkedinUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Ver LinkedIn de ${c.fullName}`}
                        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Linkedin className="size-4" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!abierto ? (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="self-start text-xs font-medium text-primary hover:underline"
            >
              Buscar más decisores
            </button>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
              {recommendedRoles.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <Sparkles className="size-3.5 text-primary" />
                    Sugeridos por las señales de la cuenta
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {recommendedRoles.map((r) => (
                      <button
                        key={r.role}
                        type="button"
                        onClick={() => toggleTitulo(r.role)}
                        title={`Por: ${r.reason}${r.inCache ? " · ya hay contactos de este cargo" : ""}`}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                          titulos.includes(r.role)
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-accent"
                        }`}
                      >
                        {r.role}
                        {r.inCache && <span className="ml-1 opacity-60">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium">Por área</p>
                <div className="flex flex-col gap-2">
                  {PREDEFINED_JOB_TITLE_GROUPS.map((grupo) => (
                    <div key={grupo.label} className="flex flex-wrap items-center gap-1.5">
                      <span className="w-full text-[11px] text-muted-foreground sm:w-auto sm:min-w-[9rem]">
                        {grupo.label}
                      </span>
                      {grupo.titles.map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => toggleTitulo(t)}
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                            titulos.includes(t)
                              ? "border-primary bg-primary text-primary-foreground"
                              : "hover:bg-accent"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
                  <label htmlFor="cargo-libre" className="text-xs font-medium">
                    Otro cargo
                  </label>
                  <div className="flex gap-1.5">
                    <Input
                      id="cargo-libre"
                      value={tituloLibre}
                      onChange={(e) => setTituloLibre(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          agregarLibre()
                        }
                      }}
                      placeholder="Ej: Gerente de Compras"
                      className="h-8 text-sm"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={agregarLibre} className="h-8">
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium">País</label>
                  <Select value={pais || "__todos"} onValueChange={(v) => setPais(v === "__todos" ? "" : v)}>
                    <SelectTrigger className="h-8 w-[12rem] text-sm">
                      <SelectValue placeholder="Sin filtro" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__todos">Sin filtro</SelectItem>
                      {APOLLO_COUNTRIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {titulos.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    {titulos.length} cargo{titulos.length === 1 ? "" : "s"} a buscar:
                  </span>
                  {titulos.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px]"
                    >
                      {t}
                      <button type="button" onClick={() => toggleTitulo(t)} aria-label={`Quitar ${t}`}>
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setAvanzadas((v) => !v)}
                  className="self-start text-[11px] text-muted-foreground hover:underline"
                  aria-expanded={avanzadas}
                >
                  {avanzadas ? "Ocultar opciones avanzadas" : "Opciones avanzadas"}
                </button>
                {avanzadas && (
                  <div className="flex flex-col gap-2 rounded-md border bg-background p-2.5">
                    <label className="flex items-start gap-2.5 text-xs">
                      <Switch checked={titulosSimilares} onCheckedChange={setTitulosSimilares} />
                      <span className="text-pretty">
                        <span className="font-medium">Incluir cargos similares.</span>{" "}
                        <span className="text-muted-foreground">
                          Trae más gente pero con más falsos positivos. Por eso viene apagado.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2.5 text-xs">
                      <Switch checked={ubicacionDeLaEmpresa} onCheckedChange={setUbicacionDeLaEmpresa} />
                      <span className="text-pretty">
                        <span className="font-medium">Filtrar por la sede de la empresa.</span>{" "}
                        <span className="text-muted-foreground">
                          En vez de por dónde vive la persona. Útil en multinacionales.
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" onClick={buscar} disabled={isPending || titulos.length === 0}>
                  {isPending ? (
                    <>
                      <Loader2 data-icon="inline-start" className="animate-spin" />
                      Buscando…
                    </>
                  ) : (
                    <>
                      <Search data-icon="inline-start" />
                      Buscar decisores
                    </>
                  )}
                </Button>
                {contacts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAbierto(false)}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    Cerrar
                  </button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
