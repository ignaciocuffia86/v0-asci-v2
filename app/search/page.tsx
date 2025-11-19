"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, X, Building2, MapPin, Briefcase } from 'lucide-react';
import { searchCompanies } from "@/app/actions/search";
import { CompanyDrawer } from "@/components/company-drawer";
import { COUNTRIES } from "@/lib/constants";

type SearchFilters = {
  technologies: string[];
  processes: string[];
  countries: string[];
  industry: string;
};

type CompanyResult = {
  id: string;
  name: string;
  linkedin_url: string | null;
  website: string | null;
  industry: string | null;
  country: string | null;
  logo_url: string | null;
  signal_count: number;
  contact_count: number;
};

export default function SearchPage() {
  const [filters, setFilters] = useState<SearchFilters>({
    technologies: [],
    processes: [],
    countries: [],
    industry: "",
  });
  const [technologies, setTechnologies] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);
  const [results, setResults] = useState<CompanyResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const supabase = createClient();

  // Fetch dictionary data
  useEffect(() => {
    const fetchDictionary = async () => {
      const { data: techData } = await supabase
        .from("dictionary_products")
        .select("id, name, dictionary_vendors(name)")
        .order("name");
      
      const { data: procData } = await supabase
        .from("dictionary_processes")
        .select("id, name")
        .order("name");

      setTechnologies(techData || []);
      setProcesses(procData || []);
    };
    fetchDictionary();
  }, []);

  const handleSearch = async () => {
    if (filters.technologies.length === 0 && filters.processes.length === 0) {
      return;
    }
    setIsSearching(true);
    const companies = await searchCompanies(filters);
    setResults(companies);
    setIsSearching(false);
  };

  const addFilter = (type: "technologies" | "processes" | "countries", id: string) => {
    if (!filters[type].includes(id)) {
      setFilters({ ...filters, [type]: [...filters[type], id] });
    }
  };

  const removeFilter = (type: "technologies" | "processes" | "countries", id: string) => {
    setFilters({
      ...filters,
      [type]: filters[type].filter((i) => i !== id),
    });
  };

  const getItemName = (type: "technologies" | "processes" | "countries", id: string) => {
    if (type === "technologies") {
      const tech = technologies.find((t) => t.id === id);
      return tech ? `${tech.name}` : id;
    } else if (type === "processes") {
      const proc = processes.find((p) => p.id === id);
      return proc ? proc.name : id;
    } else {
      return id;
    }
  };

  return (
    <div className="flex h-screen">
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Búsqueda de Leads</h1>
            <p className="text-muted-foreground">
              Encuentra empresas basándote en señales tecnológicas y de procesos.
            </p>
          </div>

          {/* Filters */}
          <div className="bg-card border rounded-lg p-6 space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Tecnologías</Label>
                <Select onValueChange={(val) => addFilter("technologies", val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona tecnologías..." />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-gray-950 border-border">
                    {technologies.map((tech) => (
                      <SelectItem key={tech.id} value={tech.id}>
                        {tech.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap gap-2 mt-2">
                  {filters.technologies.map((id) => (
                    <Badge key={id} variant="secondary">
                      {getItemName("technologies", id)}
                      <button
                        onClick={() => removeFilter("technologies", id)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Procesos</Label>
                <Select onValueChange={(val) => addFilter("processes", val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona procesos..." />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-gray-950 border-border">
                    {processes.map((proc) => (
                      <SelectItem key={proc.id} value={proc.id}>
                        {proc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap gap-2 mt-2">
                  {filters.processes.map((id) => (
                    <Badge key={id} variant="secondary">
                      {getItemName("processes", id)}
                      <button
                        onClick={() => removeFilter("processes", id)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>País (Opcional)</Label>
                <Select onValueChange={(val) => addFilter("countries", val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona países..." />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-gray-950 border-border">
                    {COUNTRIES.map((country) => (
                      <SelectItem key={country} value={country}>
                        {country}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap gap-2 mt-2">
                  {filters.countries.map((country) => (
                    <Badge key={country} variant="secondary">
                      {country}
                      <button
                        onClick={() => removeFilter("countries", country)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="industry">Industria (Opcional)</Label>
                <Input
                  id="industry"
                  placeholder="Ej: Technology, Finance"
                  value={filters.industry}
                  onChange={(e) => setFilters({ ...filters, industry: e.target.value })}
                />
              </div>
            </div>

            <Button
              onClick={handleSearch}
              disabled={isSearching || (filters.technologies.length === 0 && filters.processes.length === 0)}
              className="w-full"
              size="lg"
            >
              <Search className="mr-2 h-4 w-4" />
              {isSearching ? "Buscando..." : "Buscar Empresas"}
            </Button>
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">
                  {results.length} {results.length === 1 ? "Resultado" : "Resultados"}
                </h2>
              </div>

              <div className="grid gap-4">
                {results.map((company) => (
                  <div
                    key={company.id}
                    className="bg-card border rounded-lg p-6 hover:border-primary/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedCompany(company.id)}
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-muted rounded-md flex items-center justify-center flex-shrink-0">
                        {company.logo_url ? (
                          <img
                            src={company.logo_url || "/placeholder.svg"}
                            alt={company.name}
                            className="w-full h-full object-cover rounded-md"
                          />
                        ) : (
                          <Building2 className="h-6 w-6 text-muted-foreground" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-lg mb-1">{company.name}</h3>
                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                          {company.industry && (
                            <span className="flex items-center gap-1">
                              <Briefcase className="h-3 w-3" />
                              {company.industry}
                            </span>
                          )}
                          {company.country && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {company.country}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-3 items-center flex-shrink-0">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-primary">{company.signal_count}</div>
                          <div className="text-xs text-muted-foreground">Señales</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold">{company.contact_count}</div>
                          <div className="text-xs text-muted-foreground">Contactos</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedCompany && (
        <CompanyDrawer
          companyId={selectedCompany}
          isOpen={!!selectedCompany}
          onClose={() => setSelectedCompany(null)}
        />
      )}
    </div>
  );
}
