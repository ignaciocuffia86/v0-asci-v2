import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { VendorsTable } from "@/components/dictionary/vendors-table"
import { ProcessesTable } from "@/components/dictionary/processes-table"
import { ProcessDictionaryButton } from "@/components/dictionary/process-dictionary-button"

export default async function DictionaryPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Diccionario</h1>
          <p className="text-muted-foreground">Gestiona las tecnologías y procesos que el sistema debe detectar.</p>
        </div>
        <ProcessDictionaryButton />
      </div>

      <Tabs defaultValue="technologies" className="w-full">
        <TabsList>
          <TabsTrigger value="technologies">Tecnologías</TabsTrigger>
          <TabsTrigger value="processes">Procesos</TabsTrigger>
        </TabsList>

        <TabsContent value="technologies" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Vendors y Productos</CardTitle>
              <CardDescription>Configura las empresas de tecnología y sus productos asociados.</CardDescription>
            </CardHeader>
            <CardContent>
              <VendorsTable />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="processes" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Procesos de Negocio</CardTitle>
              <CardDescription>Define los procesos clave y sus palabras clave asociadas.</CardDescription>
            </CardHeader>
            <CardContent>
              <ProcessesTable />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
