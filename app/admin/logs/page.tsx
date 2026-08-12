import { createClient } from "@/lib/supabase/server"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { Activity, Database, FileText, AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react"

export default async function LogsPage() {
  const supabase = await createClient()

  // Obtener estadísticas de tablas principales
  const [{ count: contactsCount }, { count: jobPostingsCount }, { count: signalsCount }, { count: companiesCount }] =
    await Promise.all([
      supabase.from("contacts").select("*", { count: "exact", head: true }),
      supabase.from("job_postings").select("*", { count: "exact", head: true }),
      supabase.from("signals").select("*", { count: "exact", head: true }),
      supabase.from("companies").select("*", { count: "exact", head: true }),
    ])

  // Obtener actividad reciente de contacts (últimos 7 días)
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const [{ count: recentContacts }, { count: recentJobPostings }, { count: recentSignals }] = await Promise.all([
    supabase.from("contacts").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo.toISOString()),
    supabase
      .from("job_postings")
      .select("*", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo.toISOString()),
    supabase.from("signals").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo.toISOString()),
  ])

  // Obtener dictionary_jobs (actividad de procesamiento)
  const { data: dictionaryJobs } = await supabase
    .from("dictionary_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50)

  // Obtener debug_events recientes
  const { data: debugEvents } = await supabase
    .from("debug_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100)

  // Obtener ingestion_logs (si hay)
  const { data: ingestionLogs } = await supabase
    .from("ingestion_logs")
    .select(`
      *,
      profiles:uploaded_by (full_name)
    `)
    .order("created_at", { ascending: false })
    .limit(50)

  // Agrupar debug_events por batch y tipo
  const eventsByType =
    debugEvents?.reduce(
      (acc, event) => {
        acc[event.event_type] = (acc[event.event_type] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    ) || {}

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-600 hover:bg-green-700">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Completado
          </Badge>
        )
      case "processing":
        return (
          <Badge variant="secondary" className="bg-blue-600 hover:bg-blue-700 text-white">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Procesando
          </Badge>
        )
      case "pending":
        return (
          <Badge variant="outline">
            <Clock className="w-3 h-3 mr-1" />
            Pendiente
          </Badge>
        )
      case "failed":
        return (
          <Badge variant="destructive">
            <AlertCircle className="w-3 h-3 mr-1" />
            Error
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const formatProgress = (job: any) => {
    const contactsProgress = job.contacts_total > 0 ? `${job.contacts_processed || 0}/${job.contacts_total}` : "-"
    const jobsProgress =
      job.job_postings_total > 0 ? `${job.job_postings_processed || 0}/${job.job_postings_total}` : "-"
    return { contactsProgress, jobsProgress }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Logs del Sistema</h1>
        <p className="text-muted-foreground">Estado actual de la base de datos y actividad de procesamiento.</p>
      </div>

      {/* Resumen de Base de Datos */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Contactos</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(contactsCount || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">+{(recentContacts || 0).toLocaleString()} últimos 7 días</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Job Postings</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(jobPostingsCount || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">+{(recentJobPostings || 0).toLocaleString()} últimos 7 días</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Señales</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(signalsCount || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">+{(recentSignals || 0).toLocaleString()} últimos 7 días</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Empresas</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(companiesCount || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Empresas únicas</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="dictionary" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dictionary">Jobs de Diccionario</TabsTrigger>
          <TabsTrigger value="events">Eventos de Debug</TabsTrigger>
          <TabsTrigger value="ingestion">Logs de Ingesta</TabsTrigger>
        </TabsList>

        <TabsContent value="dictionary" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Jobs de Procesamiento de Diccionario</CardTitle>
              <CardDescription>
                Historial de reprocesamiento de señales por cambios en el diccionario de keywords.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Keyword</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Fase</TableHead>
                      <TableHead>Contactos</TableHead>
                      <TableHead>Job Postings</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dictionaryJobs?.map((job) => {
                      const { contactsProgress, jobsProgress } = formatProgress(job)
                      return (
                        <TableRow key={job.id}>
                          <TableCell className="text-sm">
                            {formatDistanceToNow(new Date(job.created_at), {
                              addSuffix: true,
                              locale: es,
                            })}
                          </TableCell>
                          <TableCell className="font-medium max-w-[150px] truncate" title={job.keyword}>
                            {job.keyword}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{job.job_type === "add" ? "Agregar" : "Eliminar"}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {job.phase === "contacts" && "Contactos"}
                            {job.phase === "job_postings" && "Job Postings"}
                            {job.phase === "completed" && "Finalizado"}
                            {!job.phase && "-"}
                          </TableCell>
                          <TableCell className="text-sm font-mono">{contactsProgress}</TableCell>
                          <TableCell className="text-sm font-mono">{jobsProgress}</TableCell>
                          <TableCell>{getStatusBadge(job.status)}</TableCell>
                        </TableRow>
                      )
                    })}
                    {!dictionaryJobs?.length && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                          No hay jobs de diccionario registrados.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Eventos de Debug</CardTitle>
              <CardDescription>Eventos recientes del sistema de procesamiento.</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Resumen de tipos de eventos */}
              <div className="grid gap-2 md:grid-cols-4 mb-4">
                {Object.entries(eventsByType).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between p-2 rounded border bg-muted/50">
                    <span className="text-sm font-medium">{type}</span>
                    <Badge variant="secondary">{String(count)}</Badge>
                  </div>
                ))}
              </div>

              <div className="rounded-md border max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[150px]">Fecha</TableHead>
                      <TableHead className="w-[150px]">Tipo</TableHead>
                      <TableHead>Mensaje</TableHead>
                      <TableHead>Detalles</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debugEvents?.slice(0, 50).map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNow(new Date(event.created_at), {
                            addSuffix: true,
                            locale: es,
                          })}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              event.event_type === "row_error"
                                ? "destructive"
                                : event.event_type === "signal_detection_match"
                                  ? "default"
                                  : "outline"
                            }
                            className={event.event_type === "signal_detection_match" ? "bg-green-600" : ""}
                          >
                            {event.event_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[300px] truncate" title={event.message}>
                          {event.message}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {event.details ? JSON.stringify(event.details) : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!debugEvents?.length && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                          No hay eventos registrados.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ingestion" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Logs de Ingesta de Archivos</CardTitle>
              <CardDescription>Historial de archivos CSV procesados y su estado.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Archivo</TableHead>
                      <TableHead>Usuario</TableHead>
                      <TableHead>Filas</TableHead>
                      <TableHead>Procesados</TableHead>
                      <TableHead>Errores</TableHead>
                      <TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ingestionLogs?.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          {formatDistanceToNow(new Date(log.created_at), {
                            addSuffix: true,
                            locale: es,
                          })}
                        </TableCell>
                        <TableCell className="font-medium">{log.filename}</TableCell>
                        <TableCell>{log.profiles?.full_name || "Desconocido"}</TableCell>
                        <TableCell>{log.total_rows}</TableCell>
                        <TableCell>{log.processed_rows}</TableCell>
                        <TableCell className={log.errors?.length > 0 ? "text-destructive" : ""}>
                          {log.errors?.length || 0}
                        </TableCell>
                        <TableCell>{getStatusBadge(log.status)}</TableCell>
                      </TableRow>
                    ))}
                    {!ingestionLogs?.length && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                          No hay logs de ingesta registrados.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
