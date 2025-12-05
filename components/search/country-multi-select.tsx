"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ChevronDown, X, Search, MapPin } from "lucide-react"
import { COUNTRIES } from "@/lib/constants"
import { cn } from "@/lib/utils"

interface CountryMultiSelectProps {
  selectedCountries: string[]
  onCountriesChange: (countries: string[]) => void
  placeholder?: string
}

export function CountryMultiSelect({
  selectedCountries,
  onCountriesChange,
  placeholder = "Agregar país...",
}: CountryMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  // Filtrar países: excluir seleccionados y aplicar búsqueda
  const availableCountries = useMemo(() => {
    return COUNTRIES.filter((country) => {
      const isNotSelected = !selectedCountries.includes(country)
      const matchesSearch = country.toLowerCase().includes(searchQuery.toLowerCase())
      return isNotSelected && matchesSearch
    })
  }, [selectedCountries, searchQuery])

  const toggleCountry = (country: string) => {
    if (selectedCountries.includes(country)) {
      onCountriesChange(selectedCountries.filter((c) => c !== country))
    } else {
      onCountriesChange([...selectedCountries, country])
    }
    // Limpiar búsqueda al seleccionar
    setSearchQuery("")
  }

  const removeCountry = (country: string) => {
    onCountriesChange(selectedCountries.filter((c) => c !== country))
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal bg-transparent"
          >
            <span className="text-muted-foreground">{placeholder}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          {/* Buscador */}
          <div className="flex items-center border-b px-3 py-2">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Input
              placeholder="Buscar país..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-0 p-0 h-8 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="ml-2 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Lista de países */}
          <div className="max-h-[250px] overflow-y-auto p-1">
            {availableCountries.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {searchQuery ? "No se encontraron países" : "Todos los países están seleccionados"}
              </div>
            ) : (
              availableCountries.map((country) => (
                <button
                  key={country}
                  onClick={() => toggleCountry(country)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    "cursor-pointer transition-colors",
                  )}
                >
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  {country}
                </button>
              ))
            )}
          </div>

          {/* Footer con contador */}
          {selectedCountries.length > 0 && (
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
              {selectedCountries.length} {selectedCountries.length === 1 ? "país seleccionado" : "países seleccionados"}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Tags de países seleccionados */}
      <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
        {selectedCountries.map((country) => (
          <Badge key={country} variant="outline" className="pl-2 pr-1 py-1">
            {country}
            <button onClick={() => removeCountry(country)} className="ml-2 hover:text-destructive transition-colors">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {selectedCountries.length === 0 && (
          <span className="text-sm text-muted-foreground italic py-1">Selecciona al menos un país</span>
        )}
      </div>
    </div>
  )
}
