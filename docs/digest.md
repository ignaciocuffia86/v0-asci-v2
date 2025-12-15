# Email Digest Mensual - Documentación

Feature temporalmente removida. Este documento contiene las definiciones para reimplementarla.

## Objetivo

Enviar un email mensual a cada usuario con las novedades (noticias e implementaciones) de las compañías que tiene bookmarkeadas.

## Reglas de Negocio

1. **Frecuencia:** 1 vez por mes (día 1 a las 9:00 AM)
2. **Filtros de noticias:**
   - `published_at` < 2 meses de antigüedad
   - `requested_by` ≠ usuario destinatario (no enviar las que él mismo buscó)
   - No enviar noticias que ya se enviaron en digests anteriores
3. **Agrupación:** Por compañía bookmarkeada

## Flujo

```
1. Cron Job (1ro de cada mes, 9:00 AM)
   ↓
2. Para cada usuario con digest_enabled = true:
   ↓
3. Obtener sus bookmarks → company_ids
   ↓
4. Buscar noticias/implementaciones donde:
   - company_id IN (sus bookmarks)
   - published_at > NOW() - 2 meses
   - requested_by ≠ user_id
   - id NOT IN (user_digest_sent_items)
   ↓
5. Agrupar por compañía
   ↓
6. Enviar email con Resend
   ↓
7. Registrar items enviados en user_digest_sent_items
```

## Formato del Email

```
Noticias ASCI
Estas son las novedades de las cuentas que seguís:

Compañía A:
- Noticia 1 (title) [link a la noticia]
  Content: resumen de 2 lineas
- Noticia 2 (title) [link a la noticia]
  Content: resumen de 2 lineas

Compañía B:
...
```

## Tablas de Base de Datos

### user_notification_preferences
```sql
CREATE TABLE user_notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  digest_enabled BOOLEAN DEFAULT true,
  digest_frequency TEXT DEFAULT 'monthly', -- 'weekly', 'monthly', 'never'
  last_digest_sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### user_digest_sent_items
```sql
CREATE TABLE user_digest_sent_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  item_type TEXT NOT NULL, -- 'news' | 'implementation'
  item_id UUID NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, item_type, item_id)
);
```

### digest_send_log
```sql
CREATE TABLE digest_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  items_count INTEGER NOT NULL DEFAULT 0,
  companies_count INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'sent', -- 'sent', 'failed', 'skipped'
  error_message TEXT
);
```

## Campos requeridos en company_news y company_implementations

```sql
ALTER TABLE company_news 
ADD COLUMN requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN requested_by UUID REFERENCES auth.users(id),
ADD COLUMN published_at DATE;

ALTER TABLE company_implementations 
ADD COLUMN requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN requested_by UUID REFERENCES auth.users(id),
ADD COLUMN published_at DATE;
```

## SYSTEM_USER_ID

UUID especial para identificar noticias generadas automáticamente por el cron job (no por usuarios):

```typescript
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000"
```

Las noticias con `requested_by = SYSTEM_USER_ID` se incluyen en el digest de TODOS los usuarios.

## Integración con refresh-news cron

El cron `refresh-news` (día 1 y 15 de cada mes a las 8:00 AM) busca noticias para bookmarks de alta prioridad.
Debe guardar las noticias con `requested_by = SYSTEM_USER_ID` para que lleguen a todos los usuarios en el digest.

## Archivos a crear

1. `app/actions/digest.ts` - Lógica de generación y envío
2. `app/api/cron/monthly-digest/route.ts` - Endpoint del cron job
3. `app/api/digest/preview/route.ts` - Preview del digest sin enviar

## Configuración de Resend

- Dominio verificado en resend.com
- API Key en `RESEND_API_KEY`
- From: `ASCI <noticias@tudominio.com>`

## vercel.json cron

```json
{
  "path": "/api/cron/monthly-digest",
  "schedule": "0 9 1 * *"
}
```

## Script SQL completo

Ver `scripts/102_digest_tables.sql` para el script completo de creación de tablas.
