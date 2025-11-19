"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Process = {
  id: string;
  name: string;
  keywords: string[];
};

export function ProcessesTable() {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

  const fetchData = async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from("dictionary_processes")
      .select("*")
      .order("name");
    setProcesses(data || []);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const addProcess = async (name: string, keywords: string[]) => {
    await supabase.from("dictionary_processes").insert({
      name,
      keywords,
    });
    fetchData();
  };

  const deleteProcess = async (id: string) => {
    if (confirm("¿Estás seguro de eliminar este proceso?")) {
      await supabase.from("dictionary_processes").delete().eq("id", id);
      fetchData();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddProcessDialog onAdd={addProcess} />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Proceso</TableHead>
              <TableHead>Keywords</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {processes.map((process) => (
              <TableRow key={process.id}>
                <TableCell className="font-medium align-top pt-4">{process.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {process.keywords?.map((kw, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right align-top pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteProcess(process.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && processes.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center h-24 text-muted-foreground">
                  No hay procesos configurados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AddProcessDialog({ onAdd }: { onAdd: (name: string, kws: string[]) => void }) {
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [open, setOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      const kwList = keywords.split(",").map(k => k.trim()).filter(k => k);
      if (!kwList.includes(name.trim())) {
        kwList.unshift(name.trim());
      }
      onAdd(name, kwList);
      setName("");
      setKeywords("");
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Agregar Proceso
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar Nuevo Proceso</DialogTitle>
          <DialogDescription>
            Define el proceso de negocio y sus palabras clave asociadas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="proc-name">Nombre del Proceso</Label>
              <Input
                id="proc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Transformación Digital"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proc-keywords">Sinónimos / Keywords</Label>
              <Input
                id="proc-keywords"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="Ej: Digital Transformation, Digitalización (separar por comas)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim()}>Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
