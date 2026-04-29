'use client'

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { motion, useInView, useScroll, useTransform } from "framer-motion"
import {
  ArrowRight,
  Search,
  Target,
  Users,
  Zap,
  Building2,
  Globe,
  ChevronRight,

  FileText,
  Sparkles,

  Menu,
  X,
} from "lucide-react"
import { NetHuntForm } from "@/components/nethunt-form"

/* ─── ASCI Sonar Logo ─── */
function AsciLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M60 10 C87.6 10 110 32.4 110 60" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.25" />
      <path d="M60 28 C77.7 28 92 42.3 92 60" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" opacity="0.5" />
      <path d="M60 46 C67.7 46 74 52.3 74 60" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
      <circle cx="60" cy="60" r="5" fill="currentColor" />
      <path d="M60 110 C32.4 110 10 87.6 10 60" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.25" />
      <path d="M60 92 C42.3 92 28 77.7 28 60" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" opacity="0.5" />
      <path d="M60 74 C52.3 74 46 67.7 46 60" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
    </svg>
  )
}

/* ─── Palette constants ─── */
const LIME = "#d9f270"
const DARK = "#0a0a0a"
const OFF_WHITE = "#f5f5f0"
const GRAY = "#737373"
const BORDER = "#1f1f1f"

/* ─── Section wrapper with scroll reveal ─── */
function Section({ children, className = "", id, style }: { children: React.ReactNode; className?: string; id?: string; style?: React.CSSProperties }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-80px" })
  return (
    <motion.section
      ref={ref}
      id={id}
      initial={{ opacity: 0, y: 32 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={className}
      style={style}
    >
      {children}
    </motion.section>
  )
}

/* ─── Animated counter ─── */
function AnimatedStat({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: "-40px" })
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!isInView) return
    let start = 0
    const increment = value / 60
    const timer = setInterval(() => {
      start += increment
      if (start >= value) { setCount(value); clearInterval(timer) }
      else setCount(Math.floor(start))
    }, 16)
    return () => clearInterval(timer)
  }, [isInView, value])

  return (
    <div ref={ref} className="text-center">
      <div className="text-4xl md:text-5xl font-bold tabular-nums" style={{ color: OFF_WHITE }}>
        {count.toLocaleString()}{suffix}
      </div>
      <div className="text-sm mt-2" style={{ color: GRAY }}>
        {label}
      </div>
    </div>
  )
}

/* ─── Feature Card ─── */
function FeatureCard({ icon: Icon, title, description, index }: { icon: React.ElementType; title: string; description: string; index: number }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-40px" })
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
      className="group relative rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1"
      style={{ border: `1px solid ${BORDER}`, backgroundColor: "#111111" }}
    >
      <div
        className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl transition-colors duration-300"
        style={{ backgroundColor: `${LIME}12`, color: LIME }}
      >
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mb-2 text-lg font-semibold" style={{ color: OFF_WHITE }}>{title}</h3>
      <p className="text-sm leading-relaxed" style={{ color: GRAY }}>{description}</p>
      <div
        className="absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none"
        style={{ boxShadow: `0 0 40px ${LIME}08, inset 0 1px 0 ${LIME}15` }}
      />
    </motion.div>
  )
}

/* ─── Step Component ─── */
function StepCard({ number, title, description, index }: { number: number; title: string; description: string; index: number }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-40px" })
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      <div className="mb-5">
        <span className="text-6xl font-bold" style={{ color: `${LIME}20` }}>{number}</span>
      </div>
      <h3 className="mb-3 text-xl font-semibold" style={{ color: OFF_WHITE }}>{title}</h3>
      <p className="leading-relaxed" style={{ color: GRAY }}>{description}</p>
    </motion.div>
  )
}

/* ─── Testimonial Card ─── */


/* ═══════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════ */
// Valores de fallback (snapshot manual de la DB al 29-Abr-2026).
// Si el fetch a /api/landing-stats falla, se muestran estos.
const STATS_FALLBACK = {
  contacts_analyzed: 393198,
  companies_indexed: 398459,
  technologies_processes: 89,
  signals_detected: 1091130,
}

export default function HomePage() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [stats, setStats] = useState(STATS_FALLBACK)
  const heroRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] })
  const heroOpacity = useTransform(scrollYProgress, [0, 1], [1, 0])
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 80])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/landing-stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setStats({
          contacts_analyzed: data.contacts_analyzed ?? STATS_FALLBACK.contacts_analyzed,
          companies_indexed: data.companies_indexed ?? STATS_FALLBACK.companies_indexed,
          technologies_processes:
            data.technologies_processes ?? STATS_FALLBACK.technologies_processes,
          signals_detected: data.signals_detected ?? STATS_FALLBACK.signals_detected,
        })
      })
      .catch(() => {
        // Silencioso: dejamos el fallback. La landing no debe romperse por esto.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const navLinks = [
    { href: "#features", label: "Producto" },
    { href: "#how-it-works", label: "Como Funciona" },
    { href: "#request-access", label: "Contacto" },
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: DARK, color: OFF_WHITE }}>
      {/* ─── Navbar ─── */}
      <header
        className="fixed top-0 z-50 w-full transition-all duration-500"
        style={{
          backgroundColor: scrolled ? `${DARK}f0` : "transparent",
          backdropFilter: scrolled ? "blur(20px)" : "none",
          borderBottom: scrolled ? `1px solid ${BORDER}` : "1px solid transparent",
        }}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <AsciLogo size={32} style={{ color: LIME }} />
            <span className="text-lg font-bold tracking-tight" style={{ color: OFF_WHITE }}>ASCI</span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium transition-colors duration-200 hover:opacity-100"
                style={{ color: GRAY }}
                onMouseOver={(e) => (e.currentTarget.style.color = OFF_WHITE)}
                onMouseOut={(e) => (e.currentTarget.style.color = GRAY)}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            <Link href="/auth/login">
              <button
                className="rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-200"
                style={{ color: GRAY }}
                onMouseOver={(e) => (e.currentTarget.style.color = OFF_WHITE)}
                onMouseOut={(e) => (e.currentTarget.style.color = GRAY)}
              >
                Iniciar Sesion
              </button>
            </Link>
            <Link href="#request-access">
              <button
                className="rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-200 hover:brightness-110"
                style={{ backgroundColor: LIME, color: DARK }}
              >
                Solicitar Demo
              </button>
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2"
            onClick={() => setMobileMenu(!mobileMenu)}
            aria-label={mobileMenu ? "Cerrar menu" : "Abrir menu"}
          >
            {mobileMenu ? <X className="h-5 w-5" style={{ color: OFF_WHITE }} /> : <Menu className="h-5 w-5" style={{ color: OFF_WHITE }} />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenu && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden px-6 pb-6 pt-2"
            style={{ backgroundColor: DARK, borderBottom: `1px solid ${BORDER}` }}
          >
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block py-3 text-sm font-medium"
                style={{ color: GRAY }}
                onClick={() => setMobileMenu(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-4 flex flex-col gap-3">
              <Link href="/auth/login" className="text-sm font-medium text-center py-2.5" style={{ color: GRAY }}>
                Iniciar Sesion
              </Link>
              <Link
                href="#request-access"
                className="rounded-xl px-5 py-2.5 text-sm font-semibold text-center"
                style={{ backgroundColor: LIME, color: DARK }}
                onClick={() => setMobileMenu(false)}
              >
                Solicitar Demo
              </Link>
            </div>
          </motion.div>
        )}
      </header>

      <main>
        {/* ═══════════════════════════════════════
            HERO
            ═══════════════════════════════════════ */}
        <section ref={heroRef} className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
          {/* Subtle grid background */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `linear-gradient(${LIME}30 1px, transparent 1px), linear-gradient(90deg, ${LIME}30 1px, transparent 1px)`,
              backgroundSize: "80px 80px",
            }}
          />
          {/* Radial glow */}
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-15"
            style={{ background: `radial-gradient(ellipse at center, ${LIME}40, transparent 70%)` }}
          />

          <motion.div style={{ opacity: heroOpacity, y: heroY }} className="relative z-10 mx-auto max-w-5xl px-6 text-center">
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mb-8 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-widest"
              style={{ border: `1px solid ${LIME}30`, color: LIME, backgroundColor: `${LIME}08` }}
            >
              <Sparkles className="h-3 w-3" />
              Signal-Based Selling para LATAM
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="mb-6 text-balance text-5xl font-bold leading-[1.06] tracking-tight md:text-6xl lg:text-[4.5rem]"
              style={{ color: OFF_WHITE }}
            >
              Sabe que tecnologias usa{" "}
              <span style={{ color: LIME }}>cada empresa</span>{" "}
              antes de llamar
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.35 }}
              className="mx-auto mb-10 max-w-2xl text-pretty text-lg leading-relaxed md:text-xl"
              style={{ color: GRAY }}
            >
              ASCI detecta senales ocultas en perfiles de empleados y busquedas laborales para mapear el stack tecnologico y los procesos de cualquier compania. Prospeccion B2B con contexto real, no con datos frios.
            </motion.p>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
              <Link href="#request-access">
                <button
                  className="flex items-center gap-2 rounded-xl px-7 py-3.5 text-base font-semibold transition-all duration-200 hover:brightness-110 hover:-translate-y-0.5"
                  style={{ backgroundColor: LIME, color: DARK }}
                >
                  Solicitar Demo
                  <ArrowRight className="h-4 w-4" />
                </button>
              </Link>
              <Link href="/auth/login">
                <button
                  className="rounded-xl px-7 py-3.5 text-base font-medium transition-all duration-200 hover:brightness-125"
                  style={{ border: `1px solid ${BORDER}`, color: OFF_WHITE, backgroundColor: "transparent" }}
                >
                  Ya tengo cuenta
                </button>
              </Link>
            </motion.div>

            {/* Hero Visual */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="relative mx-auto mt-20 max-w-4xl"
            >
              <div
                className="absolute -inset-8 rounded-3xl opacity-20 blur-3xl"
                style={{ background: `radial-gradient(${LIME}30, transparent)` }}
              />
              <div className="relative overflow-hidden rounded-2xl" style={{ border: `1px solid ${BORDER}`, backgroundColor: "#0f0f0f" }}>
                {/* Browser chrome */}
                <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <div className="flex gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#ff5f57" }} />
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#febc2e" }} />
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#28c840" }} />
                  </div>
                  <div className="flex flex-1 justify-center">
                    <div
                      className="flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs"
                      style={{ backgroundColor: "#1a1a1a", color: GRAY }}
                    >
                      <Search className="h-3 w-3" />
                      asci.bigua.lat/search
                    </div>
                  </div>
                </div>
                {/* App mockup */}
                <div className="p-5 md:p-6" style={{ backgroundColor: "#0f0f0f" }}>
                  <div className="mb-5 flex items-center gap-3">
                    <div className="flex flex-1 items-center gap-3 rounded-xl px-4 py-3" style={{ backgroundColor: "#1a1a1a", border: `1px solid ${BORDER}` }}>
                      <Search className="h-4 w-4" style={{ color: GRAY }} />
                      <span className="text-sm" style={{ color: GRAY }}>Buscar por tecnologia, proceso o empresa...</span>
                    </div>
                    <div className="hidden sm:block rounded-xl px-5 py-3 text-sm font-medium" style={{ backgroundColor: LIME, color: DARK }}>
                      Buscar
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {[
                      { name: "Galicia Bank", industry: "Financial Services", signals: 18, tags: ["AWS", "SAP", "DevOps"] },
                      { name: "Santander Argentina", industry: "Banking", signals: 24, tags: ["Azure", "Oracle", "Kubernetes"] },
                      { name: "Mercado Libre", industry: "E-commerce", signals: 42, tags: ["GCP", "Kafka", "React"] },
                    ].map((company) => (
                      <div
                        key={company.name}
                        className="rounded-xl p-4 transition-all duration-300 hover:brightness-110"
                        style={{ backgroundColor: "#1a1a1a", border: `1px solid ${BORDER}` }}
                      >
                        <div className="mb-3 flex items-start gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold" style={{ backgroundColor: `${LIME}15`, color: LIME }}>
                            {company.name[0]}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold" style={{ color: OFF_WHITE }}>{company.name}</div>
                            <div className="text-xs" style={{ color: GRAY }}>{company.industry}</div>
                          </div>
                        </div>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {company.tags.map((tag) => (
                            <span key={tag} className="rounded-md px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${LIME}12`, color: LIME }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs" style={{ color: GRAY }}>{company.signals} senales</span>
                          <span className="flex items-center gap-0.5 text-xs font-medium" style={{ color: LIME }}>
                            Ver detalle <ChevronRight className="h-3 w-3" />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </section>

        {/* ═══════════════════════════════════════
            STATS
            ═══════════════════════════════════════ */}
        <Section className="py-20" style={{ borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-5xl px-6">
            <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
              <AnimatedStat value={stats.contacts_analyzed} suffix="+" label="Contactos Analizados" />
              <AnimatedStat value={stats.companies_indexed} suffix="+" label="Empresas Indexadas" />
              <AnimatedStat value={stats.technologies_processes} suffix="" label="Tecnologias y Procesos" />
              <AnimatedStat value={stats.signals_detected} suffix="+" label="Senales Detectadas" />
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════
            FEATURES
            ═══════════════════════════════════════ */}
        <Section id="features" className="py-24 md:py-32">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto mb-16 max-w-2xl text-center">
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest" style={{ color: LIME }}>
                Producto
              </p>
              <h2 className="mb-5 text-balance text-3xl font-bold md:text-4xl" style={{ color: OFF_WHITE }}>
                Todo lo que necesitas para prospectar con contexto
              </h2>
              <p className="text-lg leading-relaxed" style={{ color: GRAY }}>
                Funcionalidades pensadas para equipos de ventas B2B que quieren ir mas alla del email frio.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              <FeatureCard index={0} icon={Search} title="Segmentacion por Senales" description="Busca empresas por tecnologia, proceso o nombre. Cada senal proviene de perfiles reales de empleados actuales y pasados, o de busquedas laborales activas." />
              <FeatureCard index={1} icon={Building2} title="Perfil 360 de Empresa" description="Cada empresa tiene un panel con su stack tecnologico, procesos internos, empleados detectados, busquedas laborales activas y noticias recientes." />
              <FeatureCard index={2} icon={FileText} title="Documentacion & Value Profile" description="Subi tus casos de exito, propuestas de valor y brochures. La IA los vincula con el diccionario de senales para entender tu fit con cada cuenta." />
              <FeatureCard index={3} icon={Users} title="Prospectos & Decision Makers" description="Busca contactos relevantes en Apollo.io desde el workspace. La IA sugiere job titles basandose en las senales detectadas de cada cuenta." />
              <FeatureCard index={4} icon={Globe} title="Noticias e Implementaciones" description="Investiga con IA las noticias recientes e implementaciones de cada cuenta. Alimentan los icebreakers y el brief ejecutivo con contexto actualizado." />
              <FeatureCard index={5} icon={Sparkles} title="Estrategia, Icebreakers & Brief" description="Genera estrategias de abordaje, icebreakers personalizados y briefs ejecutivos. Todo basado en senales, documentacion y noticias reales." />
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════
            HOW IT WORKS
            ═══���═══════════════════════════════════ */}
        <Section id="how-it-works" className="py-24 md:py-32" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-5xl px-6">
            <div className="mx-auto mb-16 max-w-2xl text-center">
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest" style={{ color: LIME }}>
                Como Funciona
              </p>
              <h2 className="mb-5 text-balance text-3xl font-bold md:text-4xl" style={{ color: OFF_WHITE }}>
                De datos dispersos a inteligencia accionable
              </h2>
              <p className="text-lg leading-relaxed" style={{ color: GRAY }}>
                ASCI transforma informacion publica en senales de compra que tu equipo puede usar hoy.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-12 md:grid-cols-4">
              <StepCard index={0} number={1} title="Ingesta & Senales" description="Importa contactos y busquedas laborales. ASCI analiza cada perfil contra un diccionario de tecnologias y procesos, creando senales unicas por empresa." />
              <StepCard index={1} number={2} title="Documentacion" description="Subi tus propuestas de valor, casos de exito y brochures. La IA los analiza, extrae tags de industria, tecnologia y proceso, y construye tu perfil de valor." />
              <StepCard index={2} number={3} title="Segmentacion" description="Busca por tecnologia, proceso o empresa. Filtra por pais e industria. Guarda cuentas como bookmarks con prioridad (T1, T2, T3) y estado de avance." />
              <StepCard index={3} number={4} title="Workspace & Accion" description="Cada cuenta tiene su workspace con estrategia IA, noticias, implementaciones, prospectos, icebreakers y brief ejecutivo. Todo conectado a tus documentos y senales." />
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════
            WORKSPACE SHOWCASE
            ═════════════��═════════════════════════ */}
        <Section className="py-24 md:py-32" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
              {/* Left */}
              <div>
                <p className="mb-4 text-xs font-semibold uppercase tracking-widest" style={{ color: LIME }}>
                  Workspace Inteligente
                </p>
                <h2 className="mb-6 text-3xl font-bold md:text-4xl" style={{ color: OFF_WHITE }}>
                  Tu centro de comando para cada cuenta
                </h2>
                <p className="mb-10 text-lg leading-relaxed" style={{ color: GRAY }}>
                  Cada cuenta guardada tiene su workspace privado. La IA cruza las senales detectadas con tus documentos de propuesta de valor y casos de exito para generar estrategias, icebreakers y briefs personalizados.
                </p>
                <div className="space-y-6">
                  {[
                    { icon: Target, title: "Estrategia con IA", desc: "Genera angulos de venta usando las senales detectadas, tus documentos de propuesta de valor, y el contexto de noticias e implementaciones de la cuenta." },
                    { icon: FileText, title: "Documentacion conectada", desc: "Tus casos de exito y propuestas de valor se vinculan automaticamente a cada cuenta segun las senales. La IA entiende tu fit con cada prospecto." },
                    { icon: Zap, title: "Icebreakers & Brief", desc: "Mensajes de apertura personalizados y briefs ejecutivos que combinan senales, noticias, implementaciones y tu propia documentacion comercial." },
                  ].map((f) => (
                    <div key={f.title} className="flex items-start gap-4">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${LIME}12`, color: LIME }}>
                        <f.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-semibold" style={{ color: OFF_WHITE }}>{f.title}</h4>
                        <p className="text-sm leading-relaxed" style={{ color: GRAY }}>{f.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Right - Visual */}
              <div className="relative">
                <div className="overflow-hidden rounded-2xl" style={{ border: `1px solid ${BORDER}`, backgroundColor: "#0f0f0f" }}>
                  <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold" style={{ backgroundColor: `${LIME}15`, color: LIME }}>G</div>
                      <div>
                        <div className="font-semibold" style={{ color: OFF_WHITE }}>Galicia Bank</div>
                        <div className="text-sm" style={{ color: GRAY }}>Financial Services</div>
                      </div>
                    </div>
                    <span className="rounded-lg px-3 py-1 text-xs font-medium" style={{ backgroundColor: `${LIME}15`, color: LIME }}>Alta Prioridad</span>
                  </div>
                  <div className="flex gap-1 px-6 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {["Resumen", "Estrategia", "Noticias", "Icebreakers"].map((tab, i) => (
                      <span
                        key={tab}
                        className="rounded-lg px-3.5 py-1.5 text-xs font-medium"
                        style={{
                          backgroundColor: i === 0 ? `${LIME}15` : "transparent",
                          color: i === 0 ? LIME : GRAY,
                        }}
                      >
                        {tab}
                      </span>
                    ))}
                  </div>
                  <div className="space-y-4 p-6">
                    <div className="rounded-xl p-4" style={{ backgroundColor: `${LIME}08`, border: `1px solid ${LIME}20` }}>
                      <div className="mb-2 flex items-center gap-2">
                        <Sparkles className="h-4 w-4" style={{ color: LIME }} />
                        <span className="text-sm font-medium" style={{ color: OFF_WHITE }}>Estrategia Generada por IA</span>
                      </div>
                      <p className="text-sm" style={{ color: GRAY }}>
                        Basado en 12 senales tech y tu caso de exito en banca digital: enfocar pitch en modernizacion de core bancario. Migracion a AWS y adopcion de metodologias agiles...
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { val: "12", label: "Senales Tech" },
                        { val: "6", label: "Procesos" },
                        { val: "8", label: "Busquedas Lab." },
                      ].map((s) => (
                        <div key={s.label} className="rounded-lg p-3 text-center" style={{ backgroundColor: "#1a1a1a" }}>
                          <div className="text-xl font-bold" style={{ color: OFF_WHITE }}>{s.val}</div>
                          <div className="text-[10px]" style={{ color: GRAY }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {["AWS", "SAP S/4HANA", "DevOps", "Kubernetes", "Terraform"].map((tag) => (
                        <span key={tag} className="rounded-md px-2.5 py-1 text-[11px] font-medium" style={{ backgroundColor: `${LIME}12`, color: LIME }}>{tag}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════
            CTA + FORM
            ═══════════════════════════════════════ */}
        <section id="request-access" className="py-24 md:py-32" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-3xl px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <AsciLogo size={48} className="mx-auto mb-6" style={{ color: LIME }} />
              <h2 className="mb-4 text-balance text-3xl font-bold md:text-4xl" style={{ color: OFF_WHITE }}>
                Comenza a encontrar senales hoy
              </h2>
              <p className="mx-auto mb-12 max-w-xl text-lg leading-relaxed" style={{ color: GRAY }}>
                Unite a los equipos de ventas que ya estan usando inteligencia de senales para mejorar su prospeccion B2B en Latinoamerica.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.15 }}
            >
              <NetHuntForm />
            </motion.div>
          </div>
        </section>
      </main>

      {/* ═══════════════════════════════════════
          FOOTER
          ═══════════════════════════════════════ */}
      <footer className="py-10" style={{ borderTop: `1px solid ${BORDER}` }}>
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <Link href="/" className="flex items-center gap-2">
              <AsciLogo size={28} style={{ color: LIME }} />
              <span className="text-base font-bold" style={{ color: OFF_WHITE }}>ASCI</span>
            </Link>
            <p className="text-sm" style={{ color: GRAY }}>
              &copy; 2026 ASCI. Asistente de Senales de Compra e Inferencias.
            </p>
            <p className="text-sm" style={{ color: GRAY }}>
              Desarrollado por{" "}
              <Link href="https://bigua.lat" target="_blank" className="transition-colors duration-200 hover:underline" style={{ color: LIME }}>
                Bigua
              </Link>
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
