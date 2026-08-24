"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Trash2, ChevronRight, ChevronDown, X, Pencil } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import { EditKeywordsDialog } from "./edit-keywords-dialog"

type Vendor = {
  id: string
  name: string
  products?: Product[]
}

type Product = {
  id: string
  name: string
  keywords: string[]
  vendor_id: string
  categoria: string | null
  ciclo_vida: string | null
}

/**
 * El diccionario tiene tres ejes (ver docs/rediseno-taxonomia-diccionario.md):
 * vendor (quién te lo vende), categoría (para qué sirve) y ciclo de vida
 * (si es oportunidad de modernización). El ABM agrupa por los dos primeros;
 * el tercero se muestra como marca en cada producto.
 */
type Agrupacion = "vendor" | "categoria"

type Grupo = {
  id: string
  name: string
  products: Product[]
  /** Solo los grupos por vendor se pueden borrar o recibir productos nuevos. */
  esVendor: boolean
}

export function VendorsTable() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null)
  const [agrupacion, setAgrupacion] = useState<Agrupacion>("vendor")
  const [sinVendor, setSinVendor] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const supabase = createClient()

  const fetchData = async () => {
    setIsLoading(true)
    const { data: vendorsData } = await supabase.from("dictionary_vendors").select("*").order("name")

    if (vendorsData) {
      const vendorsWithProducts = await Promise.all(
        vendorsData.map(async (vendor: any) => {
          const { data: products } = await supabase
            .from("dictionary_products")
            .select("*")
            .eq("vendor_id", vendor.id)
            .order("name")
          return { ...vendor, products: products || [] }
        }),
      )
      setVendors(vendorsWithProducts)
    }

    // Los productos open source no tienen vendor. Antes del rediseño colgaban de
    // los vendors ficticios (Backend, Frontend, Legacy, CMS); ahora tienen
    // vendor_id NULL y sin esto quedarían invisibles en el ABM.
    const { data: huerfanos } = await supabase
      .from("dictionary_products")
      .select("*")
      .is("vendor_id", null)
      .order("name")
    setSinVendor(huerfanos || [])

    setIsLoading(false)
  }

  useEffect(() => {
    fetchData()
  }, [])

  const addVendor = async (name: string) => {
    await supabase.from("dictionary_vendors").insert({ name })
    fetchData()
  }

  const deleteVendor = async (id: string) => {
    if (confirm("¿Estás seguro? Esto eliminará todos los productos asociados.")) {
      await supabase.from("dictionary_vendors").delete().eq("id", id)
      fetchData()
    }
  }

  const addProduct = async (vendorId: string, name: string, keywords: string[]) => {
    // 1. Insertar el producto y obtener el ID
    const { data: newProduct, error: insertError } = await supabase
      .from("dictionary_products")
      .insert({
        vendor_id: vendorId,
        name,
        keywords,
      })
      .select("id")
      .single()

    if (insertError || !newProduct) {
      console.error("Error creating product:", insertError)
      fetchData()
      return
    }

    // 2. Crear jobs para cada keyword del nuevo producto
    const jobs = keywords.map((keyword) => ({
      job_type: "add_keyword",
      signal_id: newProduct.id,
      signal_type: "technology",
      keyword: keyword,
      status: "pending",
    }))

    if (jobs.length > 0) {
      const { error: jobsError } = await supabase.from("dictionary_jobs").insert(jobs)
      if (jobsError) {
        console.error("Error creating keyword jobs:", jobsError)
      } else {
        console.log(`Created ${jobs.length} keyword jobs for new product: ${name}`)
      }
    }

    fetchData()
  }

  const deleteProduct = async (id: string) => {
    await supabase.from("dictionary_products").delete().eq("id", id)
    fetchData()
  }

  const todosLosProductos: Product[] = [...vendors.flatMap((v) => v.products || []), ...sinVendor]

  const grupos: Grupo[] =
    agrupacion === "vendor"
      ? [
          ...vendors.map((v) => ({ id: v.id, name: v.name, products: v.products || [], esVendor: true })),
          ...(sinVendor.length > 0
            ? [{ id: "__sin_vendor__", name: "Sin vendor (open source)", products: sinVendor, esVendor: false }]
            : []),
        ]
      : Object.entries(
          todosLosProductos.reduce<Record<string, Product[]>>((acc, p) => {
            const k = p.categoria || "Sin categoría"
            ;(acc[k] ||= []).push(p)
            return acc
          }, {}),
        )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, products]) => ({
            id: `cat:${name}`,
            name,
            products: products.sort((a, b) => a.name.localeCompare(b.name)),
            esVendor: false,
          }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          {(["vendor", "categoria"] as const).map((eje) => (
            <Button
              key={eje}
              variant={agrupacion === eje ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setAgrupacion(eje)
                setExpandedVendor(null)
              }}
            >
              {eje === "vendor" ? "Por vendor" : "Por categoría"}
            </Button>
          ))}
        </div>
        <AddVendorDialog onAdd={addVendor} />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]"></TableHead>
              <TableHead>{agrupacion === "vendor" ? "Vendor" : "Categoría"}</TableHead>
              <TableHead>Productos</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grupos.map((vendor) => (
              <>
                <TableRow key={vendor.id} className="group">
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedVendor(expandedVendor === vendor.id ? null : vendor.id)}
                    >
                      {expandedVendor === vendor.id ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="font-medium">{vendor.name}</TableCell>
                  <TableCell>{vendor.products?.length || 0}</TableCell>
                  <TableCell className="text-right">
                    {vendor.esVendor && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteVendor(vendor.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {expandedVendor === vendor.id && (
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={4} className="p-4">
                      <div className="space-y-4 pl-10">
                        <div className="flex justify-between items-center">
                          <h4 className="text-sm font-semibold">Productos de {vendor.name}</h4>
                          {vendor.esVendor && <AddProductDialog vendorId={vendor.id} onAdd={addProduct} />}
                        </div>

                        {vendor.products && vendor.products.length > 0 ? (
                          <div className="grid gap-4">
                            {vendor.products.map((product) => (
                              <div
                                key={product.id}
                                className="flex items-start justify-between p-3 bg-background border rounded-md"
                              >
                                <div className="flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-sm">{product.name}</span>
                                    {agrupacion === "vendor" && product.categoria && (
                                      <Badge variant="outline" className="text-[10px] font-normal">
                                        {product.categoria}
                                      </Badge>
                                    )}
                                    {product.ciclo_vida === "legado" && (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] font-normal border-amber-500/60 text-amber-700 dark:text-amber-400"
                                      >
                                        legado
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {product.keywords?.map((kw, i) => (
                                      <Badge key={i} variant="secondary" className="text-xs">
                                        {kw}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    onClick={() => setEditingProduct(product)}
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive h-6 w-6 p-0"
                                    onClick={() => deleteProduct(product.id)}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground italic">No hay productos configurados.</div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
            {!isLoading && grupos.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                  No hay {agrupacion === "vendor" ? "vendors" : "categorías"} configuradas.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {editingProduct && (
        <EditKeywordsDialog
          open={!!editingProduct}
          onOpenChange={(open) => !open && setEditingProduct(null)}
          itemId={editingProduct.id}
          itemName={editingProduct.name}
          itemType="product"
          currentKeywords={editingProduct.keywords || []}
          onSave={fetchData}
        />
      )}
    </div>
  )
}

function AddVendorDialog({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("")
  const [open, setOpen] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) {
      onAdd(name)
      setName("")
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Agregar Vendor
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar Nuevo Vendor</DialogTitle>
          <DialogDescription>Ingresa el nombre de la empresa proveedora de tecnología.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Salesforce, Microsoft, Oracle"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim()}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddProductDialog({
  vendorId,
  onAdd,
}: { vendorId: string; onAdd: (vid: string, name: string, kws: string[]) => void }) {
  const [name, setName] = useState("")
  const [keywords, setKeywords] = useState("")
  const [open, setOpen] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) {
      const kwList = keywords
        .split(/[,;]/)
        .map((k) => k.trim())
        .filter((k) => k)
      if (!kwList.includes(name.trim())) {
        kwList.unshift(name.trim())
      }
      onAdd(vendorId, name, kwList)
      setName("")
      setKeywords("")
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-2 h-3 w-3" />
          Agregar Producto
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar Producto</DialogTitle>
          <DialogDescription>Define el producto y sus sinónimos.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="prod-name">Nombre del Producto</Label>
              <Input
                id="prod-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Sales Cloud"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="keywords">Sinónimos / Keywords</Label>
              <Input
                id="keywords"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="Ej: SFDC; Salesforce CRM (separar por ; o ,)"
              />
              <p className="text-xs text-muted-foreground">
                El nombre del producto se incluye automáticamente. Usa punto y coma (;) o coma (,) para separar.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim()}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
