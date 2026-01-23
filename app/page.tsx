'use client';

import Link from "next/link"
import Image from "next/image"
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
  Play,
  Kanban,
  Layers,
  BarChart3,
  FileText,
  Briefcase,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { NetHuntForm } from "@/components/nethunt-form"

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      {/* Navbar */}
      <header className="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2.5 font-semibold text-lg text-slate-900">
            <Image src="/logo.png" alt="ASCI Logo" width={32} height={32} className="rounded-lg" />
            ASCI
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <Link href="#features" className="hover:text-slate-900 transition-colors">
              Producto
            </Link>
            <Link href="#workspace" className="hover:text-slate-900 transition-colors">
              Workspace IA
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/auth/login">
              <Button variant="ghost" size="sm" className="text-slate-600 hover:text-slate-900">
                Iniciar Sesión
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative pt-20 pb-32 overflow-hidden">
          {/* Background Elements */}
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-gradient-to-b from-blue-100/50 to-transparent rounded-full blur-3xl" />
            <div className="absolute top-40 right-0 w-[400px] h-[400px] bg-gradient-to-b from-indigo-100/30 to-transparent rounded-full blur-3xl" />
          </div>

          <div className="container mx-auto px-4">
            <div className="text-center max-w-4xl mx-auto">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-sm font-medium mb-8">
                <Sparkles className="h-3.5 w-3.5" />
                Nuevo: Workspace con IA Generativa
              </div>

              {/* Headline */}
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-slate-900 mb-6 leading-[1.1]">
                Descubre qué
                <span className="relative mx-3">
                  <span className="relative z-10 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                    tecnologías
                  </span>
                  <svg
                    className="absolute -bottom-2 left-0 w-full h-3 text-blue-200"
                    viewBox="0 0 200 12"
                    preserveAspectRatio="none"
                  >
                    <path d="M0,8 Q50,0 100,8 T200,8" stroke="currentColor" strokeWidth="4" fill="none" />
                  </svg>
                </span>
                usan tus prospectos
              </h1>

              {/* Subheadline */}
              <p className="text-xl text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
                Analiza las señales ocultas en perfiles de empleados para identificar el stack tecnológico y procesos de
                cualquier empresa. Inteligencia de mercado para ventas B2B.
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
                <Link href="/search">
                  <Button
                    size="lg"
                    className="h-12 px-6 text-base bg-slate-900 hover:bg-slate-800 text-white rounded-full shadow-lg shadow-slate-900/20"
                  >
                    Explorar Señales
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 px-6 text-base rounded-full border-slate-300 text-slate-700 hover:bg-slate-100 bg-transparent"
                >
                  <Play className="mr-2 h-4 w-4" />
                  Ver Demo
                </Button>
              </div>

              {/* Hero Visual - App Screenshot */}
              <div className="relative mx-auto max-w-5xl">
                {/* Glow effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 via-indigo-500/20 to-purple-500/20 rounded-2xl blur-2xl -z-10 scale-95" />

                {/* Browser Chrome */}
                <div className="rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 overflow-hidden">
                  {/* Browser Header */}
                  <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-200">
                    <div className="flex gap-1.5">
                      <div className="h-3 w-3 rounded-full bg-red-400" />
                      <div className="h-3 w-3 rounded-full bg-yellow-400" />
                      <div className="h-3 w-3 rounded-full bg-green-400" />
                    </div>
                    <div className="flex-1 flex justify-center">
                      <div className="flex items-center gap-2 px-4 py-1.5 bg-white rounded-lg border border-slate-200 text-sm text-slate-500">
                        <Search className="h-3.5 w-3.5" />
                        asci.bigua.lat/search
                      </div>
                    </div>
                  </div>

                  {/* App Content */}
                  <div className="p-6 bg-gradient-to-b from-slate-50 to-white">
                    {/* Search Bar */}
                    <div className="flex items-center gap-3 mb-6">
                      <div className="flex-1 flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-slate-200 shadow-sm">
                        <Search className="h-5 w-5 text-slate-400" />
                        <span className="text-slate-400">Buscar por tecnología, proceso o empresa...</span>
                      </div>
                      <div className="px-4 py-3 bg-blue-600 text-white rounded-xl font-medium text-sm">Buscar</div>
                    </div>

                    {/* Results Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Result Card 1 */}
                      <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-start gap-3 mb-3">
                          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-white font-bold text-sm">
                            G
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-slate-900 truncate">Galicia Bank</div>
                            <div className="text-sm text-slate-500">Financial Services</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          <Badge variant="secondary" className="bg-blue-50 text-blue-700 text-xs">
                            AWS
                          </Badge>
                          <Badge variant="secondary" className="bg-green-50 text-green-700 text-xs">
                            SAP
                          </Badge>
                          <Badge variant="secondary" className="bg-purple-50 text-purple-700 text-xs">
                            DevOps
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">18 señales</span>
                          <span className="text-blue-600 font-medium flex items-center gap-1">
                            Ver detalle <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </div>

                      {/* Result Card 2 */}
                      <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-start gap-3 mb-3">
                          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-red-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
                            S
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-slate-900 truncate">Santander Argentina</div>
                            <div className="text-sm text-slate-500">Banking</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          <Badge variant="secondary" className="bg-blue-50 text-blue-700 text-xs">
                            Azure
                          </Badge>
                          <Badge variant="secondary" className="bg-orange-50 text-orange-700 text-xs">
                            Oracle
                          </Badge>
                          <Badge variant="secondary" className="bg-cyan-50 text-cyan-700 text-xs">
                            Kubernetes
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">24 señales</span>
                          <span className="text-blue-600 font-medium flex items-center gap-1">
                            Ver detalle <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </div>

                      {/* Result Card 3 */}
                      <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-start gap-3 mb-3">
                          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm">
                            M
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-slate-900 truncate">Mercado Libre</div>
                            <div className="text-sm text-slate-500">E-commerce</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          <Badge variant="secondary" className="bg-yellow-50 text-yellow-700 text-xs">
                            GCP
                          </Badge>
                          <Badge variant="secondary" className="bg-green-50 text-green-700 text-xs">
                            Kafka
                          </Badge>
                          <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 text-xs">
                            React
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-500">42 señales</span>
                          <span className="text-blue-600 font-medium flex items-center gap-1">
                            Ver detalle <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="py-16 border-y border-slate-200 bg-white">
          <div className="container mx-auto px-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              <div className="text-center">
                <div className="text-4xl font-bold text-slate-900 mb-1">42K+</div>
                <div className="text-sm text-slate-500">Contactos Analizados</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold text-slate-900 mb-1">58K+</div>
                <div className="text-sm text-slate-500">Empresas Indexadas</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold text-slate-900 mb-1">1.1K+</div>
                <div className="text-sm text-slate-500">Tecnologías y Procesos</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold text-slate-900 mb-1">235K+</div>
                <div className="text-sm text-slate-500">Señales Detectadas</div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="features" className="py-24 bg-white">
          <div className="container mx-auto px-4">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <Badge variant="outline" className="mb-4 text-slate-600">
                Cómo Funciona
              </Badge>
              <h2 className="text-4xl font-bold text-slate-900 mb-4">De datos dispersos a inteligencia accionable</h2>
              <p className="text-lg text-slate-600">
                ASCI transforma información pública de LinkedIn en señales de compra que tu equipo puede usar hoy.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {/* Step 1 */}
              <div className="relative">
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-600">
                    <Database className="h-6 w-6" />
                  </div>
                  <div className="h-px flex-1 bg-slate-200 hidden md:block" />
                </div>
                <h3 className="text-xl font-semibold text-slate-900 mb-2">1. Ingesta de Datos</h3>
                <p className="text-slate-600">
                  Analizamos perfiles de LinkedIn de empleados actuales y ex-empleados para extraer menciones de
                  tecnologías y procesos.
                </p>
              </div>

              {/* Step 2 */}
              <div className="relative">
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600">
                    <Zap className="h-6 w-6" />
                  </div>
                  <div className="h-px flex-1 bg-slate-200 hidden md:block" />
                </div>
                <h3 className="text-xl font-semibold text-slate-900 mb-2">2. Detección de Señales</h3>
                <p className="text-slate-600">
                  Nuestro motor de búsqueda identifica keywords de 200+ tecnologías y 50+ procesos, creando señales por
                  empresa.
                </p>
              </div>

              {/* Step 3 */}
              <div className="relative">
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-purple-600">
                    <Target className="h-6 w-6" />
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-slate-900 mb-2">3. Acción con IA</h3>
                <p className="text-slate-600">
                  Genera estrategias de cuenta, icebreakers personalizados y encuentra decision makers con contexto
                  real.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-24 bg-slate-50">
          <div className="container mx-auto px-4">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-4xl font-bold text-slate-900 mb-4">Todo lo que necesitas para prospectar mejor</h2>
              <p className="text-lg text-slate-600">
                Funcionalidades diseñadas para equipos de ventas B2B que quieren ir más allá del email frío.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
              {/* Feature 1 */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 hover:shadow-lg hover:border-slate-300 transition-all">
                <div className="h-12 w-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-4">
                  <Search className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Búsqueda por Tecnología</h3>
                <p className="text-slate-600 text-sm">
                  Encuentra empresas que usan SAP, AWS, Salesforce o cualquier tecnología. Filtra por país e industria.
                </p>
              </div>

              {/* Feature 2 */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 hover:shadow-lg hover:border-slate-300 transition-all">
                <div className="h-12 w-12 rounded-xl bg-green-100 text-green-600 flex items-center justify-center mb-4">
                  <TrendingUp className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Búsqueda por Proceso</h3>
                <p className="text-slate-600 text-sm">
                  Identifica empresas con equipos de DevOps, QA, Data Science o cualquier capacidad que necesites.
                </p>
              </div>

              {/* Feature 3 */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 hover:shadow-lg hover:border-slate-300 transition-all">
                <div className="h-12 w-12 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center mb-4">
                  <Building2 className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Perfil de Empresa</h3>
                <p className="text-slate-600 text-sm">
                  Vista 360° de cada empresa: stack tecnológico, procesos internos, empleados clave y búsquedas
                  laborales.
                </p>
              </div>

              {/* Feature 4 */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 hover:shadow-lg hover:border-slate-300 transition-all">
                <div className="h-12 w-12 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center mb-4">
                  <Users className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Decision Makers</h3>
                <p className="text-slate-600 text-sm">
                  Identifica a las personas correctas dentro de cada empresa basándote en las señales detectadas.
                </p>
              </div>

              {/* Feature 5 */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 hover:shadow-lg hover:border-slate-300 transition-all">
                <div className="h-12 w-12 rounded-xl bg-cyan-100 text-cyan-600 flex items-center justify-center mb-4">
                  <Globe className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Señales Web con IA</h3>
                <p className="text-slate-600 text-sm">
                  Busca noticias, implementaciones y casos de éxito de tus prospectos usando IA generativa.
                </p>
              </div>

              {/* Feature 6 */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 hover:shadow-lg hover:border-slate-300 transition-all">
                <div className="h-12 w-12 rounded-xl bg-pink-100 text-pink-600 flex items-center justify-center mb-4">
                  <MessageSquare className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Icebreakers con IA</h3>
                <p className="text-slate-600 text-sm">
                  Genera mensajes de apertura personalizados basados en las señales y contexto de cada prospecto.
                </p>
              </div>

              {/* Feature 7 - Pipeline Kanban */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 hover:shadow-lg hover:border-slate-300 transition-all">
                <div className="h-12 w-12 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center mb-4">
                  <Kanban className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Pipeline Kanban</h3>
                <p className="text-slate-600 text-sm">
                  Gestiona tus cuentas con vista Kanban. Arrastra y suelta para mover entre estados: Nuevo, Investigando, Contactado, Reunión.
                </p>
              </div>

              {/* Feature 8 - Account Tiers */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 hover:shadow-lg hover:border-slate-300 transition-all">
                <div className="h-12 w-12 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center mb-4">
                  <Layers className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Tiers de Cuentas (ABM)</h3>
                <p className="text-slate-600 text-sm">
                  Clasifica tus cuentas en Alta, Transaccional o Baja prioridad. Enfoca tu tiempo en lo que más importa con Account-Based Marketing.
                </p>
              </div>

              {/* Feature 9 - Brief Ejecutivo */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 hover:shadow-lg hover:border-slate-300 transition-all">
                <div className="h-12 w-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4">
                  <FileText className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Brief Ejecutivo con IA</h3>
                <p className="text-slate-600 text-sm">
                  Genera resúmenes ejecutivos de cada cuenta combinando señales, noticias, implementaciones y estrategia comercial.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* New Pipeline Section */}
        <section className="py-24 bg-white border-t border-slate-200">
          <div className="container mx-auto px-4">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <Badge className="mb-4 bg-amber-100 text-amber-700 hover:bg-amber-100">
                <Briefcase className="h-3 w-3 mr-1" />
                Gestión de Pipeline
              </Badge>
              <h2 className="text-4xl font-bold text-slate-900 mb-4">Tu pipeline de prospección, organizado</h2>
              <p className="text-lg text-slate-600">
                Guarda cuentas, clasifícalas por prioridad y gestiona todo el funnel de prospección desde una sola vista.
              </p>
            </div>

            {/* Pipeline Visual */}
            <div className="max-w-5xl mx-auto">
              <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8">
                {/* Kanban Preview */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* Column 1 */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-semibold text-slate-900">Nuevo</span>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">12</span>
                    </div>
                    <div className="space-y-3">
                      <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                        <div className="font-medium text-sm text-slate-900">ICBC Argentina</div>
                        <div className="text-xs text-slate-500">Banking</div>
                        <Badge className="mt-2 bg-red-50 text-red-700 text-xs">Alta</Badge>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                        <div className="font-medium text-sm text-slate-900">YPF</div>
                        <div className="text-xs text-slate-500">Oil & Gas</div>
                        <Badge className="mt-2 bg-yellow-50 text-yellow-700 text-xs">Transaccional</Badge>
                      </div>
                    </div>
                  </div>

                  {/* Column 2 */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-semibold text-blue-600">Investigando</span>
                      <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-full">8</span>
                    </div>
                    <div className="space-y-3">
                      <div className="bg-blue-50/50 rounded-lg p-3 border border-blue-100">
                        <div className="font-medium text-sm text-slate-900">Mercado Libre</div>
                        <div className="text-xs text-slate-500">E-commerce</div>
                        <Badge className="mt-2 bg-red-50 text-red-700 text-xs">Alta</Badge>
                      </div>
                    </div>
                  </div>

                  {/* Column 3 */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-semibold text-yellow-600">Contactado</span>
                      <span className="text-xs bg-yellow-100 text-yellow-600 px-2 py-1 rounded-full">5</span>
                    </div>
                    <div className="space-y-3">
                      <div className="bg-yellow-50/50 rounded-lg p-3 border border-yellow-100">
                        <div className="font-medium text-sm text-slate-900">Santander</div>
                        <div className="text-xs text-slate-500">Banking</div>
                        <Badge className="mt-2 bg-red-50 text-red-700 text-xs">Alta</Badge>
                      </div>
                    </div>
                  </div>

                  {/* Column 4 */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-semibold text-purple-600">Reunión</span>
                      <span className="text-xs bg-purple-100 text-purple-600 px-2 py-1 rounded-full">3</span>
                    </div>
                    <div className="space-y-3">
                      <div className="bg-purple-50/50 rounded-lg p-3 border border-purple-100">
                        <div className="font-medium text-sm text-slate-900">Galicia Bank</div>
                        <div className="text-xs text-slate-500">Financial Services</div>
                        <Badge className="mt-2 bg-red-50 text-red-700 text-xs">Alta</Badge>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats Bar */}
                <div className="mt-8 pt-6 border-t border-slate-200 grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-red-600">15</div>
                    <div className="text-xs text-slate-500">Cuentas Alta Prioridad</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-yellow-600">12</div>
                    <div className="text-xs text-slate-500">Cuentas Transaccionales</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-slate-600">8</div>
                    <div className="text-xs text-slate-500">Cuentas Baja Prioridad</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Workspace Section */}
        <section id="workspace" className="py-24 bg-white overflow-hidden">
          <div className="container mx-auto px-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
              {/* Left Content */}
              <div>
                <Badge className="mb-4 bg-indigo-100 text-indigo-700 hover:bg-indigo-100">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Workspace Inteligente
                </Badge>
                <h2 className="text-4xl font-bold text-slate-900 mb-6">Tu centro de comando para cada cuenta</h2>
                <p className="text-lg text-slate-600 mb-8">
                  Guarda empresas como bookmarks y accede a un workspace privado donde la IA trabaja para ti. Analiza,
                  investiga y crea contenido personalizado sin salir de la plataforma.
                </p>

                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="h-8 w-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                      <Target className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900">Estrategia de Cuenta con IA</h4>
                      <p className="text-sm text-slate-600">
                        Analiza el sitio web del prospecto y genera ángulos de venta únicos automáticamente.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="h-8 w-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
                      <MessageSquare className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900">Icebreakers Personalizados</h4>
                      <p className="text-sm text-slate-600">
                        Genera mensajes de apertura que demuestran que hiciste tu tarea.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="h-8 w-8 rounded-lg bg-green-100 text-green-600 flex items-center justify-center flex-shrink-0">
                      <Globe className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900">Research con Perplexity</h4>
                      <p className="text-sm text-slate-600">
                        Busca noticias e implementaciones recientes de cada empresa.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Visual */}
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 rounded-3xl blur-3xl -z-10" />
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
                  {/* Workspace Header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-white font-bold">
                        G
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">Galicia Bank</div>
                        <div className="text-sm text-slate-500">Financial Services • Argentina</div>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Alta Prioridad
                    </Badge>
                  </div>

                  {/* Workspace Tabs */}
                  <div className="flex gap-1 px-6 py-3 border-b border-slate-200 bg-white">
                    <div className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg">Overview</div>
                    <div className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 rounded-lg">
                      Señales
                    </div>
                    <div className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 rounded-lg">
                      Estrategia
                    </div>
                    <div className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 rounded-lg">
                      Noticias
                    </div>
                  </div>

                  {/* Workspace Content */}
                  <div className="p-6 space-y-4">
                    {/* Strategy Card */}
                    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 border border-indigo-100">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="h-4 w-4 text-indigo-600" />
                        <span className="text-sm font-medium text-indigo-900">Estrategia Generada por IA</span>
                      </div>
                      <p className="text-sm text-indigo-800">
                        "Enfocar pitch en modernización de core bancario. Señales indican migración a AWS y adopción de
                        metodologías ágiles..."
                      </p>
                    </div>

                    {/* Signals Summary */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-slate-900">12</div>
                        <div className="text-xs text-slate-500">Señales Tech</div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-slate-900">6</div>
                        <div className="text-xs text-slate-500">Procesos</div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-orange-600">8</div>
                        <div className="text-xs text-slate-500">Búsquedas Lab.</div>
                      </div>
                    </div>

                    {/* Tech Tags */}
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                        AWS
                      </Badge>
                      <Badge variant="secondary" className="bg-green-50 text-green-700">
                        SAP S/4HANA
                      </Badge>
                      <Badge variant="secondary" className="bg-purple-50 text-purple-700">
                        DevOps
                      </Badge>
                      <Badge variant="secondary" className="bg-orange-50 text-orange-700">
                        Kubernetes
                      </Badge>
                      <Badge variant="secondary" className="bg-cyan-50 text-cyan-700">
                        Terraform
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 bg-slate-900 text-white">
          <div className="container mx-auto px-4">
            <div className="text-center">
              <h2 className="text-4xl font-bold mb-4">Comienza a encontrar señales hoy</h2>
              <p className="text-xl text-slate-400 max-w-2xl mx-auto">
                Únete a los equipos de ventas que ya están usando inteligencia de señales para mejorar su prospección B2B.
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-slate-200 bg-white py-8">
          <div className="container mx-auto px-4">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <Image src="/logo.png" alt="ASCI Logo" width={28} height={28} className="rounded-lg" />
                ASCI
              </div>
              <div className="text-sm text-slate-500">© 2026 ASCI. Asistente de Señales de Compra e Inferencias.</div>
            </div>
          </div>
        </footer>

        {/* NetHunt Form - Fixed in footer */}
        <footer className="border-t border-slate-200 bg-white">
          <div className="container mx-auto px-4 py-12">
            <NetHuntForm />
          </div>
        </footer>
      </main>
    </div>
  )
}
