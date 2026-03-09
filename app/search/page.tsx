"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProcessSearch } from "@/components/search/process-search"
import { TechnologySearch } from "@/components/search/technology-search"
import { CompanySearch } from "@/components/search/company-search"
import { Workflow, Cpu, Building2 } from "lucide-react"

export default function SearchPage() {
  return (
    <div className="flex min-h-full bg-background">
      <div className="flex-1 p-4 md:p-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto space-y-6 md:space-y-8">
          <div data-onboarding="search-header">
            <h1 className="text-3xl font-bold tracking-tight">Busqueda de Leads</h1>
            <p className="text-muted-foreground mt-2">
              Explora el mercado utilizando tres dimensiones de busqueda inteligente.
            </p>
          </div>

          <Tabs defaultValue="process" className="w-full" id="search-tabs">
            <TabsList className="grid w-full grid-cols-3 h-auto md:h-12 mb-6 md:mb-8">
              <TabsTrigger value="process" className="flex items-center gap-1.5 md:gap-2 text-xs md:text-base py-2.5 md:py-1.5" data-onboarding="search-tab-proceso">
                <Workflow className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Por </span>Proceso
              </TabsTrigger>
              <TabsTrigger value="technology" className="flex items-center gap-1.5 md:gap-2 text-xs md:text-base py-2.5 md:py-1.5" data-onboarding="search-tab-tecnologia">
                <Cpu className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Por </span>Tech
              </TabsTrigger>
              <TabsTrigger value="company" className="flex items-center gap-1.5 md:gap-2 text-xs md:text-base py-2.5 md:py-1.5" data-onboarding="search-tab-company">
                <Building2 className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Por </span>Empresa
              </TabsTrigger>
            </TabsList>

            <TabsContent value="process" className="mt-0 focus-visible:outline-none">
              <div className="space-y-4">
                <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-100 dark:border-blue-900/50 text-sm text-blue-800 dark:text-blue-300">
                  <strong>Búsqueda por Proceso:</strong> Encuentra empresas donde los empleados <u>actuales</u>{" "}
                  mencionan procesos específicos. Ideal para identificar necesidades operativas activas.
                </div>
                <ProcessSearch />
              </div>
            </TabsContent>

            <TabsContent value="technology" className="mt-0 focus-visible:outline-none">
              <div className="space-y-4">
                <div className="bg-purple-50 dark:bg-purple-950/20 p-4 rounded-lg border border-purple-100 dark:border-purple-900/50 text-sm text-purple-800 dark:text-purple-300">
                  <strong>Búsqueda por Tecnología:</strong> Analiza la huella tecnológica considerando tanto empleados{" "}
                  <u>actuales</u> como <u>alumni</u>. Útil para ver adopción histórica y actual.
                </div>
                <TechnologySearch />
              </div>
            </TabsContent>

            <TabsContent value="company" className="mt-0 focus-visible:outline-none">
              <div className="space-y-4">
                <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-lg border border-gray-200 dark:border-gray-800 text-sm text-gray-800 dark:text-gray-300">
                  <strong>Búsqueda por Compañía:</strong> Obtén una radiografía completa de las señales de una empresa
                  específica.
                </div>
                <CompanySearch />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
