'use client'

import Image from "next/image"
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

/* ─── ASCI Sonar Logo ───
   Trazos más gruesos y opacidades más altas que el original: a 28–32 px el
   arco exterior quedaba en ~1 px al 25 % y se perdía sobre el fondo oscuro. */
function AsciLogo({ size = 40, className = "", style, title }: { size?: number; className?: string; style?: React.CSSProperties; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      shapeRendering="geometricPrecision"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g strokeLinecap="round" stroke="currentColor">
        <path d="M60 12 C86.5 12 108 33.5 108 60" strokeWidth="8" opacity="0.35" />
        <path d="M60 30 C76.6 30 90 43.4 90 60" strokeWidth="8" opacity="0.65" />
        <path d="M60 48 C66.6 48 72 53.4 72 60" strokeWidth="8" />
        <path d="M60 108 C33.5 108 12 86.5 12 60" strokeWidth="8" opacity="0.35" />
        <path d="M60 90 C43.4 90 30 76.6 30 60" strokeWidth="8" opacity="0.65" />
        <path d="M60 72 C53.4 72 48 66.6 48 60" strokeWidth="8" />
      </g>
      <circle cx="60" cy="60" r="6" fill="currentColor" />
    </svg>
  )
}

/* ─── Palette constants ─── */
const LIME = "#d9f270"
const DARK = "#0a0a0a"
const OFF_WHITE = "#f5f5f0"
const GRAY = "#737373"
const BORDER = "#1f1f1f"

/* ─── Escala tipográfica ───
   Una sola familia para títulos (Inter Tight) y una sans para el texto (Inter),
   cargadas en app/(landing)/layout.tsx. Pesos: 400 texto, 500 títulos.
   Cuanto más grande la letra, más cerrado el tracking y el interlineado.

     Display   40 → 56   500  -0.028em  1.05
     Sección   28 → 36   500  -0.02em   1.12
     Tarjeta   16        500  -0.01em   1.35
     Lead      17        400            1.6
     Texto     16        400            1.65   (en tarjetas: 15)
     Botón     texto de alrededor − 1 px
     Meta      13–14     400                                          */
const DISPLAY = "font-[family-name:var(--font-landing-display)] font-medium not-italic"
const T_HERO = `${DISPLAY} text-[40px] leading-[1.05] tracking-[-0.028em] md:text-[56px] text-balance`
const T_SECTION = `${DISPLAY} text-[28px] leading-[1.12] tracking-[-0.02em] md:text-[36px] text-balance`
const T_CARD = `${DISPLAY} text-[16px] leading-[1.35] tracking-[-0.01em] text-balance`
const P_LEAD = "text-[17px] leading-[1.6] text-pretty"
const P_BODY = "text-[16px] leading-[1.65] text-pretty"
const P_CARD = "text-[15px] leading-[1.6] text-pretty"

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
      <div className={`${DISPLAY} text-[30px] leading-none tracking-[-0.02em] tabular-nums md:text-[36px]`} style={{ color: OFF_WHITE }}>
        {count.toLocaleString()}{suffix}
      </div>
      <div className="mt-3 text-[13px] leading-snug" style={{ color: GRAY }}>
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
      className="rounded-2xl p-7"
      style={{ border: `1px solid ${BORDER}`, backgroundColor: "#111111" }}
    >
      <Icon className="mb-6 h-5 w-5" strokeWidth={1.75} style={{ color: LIME }} aria-hidden />
      <h3 className={`mb-2 ${T_CARD}`} style={{ color: OFF_WHITE }}>{title}</h3>
      <p className={P_CARD} style={{ color: GRAY }}>{description}</p>
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
      <div className="mb-4 text-[13px] tabular-nums" style={{ color: LIME }}>
        {String(number).padStart(2, "0")}
      </div>
      <h3 className={`mb-2 ${T_CARD}`} style={{ color: OFF_WHITE }}>{title}</h3>
      <p className={P_CARD} style={{ color: GRAY }}>{description}</p>
    </motion.div>
  )
}

/* ═══════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════ */
// Valores de fallback (snapshot manual de la DB al 27-Jul-2026).
// Si el fetch a /api/landing-stats falla, se muestran estos.
const STATS_FALLBACK = {
  contacts_analyzed: 484942,
  companies_indexed: 483561,
  technologies_processes: 96,
  signals_detected: 1528291,
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
    { href: "#how-it-works", label: "Cómo funciona" },
    { href: "#request-access", label: "Contacto" },
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: DARK, color: OFF_WHITE }}>
      {/* ──�� Navbar ─── */}
      <header
        className="fixed top-0 z-50 w-full transition-all duration-500"
        style={{
          backgroundColor: scrolled ? `${DARK}f0` : "transparent",
          backdropFilter: scrolled ? "blur(20px)" : "none",
          borderBottom: scrolled ? `1px solid ${BORDER}` : "1px solid transparent",
        }}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="ASCI, inicio">
            <AsciLogo size={28} style={{ color: LIME }} />
            <span className={`${DISPLAY} text-[17px] tracking-[-0.015em]`} style={{ color: OFF_WHITE }}>ASCI</span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[14px] transition-colors duration-200"
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
                className="rounded-lg px-4 py-2 text-[13px] font-medium transition-colors duration-200"
                style={{ color: GRAY }}
                onMouseOver={(e) => (e.currentTarget.style.color = OFF_WHITE)}
                onMouseOut={(e) => (e.currentTarget.style.color = GRAY)}
              >
                Iniciar sesión
              </button>
            </Link>
            <Link href="#request-access">
              <button
                className="rounded-lg px-4 py-2 text-[13px] font-medium transition-all duration-200 hover:brightness-110"
                style={{ backgroundColor: LIME, color: DARK }}
              >
                Solicitar demo
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
                className="block py-3 text-[15px]"
                style={{ color: GRAY }}
                onClick={() => setMobileMenu(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-4 flex flex-col gap-3">
              <Link href="/auth/login" className="py-2.5 text-center text-[14px] font-medium" style={{ color: GRAY }}>
                Iniciar sesión
              </Link>
              <Link
                href="#request-access"
                className="rounded-lg px-5 py-2.5 text-center text-[14px] font-medium"
                style={{ backgroundColor: LIME, color: DARK }}
                onClick={() => setMobileMenu(false)}
              >
                Solicitar demo
              </Link>
            </div>
          </motion.div>
        )}
      </header>

      <main>
        {/* ═══════════════════════════════════════
            HERO
            ═══════════════════════════════════════ */}
        <section ref={heroRef} className="relative flex min-h-screen items-center justify-center overflow-hidden pt-32 pb-24 md:pt-16 md:pb-0">
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
            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={`mx-auto mb-6 max-w-3xl ${T_HERO}`}
              style={{ color: OFF_WHITE }}
            >
              Sabé qué tecnologías usa{" "}
              <span style={{ color: LIME }}>cada empresa</span>{" "}
              antes de llamar
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.35 }}
              className={`mx-auto mb-10 max-w-xl ${P_LEAD} text-balance`}
              style={{ color: GRAY }}
            >
              ASCI detecta señales en perfiles de empleados y búsquedas laborales para mapear el stack tecnológico y los procesos de cualquier compañía. Prospección B2B con contexto real, no con datos fríos.
            </motion.p>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="flex justify-center"
            >
              <Link
                href="#request-access"
                className="flex items-center gap-2 rounded-xl px-6 py-3 text-[16px] font-medium transition-all duration-200 hover:brightness-110"
                style={{ backgroundColor: LIME, color: DARK }}
              >
                Solicitar demo
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </motion.div>

            {/* Hero Visual */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="relative mx-auto mt-24 max-w-4xl text-left"
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
                      className="flex items-center gap-2 rounded-lg px-4 py-1.5 text-[12px]"
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
                      <span className="text-[13px]" style={{ color: GRAY }}>Buscar por tecnología, proceso o empresa…</span>
                    </div>
                    <div className="hidden rounded-xl px-5 py-3 text-[12px] font-medium sm:block" style={{ backgroundColor: LIME, color: DARK }}>
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
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-medium" style={{ backgroundColor: `${LIME}15`, color: LIME }}>
                            {company.name[0]}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium" style={{ color: OFF_WHITE }}>{company.name}</div>
                            <div className="text-[12px]" style={{ color: GRAY }}>{company.industry}</div>
                          </div>
                        </div>
                        <div className="mb-3 flex flex-wrap gap-1.5">
                          {company.tags.map((tag) => (
                            <span key={tag} className="rounded-md px-2 py-0.5 text-[11px]" style={{ backgroundColor: `${LIME}12`, color: LIME }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[12px]" style={{ color: GRAY }}>{company.signals} señales</span>
                          <span className="flex items-center gap-0.5 text-[12px]" style={{ color: LIME }}>
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
        <Section className="py-20 md:py-24" style={{ borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-5xl px-6">
            <div className="grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-4">
              <AnimatedStat value={stats.contacts_analyzed} suffix="+" label="Contactos analizados" />
              <AnimatedStat value={stats.companies_indexed} suffix="+" label="Empresas indexadas" />
              <AnimatedStat value={stats.technologies_processes} suffix="" label="Tecnologías y procesos" />
              <AnimatedStat value={stats.signals_detected} suffix="+" label="Señales detectadas" />
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════
            FEATURES
            ═══════════════════════════════════════ */}
        <Section id="features" className="py-28 md:py-40">
          <div className="mx-auto max-w-6xl px-6">
            <div className="mx-auto mb-16 max-w-2xl text-center md:mb-20">
              <h2 className={`mb-5 ${T_SECTION}`} style={{ color: OFF_WHITE }}>
                Todo lo que necesitás para prospectar con contexto
              </h2>
              <p className={`mx-auto max-w-xl ${P_BODY} text-balance`} style={{ color: GRAY }}>
                Pensado para equipos de ventas B2B que quieren ir más allá del email frío.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              <FeatureCard index={0} icon={Search} title="Segmentación por señales" description="Buscá empresas por tecnología, proceso o nombre. Cada señal proviene de perfiles reales de empleados actuales y pasados, o de búsquedas laborales activas." />
              <FeatureCard index={1} icon={Building2} title="Perfil 360 de empresa" description="Cada empresa tiene un panel con su stack tecnológico, procesos internos, empleados detectados, búsquedas laborales activas y noticias recientes." />
              <FeatureCard index={2} icon={FileText} title="Documentación y value profile" description="Subí tus casos de éxito, propuestas de valor y brochures. La IA los vincula con el diccionario de señales para entender tu fit con cada cuenta." />
              <FeatureCard index={3} icon={Users} title="Prospectos y decision makers" description="Buscá contactos relevantes en Apollo.io desde el workspace. La IA sugiere job titles a partir de las señales detectadas en cada cuenta." />
              <FeatureCard index={4} icon={Globe} title="Noticias e implementaciones" description="Investigá con IA las noticias recientes e implementaciones de cada cuenta. Alimentan los icebreakers y el brief ejecutivo con contexto actualizado." />
              <FeatureCard index={5} icon={Sparkles} title="Estrategia, icebreakers y brief" description="Generá estrategias de abordaje, icebreakers personalizados y briefs ejecutivos, basados en señales, documentación y noticias reales." />
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════
            HOW IT WORKS
            ═══���═══════════════════════════════════ */}
        <Section id="how-it-works" className="py-28 md:py-40" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-5xl px-6">
            <div className="mx-auto mb-16 max-w-2xl text-center md:mb-20">
              <h2 className={`mb-5 ${T_SECTION}`} style={{ color: OFF_WHITE }}>
                De datos dispersos a inteligencia accionable
              </h2>
              <p className={`mx-auto max-w-xl ${P_BODY} text-balance`} style={{ color: GRAY }}>
                ASCI transforma información pública en señales de compra que tu equipo puede usar hoy.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-12 md:grid-cols-4">
              <StepCard index={0} number={1} title="Ingesta y señales" description="Importá contactos y búsquedas laborales. ASCI analiza cada perfil contra un diccionario de tecnologías y procesos y crea señales únicas por empresa." />
              <StepCard index={1} number={2} title="Documentación" description="Subí tus propuestas de valor, casos de éxito y brochures. La IA los analiza, extrae tags de industria, tecnología y proceso, y construye tu perfil de valor." />
              <StepCard index={2} number={3} title="Segmentación" description="Buscá por tecnología, proceso o empresa. Filtrá por país e industria. Guardá cuentas como bookmarks con prioridad (T1, T2, T3) y estado de avance." />
              <StepCard index={3} number={4} title="Workspace y acción" description="Cada cuenta tiene su workspace con estrategia IA, noticias, implementaciones, prospectos, icebreakers y brief ejecutivo, conectado a tus documentos y señales." />
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════
            WORKSPACE SHOWCASE
            ═════════════��═════════════════════════ */}
        <Section className="py-28 md:py-40" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
              {/* Left */}
              <div>
                <h2 className={`mb-5 ${T_SECTION}`} style={{ color: OFF_WHITE }}>
                  Tu centro de comando para cada cuenta
                </h2>
                <p className={`mb-12 ${P_BODY}`} style={{ color: GRAY }}>
                  Cada cuenta guardada tiene su workspace privado. La IA cruza las señales detectadas con tus documentos de propuesta de valor y casos de éxito para generar estrategias, icebreakers y briefs personalizados.
                </p>
                <div className="space-y-7">
                  {[
                    { icon: Target, title: "Estrategia con IA", desc: "Ángulos de venta a partir de las señales detectadas, tus documentos de propuesta de valor y el contexto de noticias e implementaciones de la cuenta." },
                    { icon: FileText, title: "Documentación conectada", desc: "Tus casos de éxito y propuestas de valor se vinculan automáticamente a cada cuenta según las señales. La IA entiende tu fit con cada prospecto." },
                    { icon: Zap, title: "Icebreakers y brief", desc: "Mensajes de apertura personalizados y briefs ejecutivos que combinan señales, noticias, implementaciones y tu propia documentación comercial." },
                  ].map((f) => (
                    <div key={f.title} className="flex items-start gap-4">
                      <f.icon className="mt-0.5 h-5 w-5 flex-shrink-0" strokeWidth={1.75} style={{ color: LIME }} aria-hidden />
                      <div>
                        <h3 className={`mb-1.5 ${T_CARD}`} style={{ color: OFF_WHITE }}>{f.title}</h3>
                        <p className={P_CARD} style={{ color: GRAY }}>{f.desc}</p>
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
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg text-[14px] font-medium" style={{ backgroundColor: `${LIME}15`, color: LIME }}>G</div>
                      <div>
                        <div className="text-[14px] font-medium" style={{ color: OFF_WHITE }}>Galicia Bank</div>
                        <div className="text-[13px]" style={{ color: GRAY }}>Financial Services</div>
                      </div>
                    </div>
                    <span className="rounded-lg px-3 py-1 text-[12px]" style={{ backgroundColor: `${LIME}15`, color: LIME }}>Alta prioridad</span>
                  </div>
                  <div className="flex gap-1 px-6 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {["Resumen", "Estrategia", "Noticias", "Icebreakers"].map((tab, i) => (
                      <span
                        key={tab}
                        className={`rounded-lg px-3.5 py-1.5 text-[12px] whitespace-nowrap ${i === 3 ? "hidden sm:inline" : ""}`}
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
                        <span className="text-[13px] font-medium" style={{ color: OFF_WHITE }}>Estrategia generada por IA</span>
                      </div>
                      <p className="text-[13px] leading-relaxed" style={{ color: GRAY }}>
                        Basado en 12 señales tech y tu caso de éxito en banca digital: enfocar el pitch en modernización del core bancario, migración a AWS y adopción de metodologías ágiles…
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { val: "12", label: "Señales tech" },
                        { val: "6", label: "Procesos" },
                        { val: "8", label: "Búsquedas lab." },
                      ].map((s) => (
                        <div key={s.label} className="rounded-lg p-3 text-center" style={{ backgroundColor: "#1a1a1a" }}>
                          <div className={`${DISPLAY} text-[20px] tracking-[-0.02em]`} style={{ color: OFF_WHITE }}>{s.val}</div>
                          <div className="text-[11px]" style={{ color: GRAY }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {["AWS", "SAP S/4HANA", "DevOps", "Kubernetes", "Terraform"].map((tag) => (
                        <span key={tag} className="rounded-md px-2.5 py-1 text-[11px]" style={{ backgroundColor: `${LIME}12`, color: LIME }}>{tag}</span>
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
        <section id="request-access" className="py-28 md:py-40" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-3xl px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h2 className={`mb-5 ${T_SECTION}`} style={{ color: OFF_WHITE }}>
                Empezá a encontrar señales hoy
              </h2>
              <p className={`mx-auto mb-14 max-w-xl ${P_BODY} text-balance`} style={{ color: GRAY }}>
                Sumate a los equipos de ventas que ya usan inteligencia de señales para mejorar su prospección B2B en Latinoamérica.
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
      <footer className="py-12" style={{ borderTop: `1px solid ${BORDER}` }}>
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <Link href="/" className="flex items-center gap-2">
              <AsciLogo size={24} style={{ color: LIME }} title="ASCI" />
              <span className={`${DISPLAY} text-[15px] tracking-[-0.01em]`} style={{ color: OFF_WHITE }}>ASCI</span>
            </Link>
            <p className="text-center text-[13px]" style={{ color: GRAY }}>
              &copy; 2026 ASCI · Asistente de Señales de Compra e Inferencias
            </p>
            <Link
              href="https://bigua.lat"
              target="_blank"
              rel="noopener"
              className="flex items-center gap-2.5 text-[13px] opacity-80 transition-opacity duration-200 hover:opacity-100"
              style={{ color: GRAY }}
            >
              Desarrollado por
              <Image
                src="/brand/bigua-isologo-light.png"
                alt="Biguá"
                width={447}
                height={147}
                className="h-5 w-auto"
              />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
