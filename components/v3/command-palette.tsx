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
  Building2, 
  FileText, 
  Settings, 
  Plus,
  Search,
  Sparkles,
  Key
} from "lucide-react"

interface CommandPaletteProps {
  campaigns?: Array<{
    id: string
    name: string
  }>
}

export function CommandPalette({ campaigns = [] }: CommandPaletteProps) {
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
      <CommandInput placeholder="Buscar campanas, acciones..." />
      <CommandList>
        <CommandEmpty>No se encontraron resultados.</CommandEmpty>
        
        <CommandGroup heading="Acciones rapidas">
          <CommandItem
            onSelect={() => runCommand(() => router.push("/v3/campaigns/new"))}
          >
            <Plus className="mr-2 size-4" />
            Nueva campana
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/v3/docs"))}
          >
            <FileText className="mr-2 size-4" />
            Subir documento
          </CommandItem>
        </CommandGroup>
        
        {campaigns.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Campanas">
              {campaigns.map((campaign) => (
                <CommandItem
                  key={campaign.id}
                  onSelect={() => runCommand(() => router.push(`/v3/campaigns/${campaign.id}`))}
                >
                  <Building2 className="mr-2 size-4" />
                  {campaign.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        
        <CommandSeparator />
        <CommandGroup heading="Navegacion">
          <CommandItem
            onSelect={() => runCommand(() => router.push("/v3/campaigns"))}
          >
            <Building2 className="mr-2 size-4" />
            Ver campanas
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
