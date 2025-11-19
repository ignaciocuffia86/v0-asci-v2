"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Loader2, RefreshCw } from 'lucide-react';
import { processSignals, getProcessingStats } from "@/app/actions/processing";
import { Progress } from "@/components/ui/progress";

export default function ProcessingPage() {
  const [stats, setStats] = useState({ pending: 0, signals: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  const fetchStats = async () => {
    const newStats = await getProcessingStats();
    setStats(newStats);
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleProcess = async () => {
    setIsProcessing(true);
    setLogs((prev) => ["Iniciando procesamiento...", ...prev]);
    setProgress(0);

    const BATCH_SIZE = 20;
    let totalProcessed = 0;
    const initialPending = stats.pending;

    try {
      // Loop until no more pending contacts
      while (true) {
        const result = await processSignals(BATCH_SIZE);
        
        if (!result.success) {
          setLogs((prev) => [`Error: ${result.error}`, ...prev]);
          break;
        }

        if (result.processed === 0 && result.errors === 0) {
          setLogs((prev) => ["No hay más contactos pendientes.", ...prev]);
          break;
        }

        totalProcessed += result.processed;
        const currentProgress = initialPending > 0 
          ? Math.min(Math.round((totalProcessed / initialPending) * 100), 100)
          : 100;
        
        setProgress(currentProgress);
        setLogs((prev) => [`Procesados ${result.processed} contactos...`, ...prev]);
        
        // Update stats UI
        await fetchStats();

        // Small delay to not choke the UI/Server
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      setLogs((prev) => [`Error inesperado: ${error}`, ...prev]);
    } finally {
      setIsProcessing(false);
      setLogs((prev) => ["Procesamiento finalizado.", ...prev]);
      fetchStats();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Procesamiento de Señales</h1>
          <p className="text-muted-foreground">
            Estado del motor de detección de señales y ejecución manual.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={fetchStats} disabled={isProcessing}>
          <RefreshCw className={`h-4 w-4 ${isProcessing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pendientes de Procesar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pending}</div>
            <p className="text-xs text-muted-foreground">Contactos nuevos o actualizados</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Señales Detectadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.signals}</div>
            <p className="text-xs text-muted-foreground">Total histórico</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Estado del Job
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${isProcessing ? 'text-blue-600' : 'text-green-600'}`}>
              {isProcessing ? 'Ejecutando' : 'Inactivo'}
            </div>
            <p className="text-xs text-muted-foreground">
              {isProcessing ? 'Procesando lotes...' : 'Esperando ejecución'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ejecución Manual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Puedes forzar la ejecución del motor de detección de señales para procesar los contactos pendientes.
            Esto buscará keywords en los perfiles según el diccionario actual.
          </p>
          
          {isProcessing && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progreso del lote actual</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          <Button 
            onClick={handleProcess} 
            disabled={stats.pending === 0 || isProcessing}
            className="w-full sm:w-auto"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Ejecutar Detección Ahora
              </>
            )}
          </Button>

          <div className="mt-4 bg-muted/50 rounded-md p-4 h-40 overflow-y-auto font-mono text-xs">
            {logs.length === 0 ? (
              <span className="text-muted-foreground">Esperando logs...</span>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="mb-1">{log}</div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
