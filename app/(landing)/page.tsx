'use client'

import Image from "next/image"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { motion, useInView, useScroll, useTransform } from "framer-motion"
import {
  ArrowRight,
  Building2,
  Contact,
  FileSearch,
  Menu,
  Radar,
  Repeat,
  Users,
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
const LIGHT_GRAY = "#a3a3a3"
const BORDER = "#1f1f1f"
const SURFACE = "#111111"

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

/* ─── Contenido ───
   Todo sale del MCP de ASCI (repo locasci): las tools están en mcp/tools.mjs y
   docs/16-referencia-mcp.md, los casos en docs/12-casos-de-uso.md. Las cifras
   del corpus son de estado_carga al 2026-11-26, redondeadas hacia abajo para
   que no queden viejas por arriba. */
const MCP_URL = "mcp.bigua.lat/mcp"

const STATS = [
  { value: "669 mil", label: "Perfiles profesionales" },
  { value: "275 mil", label: "Avisos de empleo" },
  { value: "113 mil", label: "Empresas" },
  { value: "461", label: "Tecnologías en el diccionario" },
]

const REASONS = [
  {
    title: "La tecnología se declara sola",
    text: "La gente la escribe en su perfil y las empresas la piden en sus avisos. ASCI lo lee, lo normaliza contra un diccionario de 461 tecnologías y lo resume por empresa y por país.",
  },
  {
    title: "Cada señal trae su prueba",
    text: "El fragmento, la persona o el aviso, la fecha y el link. Sabés por qué llamás a esa cuenta y lo podés defender frente a tu cliente o tu jefe.",
  },
  {
    title: "Firmeza, no menciones sueltas",
    text: "Una cuenta con doce personas que hoy usan SAP no pesa lo mismo que un ex empleado que lo nombró una vez. La respuesta dice cuánto respaldo tiene cada una.",
  },
  {
    title: "Sin ruido de proveedores",
    text: "Partners, integradores y software factories quedan afuera por defecto, y la respuesta dice cuántos escondió. Si una tecnología no existe en el diccionario, también lo dice.",
  },
]

const USE_CASES = [
  {
    icon: Radar,
    title: "Prospectar por tecnología",
    prompt: "¿Qué aseguradoras de Chile usan Oracle Forms?",
    result: "Las cuentas ordenadas por respaldo, sin los partners que lo implementan.",
    tools: "prospectar",
  },
  {
    icon: FileSearch,
    title: "La vacante como señal de compra",
    prompt: "Avisos de los últimos 30 días que piden Snowflake en México.",
    result: "Una fila por empresa, con el link del aviso y quién lo publicó.",
    tools: "avisos_recientes",
  },
  {
    icon: Building2,
    title: "ABM sobre tu propio listado",
    prompt: "Acá van mis 80 cuentas: ¿cuáles tienen SAP y cuáles Salesforce?",
    result: "La matriz cuenta × país × tecnología en dos llamadas, no en ochenta.",
    tools: "resolver_cuentas · presencia",
  },
  {
    icon: Contact,
    title: "Señal técnica, decisor de negocio",
    prompt: "¿A quién de finanzas y de TI le hablo en esas cuentas?",
    result: "Los decisores con su mail. Ver el padrón es gratis; se paga sólo lo que revelás.",
    tools: "tomadores_de_decision · revelar_lote",
  },
  {
    icon: Repeat,
    title: "Radar de rotación",
    prompt: "¿Quién entró y quién se fue del área de TI de mi cartera este año?",
    result: "Las dos caras del movimiento: de dónde vino cada uno y adónde se fue.",
    tools: "rotacion",
  },
  {
    icon: Users,
    title: "Talento con evidencia",
    prompt: "Desarrolladores Java en Argentina con más de cinco años usándolo.",
    result: "Personas ordenadas por cuánta evidencia hay de que lo usan, con la cita.",
    tools: "personas · personas_por_texto",
  },
]

const STEPS = [
  {
    title: "Conectás",
    text: "En Claude o ChatGPT agregás un conector con la dirección de ASCI. Entrás con tu email y un código, sin instalar nada.",
  },
  {
    title: "Preguntás",
    text: "En español, como se lo pedirías a un analista. La IA elige las herramientas, las combina y te muestra lo que encontró.",
  },
  {
    title: "Decidís",
    text: "Explorar cuentas, señales y padrones no gasta créditos. Sólo se cobra cuando elegís revelar el contacto de una persona.",
  },
]

const TOOL_GROUPS = [
  {
    title: "Cuentas",
    tools: [
      { name: "resolver_cuentas", desc: "Tu lista de nombres, convertida en cuentas" },
      { name: "presencia", desc: "Qué tecnología tiene cada cuenta, por país" },
      { name: "prospectar", desc: "Qué cuentas usan una tecnología" },
      { name: "evidencia", desc: "Los fragmentos que prueban la señal" },
      { name: "novedades", desc: "Qué cambió en tu cartera en un período" },
      { name: "avisos_recientes", desc: "Quién está contratando, y para qué" },
    ],
  },
  {
    title: "Personas",
    tools: [
      { name: "personas", desc: "Quién usa una tecnología, por evidencia" },
      { name: "personas_por_texto", desc: "Por concepto, aunque no sea una tecnología" },
      { name: "personas_por_mail", desc: "Identidad para una lista de mails" },
      { name: "rotacion", desc: "Quién entró y quién salió de una cuenta" },
    ],
  },
  {
    title: "Contactos",
    tools: [
      { name: "roles_objetivo", desc: "El catálogo de roles de decisor" },
      { name: "tomadores_de_decision", desc: "A quién llamar, desde la caché" },
      { name: "buscar_contactos", desc: "El padrón de una cuenta, sin costo" },
      { name: "revelar_lote", desc: "El mail de los que elegiste" },
    ],
  },
  {
    title: "Investigación",
    tools: [
      { name: "productos", desc: "El diccionario de tecnologías" },
      { name: "radiografia", desc: "Qué falta saber de una cuenta" },
      { name: "hallazgos", desc: "Lo que ya se investigó de ella" },
    ],
  },
]

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

function SectionHeader({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="mx-auto mb-16 max-w-2xl text-center md:mb-20">
      <h2 className={`mb-5 ${T_SECTION}`} style={{ color: OFF_WHITE }}>{title}</h2>
      {lead && <p className={`mx-auto max-w-xl ${P_BODY} text-balance`} style={{ color: GRAY }}>{lead}</p>}
    </div>
  )
}

/* ─── Use case card ─── */
function UseCaseCard({ icon: Icon, title, prompt, result, tools, index }: (typeof USE_CASES)[number] & { index: number }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-40px" })
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col rounded-2xl p-7"
      style={{ border: `1px solid ${BORDER}`, backgroundColor: SURFACE }}
    >
      <Icon className="mb-6 h-5 w-5" strokeWidth={1.75} style={{ color: LIME }} aria-hidden />
      <h3 className={`mb-3 ${T_CARD}`} style={{ color: OFF_WHITE }}>{title}</h3>
      <p className={`mb-3 ${P_CARD}`} style={{ color: LIGHT_GRAY }}>«{prompt}»</p>
      <p className={`mb-6 ${P_CARD}`} style={{ color: GRAY }}>{result}</p>
      <p className="mt-auto text-[13px]" style={{ color: LIME }}>{tools}</p>
    </motion.div>
  )
}

/* ─── Hero: una conversación de ejemplo ───
   Nombres de empresa ficticios a propósito: es una vidriera pública y no
   corresponde afirmar qué tecnología usa una empresa real. */
const DEMO_ROWS = [
  { name: "Distribuidora Andina", people: 14, jobs: 3 },
  { name: "Logística del Plata", people: 11, jobs: 2 },
  { name: "Frigorífico Pampeano", people: 9, jobs: 0 },
  { name: "Laboratorios del Norte", people: 8, jobs: 1 },
]

function ChatMockup() {
  return (
    <div className="relative overflow-hidden rounded-2xl text-left" style={{ border: `1px solid ${BORDER}`, backgroundColor: "#0f0f0f" }}>
      <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex gap-1.5" aria-hidden>
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#2a2a2a" }} />
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#2a2a2a" }} />
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#2a2a2a" }} />
        </div>
        <div className="flex flex-1 items-center justify-center gap-2 text-[12px]" style={{ color: GRAY }}>
          <AsciLogo size={14} style={{ color: LIME }} />
          Tu asistente, conectado a ASCI
        </div>
      </div>

      <div className="space-y-5 p-5 md:p-7">
        {/* Pregunta */}
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-3 text-[14px] leading-relaxed" style={{ backgroundColor: "#1c1c1c", color: OFF_WHITE }}>
            ¿Qué empresas de Argentina usan SAP Business One? Dejá afuera a los partners.
          </div>
        </div>

        {/* Llamada a la tool */}
        <div className="flex items-center gap-2 text-[12px]" style={{ color: GRAY }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LIME }} aria-hidden />
          Usó ASCI · <span style={{ color: LIGHT_GRAY }}>prospectar</span>
        </div>

        {/* Respuesta */}
        <div className="space-y-4 text-[14px] leading-relaxed" style={{ color: OFF_WHITE }}>
          <p>
            Encontré <span style={{ color: LIME }}>186 cuentas</span> con SAP Business One vigente en Argentina. Dejé afuera
            231 proveedores e integradores. Las de más respaldo:
          </p>
          <div className="overflow-hidden rounded-xl" style={{ border: `1px solid ${BORDER}` }}>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2.5 text-[12px] sm:gap-x-8" style={{ color: GRAY, backgroundColor: "#141414" }}>
              <span>Cuenta</span>
              <span className="text-right">Personas hoy</span>
              <span className="text-right">Avisos</span>
            </div>
            {DEMO_ROWS.map((row) => (
              <div
                key={row.name}
                className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-2.5 text-[13px] tabular-nums sm:gap-x-8"
                style={{ borderTop: `1px solid ${BORDER}` }}
              >
                <span className="truncate">{row.name}</span>
                <span className="text-right" style={{ color: LIGHT_GRAY }}>{row.people}</span>
                <span className="text-right" style={{ color: LIGHT_GRAY }}>{row.jobs}</span>
              </div>
            ))}
          </div>
          <p style={{ color: LIGHT_GRAY }}>¿Querés que busque quién decide en finanzas y en TI en estas cuatro?</p>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════ */
export default function HomePage() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)
  const heroRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] })
  const heroOpacity = useTransform(scrollYProgress, [0, 1], [1, 0])
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 80])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const navLinks = [
    { href: "#casos", label: "Casos de uso" },
    { href: "#como-funciona", label: "Cómo funciona" },
    { href: "#herramientas", label: "Herramientas" },
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
            <Link
              href="/auth/login"
              className="rounded-lg px-4 py-2 text-[13px] font-medium transition-colors duration-200"
              style={{ color: GRAY }}
              onMouseOver={(e) => (e.currentTarget.style.color = OFF_WHITE)}
              onMouseOut={(e) => (e.currentTarget.style.color = GRAY)}
            >
              Iniciar sesión
            </Link>
            <Link
              href="#solicitar-acceso"
              className="rounded-lg px-4 py-2 text-[13px] font-medium transition-all duration-200 hover:brightness-110"
              style={{ backgroundColor: LIME, color: DARK }}
            >
              Solicitar acceso
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            className="p-2 md:hidden"
            onClick={() => setMobileMenu(!mobileMenu)}
            aria-label={mobileMenu ? "Cerrar menú" : "Abrir menú"}
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
            className="px-6 pb-6 pt-2 md:hidden"
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
                href="#solicitar-acceso"
                className="rounded-lg px-5 py-2.5 text-center text-[14px] font-medium"
                style={{ backgroundColor: LIME, color: DARK }}
                onClick={() => setMobileMenu(false)}
              >
                Solicitar acceso
              </Link>
            </div>
          </motion.div>
        )}
      </header>

      <main>
        {/* ═══════════════════════════════════════
            HERO
            ═══════════════════════════════════════ */}
        <section ref={heroRef} className="relative flex min-h-screen items-center justify-center overflow-hidden pt-32 pb-24 md:pt-28 md:pb-16">
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `linear-gradient(${LIME}30 1px, transparent 1px), linear-gradient(90deg, ${LIME}30 1px, transparent 1px)`,
              backgroundSize: "80px 80px",
            }}
          />
          <div
            className="absolute top-0 left-1/2 h-[600px] w-[800px] -translate-x-1/2 opacity-15"
            style={{ background: `radial-gradient(ellipse at center, ${LIME}40, transparent 70%)` }}
          />

          <motion.div style={{ opacity: heroOpacity, y: heroY }} className="relative z-10 mx-auto max-w-5xl px-6 text-center">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              className={`mx-auto mb-6 max-w-3xl ${T_HERO}`}
              style={{ color: OFF_WHITE }}
            >
              Prospectá con <span style={{ color: LIME }}>señales reales</span> desde Claude o ChatGPT
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.25 }}
              className={`mx-auto mb-10 max-w-2xl ${P_LEAD} text-balance`}
              style={{ color: GRAY }}
            >
              ASCI conecta tu asistente de IA a 669 mil perfiles profesionales y 275 mil avisos de empleo, con
              foco en Latinoamérica. Preguntás qué empresas usan una tecnología, quién la usa y a quién llamar, y la
              respuesta llega con la evidencia.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex flex-col items-center gap-4"
            >
              <Link
                href="#solicitar-acceso"
                className="flex items-center gap-2 rounded-xl px-6 py-3 text-[16px] font-medium transition-all duration-200 hover:brightness-110"
                style={{ backgroundColor: LIME, color: DARK }}
              >
                Solicitar acceso
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <p className="text-[13px]" style={{ color: GRAY }}>
                Funciona en Claude, ChatGPT y cualquier cliente compatible con MCP
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="relative mx-auto mt-20 max-w-3xl"
            >
              <div
                className="absolute -inset-8 rounded-3xl opacity-20 blur-3xl"
                style={{ background: `radial-gradient(${LIME}30, transparent)` }}
              />
              <ChatMockup />
              <p className="relative mt-4 text-[13px]" style={{ color: GRAY }}>
                Conversación de ejemplo, con nombres de empresa ficticios.
              </p>
            </motion.div>
          </motion.div>
        </section>

        {/* ═══════════════════════════════════════
            STATS
            ═══════════════════════════════════════ */}
        <Section className="py-20 md:py-24" style={{ borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-5xl px-6">
            <div className="grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-4">
              {STATS.map((s) => (
                <div key={s.label} className="text-center">
                  <div className={`${DISPLAY} text-[30px] leading-none tracking-[-0.02em] tabular-nums md:text-[36px]`} style={{ color: OFF_WHITE }}>
                    {s.value}
                  </div>
                  <div className="mt-3 text-[13px] leading-snug" style={{ color: GRAY }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════
            POR QUÉ SEÑALES
            ═══════════════════════════════════════ */}
        <Section id="por-que" className="py-28 md:py-40">
          <div className="mx-auto max-w-5xl px-6">
            <SectionHeader
              title="Una lista fría no sabe qué pasa adentro de cada empresa"
              lead="Las bases de contactos dicen quién trabaja dónde. ASCI dice qué usa cada empresa, qué está buscando y cuánto respaldo tiene esa afirmación."
            />
            <div className="grid grid-cols-1 gap-x-12 gap-y-12 md:grid-cols-2">
              {REASONS.map((r, i) => (
                <div key={r.title} className="flex gap-5">
                  <div className="pt-0.5 text-[13px] tabular-nums" style={{ color: LIME }}>{String(i + 1).padStart(2, "0")}</div>
                  <div>
                    <h3 className={`mb-2 ${T_CARD}`} style={{ color: OFF_WHITE }}>{r.title}</h3>
                    <p className={P_CARD} style={{ color: GRAY }}>{r.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════
            CASOS DE USO
            ═══════════════════════════════════════ */}
        <Section id="casos" className="py-28 md:py-40" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-6xl px-6">
            <SectionHeader
              title="Lo que se resuelve en una conversación"
              lead="Pedidos reales de equipos de ventas, marketing y reclutamiento. Cada uno es una o dos llamadas a ASCI."
            />
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {USE_CASES.map((c, i) => (
                <UseCaseCard key={c.title} index={i} {...c} />
              ))}
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════
            CÓMO FUNCIONA
            ═══════════════════════════════════════ */}
        <Section id="como-funciona" className="py-28 md:py-40" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-5xl px-6">
            <SectionHeader
              title="Sin plataforma nueva que aprender"
              lead="ASCI es un servidor MCP: vive adentro del asistente que tu equipo ya usa."
            />
            <div className="grid grid-cols-1 gap-12 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <div key={s.title}>
                  <div className="mb-4 text-[13px] tabular-nums" style={{ color: LIME }}>{String(i + 1).padStart(2, "0")}</div>
                  <h3 className={`mb-2 ${T_CARD}`} style={{ color: OFF_WHITE }}>{s.title}</h3>
                  <p className={P_CARD} style={{ color: GRAY }}>{s.text}</p>
                  {i === 0 && (
                    <p className="mt-4 inline-block rounded-lg px-3 py-1.5 text-[13px]" style={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}`, color: LIGHT_GRAY }}>
                      {MCP_URL}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════
            HERRAMIENTAS
            ═══════════════════════════════════════ */}
        <Section id="herramientas" className="py-28 md:py-40" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-6xl px-6">
            <SectionHeader
              title="Las herramientas que tu IA puede usar"
              lead="No tenés que nombrarlas: el asistente elige cuál llamar según lo que pedís. Están acá para que sepas qué hay del otro lado."
            />
            <div className="grid grid-cols-1 gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
              {TOOL_GROUPS.map((g) => (
                <div key={g.title}>
                  <h3 className={`mb-5 pb-3 ${T_CARD}`} style={{ color: OFF_WHITE, borderBottom: `1px solid ${BORDER}` }}>{g.title}</h3>
                  <ul className="space-y-4">
                    {g.tools.map((t) => (
                      <li key={t.name}>
                        <div className="text-[13px]" style={{ color: LIME }}>{t.name}</div>
                        <div className="mt-0.5 text-[14px] leading-snug text-pretty" style={{ color: GRAY }}>{t.desc}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════
            CTA + FORM
            ═══════════════════════════════════════ */}
        <section id="solicitar-acceso" className="py-28 md:py-40" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="mx-auto max-w-3xl px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <h2 className={`mb-5 ${T_SECTION}`} style={{ color: OFF_WHITE }}>
                Probalo con tus propias cuentas
              </h2>
              <p className={`mx-auto mb-14 max-w-xl ${P_BODY} text-balance`} style={{ color: GRAY }}>
                Contanos qué vendés y a quién. Te damos acceso y lo conectás a tu asistente en dos minutos.
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
