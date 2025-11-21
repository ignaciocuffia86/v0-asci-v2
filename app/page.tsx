import Link from "next/link"
import { ArrowRight, BrainCircuit, CheckCircle2, Database, Globe, LineChart, Search, Users, Zap } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-slate-950">
      {/* Navbar */}
      <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md dark:bg-slate-950/80 dark:border-slate-800">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2 font-bold text-xl text-slate-900 dark:text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">A</div>
            ASCI v2
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
            <Link href="#features" className="hover:text-blue-600 transition-colors">
              Funcionalidades
            </Link>
            <Link href="#roadmap" className="hover:text-blue-600 transition-colors">
              Roadmap
            </Link>
            <Link href="#pricing" className="hover:text-blue-600 transition-colors">
              Precios
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/auth/login">
              <Button variant="ghost" size="sm">
                Iniciar Sesión
              </Button>
            </Link>
            <Link href="/search">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white">
                Ir a la Plataforma
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative py-20 md:py-32 overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:14px_24px]"></div>
          <div className="absolute left-0 right-0 top-0 -z-10 m-auto h-[310px] w-[310px] rounded-full bg-blue-500 opacity-20 blur-[100px]"></div>

          <div className="container mx-auto px-4 text-center">
            <Badge
              variant="outline"
              className="mb-4 py-1.5 px-4 border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800"
            >
              <span className="mr-2">✨</span> Nuevo: Búsqueda Facetada y Detección de Alumni
            </Badge>
            <h1 className="mx-auto mb-6 max-w-4xl text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl md:text-6xl dark:text-white">
              Transforma Señales en <br className="hidden md:block" />
              <span className="text-blue-600">Oportunidades de Venta</span>
            </h1>
            <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
              Descubre qué tecnologías y procesos utilizan tus prospectos analizando las señales ocultas en sus
              empleados. La inteligencia de mercado definitiva para equipos de ventas B2B.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/search">
                <Button
                  size="lg"
                  className="h-12 px-8 text-base bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20"
                >
                  Explorar Señales
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Button variant="outline" size="lg" className="h-12 px-8 text-base bg-transparent">
                Agendar Demo
              </Button>
            </div>

            {/* Hero Image / UI Mockup */}
            <div className="mt-20 relative mx-auto max-w-5xl rounded-xl border bg-white/50 p-2 shadow-2xl backdrop-blur-sm dark:bg-slate-950/50 dark:border-slate-800">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
              <div className="rounded-lg border bg-slate-50/50 overflow-hidden dark:bg-slate-900/50 dark:border-slate-800">
                <div className="flex items-center justify-between border-b px-4 py-3 bg-white dark:bg-slate-950">
                  <div className="flex space-x-2">
                    <div className="h-3 w-3 rounded-full bg-red-400/80"></div>
                    <div className="h-3 w-3 rounded-full bg-yellow-400/80"></div>
                    <div className="h-3 w-3 rounded-full bg-green-400/80"></div>
                  </div>
                  <div className="h-6 w-64 rounded bg-slate-100 dark:bg-slate-800"></div>
                  <div className="h-4 w-4"></div>
                </div>
                <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Fake UI Cards */}
                  <div className="rounded-lg bg-white p-4 shadow-sm border dark:bg-slate-950 dark:border-slate-800">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-8 w-8 rounded bg-orange-100 flex items-center justify-center text-orange-600">
                        <Zap size={16} />
                      </div>
                      <div className="font-semibold text-sm">AWS Integration</div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-2 w-3/4 rounded bg-slate-100 dark:bg-slate-800"></div>
                      <div className="h-2 w-1/2 rounded bg-slate-100 dark:bg-slate-800"></div>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                      <Badge variant="secondary" className="text-[10px]">
                        Cloud
                      </Badge>
                      <span>+12 Señales</span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-white p-4 shadow-sm border dark:bg-slate-950 dark:border-slate-800">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-8 w-8 rounded bg-blue-100 flex items-center justify-center text-blue-600">
                        <Database size={16} />
                      </div>
                      <div className="font-semibold text-sm">Salesforce CRM</div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-2 w-full rounded bg-slate-100 dark:bg-slate-800"></div>
                      <div className="h-2 w-2/3 rounded bg-slate-100 dark:bg-slate-800"></div>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                      <Badge variant="secondary" className="text-[10px]">
                        CRM
                      </Badge>
                      <span>+8 Señales</span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-white p-4 shadow-sm border dark:bg-slate-950 dark:border-slate-800">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-8 w-8 rounded bg-green-100 flex items-center justify-center text-green-600">
                        <Users size={16} />
                      </div>
                      <div className="font-semibold text-sm">Agile Methodologies</div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-2 w-5/6 rounded bg-slate-100 dark:bg-slate-800"></div>
                      <div className="h-2 w-1/2 rounded bg-slate-100 dark:bg-slate-800"></div>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                      <Badge variant="secondary" className="text-[10px]">
                        Process
                      </Badge>
                      <span>+24 Señales</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Value Props / Features */}
        <section id="features" className="py-20 bg-slate-50 dark:bg-slate-900/50">
          <div className="container mx-auto px-4">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white mb-4">
                Inteligencia que va más allá del "Quién es Quién"
              </h2>
              <p className="text-lg text-slate-600 dark:text-slate-400">
                La mayoría de las herramientas solo te dan emails. ASCI te da contexto. Entiende qué está pasando dentro
                de las empresas a través de las huellas digitales de sus equipos.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <Card className="border-none shadow-md bg-white dark:bg-slate-950">
                <CardHeader>
                  <div className="mb-4 h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    <Search className="h-6 w-6" />
                  </div>
                  <CardTitle>Búsqueda Facetada</CardTitle>
                  <CardDescription>Encuentra empresas no por su nombre, sino por lo que hacen y usan.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" /> Filtro por Tecnología (Stack)
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" /> Filtro por Procesos Internos
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" /> Filtro Geográfico Preciso
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-none shadow-md bg-white dark:bg-slate-950">
                <CardHeader>
                  <div className="mb-4 h-12 w-12 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                    <LineChart className="h-6 w-6" />
                  </div>
                  <CardTitle>Señales de Empleados</CardTitle>
                  <CardDescription>
                    Detectamos keywords en perfiles de empleados para inferir el stack tecnológico.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" /> Detección de Menciones (Biografías)
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" /> Validación de "Current vs Alumni"
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" /> Análisis de Seniority
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-none shadow-md bg-white dark:bg-slate-950">
                <CardHeader>
                  <div className="mb-4 h-12 w-12 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                    <Database className="h-6 w-6" />
                  </div>
                  <CardTitle>Datos Normalizados</CardTitle>
                  <CardDescription>Base de datos limpia y estructurada lista para tu equipo de ventas.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" /> Fusión automática de duplicados
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" /> Emails Corporativos Validados
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" /> Enriquecimiento Constante
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Roadmap Section */}
        <section id="roadmap" className="py-20 border-t dark:border-slate-800">
          <div className="container mx-auto px-4">
            <div className="flex flex-col md:flex-row items-start justify-between gap-12">
              <div className="md:w-1/3">
                <Badge variant="secondary" className="mb-4">
                  Roadmap 2025
                </Badge>
                <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white mb-4">
                  El Futuro de la Prospección es <span className="text-blue-600">Hiper-Personalizado</span>
                </h2>
                <p className="text-slate-600 dark:text-slate-400 mb-8">
                  Estamos construyendo la próxima generación de herramientas de inteligencia de ventas. Esto es lo que
                  llegará pronto a ASCI.
                </p>
                <Button variant="outline" className="gap-2 bg-transparent">
                  Ver Roadmap Completo <ArrowRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="md:w-2/3 grid gap-6">
                <div className="flex gap-4 p-4 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
                  <div className="mt-1 h-10 w-10 shrink-0 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                    <Globe className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Enrichment Web en Tiempo Real</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      No solo nos basamos en CSVs. Escanearemos la web para enriquecer perfiles y empresas con datos
                      frescos al instante.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4 p-4 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
                  <div className="mt-1 h-10 w-10 shrink-0 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Búsqueda de Decision Makers</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      Identificación automática de los tomadores de decisión clave para cada oportunidad detectada, con
                      sus datos de contacto.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4 p-4 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
                  <div className="mt-1 h-10 w-10 shrink-0 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                    <BrainCircuit className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-white">Icebreakers con IA</h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      Generación automática de mensajes de apertura hiper-personalizados basados en las señales
                      detectadas (ej: "Vi que usas AWS y están migrando a...").
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-20 bg-blue-600 text-white">
          <div className="container mx-auto px-4 text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
              ¿Listo para encontrar tu próxima gran venta?
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-blue-100 text-lg">
              Únete a las empresas que ya están utilizando inteligencia de señales para mejorar su prospección.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/search">
                <Button size="lg" variant="secondary" className="h-12 px-8 text-base text-blue-700 font-bold">
                  Comenzar Gratis
                </Button>
              </Link>
              <Button
                size="lg"
                className="h-12 px-8 text-base border-blue-400 bg-blue-700 hover:bg-blue-800 text-white border shadow-none"
              >
                Hablar con Ventas
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-12 bg-slate-50 dark:bg-slate-950 dark:border-slate-800">
        <div className="container mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 font-bold text-xl text-slate-900 dark:text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900">
              A
            </div>
            ASCI v2
          </div>
          <div className="text-sm text-slate-500">© 2025 ASCI Intelligence. Todos los derechos reservados.</div>
        </div>
      </footer>
    </div>
  )
}
