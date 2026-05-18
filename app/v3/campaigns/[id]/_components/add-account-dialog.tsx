"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Building2, Globe, Loader2 } from "lucide-react";
import { searchCompanies, addAccountToCampaign } from "@/app/actions/v3/campaigns";
import { useDebouncedCallback } from "use-debounce";

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onSuccess: () => void;
}

interface SearchResult {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
}

export function AddAccountDialog({
  open,
  onOpenChange,
  campaignId,
  onSuccess,
}: AddAccountDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const debouncedSearch = useDebouncedCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    const data = await searchCompanies(searchQuery);
    setResults(data);
    setIsSearching(false);
  }, 300);

  useEffect(() => {
    debouncedSearch(query);
  }, [query, debouncedSearch]);

  const handleAdd = async (companyId: string) => {
    setIsAdding(companyId);
    setError(null);

    const result = await addAccountToCampaign(campaignId, companyId, "manual");

    if (result.success) {
      onSuccess();
      onOpenChange(false);
      setQuery("");
      setResults([]);
    } else {
      setError(result.error || "Error al agregar cuenta");
    }

    setIsAdding(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar Cuenta</DialogTitle>
          <DialogDescription>
            Busca una empresa por nombre o dominio para agregarla a la campana
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Buscar empresa..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="max-h-64 overflow-y-auto">
            {isSearching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : results.length > 0 ? (
              <div className="flex flex-col gap-1">
                {results.map((company) => (
                  <div
                    key={company.id}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-muted p-2">
                        <Building2 className="size-4 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="font-medium">{company.name}</div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          {company.domain && (
                            <>
                              <Globe className="size-3" />
                              <span>{company.domain}</span>
                            </>
                          )}
                          {company.industry && (
                            <>
                              <span>•</span>
                              <span>{company.industry}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleAdd(company.id)}
                      disabled={isAdding === company.id}
                    >
                      {isAdding === company.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Agregar"
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            ) : query.length >= 2 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Building2 className="size-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  No se encontraron empresas con ese nombre
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Search className="size-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  Escribe al menos 2 caracteres para buscar
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
