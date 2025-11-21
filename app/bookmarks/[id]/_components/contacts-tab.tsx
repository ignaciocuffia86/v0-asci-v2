"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Users, Loader2, Linkedin, Mail, Search, UserPlus } from "lucide-react"
import { getPrivateContacts, searchDecisionMakers } from "@/app/actions/workspace"
import Link from "next/link"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

export function BookmarkContacts({ companyId }: { companyId: string }) {
  const [contacts, setContacts] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [roleQuery, setRoleQuery] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)

  const loadContacts = async () => {
    setIsLoading(true)
    const data = await getPrivateContacts(companyId)
    setContacts(data)
    setIsLoading(false)
  }

  useEffect(() => {
    loadContacts()
  }, [companyId])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!roleQuery.trim()) return

    setIsSearching(true)
    try {
      await searchDecisionMakers(companyId, roleQuery)
      await loadContacts()
      setDialogOpen(false)
      setRoleQuery("")
    } catch (error) {
      console.error("Failed to search contacts", error)
    } finally {
      setIsSearching(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Tomadores de Decisión</h2>
          <p className="text-sm text-muted-foreground">Prospectos guardados específicamente para tu estrategia.</p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="h-4 w-4 mr-2" />
              Buscar Personas
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Buscar Tomadores de Decisión</DialogTitle>
              <DialogDescription>
                Busca perfiles por cargo (ej: CEO, CTO, Marketing) en nuestra base de datos enriquecida.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSearch}>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="role">Cargo / Rol</Label>
                  <Input
                    id="role"
                    placeholder="Ej: VP of Engineering"
                    value={roleQuery}
                    onChange={(e) => setRoleQuery(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={isSearching || !roleQuery.trim()}>
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Search className="h-4 w-4 mr-2" />
                  )}
                  Buscar y Guardar
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : contacts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 space-y-4 text-center">
            <div className="bg-muted p-3 rounded-full">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-medium">No hay prospectos guardados</h3>
              <p className="text-sm text-muted-foreground max-w-sm mt-1">
                Busca y guarda los perfiles clave para esta cuenta para comenzar.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {contacts.map((contact) => (
            <Card key={contact.id} className="group hover:border-primary/50 transition-colors">
              <CardHeader className="flex flex-row items-start gap-4 space-y-0 pb-2">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={contact.profile_picture_url || "/placeholder.svg"} />
                  <AvatarFallback>
                    {contact.first_name?.[0]}
                    {contact.last_name?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-1">
                  <CardTitle className="text-base font-medium leading-none">{contact.full_name}</CardTitle>
                  <p className="text-sm text-muted-foreground line-clamp-2 h-10">{contact.role}</p>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mt-2">
                  {contact.status === "new" && (
                    <Badge variant="secondary" className="text-xs">
                      Nuevo
                    </Badge>
                  )}
                  {contact.source === "apollo" && (
                    <Badge variant="outline" className="text-xs">
                      Apollo.io
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-4">
                  {contact.email && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 text-xs gap-2 bg-transparent"
                      onClick={() => navigator.clipboard.writeText(contact.email)}
                    >
                      <Mail className="h-3 w-3" />
                      Copiar Email
                    </Button>
                  )}
                  {contact.linkedin_url && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                      <Link href={contact.linkedin_url} target="_blank">
                        <Linkedin className="h-4 w-4 text-[#0077b5]" />
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
