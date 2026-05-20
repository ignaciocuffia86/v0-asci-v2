# V3 MVP - Status de Implementacion

**Ultima actualizacion:** 2025-05-18
**Build Status:** 0 errores de tipos en archivos de v3. Build falla por error de v2 (PARALLEL_API_KEY en `/api/research/implementations`) que no afecta a v3.

---

## Resumen por Fase

| Fase | Descripcion | Status | Notas |
|------|-------------|--------|-------|
| 0 | Schema y Fundacion | COMPLETO | Scripts ejecutados en Supabase |
| 1 | Auth y Workspace | COMPLETO | Falta probar flujo completo |
| 2 | Documentos | COMPLETO | Reutiliza Supabase Storage de v2 |
| 3 | Campanas y Cuentas | COMPLETO | CSV matching implementado |
| 4 | Digest y Senales | COMPLETO | Lee cache compartido de v2 |
| 5 | Tech Radar y Apollo | COMPLETO | Reutiliza APIs de v2 |
| 6 | MCP Server | COMPLETO | 9 endpoints implementados |
| 7 | UI/UX Polish | PARCIAL | Falta testing completo |

---

## Archivos Creados por Fase

### Fase 0: Schema
- `scripts/200_v3_schema.sql` - Schema completo con 14 tablas
- `scripts/201_v3_rls.sql` - Row Level Security policies
- `scripts/202_v3_seed_job_titles.sql` - Seed de job titles

### Fase 1: Auth y Workspace
- `lib/v3/workspace.ts` - Logica de workspaces
- `app/actions/v3/workspace.ts` - Server actions
- `app/api/v3/workspace/route.ts` - API route
- `app/v3/layout.tsx` - Layout con auth check
- `app/v3/page.tsx` - Pagina index con redirect
- `app/v3/onboarding/page.tsx` - Onboarding page
- `app/v3/onboarding/_components/onboarding-form.tsx`
- `app/v3/onboarding/_components/pending-approval.tsx`

### Fase 2: Documentos
- `app/actions/v3/documents.ts` - CRUD de documentos
- `app/api/v3/documents/process/route.ts` - Procesamiento
- `app/v3/docs/page.tsx` - Pagina de documentos
- `app/v3/docs/_components/documents-view.tsx`
- `app/v3/docs/_components/upload-document-dialog.tsx`

### Fase 3: Campanas y Cuentas
- `app/actions/v3/campaigns.ts` - CRUD de campanas
- `app/actions/v3/csv-import.ts` - Import y matching de CSV
- `app/v3/campaigns/page.tsx` - Lista de campanas
- `app/v3/campaigns/_components/campaigns-view.tsx`
- `app/v3/campaigns/new/page.tsx` - Crear campana
- `app/v3/campaigns/new/_components/new-campaign-form.tsx`
- `app/v3/campaigns/[id]/page.tsx` - Detalle de campana
- `app/v3/campaigns/[id]/layout.tsx`
- `app/v3/campaigns/[id]/_components/campaign-detail-view.tsx`
- `app/v3/campaigns/[id]/_components/add-account-dialog.tsx`
- `app/v3/campaigns/[id]/_components/csv-import-dialog.tsx`
- `app/v3/campaigns/[id]/import/page.tsx` - Revision de CSV
- `app/v3/campaigns/[id]/import/_components/csv-review-view.tsx`

### Fase 4: Digest y Senales
- `lib/v3/cache-reader.ts` - Lectura de cache compartido
- `lib/v3/digest.ts` - Generacion de digest
- `app/v3/campaigns/[id]/_components/campaign-layout-client.tsx`
- `app/v3/campaigns/[id]/_components/account-list-sidebar.tsx`
- `app/v3/campaigns/[id]/_components/copilot-panel.tsx`
- `app/v3/campaigns/[id]/accounts/[accountId]/page.tsx`
- `app/v3/campaigns/[id]/accounts/[accountId]/_components/digest-view.tsx`

### Fase 5: Tech Radar y Apollo
- `app/actions/v3/tech-radar.ts` - Wrapper de Tech Radar
- `app/actions/v3/apollo.ts` - Busqueda de DMs
- `app/v3/campaigns/[id]/accounts/[accountId]/_components/prospection-actions.tsx`

### Fase 6: MCP Server
- `app/actions/v3/api-keys.ts` - Gestion de API keys
- `lib/v3/mcp-auth.ts` - Middleware de autenticacion
- `app/api/v3/mcp/route.ts` - Manifest
- `app/api/v3/mcp/tools/list-campaigns/route.ts`
- `app/api/v3/mcp/tools/list-accounts/route.ts`
- `app/api/v3/mcp/tools/get-account-digest/route.ts`
- `app/api/v3/mcp/tools/get-signals/route.ts`
- `app/api/v3/mcp/tools/get-contacts/route.ts`
- `app/api/v3/mcp/tools/search-companies/route.ts`
- `app/api/v3/mcp/tools/run-tech-radar/route.ts`
- `app/api/v3/mcp/tools/search-decision-makers/route.ts`
- `app/api/v3/mcp/tools/get-recommended-job-titles/route.ts`
- `app/v3/settings/api-keys/page.tsx`
- `app/v3/settings/api-keys/_components/api-keys-view.tsx`

### Fase 7: UI/UX
- `app/globals.css` - Tokens de v3-theme y signal colors
- `components/v3/navbar.tsx` - Navegacion principal
- `components/v3/command-palette.tsx` - Command palette (Cmd+K)
- `app/v3/settings/layout.tsx` - Layout de settings
- `app/v3/settings/page.tsx` - Settings general
- `app/v3/settings/workspace/page.tsx`
- `app/v3/settings/workspace/_components/workspace-settings-view.tsx`

---

## Funcionalidades Pendientes (Por Prioridad)

### Alta Prioridad (Necesarios para funcionar)

1. **Probar flujo completo de onboarding**
   - Crear workspace
   - Subir primer documento
   - Verificar que se procesa correctamente

2. **Probar creacion de campana**
   - Crear campana tipo "monitorear"
   - Agregar cuenta manualmente
   - Verificar que aparece en lista

3. **Probar CSV import**
   - Subir CSV con nombres/dominios
   - Verificar matching fuzzy
   - Confirmar/ignorar matches

4. **Probar digest de cuenta**
   - Navegar a cuenta
   - Ver datos del cache (si existen)
   - Ejecutar Tech Radar
   - Ejecutar busqueda Apollo

### Media Prioridad (Mejoras importantes)

5. **Workspace Members**
   - Implementar `inviteMember` action
   - Implementar `removeMember` action
   - UI de invitacion por email

6. **Buyer Personas**
   - UI para crear/editar buyer personas
   - Asociar buyer persona a campana
   - Usar en recomendacion de job titles

7. **Notificaciones**
   - Toast de exito/error en todas las acciones
   - Feedback visual de estados de carga

### Baja Prioridad (Nice to have)

8. **Command Palette mejorado**
   - Buscar cuentas directamente
   - Acciones rapidas (crear campana, etc.)

9. **Keyboard shortcuts**
   - Navegacion por teclado en listas
   - Atajos para acciones comunes

10. **Mobile responsive**
    - Bottom sheet para sidebar en mobile
    - Touch-friendly interactions

---

## Bugs Conocidos

### Criticos
- Ninguno identificado

### Medios
1. **Workspace Settings** - Boton "Remover" miembro esta comentado (falta action)
2. **Invite Member** - Muestra toast "en desarrollo" (falta action)

### Menores
1. **Date formatting** - Algunas fechas no tienen locale en espanol

---

## Type Casts y Placeholders (Deuda Tecnica)

Los siguientes archivos usan `as any` o `as unknown as` para evitar errores de tipos.
Deben ser corregidos con tipos correctos en iteraciones futuras:

| Archivo | Linea | Descripcion |
|---------|-------|-------------|
| `app/v3/campaigns/[id]/_components/account-list-sidebar.tsx` | 55 | `result as unknown as Account[]` - El tipo `CampaignAccount[]` no coincide con `Account[]` local |
| `app/v3/campaigns/[id]/accounts/[accountId]/page.tsx` | 55 | `campaignAccount as any` - El tipo devuelto por la query no coincide con `DigestViewProps` |
| `app/v3/settings/workspace/page.tsx` | 27 | `members as any` - El tipo devuelto por `getWorkspaceMembers` no coincide |
| `app/api/v3/mcp/tools/get-account-digest/route.ts` | 66 | `account.v3_campaigns as any` - Relacion de Supabase no tipada |
| `app/api/v3/mcp/tools/run-tech-radar/route.ts` | 59, 92 | `v3_campaigns as any`, `companies as any` |
| `app/api/v3/mcp/tools/search-decision-makers/route.ts` | 59 | `v3_campaigns as any` |
| `app/api/v3/mcp/tools/get-recommended-job-titles/route.ts` | 54, 72 | `v3_campaigns as any`, `companies as any` |
| `lib/v3/digest.ts` | 74-75, 255, 259 | `campaigns as any`, `target_processes as any[]` |
| `lib/v3/mcp-auth.ts` | 125 | `keyData as any` - request_count no tipado |

### Para corregir estos tipos:
1. Crear tipos en `lib/v3/types.ts` que reflejen exactamente el schema de Supabase v3
2. Generar tipos con `supabase gen types` para el schema v3
3. Usar los tipos generados en las queries y componentes

---

## Variables de Entorno Requeridas

```env
# Supabase (ya configuradas en v2)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# APIs externas (ya configuradas en v2)
PARALLEL_API_KEY=          # Tech Radar
APOLLO_API_KEY=            # Apollo search
GOOGLE_GENERATIVE_AI_API_KEY=  # Gemini para analisis
```

---

## Pruebas Recomendadas

### 1. Flujo de Onboarding
```
1. Ir a /v3
2. Verificar redirect a /v3/onboarding (si no tiene workspace)
3. Crear workspace con nombre
4. Verificar redirect a /v3/docs
5. Subir documento PDF
6. Verificar procesamiento (status = "processed")
7. Verificar redirect a /v3/campaigns
```

### 2. Flujo de Campana
```
1. Crear nueva campana tipo "monitorear"
2. Agregar cuenta manualmente (buscar empresa)
3. Ver cuenta en lista
4. Click en cuenta para ver digest
5. Ejecutar Tech Radar (boton)
6. Ejecutar Apollo search (dialog con job titles)
7. Ver resultados en digest
```

### 3. CSV Import
```
1. Preparar CSV con columnas: name, domain (o website)
2. En campana, click "Importar CSV"
3. Subir archivo
4. Ver preview de matches
5. Ir a /v3/campaigns/[id]/import
6. Revisar matches pendientes
7. Confirmar o ignorar cada match
```

### 4. MCP Server
```
1. Ir a /v3/settings/api-keys
2. Crear nueva API key
3. Copiar key (solo visible una vez)
4. Test con curl:
   curl -H "Authorization: Bearer sk_..." \
     https://[domain]/api/v3/mcp
5. Verificar manifest de tools
```

---

## Proximos Pasos Sugeridos

1. **Testing manual** - Probar los 4 flujos documentados arriba
2. **Fix bugs** - Resolver los bugs medios identificados
3. **Documentacion** - Actualizar README con instrucciones de v3
4. **Deploy** - Verificar que funciona en produccion
5. **Iteracion** - Agregar funcionalidades de media prioridad

---

## Referencias

- `docs/BOT-BIGUA-LAT-ARCHITECTURE.md` - Arquitectura completa
- `docs/DESIGN-SYSTEM.md` - Sistema de diseno
- `docs/MVP-IMPLEMENTATION-PLAN.md` - Plan de implementacion detallado
