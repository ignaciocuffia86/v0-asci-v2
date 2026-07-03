"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { 
  FileText, 
  Settings, 
  MessageSquare,
  Star,
  Key
} from "lucide-react"

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  const runCommand = useCallback((command: () => void) => {
    setOpen(false)
    command()
  }, [])

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Buscar acciones..." />
      <CommandList>
        <CommandEmpty>No se encontraron resultados.</CommandEmpty>
        
        <CommandGroup heading="Acciones rapidas">
          <CommandItem
            onSelect={() => runCommand(() => router.push("/v3/chat"))}
          >
            <MessageSquare className="mr-2 size-4" />
            Nueva conversacion
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/v3/docs"))}
          >
            <FileText className="mr-2 size-4" />
            Subir documento
          </CommandItem>
        </CommandGroup>
        
        <CommandSeparator />
        <CommandGroup heading="Navegacion">
          <CommandItem
            onSelect={() => runCommand(() => router.push("/v3/chat"))}
          >
            <MessageSquare className="mr-2 size-4" />
            Chat
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/v3/accounts"))}
          >
            <Star className="mr-2 size-4" />
            Cuentas seguidas
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/v3/docs"))}
          >
            <FileText className="mr-2 size-4" />
            Ver documentos
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/v3/settings"))}
          >
            <Settings className="mr-2 size-4" />
            Configuracion
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/v3/settings/api-keys"))}
          >
            <Key className="mr-2 size-4" />
            API Keys
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
