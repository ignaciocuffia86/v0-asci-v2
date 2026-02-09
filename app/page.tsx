'use client';

import Link from "next/link"
import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import {
  ArrowRight,
  Sparkles,
  Search,
  Target,
  Users,
  Zap,
  Building2,
  TrendingUp,
  MessageSquare,
  Database,
  Globe,
  CheckCircle2,
  ChevronRight,
  Kanban,
  Layers,
  FileText,
  BarChart3,
  Radar,
  Download,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { NetHuntForm } from "@/components/nethunt-form"

// Animated counter hook
function useCounter(target: number, duration: number = 2000) {
  const [count, setCount] = useState(0)
  const [hasStarted, setHasStarted] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasStarted) {
          setHasStarted(true)
        }
      },
      { threshold: 0.3 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [hasStarted])

  useEffect(() => {
    if (!hasStarted) return
    let start = 0
    const increment = target / (duration / 16)
    const timer = setInterval(() => {
      start += increment
      if (start >= target) {
        setCount(target)
        clearInterval(timer)
      } else {
        setCount(Math.floor(start))
      }
    }, 16)
    return () => clearInterval(timer)
  }, [hasStarted, target, duration])

  return { count, ref }
}

function StatItem({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  const { count, ref } = useCounter(value)
  return (
    <div ref={ref} className="text-center">
      <div className="text-4xl md:text-5xl font-bold text-foreground mb-2 tabular-nums">
        {count.toLocaleString()}{suffix}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  )
}

// Feature card component
function FeatureCard({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="group relative rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mb-2 text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

// Step component
function StepItem({ number, icon: Icon, title, description, isLast = false }: { number: number; icon: React.ElementType; title: string; description: string; isLast?: boolean }) {
  return (
    <div className="relative">
      <div className="flex items-center gap-4 mb-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary flex-shrink-0">
          <Icon className="h-7 w-7" />
        </div>
        {!isLast && <div className="hidden h-px flex-1 bg-border md:block" />}
      </div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary">Paso {number}</div>
      <h3 className="mb-2 text-xl font-semibold text-foreground">{title}</h3>
      <p className="leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Navbar */}
      <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.jpg" alt="ASCI Logo" width={32} height={32} className="rounded-lg" />
            <span className="text-lg font-bold tracking-tight text-foreground">ASCI</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
            <Link href="#features" className="transition-colors hover:text-foreground">
              Producto
            </Link>
            <Link href="#how-it-works" className="transition-colors hover:text-foreground">
              Como Funciona
            </Link>
            <Link href="#workspace" className="transition-colors hover:text-foreground">
              Workspace IA
            </Link>
            <Link href="#request-access" className="transition-colors hover:text-foreground">
              Acceso
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/auth/login">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                Iniciar Sesion
              </Button>
            </Link>
            <Link href="/auth/sign-up">
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
                Registrarse
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative overflow-hidden pb-32 pt-20">
          {/* Subtle background grid */}
          <div className="absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--primary)/0.08),transparent_60%)]" />
            <div
              className="absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
              }}
            />
          </div>

          <div className="container mx-auto px-4">
            <div className="mx-auto max-w-4xl text-center">
              {/* Badge */}
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Inteligencia de Senales para Ventas B2B
              </div>

              {/* Headline */}
              <h1 className="mb-6 text-balance text-5xl font-bold leading-[1.08] tracking-tight text-foreground md:text-6xl lg:text-7xl">
                Descubre que{" "}
                <span className="text-primary">
                  tecnologias
                </span>{" "}
                usan tus prospectos
              </h1>

              {/* Subheadline */}
              <p className="mx-auto mb-10 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground md:text-xl">
                Analiza senales ocultas en perfiles de empleados para identificar el stack tecnologico y procesos de cualquier empresa. Inteligencia de mercado para equipos de ventas B2B.
              </p>

              {/* CTA Buttons */}
              <div className="mb-20 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Link href="/auth/sign-up">
                  <Button size="lg" className="h-12 px-8 text-base bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20">
                    Comenzar Gratis
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="#request-access">
                  <Button variant="outline" size="lg" className="h-12 px-8 text-base border-border text-foreground hover:bg-muted">
                    Solicitar Demo
                  </Button>
                </Link>
              </div>

              {/* Hero Visual - App Screenshot */}
              <div className="relative mx-auto max-w-5xl">
                <div className="absolute -inset-4 rounded-3xl bg-primary/5 blur-2xl -z-10" />

                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/20">
                  {/* Browser Header */}
                  <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-3">
                    <div className="flex gap-1.5">
                      <div className="h-3 w-3 rounded-full bg-destructive/60" />
                      <div className="h-3 w-3 rounded-full bg-chart-4/60" />
                      <div className="h-3 w-3 rounded-full bg-accent/60" />
                    </div>
                    <div className="flex flex-1 justify-center">
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-1.5 text-sm text-muted-foreground">
                        <Search className="h-3.5 w-3.5" />
                        asci.bigua.lat/search
                      </div>
                    </div>
                  </div>

                  {/* App Content */}
                  <div className="bg-background p-6">
                    {/* Search Bar */}
                    <div className="mb-6 flex items-center gap-3">
                      <div className="flex flex-1 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                        <Search className="h-5 w-5 text-muted-foreground" />
                        <span className="text-muted-foreground">Buscar por tecnologia, proceso o empresa...</span>
                      </div>
                      <div className="rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground">Buscar</div>
                    </div>

                    {/* Results Grid */}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      {[
                        { name: "Galicia Bank", industry: "Financial Services", initial: "G", signals: 18, tags: ["AWS", "SAP", "DevOps"], colors: ["bg-primary/10 text-primary", "bg-accent/10 text-accent", "bg-chart-4/20 text-chart-4"] },
                        { name: "Santander Argentina", industry: "Banking", initial: "S", signals: 24, tags: ["Azure", "Oracle", "Kubernetes"], colors: ["bg-primary/10 text-primary", "bg-chart-5/10 text-chart-5", "bg-chart-2/10 text-chart-2"] },
                        { name: "Mercado Libre", industry: "E-commerce", initial: "M", signals: 42, tags: ["GCP", "Kafka", "React"], colors: ["bg-chart-4/20 text-chart-4", "bg-accent/10 text-accent", "bg-primary/10 text-primary"] },
                      ].map((company) => (
                        <div key={company.name} className="rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-md">
                          <div className="mb-3 flex items-start gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                              {company.initial}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-semibold text-foreground">{company.name}</div>
                              <div className="text-sm text-muted-foreground">{company.industry}</div>
                            </div>
                          </div>
                          <div className="mb-3 flex flex-wrap gap-1.5">
                            {company.tags.map((tag, i) => (
                              <Badge key={tag} variant="secondary" className={`text-xs ${company.colors[i]}`}>
                                {tag}
                              </Badge>
                            ))}
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{company.signals} senales</span>
                            <span className="flex items-center gap-1 font-medium text-primary">
                              Ver detalle <ChevronRight className="h-3.5 w-3.5" />
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="border-y border-border bg-card py-16">
          <div className="container mx-auto px-4">
            <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
              <StatItem value={42000} suffix="+" label="Contactos Analizados" />
              <StatItem value={58000} suffix="+" label="Empresas Indexadas" />
              <StatItem value={1100} suffix="+" label="Tecnologias y Procesos" />
              <StatItem value={235000} suffix="+" label="Senales Detectadas" />
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="py-24 bg-background">
          <div className="container mx-auto px-4">
            <div className="mx-auto mb-16 max-w-3xl text-center">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Como Funciona
              </div>
              <h2 className="mb-4 text-balance text-4xl font-bold text-foreground">De datos dispersos a inteligencia accionable</h2>
              <p className="text-lg leading-relaxed text-muted-foreground">
                ASCI transforma informacion publica de LinkedIn en senales de compra que tu equipo puede usar hoy.
              </p>
            </div>

            <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 md:grid-cols-3">
              <StepItem
                number={1}
                icon={Database}
                title="Ingesta de Datos"
                description="Analizamos perfiles de LinkedIn de empleados actuales y ex-empleados para extraer menciones de tecnologias y procesos."
              />
              <StepItem
                number={2}
                icon={Zap}
                title="Deteccion de Senales"
                description="Nuestro motor de busqueda identifica keywords de 200+ tecnologias y 50+ procesos, creando senales por empresa."
              />
              <StepItem
                number={3}
                icon={Target}
                title="Accion con IA"
                description="Genera estrategias de cuenta, icebreakers personalizados y encuentra decision makers con contexto real."
                isLast
              />
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section id="features" className="border-t border-border bg-card py-24">
          <div className="container mx-auto px-4">
            <div className="mx-auto mb-16 max-w-3xl text-center">
              <h2 className="mb-4 text-balance text-4xl font-bold text-foreground">Todo lo que necesitas para prospectar mejor</h2>
              <p className="text-lg leading-relaxed text-muted-foreground">
                Funcionalidades disenadas para equipos de ventas B2B que quieren ir mas alla del email frio.
              </p>
            </div>

            <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={Search}
                title="Busqueda por Tecnologia"
                description="Encuentra empresas que usan SAP, AWS, Salesforce o cualquier tecnologia. Filtra por pais e industria."
              />
              <FeatureCard
                icon={TrendingUp}
                title="Busqueda por Proceso"
                description="Identifica empresas con equipos de DevOps, QA, Data Science o cualquier capacidad que necesites."
              />
              <FeatureCard
                icon={Building2}
                title="Perfil de Empresa"
                description="Vista 360 de cada empresa: stack tecnologico, procesos internos, empleados clave y busquedas laborales."
              />
              <FeatureCard
                icon={Users}
                title="Decision Makers"
                description="Identifica a las personas correctas dentro de cada empresa basandote en las senales detectadas."
              />
              <FeatureCard
                icon={Globe}
                title="Senales Web con IA"
                description="Busca noticias, implementaciones y casos de exito de tus prospectos usando IA generativa."
              />
              <FeatureCard
                icon={MessageSquare}
                title="Icebreakers con IA"
                description="Genera mensajes de apertura personalizados basados en las senales y contexto de cada prospecto."
              />
              <FeatureCard
                icon={Kanban}
                title="Pipeline Kanban"
                description="Gestiona tus cuentas con vista Kanban. Arrastra y suelta para mover entre estados del funnel."
              />
              <FeatureCard
                icon={Layers}
                title="Tiers de Cuentas (ABM)"
                description="Clasifica tus cuentas en Alta, Transaccional o Baja prioridad. Enfoca tu tiempo en lo que mas importa."
              />
              <FeatureCard
                icon={FileText}
                title="Brief Ejecutivo con IA"
                description="Genera resumenes ejecutivos de cada cuenta combinando senales, noticias y estrategia comercial."
              />
            </div>
          </div>
        </section>

        {/* Pipeline Section */}
        <section className="border-t border-border bg-background py-24">
          <div className="container mx-auto px-4">
            <div className="mx-auto mb-16 max-w-3xl text-center">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                <Kanban className="h-3 w-3" />
                Gestion de Pipeline
              </div>
              <h2 className="mb-4 text-balance text-4xl font-bold text-foreground">Tu pipeline de prospeccion, organizado</h2>
              <p className="text-lg leading-relaxed text-muted-foreground">
                Guarda cuentas, clasificalas por prioridad y gestiona todo el funnel de prospeccion desde una sola vista.
              </p>
            </div>

            <div className="mx-auto max-w-5xl">
              <div className="rounded-2xl border border-border bg-card p-8">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  {[
                    { title: "Nuevo", count: 12, color: "text-muted-foreground", bgCount: "bg-muted text-muted-foreground", items: [
                      { name: "ICBC Argentina", industry: "Banking", tier: "Alta", tierColor: "bg-destructive/10 text-destructive" },
                      { name: "YPF", industry: "Oil & Gas", tier: "Transaccional", tierColor: "bg-chart-4/15 text-chart-4" },
                    ]},
                    { title: "Investigando", count: 8, color: "text-primary", bgCount: "bg-primary/10 text-primary", items: [
                      { name: "Mercado Libre", industry: "E-commerce", tier: "Alta", tierColor: "bg-destructive/10 text-destructive" },
                    ]},
                    { title: "Contactado", count: 5, color: "text-chart-4", bgCount: "bg-chart-4/15 text-chart-4", items: [
                      { name: "Santander", industry: "Banking", tier: "Alta", tierColor: "bg-destructive/10 text-destructive" },
                    ]},
                    { title: "Reunion", count: 3, color: "text-chart-2", bgCount: "bg-chart-2/10 text-chart-2", items: [
                      { name: "Galicia Bank", industry: "Financial Services", tier: "Alta", tierColor: "bg-destructive/10 text-destructive" },
                    ]},
                  ].map((column) => (
                    <div key={column.title} className="rounded-xl border border-border bg-background p-4">
                      <div className="mb-4 flex items-center justify-between">
                        <span className={`font-semibold ${column.color}`}>{column.title}</span>
                        <span className={`rounded-full px-2 py-1 text-xs ${column.bgCount}`}>{column.count}</span>
                      </div>
                      <div className="space-y-3">
                        {column.items.map((item) => (
                          <div key={item.name} className="rounded-lg border border-border bg-card p-3">
                            <div className="text-sm font-medium text-foreground">{item.name}</div>
                            <div className="text-xs text-muted-foreground">{item.industry}</div>
                            <Badge className={`mt-2 text-xs ${item.tierColor} hover:${item.tierColor}`}>{item.tier}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 grid grid-cols-3 gap-4 border-t border-border pt-6 text-center">
                  <div>
                    <div className="text-2xl font-bold text-destructive">15</div>
                    <div className="text-xs text-muted-foreground">Cuentas Alta Prioridad</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-chart-4">12</div>
                    <div className="text-xs text-muted-foreground">Cuentas Transaccionales</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-muted-foreground">8</div>
                    <div className="text-xs text-muted-foreground">Cuentas Baja Prioridad</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Workspace Section */}
        <section id="workspace" className="overflow-hidden border-t border-border bg-card py-24">
          <div className="container mx-auto px-4">
            <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
              {/* Left Content */}
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Sparkles className="h-3 w-3" />
                  Workspace Inteligente
                </div>
                <h2 className="mb-6 text-4xl font-bold text-foreground">Tu centro de comando para cada cuenta</h2>
                <p className="mb-8 text-lg leading-relaxed text-muted-foreground">
                  Guarda empresas como bookmarks y accede a un workspace privado donde la IA trabaja para ti. Analiza, investiga y crea contenido personalizado sin salir de la plataforma.
                </p>

                <div className="space-y-5">
                  {[
                    { icon: Target, title: "Estrategia de Cuenta con IA", description: "Analiza el sitio web del prospecto y genera angulos de venta unicos automaticamente." },
                    { icon: MessageSquare, title: "Icebreakers Personalizados", description: "Genera mensajes de apertura que demuestran que hiciste tu tarea." },
                    { icon: Globe, title: "Research con Perplexity", description: "Busca noticias e implementaciones recientes de cada empresa." },
                    { icon: Download, title: "Exporta tus Prospectos", description: "Descarga contactos y decision makers en CSV o Excel con toda la informacion relevante." },
                  ].map((feature) => (
                    <div key={feature.title} className="flex items-start gap-4">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <feature.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-foreground">{feature.title}</h4>
                        <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Visual */}
              <div className="relative">
                <div className="absolute -inset-4 rounded-3xl bg-primary/5 blur-3xl -z-10" />
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
                  {/* Workspace Header */}
                  <div className="flex items-center justify-between border-b border-border bg-muted/50 px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 font-bold text-primary">
                        G
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">Galicia Bank</div>
                        <div className="text-sm text-muted-foreground">Financial Services - Argentina</div>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-accent/30 bg-accent/10 text-accent">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      Alta Prioridad
                    </Badge>
                  </div>

                  {/* Workspace Tabs */}
                  <div className="flex gap-1 border-b border-border bg-background px-6 py-3">
                    {["Overview", "Senales", "Estrategia", "Noticias"].map((tab, i) => (
                      <div
                        key={tab}
                        className={`rounded-lg px-4 py-2 text-sm font-medium ${
                          i === 0
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {tab}
                      </div>
                    ))}
                  </div>

                  {/* Workspace Content */}
                  <div className="space-y-4 p-6">
                    {/* Strategy Card */}
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium text-foreground">Estrategia Generada por IA</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        &quot;Enfocar pitch en modernizacion de core bancario. Senales indican migracion a AWS y adopcion de metodologias agiles...&quot;
                      </p>
                    </div>

                    {/* Signals Summary */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { value: "12", label: "Senales Tech" },
                        { value: "6", label: "Procesos" },
                        { value: "8", label: "Busquedas Lab." },
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-lg bg-muted p-3 text-center">
                          <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                          <div className="text-xs text-muted-foreground">{stat.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Tech Tags */}
                    <div className="flex flex-wrap gap-2">
                      {["AWS", "SAP S/4HANA", "DevOps", "Kubernetes", "Terraform"].map((tag) => (
                        <Badge key={tag} variant="secondary" className="bg-primary/10 text-primary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="border-t border-border bg-secondary py-24 text-secondary-foreground">
          <div className="container mx-auto px-4 text-center">
            <div className="mx-auto max-w-3xl">
              <Radar className="mx-auto mb-6 h-12 w-12 text-primary" />
              <h2 className="mb-4 text-balance text-4xl font-bold">Comienza a encontrar senales hoy</h2>
              <p className="mb-8 text-lg text-secondary-foreground/70">
                Unite a los equipos de ventas que ya estan usando inteligencia de senales para mejorar su prospeccion B2B.
              </p>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Link href="/auth/sign-up">
                  <Button size="lg" className="h-12 px-8 text-base bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20">
                    Crear Cuenta Gratis
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="#request-access">
                  <Button variant="outline" size="lg" className="h-12 px-8 text-base border-secondary-foreground/20 text-secondary-foreground hover:bg-secondary-foreground/10">
                    Solicitar Demo
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* NetHunt Form Section */}
        <section id="request-access" className="border-t border-border bg-background py-16">
          <div className="container mx-auto px-4">
            <div className="mb-12 text-center">
              <h2 className="mb-4 text-3xl font-bold text-foreground">Solicita acceso a ASCI</h2>
              <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
                Completa el formulario y te contactaremos para brindarte acceso a la plataforma.
              </p>
            </div>
            <NetHuntForm />
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border bg-card py-8">
          <div className="container mx-auto px-4">
            <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
              <div className="flex items-center gap-2 font-bold text-foreground">
                <Image src="/logo.jpg" alt="ASCI Logo" width={28} height={28} className="rounded-lg" />
                ASCI
              </div>
              <div className="text-sm text-muted-foreground">
                &copy; 2026 ASCI. Asistente de Senales de Compra e Inferencias.
              </div>
              <div className="text-sm text-muted-foreground">
                Desarrollado por{" "}
                <Link href="https://bigua.lat" target="_blank" className="text-primary hover:underline">
                  Bigua
                </Link>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </div>
  )
}
