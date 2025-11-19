"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Building2, Globe, Linkedin, Bookmark, ExternalLink } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type CompanyDetails = {
  id: string;
  name: string;
  linkedin_url: string | null;
  website: string | null;
  industry: string | null;
  country: string | null;
  logo_url: string | null;
};

type Signal = {
  id: string;
  signal_type: string;
  keyword_matched: string;
  source_field: string;
  snippet: string;
  contact: {
    full_name: string;
    headline: string;
    profile_picture_url: string | null;
  };
  signal_name: string;
};

type Contact = {
  id: string;
  full_name: string;
  headline: string;
  linkedin_url: string;
  profile_picture_url: string | null;
  signal_count: number;
};

export function CompanyDrawer({
  companyId,
  isOpen,
  onClose,
}: {
  companyId: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [company, setCompany] = useState<CompanyDetails | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (isOpen && companyId) {
      fetchCompanyData();
    }
  }, [companyId, isOpen]);

  const fetchCompanyData = async () => {
    // Fetch company details
    const { data: companyData } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .single();

    setCompany(companyData);

    // Fetch signals with contact and signal name
    const { data: signalsData } = await supabase
      .from("signals")
      .select(`
        id,
        signal_type,
        keyword_matched,
        source_field,
        snippet,
        contacts:contact_id (
          full_name,
          headline,
          profile_picture_url
        )
      `)
      .eq("company_id", companyId)
      .limit(50);

    // Enrich with signal names
    if (signalsData) {
      const enrichedSignals = await Promise.all(
        signalsData.map(async (signal) => {
          let signalName = signal.keyword_matched;
          
          // This is a simplified version - in production we'd need to join properly
          // For now we just use the keyword matched
          
          return {
            ...signal,
            contact: signal.contacts,
            signal_name: signalName,
          };
        })
      );
      setSignals(enrichedSignals as any);
    }

    // Fetch contacts
    const { data: contactsData } = await supabase
      .from("contacts")
      .select("id, full_name, headline, linkedin_url, profile_picture_url")
      .eq("current_company_id", companyId);

    if (contactsData) {
      const contactsWithSignals = await Promise.all(
        contactsData.map(async (contact) => {
          const { count } = await supabase
            .from("signals")
            .select("id", { count: "exact", head: true })
            .eq("contact_id", contact.id);
          return { ...contact, signal_count: count || 0 };
        })
      );
      setContacts(contactsWithSignals);
    }

    // Check if bookmarked
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: bookmark } = await supabase
        .from("bookmarks")
        .select("id")
        .eq("user_id", user.id)
        .eq("company_id", companyId)
        .single();
      setIsBookmarked(!!bookmark);
    }
  };

  const handleBookmark = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (isBookmarked) {
      await supabase
        .from("bookmarks")
        .delete()
        .eq("user_id", user.id)
        .eq("company_id", companyId);
      setIsBookmarked(false);
    } else {
      await supabase
        .from("bookmarks")
        .insert({
          user_id: user.id,
          company_id: companyId,
          priority: "transaccional",
        });
      setIsBookmarked(true);
    }
  };

  if (!company) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
              {company.logo_url ? (
                <img
                  src={company.logo_url || "/placeholder.svg"}
                  alt={company.name}
                  className="w-full h-full object-cover rounded-lg"
                />
              ) : (
                <Building2 className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1">
              <SheetTitle className="text-2xl">{company.name}</SheetTitle>
              <SheetDescription className="mt-1">
                {company.industry && <span>{company.industry}</span>}
                {company.country && <span> · {company.country}</span>}
              </SheetDescription>
              <div className="flex gap-2 mt-3">
                {company.website && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={company.website} target="_blank" rel="noopener noreferrer">
                      <Globe className="h-3 w-3 mr-1" />
                      Web
                    </a>
                  </Button>
                )}
                {company.linkedin_url && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer">
                      <Linkedin className="h-3 w-3 mr-1" />
                      LinkedIn
                    </a>
                  </Button>
                )}
              </div>
            </div>
            <Button
              variant={isBookmarked ? "default" : "outline"}
              size="sm"
              onClick={handleBookmark}
            >
              <Bookmark className={`h-4 w-4 ${isBookmarked ? 'fill-current' : ''}`} />
            </Button>
          </div>
        </SheetHeader>

        <Separator className="my-6" />

        <Tabs defaultValue="signals" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="signals" className="flex-1">
              Señales ({signals.length})
            </TabsTrigger>
            <TabsTrigger value="contacts" className="flex-1">
              Contactos ({contacts.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="signals" className="space-y-4 mt-4">
            {signals.map((signal) => (
              <div key={signal.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={signal.contact?.profile_picture_url || undefined} />
                      <AvatarFallback>
                        {signal.contact?.full_name?.charAt(0) || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium text-sm">{signal.contact?.full_name}</div>
                      <div className="text-xs text-muted-foreground">{signal.contact?.headline}</div>
                    </div>
                  </div>
                  <Badge variant={signal.signal_type === "technology" ? "default" : "secondary"}>
                    {signal.signal_type === "technology" ? "Tech" : "Proceso"}
                  </Badge>
                </div>
                <div className="text-sm">
                  <span className="font-semibold text-primary">"{signal.keyword_matched}"</span>
                  {" en "}
                  <span className="text-muted-foreground">{signal.source_field}</span>
                </div>
                <div className="text-sm text-muted-foreground bg-muted/30 p-2 rounded italic">
                  ...{signal.snippet}...
                </div>
              </div>
            ))}
            {signals.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No hay señales disponibles
              </div>
            )}
          </TabsContent>

          <TabsContent value="contacts" className="space-y-3 mt-4">
            {contacts.map((contact) => (
              <div key={contact.id} className="border rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src={contact.profile_picture_url || undefined} />
                    <AvatarFallback>{contact.full_name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{contact.full_name}</div>
                    <div className="text-sm text-muted-foreground">{contact.headline}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline">{contact.signal_count} señales</Badge>
                  <Button variant="ghost" size="sm" asChild>
                    <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>
              </div>
            ))}
            {contacts.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No hay contactos disponibles
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
