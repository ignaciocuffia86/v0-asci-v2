import { createClient } from "@/lib/supabase/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

export default async function LogsPage() {
  const supabase = await createClient();
  
  const { data: logs } = await supabase
    .from("ingestion_logs")
    .select(`
      *,
      profiles:uploaded_by (full_name)
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Logs de Ingesta</h1>
        <p className="text-muted-foreground">
          Historial de archivos procesados y su estado.
        </p>
      </div>

      <div className="rounded-md border bg-card">
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
            {logs?.map((log) => (
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
                <TableCell>
                  <Badge
                    variant={
                      log.status === "completed"
                        ? "default" // Using default (primary) for success/completed
                        : log.status === "failed"
                        ? "destructive"
                        : "secondary"
                    }
                    className={
                        log.status === "completed" ? "bg-green-600 hover:bg-green-700" : ""
                    }
                  >
                    {log.status === "completed"
                      ? "Completado"
                      : log.status === "failed"
                      ? "Fallido"
                      : "Procesando"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {!logs?.length && (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-24">
                  No hay logs registrados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
