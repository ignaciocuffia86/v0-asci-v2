"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Eye, Search, Sparkles, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { createCampaign, type CampaignType } from "@/app/actions/v3/campaigns";

const CAMPAIGN_TYPES: {
  value: CampaignType;
  label: string;
  description: string;
  icon: typeof Eye;
  features: string[];
}[] = [
  {
    value: "monitorear",
    label: "Monitoreo",
    description: "Seguimiento de senales y noticias de cuentas conocidas",
    icon: Eye,
    features: ["Noticias y senales", "Alertas de cambios", "Sin prospeccion activa"],
  },
  {
    value: "prospectar",
    label: "Prospeccion",
    description: "Busqueda activa de decision makers en cuentas target",
    icon: Search,
    features: ["Tech Radar", "Busqueda en Apollo", "Recomendacion de cargos", "Email agent"],
  },
  {
    value: "descubrir",
    label: "Descubrimiento",
    description: "ASCI recomienda nuevas cuentas basado en tu perfil",
    icon: Sparkles,
    features: ["Recomendaciones de ASCI", "Filtro por senales", "Blacklist de cuentas"],
  },
];

export function NewCampaignForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<CampaignType>("monitorear");
  const [buyerPersona, setBuyerPersona] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedType = CAMPAIGN_TYPES.find((t) => t.value === type)!;
  const showBuyerPersona = type !== "monitorear";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("El nombre es requerido");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await createCampaign({
      name: name.trim(),
      type,
      buyer_persona_text: showBuyerPersona ? buyerPersona.trim() : undefined,
    });

    if (result.success && result.campaignId) {
      router.push(`/v3/campaigns/${result.campaignId}`);
    } else {
      setError(result.error || "Error al crear la campana");
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" className="w-fit" asChild>
        <Link href="/v3/campaigns">
          <ArrowLeft data-icon="inline-start" />
          Volver a campanas
        </Link>
      </Button>

      {/* Nombre */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Nombre de la campana</Label>
        <Input
          id="name"
          placeholder="Ej: Enterprise Q1 2025"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      {/* Tipo */}
      <div className="flex flex-col gap-3">
        <Label>Tipo de campana</Label>
        <RadioGroup
          value={type}
          onValueChange={(v) => setType(v as CampaignType)}
          className="grid gap-3"
        >
          {CAMPAIGN_TYPES.map((campaignType) => {
            const Icon = campaignType.icon;
            const isSelected = type === campaignType.value;

            return (
              <label
                key={campaignType.value}
                className={`relative flex cursor-pointer rounded-lg border p-4 transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <RadioGroupItem
                  value={campaignType.value}
                  className="sr-only"
                  disabled={isSubmitting}
                />
                <div className="flex gap-4">
                  <div
                    className={`rounded-lg p-2 h-fit ${
                      isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{campaignType.label}</div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      {campaignType.description}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {campaignType.features.map((feature) => (
                        <span
                          key={feature}
                          className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </label>
            );
          })}
        </RadioGroup>
      </div>

      {/* Buyer Persona (solo para prospectar/descubrir) */}
      {showBuyerPersona && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="buyer-persona">Buyer Persona (opcional)</Label>
          <Textarea
            id="buyer-persona"
            placeholder="Ej: CTOs y VPs de Engineering en empresas SaaS B2B de 50-500 empleados en LATAM"
            value={buyerPersona}
            onChange={(e) => setBuyerPersona(e.target.value)}
            disabled={isSubmitting}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            Describe el perfil de los decision makers que buscas. ASCI usara esto para recomendar
            cargos relevantes.
          </p>
        </div>
      )}

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">{error}</div>
      )}

      <div className="flex justify-end gap-3">
        <Button variant="outline" type="button" asChild disabled={isSubmitting}>
          <Link href="/v3/campaigns">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={isSubmitting || !name.trim()}>
          {isSubmitting ? "Creando..." : "Crear Campana"}
        </Button>
      </div>
    </form>
  );
}
