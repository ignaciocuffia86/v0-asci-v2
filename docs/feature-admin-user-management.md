# Feature: Gestion de Usuarios en Admin

## Resumen

ABM completo de usuarios de la plataforma desde el panel de administracion,
utilizando la API admin de Supabase Auth (`supabase.auth.admin.*`).

---

## 1. Alcance Funcional

### 1.1 Alta Individual

**Flujo:**
1. Admin ingresa email del nuevo usuario
2. Opcion: generar password aleatorio o definir password manual
3. Opcion: auto-confirmar email (sin verificacion) o enviar invitacion
4. Opcion: asignar rol inicial (`user` o `admin`)
5. Se crea el usuario en `auth.users` y el trigger existente crea el `profile`

**API Supabase:**
```ts
const { data, error } = await supabase.auth.admin.createUser({
  email: 'user@email.com',
  password: generatedPassword,
  email_confirm: true, // auto-confirma sin email
  user_metadata: { created_by_admin: adminId }
})
```

**Post-creacion:**
- Actualizar `profiles.role` si es distinto de 'user'
- Opcion: enviar email de bienvenida con credenciales (si password generado)

### 1.2 Alta Masiva (Bulk Import)

**Flujo:**
1. Admin pega lista de emails (textarea, uno por linea) o sube CSV
2. Sistema valida formato de emails, detecta duplicados
3. Preview de usuarios a crear con status (nuevo/existente/invalido)
4. Password generico configurable o auto-generado por usuario
5. Procesamiento en background con progress bar
6. Reporte final: creados exitosamente, ya existian, fallaron

**Consideraciones:**
- Maximo 100 usuarios por batch (limite razonable para admin manual)
- Rate limiting: 1 creacion por 100ms para no saturar Supabase Auth
- Log de auditoria con admin que realizo el import

**Tabla de soporte (nueva):**
```sql
CREATE TABLE admin_user_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES profiles(id),
  total_emails INTEGER NOT NULL,
  created_count INTEGER DEFAULT 0,
  existing_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
  results JSONB, -- detalle por email
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.3 Modificacion de Usuario

**Campos editables:**
- **Email:** Cambio directo via `updateUserById({ email: 'new@email.com' })`
  - Supabase envia email de confirmacion al nuevo email por defecto
  - Opcion admin: forzar cambio sin confirmacion (`email_confirm: true`)
- **Password:** Reset a password temporal via `updateUserById({ password: 'temp123' })`
  - Opcion: forzar cambio en proximo login (guardar flag en `app_metadata`)
- **Rol:** Editar `profiles.role` (user/admin)
- **Metadata:** Editar `full_name`, `company`, `value_proposition` en profiles

**No editable desde admin:**
- Password actual (no visible, solo reseteable)

### 1.4 Reset de Password

**Dos modalidades:**

1. **Enviar email de reset:**
   - Usa el flow estandar de Supabase
   - `await supabase.auth.resetPasswordForEmail(email)`
   - Usuario recibe link para definir nuevo password

2. **Definir password temporal:**
   - Admin define password temporal
   - `await supabase.auth.admin.updateUserById(id, { password: 'temp123' })`
   - Opcion: marcar `app_metadata.force_password_change = true`
   - El middleware/app detecta este flag y redirige a cambio de password

### 1.5 Bloqueo de Usuario (Ban)

**Flujo:**
```ts
// Ban temporal (ej: 30 dias)
await supabase.auth.admin.updateUserById(userId, { 
  ban_duration: '720h' // 30 dias
})

// Ban permanente
await supabase.auth.admin.updateUserById(userId, { 
  ban_duration: 'none' // o un valor muy largo como '876000h' (100 años)
})

// Desbloquear
await supabase.auth.admin.updateUserById(userId, { 
  ban_duration: 'none'
})
```

**Efecto:**
- `auth.users.banned_until` se setea
- Usuario no puede hacer login hasta que expire o se desbloquee
- Sesiones existentes siguen activas hasta expirar (considerar invalidar)

**UI:**
- Mostrar estado de ban en la lista de usuarios
- Permitir definir duracion: 1 dia, 7 dias, 30 dias, permanente, custom
- Mostrar fecha de expiracion del ban

### 1.6 Eliminacion de Usuario

**Soft Delete (Recomendado - 30 dias retencion):**
```ts
// Supabase Auth soporta soft delete nativo
await supabase.auth.admin.deleteUser(userId, { 
  shouldSoftDelete: true 
})
```

**Efecto:**
- `auth.users.deleted_at` se setea
- Usuario no puede hacer login
- Datos en `profiles` y tablas relacionadas permanecen intactos
- Despues de 30 dias, Supabase elimina permanentemente (configurable)

**Hard Delete (Inmediato):**
```ts
await supabase.auth.admin.deleteUser(userId)
```
- Elimina permanentemente de `auth.users`
- CASCADE en `profiles` elimina el perfil
- Considerar: soft delete en tablas relacionadas (bookmarks, strategies, etc)

**Restauracion (dentro de 30 dias):**
- No hay API directa de restore en Supabase Auth
- Workaround: crear nuevo usuario con mismo email, migrar datos

---

## 2. Features de Valor Agregado

### 2.1 Audit Log de Acciones Admin

**Tabla:**
```sql
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL, -- create_user, update_user, ban_user, delete_user, bulk_import
  target_user_id UUID, -- usuario afectado
  target_email TEXT, -- email del usuario (para auditar incluso si se elimino)
  details JSONB, -- cambios realizados
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_admin ON admin_audit_log(admin_id);
CREATE INDEX idx_audit_log_target ON admin_audit_log(target_user_id);
CREATE INDEX idx_audit_log_action ON admin_audit_log(action);
CREATE INDEX idx_audit_log_date ON admin_audit_log(created_at DESC);
```

**Eventos a loguear:**
- Creacion de usuario (individual y bulk)
- Cambio de email
- Reset de password
- Cambio de rol
- Ban/unban
- Soft delete / hard delete

### 2.2 Dashboard de Usuarios

**Metricas:**
- Total usuarios activos
- Usuarios creados ultimo mes
- Usuarios baneados actualmente
- Usuarios eliminados (soft) pendientes de purga
- Usuarios por rol (user/admin)
- Usuarios sin login en 30+ dias (inactivos)

### 2.3 Filtros y Busqueda Avanzada

**Filtros:**
- Por estado: activo, baneado, eliminado (soft)
- Por rol: user, admin
- Por fecha de creacion: rango
- Por ultimo login: activos/inactivos
- Por onboarding: completado/pendiente/skipped

**Busqueda:**
- Por email (parcial)
- Por nombre completo
- Por empresa

### 2.4 Acciones Bulk en Lista

**Desde la tabla de usuarios:**
- Seleccionar multiples usuarios
- Acciones disponibles:
  - Banear seleccionados
  - Desbanear seleccionados
  - Eliminar seleccionados (soft)
  - Cambiar rol de seleccionados
  - Enviar email de reset a seleccionados

### 2.5 Invitaciones Pendientes

**Tracking de invitaciones:**
- Usuarios creados con `email_confirm: false` tienen `email_confirmed_at = null`
- Mostrar lista de invitaciones pendientes
- Permitir re-enviar invitacion
- Permitir cancelar invitacion (eliminar usuario no confirmado)

### 2.6 Impersonacion (Login como Usuario)

**Feature avanzada (opcional):**
- Admin puede "loguearse como" otro usuario para debug
- Genera sesion temporal con flag `impersonated_by: adminId`
- Toda la actividad se loguea como impersonada
- Boton visible para "volver a admin"

**Implementacion:**
```ts
// Generar link magico para el usuario
const { data, error } = await supabase.auth.admin.generateLink({
  type: 'magiclink',
  email: userEmail,
})
// Admin abre el link en ventana nueva
```

### 2.7 Notificaciones de Seguridad

**Alertas automaticas:**
- Usuario intenta login 5+ veces fallido -> notificar admin
- Usuario baneado intenta login -> loguear
- Nuevo admin creado -> notificar otros admins

### 2.8 Export de Usuarios

**Formatos:**
- CSV con campos seleccionables
- JSON completo

**Campos exportables:**
- Email, nombre, empresa, rol, fecha creacion, ultimo login, estado

---

## 3. Arquitectura Tecnica

### 3.1 API Routes (Server Actions)

```
app/api/admin/users/
├── route.ts              # GET list, POST create
├── [id]/route.ts         # GET one, PATCH update, DELETE
├── [id]/ban/route.ts     # POST ban, DELETE unban
├── [id]/reset-password/route.ts  # POST send reset / set temp
├── bulk-import/route.ts  # POST import multiple
└── export/route.ts       # GET export CSV/JSON
```

### 3.2 Componentes UI

```
app/admin/users/
├── page.tsx                    # Lista principal con filtros
├── _components/
│   ├── users-table.tsx         # Tabla con seleccion multiple
│   ├── user-filters.tsx        # Filtros y busqueda
│   ├── user-stats-cards.tsx    # Metricas dashboard
│   ├── create-user-dialog.tsx  # Modal crear usuario
│   ├── edit-user-dialog.tsx    # Modal editar usuario
│   ├── bulk-import-dialog.tsx  # Modal import masivo
│   ├── ban-user-dialog.tsx     # Modal banear con duracion
│   ├── delete-user-dialog.tsx  # Modal eliminar con confirmacion
│   └── bulk-actions-toolbar.tsx # Toolbar acciones masivas
```

### 3.3 Seguridad

**Validaciones:**
- Solo usuarios con `profiles.role = 'admin'` pueden acceder
- Middleware verifica rol en cada request
- Admin no puede eliminarse a si mismo
- Admin no puede quitarse rol admin a si mismo (evita lock-out)
- Todos los endpoints usan `supabase.auth.admin.*` (requiere service_role)

**Service Role Key:**
- Se usa SOLO en server-side (API routes)
- Nunca exponer al cliente
- Crear cliente con service_role solo para operaciones admin

```ts
// lib/supabase/admin.ts
import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
```

---

## 4. Orden de Implementacion

### Fase 1: Core CRUD
1. Migration: crear `admin_audit_log` y `admin_user_imports`
2. API routes basicas: list, create, update, delete
3. UI: tabla de usuarios con paginacion
4. UI: dialogs para crear/editar usuario individual

### Fase 2: Ban y Soft Delete
5. API: ban/unban con duracion
6. API: soft delete con 30 dias retencion
7. UI: dialogs de ban y delete con confirmaciones
8. UI: filtros por estado (activo/baneado/eliminado)

### Fase 3: Bulk Operations
9. API: bulk import de emails
10. UI: dialog de import masivo con preview
11. UI: bulk actions toolbar (ban/delete multiples)
12. API: export CSV/JSON

### Fase 4: Observabilidad
13. Audit log integration en todas las acciones
14. UI: seccion de audit log con filtros
15. Dashboard de metricas de usuarios
16. Alertas de seguridad (opcional)

---

## 5. Consideraciones UX

### Confirmaciones
- Eliminar usuario: doble confirmacion (escribir email del usuario)
- Ban permanente: confirmacion explicita
- Bulk delete: mostrar cantidad y pedir confirmacion

### Feedback
- Toast de exito/error en cada accion
- Progress bar en operaciones bulk
- Indicadores de estado claros (badges de color)

### Estados Visuales
- **Activo:** badge verde
- **Baneado:** badge rojo con fecha de expiracion
- **Eliminado (soft):** badge gris, fila atenuada
- **Invitacion pendiente:** badge amarillo
- **Admin:** badge azul distintivo

---

## 6. Integracion con Sistema Existente

### Sidebar Admin
Agregar item "Usuarios" en `admin-sidebar.tsx`:
```ts
{
  title: "Usuarios",
  href: "/admin/users",
  icon: UserCog,
}
```

### Middleware
El middleware existente ya protege `/admin/*` para roles admin.
Solo necesita verificar que el usuario que accede tenga `profiles.role = 'admin'`.

### Profiles Trigger
El trigger existente `handle_new_user` ya crea el profile cuando se crea
un usuario en auth. Solo asegurar que funcione con usuarios creados via admin API.
