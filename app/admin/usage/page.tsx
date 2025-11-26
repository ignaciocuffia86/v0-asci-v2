import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Users, Bookmark, TrendingUp, DollarSign } from "lucide-react"

export default async function AdminUsagePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

  if (profile?.role !== "superadmin") {
    redirect("/")
  }

  const adminClient = createAdminClient()
  const {
    data: { users: authUsers },
  } = await adminClient.auth.admin.listUsers()

  // Obtener todos los bookmarks
  const { data: bookmarks } = await supabase.from("bookmarks").select("user_id, priority")

  const userStats = (authUsers || []).map((authUser) => {
    const userBookmarks = (bookmarks || []).filter((b) => b.user_id === authUser.id)

    return {
      user_id: authUser.id,
      user_email: authUser.email || "Sin email",
      created_at: authUser.created_at,
      total_bookmarks: userBookmarks.length,
      high_priority: userBookmarks.filter((b) => b.priority === "alta").length,
      medium_priority: userBookmarks.filter((b) => b.priority === "media").length,
      low_priority: userBookmarks.filter((b) => b.priority === "baja").length,
      no_priority: userBookmarks.filter((b) => !b.priority || !["alta", "media", "baja"].includes(b.priority)).length,
    }
  })

  // Calcular totales
  const totalUsers = userStats.length
  const usersWithBookmarks = userStats.filter((u) => u.total_bookmarks > 0).length
  const totalBookmarks = userStats.reduce((sum, u) => sum + u.total_bookmarks, 0)
  const totalHighPriority = userStats.reduce((sum, u) => sum + u.high_priority, 0)

  // Costo estimado: $0.50 por bookmark alta prioridad por mes (2 búsquedas quincenales)
  const estimatedMonthlyCost = totalHighPriority * 0.5

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Uso por Usuario</h1>
        <p className="text-muted-foreground mt-2">
          Métricas de bookmarks y prioridades para estimar costos de búsqueda AI
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Usuarios Totales</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalUsers}</div>
            <p className="text-xs text-muted-foreground">{usersWithBookmarks} con bookmarks</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Bookmarks</CardTitle>
            <Bookmark className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalBookmarks}</div>
            <p className="text-xs text-muted-foreground">en toda la plataforma</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alta Prioridad</CardTitle>
            <TrendingUp className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{totalHighPriority}</div>
            <p className="text-xs text-muted-foreground">con cron de noticias activo</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Costo Est. Mensual</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">${estimatedMonthlyCost.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">Perplexity (alta prioridad)</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla de usuarios */}
      <Card>
        <CardHeader>
          <CardTitle>Detalle por Usuario</CardTitle>
          <CardDescription>Distribución de bookmarks y prioridades por cada usuario</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Registro</TableHead>
                <TableHead className="text-center">Total</TableHead>
                <TableHead className="text-center">Alta</TableHead>
                <TableHead className="text-center">Media</TableHead>
                <TableHead className="text-center">Baja</TableHead>
                <TableHead className="text-center">Sin Prioridad</TableHead>
                <TableHead className="text-right">Costo Est.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {userStats.map((user) => (
                <TableRow key={user.user_id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{user.user_email}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString("es-AR") : "-"}
                  </TableCell>
                  <TableCell className="text-center font-medium">{user.total_bookmarks}</TableCell>
                  <TableCell className="text-center">
                    {user.high_priority > 0 ? (
                      <Badge variant="destructive">{user.high_priority}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {user.medium_priority > 0 ? (
                      <Badge variant="secondary">{user.medium_priority}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {user.low_priority > 0 ? (
                      <Badge variant="outline">{user.low_priority}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center text-muted-foreground">{user.no_priority}</TableCell>
                  <TableCell className="text-right font-medium">${(user.high_priority * 0.5).toFixed(2)}</TableCell>
                </TableRow>
              ))}
              {userStats.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No hay usuarios registrados
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Nota sobre costos */}
      <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
        <CardContent className="pt-6">
          <h4 className="font-medium text-blue-900 dark:text-blue-100">Cálculo de costos</h4>
          <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
            El costo estimado se basa en ~$0.50/bookmark/mes para bookmarks de alta prioridad (2 búsquedas Perplexity
            quincenales). Los bookmarks de prioridad media y baja solo generan costos cuando el usuario hace búsquedas
            manuales.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
