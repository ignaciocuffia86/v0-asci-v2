"use client"

import { useState } from "react"
import { FileUp, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export function UploadForm({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [message, setMessage] = useState("")
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus("loading")
    const response = await fetch(`/api/v3/mcp/documents/upload/${encodeURIComponent(token)}`, { method: "POST", body: new FormData(event.currentTarget) })
    const result = await response.json()
    if (!response.ok) { setStatus("error"); setMessage(result.error || "No se pudo cargar el archivo"); return }
    setStatus("done")
    setMessage(result.reused ? "Este documento ya existía y fue reutilizado. Vuelve a Claude para continuar." : "Documento cargado y listo para analizar. Vuelve a Claude para continuar.")
  }
  return <Card className="w-full max-w-lg">
    <CardHeader><div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><FileUp className="size-5" /></div><CardTitle className="text-balance">Cargar propuesta de valor</CardTitle><CardDescription>El enlace es de un solo uso. Admite PDF, DOCX o PPTX de hasta 25 MB.</CardDescription></CardHeader>
    <CardContent>{status === "done" ? <p className="text-sm text-foreground">{message}</p> : <form onSubmit={submit} className="flex flex-col gap-4"><Input name="file" type="file" accept=".pdf,.docx,.pptx" required /><Button disabled={status === "loading"} type="submit">{status === "loading" && <Loader2 className="size-4 animate-spin" />}Cargar documento</Button>{status === "error" && <p role="alert" className="text-sm text-destructive">{message}</p>}</form>}</CardContent>
  </Card>
}
