# Arquitectura de Ambiente de Desarrollo Separado

> **Objetivo**: Establecer un ambiente de desarrollo completo separado de producción con bases de datos independientes, permitiendo desarrollo sin riesgo de afectar usuarios reales.

**Fecha**: 25 de enero 2026  
**Responsabilidad**: Infrastructure/DevOps  

---

## 1. Estrategia General

### Estructura de Ambientes

```
┌─────────────────────────────────────────────────────────────┐
│                    PRODUCCIÓN (main)                         │
│  - Base de datos: Supabase Pro                               │
│  - URL: app.bigua.lat                                        │
│  - Deploy: Vercel (production)                               │
│  - Acceso: Usuarios finales                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   DESARROLLO (develop)                       │
│  - Base de datos: Supabase Dev (proyecto separado)           │
│  - URL: dev.bigua.lat (o app-dev.vercel.app)                │
│  - Deploy: Vercel (preview)                                  │
│  - Acceso: Team de desarrollo interno                        │
│  - Data: Sandbox con datos de prueba                         │
└─────────────────────────────────────────────────────────────┘
```

### Principios

1. **Aislamiento total**: Cero dependencia entre ambientes
2. **Espejo de producción**: Dev debe ser lo más similar posible a prod
3. **Seed data**: Datos de prueba consistentes y realistas
4. **Migraciones sincronizadas**: Cambios de schema se aplican a ambos
5. **Reversibilidad**: Poder revertir cambios rápidamente

---

## 2. GitHub - Estrategia de Ramas y Environments

### Configuración de Ramas

```
main (Production)
├── protected branch
├── require PR reviews
├── require status checks (tests, build)
├── require up-to-date branches
└── auto-delete head branches

develop (Development)
├── protected branch
├── require PR reviews (1 aprobación)
├── require status checks (tests)
└── feature/* (ramas de features)
    ├── feature/xyz
    └── auto-delete al mergear
```

### Archivos a Crear/Actualizar

#### `.github/workflows/deploy-prod.yml`
```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:ci
      - run: npm run lint
      - run: npm run build

  deploy-vercel-prod:
    needs: test
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Vercel Production
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
        run: |
          npm install -g vercel
          vercel deploy --prod --token=$VERCEL_TOKEN
```

#### `.github/workflows/deploy-dev.yml`
```yaml
name: Deploy to Development

on:
  push:
    branches: [develop]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:ci
      - run: npm run lint
      - run: npm run build

  deploy-vercel-dev:
    needs: test
    runs-on: ubuntu-latest
    environment: development
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Vercel Development
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID_DEV: ${{ secrets.VERCEL_PROJECT_ID_DEV }}
        run: |
          npm install -g vercel
          vercel deploy --token=$VERCEL_TOKEN \
            --scope $VERCEL_ORG_ID \
            --project-id $VERCEL_PROJECT_ID_DEV
```

### Secrets de GitHub

En **Settings → Environments → production** y **development**:

```
# Compartidos
VERCEL_TOKEN
VERCEL_ORG_ID

# Production
VERCEL_PROJECT_ID (la aplicación actual)
SUPABASE_URL_PROD
SUPABASE_ANON_KEY_PROD
POSTGRES_URL_PROD
...todas las vars de prod

# Development
VERCEL_PROJECT_ID_DEV
SUPABASE_URL_DEV
SUPABASE_ANON_KEY_DEV
POSTGRES_URL_DEV
...todas las vars de dev
```

---

## 3. Supabase - Proyecto Separado de Desarrollo

### Pasos de Configuración

#### 3.1 Crear Proyecto Dev

1. Ir a console.supabase.com
2. Click "New project"
3. Configuración:
   - Nombre: `asci-dev`
   - Región: Misma que prod (ej: `us-east-1`)
   - Plan: Free (suficiente para dev)
   - Database password: nueva contraseña fuerte

#### 3.2 Migrar Schema desde Prod

Una vez creado el proyecto dev, usar herramientas de Supabase CLI:

```bash
# Instalar CLI
npm install -g @supabase/cli

# Login
supabase login

# Conectar a proyecto prod (obtener ID)
supabase projects list

# Dumpar schema desde prod
pg_dump --schema-only --no-privileges \
  postgresql://user:password@prod-db-host/postgres > schema.sql

# Aplicar a dev
psql --dbname=postgresql://user:password@dev-db-host/postgres < schema.sql
```

#### 3.3 Configurar RLS y Políticas

- Las políticas se migran con el schema
- Verificar que todas estén habilitadas en dev también

#### 3.4 Extensiones de Supabase

Habilitar en dev igual que en prod:
- `uuid-ossp` (UUIDs)
- `pg_cron` (CRON jobs)
- `pgvector` (si se agrega)
- `http` (webhooks externos)

### Variables de Entorno Supabase

**Production** (.env.production):
```env
NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxyz...
SUPABASE_SERVICE_ROLE_KEY=eyJxyz...
```

**Development** (.env.development):
```env
NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJabc...
SUPABASE_SERVICE_ROLE_KEY=eyJabc...
```

---

## 4. v0 - Workspaces Separados (Recomendado)

### Opción A: Dos Workspaces en v0 (Recomendado)

**v0 Workspace Producción**
- Conectado a repo `main` branch
- Conectado a Supabase prod
- Deploy automático a Vercel prod

**v0 Workspace Desarrollo**
- Conectado a repo `develop` branch
- Conectado a Supabase dev
- Deploy automático a Vercel dev

**Ventajas:**
- Aislamiento visual y mental
- Diferentes secrets y credenciales
- No hay confusión entre ambientes

### Opción B: Un Workspace con Branch Switching

- Un workspace conectado al repo
- Cambiar entre `main` y `develop`
- Cambiar credenciales manualmente

**Desventajas:** Riesgo de confusión y deployar a ambiente equivocado

**Recomendación**: Usar Opción A

---

## 5. Configuración Local - `.env` Files

### Estructura de `.env` Local

```
# .env.local (no commitear)
NEXT_PUBLIC_SUPABASE_URL=https://dev.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...dev...
SUPABASE_SERVICE_ROLE_KEY=eyJ...dev...
POSTGRES_URL=postgresql://...dev...
```

### Estructura en Vercel

Vercel automáticamente detecta el ambiente basado en rama:

- **main** → environment: production
- **develop** → environment: development

Vercel inyecta los secrets correctos automáticamente.

---

## 6. Migraciones de Base de Datos

### Estrategia de Migraciones

```
/migrations
├── V001__initial_schema.sql
├── V002__add_bookmarks.sql
├── V003__add_rls_policies.sql
└── ... (numeradas secuencialmente)
```

### Proceso

1. **Crear migración** en `/migrations`
2. **Aplicar a DEV primero**:
   ```bash
   supabase migration up --db-url postgresql://...dev...
   ```
3. **Testear en DEV** (test fixtures, validaciones)
4. **Mergear a main**
5. **Aplicar a PROD**:
   ```bash
   supabase migration up --db-url postgresql://...prod...
   ```

### Script de Migración

```bash
#!/bin/bash
# scripts/migrate.sh

ENV=${1:-dev}  # dev or prod

if [ "$ENV" = "dev" ]; then
  psql $POSTGRES_URL_DEV < migrations/*.sql
elif [ "$ENV" = "prod" ]; then
  # Requerir confirmación
  read -p "⚠️  Aplicar migraciones a PRODUCCIÓN? (si/no): " -r
  if [[ $REPLY =~ ^[Ss][Ii]$ ]]; then
    psql $POSTGRES_URL_PROD < migrations/*.sql
  fi
else
  echo "Uso: bash scripts/migrate.sh [dev|prod]"
fi
```

---

## 7. Seed Data - Datos de Prueba

### Estructura

```
/seeds
├── dev-seed.sql
└── dev-seed.json
```

### `dev-seed.sql`

```sql
-- Usuarios de prueba
INSERT INTO auth.users (id, email, email_confirmed_at, encrypted_password)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'dev@test.com',
  now(),
  crypt('password123', gen_salt('bf'))
);

INSERT INTO profiles (id, full_name, company, role, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Dev User',
  'Test Company',
  'Sales',
  now()
);

-- Empresas de prueba
INSERT INTO companies (id, name, industry, country, linkedin_url, website)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Tech Startup Inc', 'SaaS', 'US', 'https://linkedin.com/company/tech-startup', 'https://techstartup.com'),
  ('22222222-2222-2222-2222-222222222222', 'Finance Corp', 'Banking', 'US', 'https://linkedin.com/company/finance-corp', 'https://financecorp.com');

-- Bookmarks de prueba
INSERT INTO bookmarks (id, user_id, company_id, status, priority, created_at)
VALUES
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'nuevo', 'Alta', now());
```

### Script de Seeding

```bash
#!/bin/bash
# scripts/seed-dev.sh

echo "🌱 Seeding development database..."

# Crear usuario de prueba
supabase seed run --db-url postgresql://...dev...

echo "✅ Seed completado"
```

### Ejecutar Localmente

```bash
npm run seed:dev
```

---

## 8. Testing - Aislamiento por Ambiente

### `jest.config.js`

```javascript
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
};
```

### `jest.setup.js`

```javascript
// Usar Supabase dev en tests
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL_DEV;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_DEV;

// Mock de APIs externas
jest.mock('axios');
```

### Tests de Integración

Tests deben correr contra base de datos dev:

```bash
npm run test:integration -- --env=dev
```

---

## 9. Deployment Strategy

### Diagrama de Flujo

```
Feature Branch
    ↓
PR a develop
    ↓
CI (tests, build, lint)
    ↓
Code review + merge
    ↓
Auto-deploy a DEV (Vercel)
    ↓
QA Testing en DEV
    ↓
PR a main (release)
    ↓
CI + Code review
    ↓
Auto-deploy a PROD (Vercel)
```

### Checklist Pre-Deploy a Producción

- [ ] PR aprobado
- [ ] Todos los tests pasando
- [ ] Migraciones de DB ejecutadas en dev
- [ ] Seed data validado
- [ ] Performance metrics en dev aceptables
- [ ] Docs actualizadas
- [ ] Changelog actualizado

---

## 10. Local Development Setup

### Pasos Iniciales

```bash
# 1. Clonar repo
git clone ...
cd asci

# 2. Crear rama feature
git checkout -b feature/my-feature develop

# 3. Instalar dependencias
npm install

# 4. Crear .env.local con vars dev
cp .env.example .env.local
# Editar con credenciales DEV de Supabase

# 5. Conectar a Supabase local (opcional pero recomendado)
supabase start

# 6. Aplicar migraciones
supabase db pull

# 7. Seed data de desarrollo
npm run seed:dev

# 8. Iniciar servidor local
npm run dev

# Acceder a http://localhost:3000
```

### Comando Useful

```bash
# Ver estado de Supabase local
supabase status

# Resincronizar schema
supabase db pull

# Generar tipos
supabase gen types typescript --local > types/database.ts

# Stop Supabase local
supabase stop
```

---

## 11. Monitoreo de Ambientes

### Health Checks

**Production**:
- Uptime monitoring (Vercel analytics)
- Database performance (Supabase metrics)
- Error tracking (Sentry, si se agrega)

**Development**:
- Build status (GitHub Actions)
- Deploy status (Vercel)
- Database state (verificación manual)

### Alertas

```bash
# En GitHub Actions: notificar en Slack si falla deploy a prod
- name: Notify Slack on failure
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "Deploy a PRODUCCIÓN falló: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
      }
```

---

## 12. Rollback Strategy

### Si Algo Sale Mal en Producción

#### Opción 1: Revertir Deploy Vercel
```bash
# En Vercel console:
1. Ir a Deployments
2. Click en último deployment exitoso
3. Click "Redeploy"
```

#### Opción 2: Revertir Cambios de DB
```bash
# Si migración fue problema:
supabase migration down --db-url postgresql://...prod...

# Revertar commit
git revert <commit-hash>
git push origin main
```

#### Opción 3: Rollback Rápido
```bash
# Tag de release "stable"
git tag v1.0.0-stable
git push origin v1.0.0-stable

# En Vercel, hacer deploy desde tag
```

---

## 13. Documentación Necesaria

### Archivos a Crear

```
/docs
├── DEVELOPMENT_SETUP.md (guía para desarrolladores)
├── DEPLOYMENT_GUIDE.md (proceso de deployment)
├── DATABASE_MIGRATIONS.md (cómo crear migraciones)
├── ENVIRONMENTS.md (configuración de ambientes)
└── TROUBLESHOOTING.md (problemas comunes)
```

### `DEVELOPMENT_SETUP.md`

Incluir:
- Requisitos (Node, npm, Git)
- Pasos de setup local
- Uso de Supabase local
- Cómo ejecutar tests
- Debugging tips
- Contacto para preguntas

---

## 14. Estimación de Esfuerzo

| Tarea | Esfuerzo | Blocker |
|-------|----------|---------|
| Crear proyecto Supabase dev | 0.5 días | No |
| Migrar schema a dev | 1 día | Sí |
| Configurar GitHub Actions | 1-2 días | No |
| Crear v0 workspace dev | 0.5 días | No |
| Setup local development | 1 día | No |
| Crear seed data | 1 día | No |
| Documentación | 1 día | No |
| Testing y validación | 1 día | No |
| **TOTAL** | **6-7 días** | |

### Timeline

**Semana 1:**
- Días 1-2: Setup Supabase dev + migrar schema
- Días 3-4: GitHub Actions + CI/CD
- Días 5: v0 workspace dev

**Semana 2:**
- Días 1-2: Local development + seed data
- Días 3-4: Documentación
- Día 5: Testing, validación, go-live

---

## 15. Checklist de Implementación

### Pre-Setup
- [ ] Supabase dev account creado
- [ ] Nuevo proyecto Supabase dev creado
- [ ] GitHub repositorio configurado
- [ ] Vercel app dev creada
- [ ] v0 workspace preparado

### Setup
- [ ] Schema migrado a dev
- [ ] RLS policies sincronizadas
- [ ] GitHub workflows creados
- [ ] Secrets configurados (prod + dev)
- [ ] v0 workspace dev conectado

### Validación
- [ ] Deploy a dev funciona
- [ ] Deploy a prod funciona
- [ ] Migraciones ejecutables
- [ ] Seed data funciona
- [ ] Tests en dev pasan
- [ ] Local development setup completo
- [ ] Documentación completa

### Go-Live
- [ ] Team trainning
- [ ] Primer feature mergeado a develop
- [ ] Deploy exitoso a dev
- [ ] PR a main con cambios base
- [ ] Deploy exitoso a prod

---

## 16. Próximos Pasos

1. **Crear proyecto Supabase dev** (hoy)
2. **Configurar GitHub Actions** (día 2-3)
3. **Setup local Supabase** (día 4-5)
4. **First feature en develop branch** (validación)
5. **Entrenar al team** en el nuevo flujo
