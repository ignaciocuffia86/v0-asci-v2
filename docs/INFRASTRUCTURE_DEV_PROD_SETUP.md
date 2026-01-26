# Infrastructure: Development vs Production Setup

> Documento de configuración para separar ambientes de desarrollo y producción con bases de datos independientes, permitiendo desarrollo sin impactar producción.

---

## Tabla de Contenidos

1. [Visión General](#visión-general)
2. [Arquitectura](#arquitectura)
3. [Setup de Supabase](#setup-de-supabase)
4. [Configuración de GitHub](#configuración-de-github)
5. [Configuración de v0](#configuración-de-v0)
6. [Configuración de Vercel](#configuración-de-vercel)
7. [Variables de Entorno](#variables-de-entorno)
8. [Workflows CI/CD](#workflows-cicd)
9. [Plan de Implementación](#plan-de-implementación)

---

## Visión General

### Objetivos
- ✅ **Desarrollo sin riesgo**: Cambios sin impactar producción
- ✅ **Testing realista**: BD con datos representativos
- ✅ **Deployment seguro**: Staging antes de production
- ✅ **Control de versiones**: Schema migrations versionadas
- ✅ **Aislamiento**: Credenciales y datos completamente separados

### Ambientes

```
┌─────────────────────────────────────────────────────────────┐
│                     PRODUCTION                              │
│  (main branch, usuarios reales, datos vivos)               │
│  ├─ URL: https://asci.bigua.lat                            │
│  ├─ DB: Supabase Prod Project                              │
│  └─ Team: Deploy automático tras review                    │
├─────────────────────────────────────────────────────────────┤
│                     STAGING                                 │
│  (release branch, ambiente de pre-prod)                    │
│  ├─ URL: https://staging.asci.bigua.lat                   │
│  ├─ DB: Supabase Staging Project                           │
│  └─ Team: Deploy automático tras merge a release/          │
├─────────────────────────────────────────────────────────────┤
│                     DEVELOPMENT                             │
│  (develop branch, desarrollo activo)                       │
│  ├─ URL: https://dev.asci.bigua.lat                        │
│  ├─ DB: Supabase Dev Project                               │
│  └─ Team: Deploy automático tras merge a develop           │
├─────────────────────────────────────────────────────────────┤
│                     LOCAL                                   │
│  (branches personales, máquina local)                      │
│  ├─ DB: Local o rama propia Supabase                       │
│  └─ Variables: .env.local                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Arquitectura

### Estructura de Ramas

```
main (Production)
├── tags: v1.0.0, v1.1.0 (releases)
│
release/v1.x (Staging)
├── Merge from: develop (preparación para prod)
├── Merge to: main + develop (post-release)
│
develop (Development)
├── Merge from: feature/*, bugfix/*, hotfix/*
├── Merge to: release/, main (hotfixes)
│
feature/*, bugfix/*, hotfix/*, chore/* (Local)
├── Creadas desde: develop
├── Merge a: develop (PR)
```

### Supabase Projects

Crear **3 proyectos Supabase independientes**:

| Ambiente | Nombre | Región | Purpose |
|----------|--------|--------|---------|
| **Production** | `asci-prod` | us-east-1 | Datos vivos |
| **Staging** | `asci-staging` | us-east-1 | Pre-prod testing |
| **Development** | `asci-dev` | us-east-1 | Desarrollo activo |

**Cada proyecto tiene:**
- Base de datos PostgreSQL independiente
- Credenciales y API keys propias
- Configuración de auth separada
- RLS policies idénticas

---

## Setup de Supabase

### Paso 1: Crear 3 Proyectos

**En Supabase Dashboard:**

```bash
# Para cada ambiente ejecutar:
1. Crear nuevo proyecto
   - Nombre: asci-{prod|staging|dev}
   - Region: us-east-1
   - Password: [generar fuerte]
   - Plan: [mismo que actual]

2. Esperar inicialización (~5 min)
3. Copiar credentials:
   - Project URL
   - Anon Key (public)
   - Service Role Key (secret)
   - POSTGRES_URL
   - JWT Secret
```

### Paso 2: Migrar Schema

**Opción A: Desde SQL (Recomendado)**

```bash
# 1. Exportar schema del proyecto actual
supabase db pull --project-id={prod-project-id}

# Archivo generado: ./supabase/migrations/{timestamp}_remote_schema.sql

# 2. Aplicar a cada nuevo proyecto
supabase db push --project-id={staging-project-id}
supabase db push --project-id={dev-project-id}
```

**Opción B: Manual desde Supabase SQL Editor**

```bash
# En cada proyecto Supabase SQL Editor:
1. Copiar toda la estructura del proyecto actual
2. Paste en nuevo proyecto
3. Ejecutar
```

### Paso 3: Seed Data para Dev/Staging

```sql
-- scripts/seed-dev.sql (solo para dev/staging)

-- Insertar usuarios de test
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES 
  (gen_random_uuid(), 'dev@test.com', 'hashed_pw', NOW()),
  (gen_random_uuid(), 'staging@test.com', 'hashed_pw', NOW());

-- Insertar datos de prueba (empresas, contactos, etc.)
-- ... (datos sintéticos para testing)
```

---

## Configuración de GitHub

### Paso 1: Proteger Ramas

**Settings → Branches → Branch Protection Rules**

```yaml
# main
  - Require PR reviews: 2
  - Require status checks: All passing
  - Require up-to-date: true
  - Allow auto-merge: false
  - Dismiss stale reviews: true

# release/*
  - Require PR reviews: 1
  - Require status checks: All passing
  - Allow auto-merge: true

# develop
  - Require PR reviews: 0
  - Require status checks: All passing
  - Allow auto-merge: true
```

### Paso 2: Secrets and Variables

**Settings → Secrets and Variables → Actions**

**Environment: production**
```
SUPABASE_URL_PROD = [production-url]
SUPABASE_ANON_KEY_PROD = [production-anon-key]
SUPABASE_SERVICE_ROLE_PROD = [production-service-role-key]
POSTGRES_URL_PROD = [production-postgres-url]
DEPLOYMENT_URL_PROD = asci.bigua.lat
```

**Environment: staging**
```
SUPABASE_URL_STAGING = [staging-url]
SUPABASE_ANON_KEY_STAGING = [staging-anon-key]
SUPABASE_SERVICE_ROLE_STAGING = [staging-service-role-key]
POSTGRES_URL_STAGING = [staging-postgres-url]
DEPLOYMENT_URL_STAGING = staging.asci.bigua.lat
```

**Environment: development**
```
SUPABASE_URL_DEV = [dev-url]
SUPABASE_ANON_KEY_DEV = [dev-anon-key]
SUPABASE_SERVICE_ROLE_DEV = [dev-service-role-key]
POSTGRES_URL_DEV = [dev-postgres-url]
DEPLOYMENT_URL_DEV = dev.asci.bigua.lat
```

**Repository Level (compartidas)**
```
RESEND_API_KEY = [key]
VERCEL_API_TOKEN = [token]
BLOB_READ_WRITE_TOKEN = [token]
```

### Paso 3: Workflows (Github Actions)

**`.github/workflows/ci.yml`** - Test y lint en todas las ramas
**`.github/workflows/deploy-dev.yml`** - Deploy a dev en merge a `develop`
**`.github/workflows/deploy-staging.yml`** - Deploy a staging en merge a `release/*`
**`.github/workflows/deploy-prod.yml`** - Deploy a prod en merge a `main`

Ver sección [Workflows CI/CD](#workflows-cicd) para detalles.

---

## Configuración de v0

### Opción 1: Un Proyecto v0 con Múltiples Environments (Recomendado)

**v0 Settings → Integrations:**

```
1. Conectar a GitHub repo (ya existe)
2. Conectar a Vercel project (ya existe)
3. NO conectar Supabase directamente
   (usaremos variables de entorno por ambiente)
```

**Flujo de desarrollo en v0:**

```
1. Crear rama feature desde develop
2. En v0, la rama se detecta automáticamente
3. Usar variables de entorno según rama:
   if branch === 'develop' → usar SUPABASE_URL_DEV
   if branch === 'release/*' → usar SUPABASE_URL_STAGING
   if branch === 'main' → usar SUPABASE_URL_PROD
```

### Opción 2: Múltiples Proyectos v0 (Alternativa)

```
- asci-production (connected to main branch)
- asci-staging (connected to release/* branch)
- asci-dev (connected to develop branch)
```

**Ventajas:**
- Completamente aislado
- Sin riesgo de confusión

**Desventajas:**
- Repetición de código
- Múltiples sincronizaciones

**Recomendación: Opción 1 es más limpia**

---

## Configuración de Vercel

### Paso 1: Crear 3 Projects en Vercel

```bash
# En https://vercel.com/new

1. asci-production
   - Connected to: main branch
   - Domain: asci.bigua.lat
   - Environment: production

2. asci-staging
   - Connected to: release/* branch
   - Domain: staging.asci.bigua.lat
   - Environment: preview

3. asci-dev
   - Connected to: develop branch
   - Domain: dev.asci.bigua.lat
   - Environment: preview
```

### Paso 2: Environment Variables por Proyecto

**Vercel Project → Settings → Environment Variables**

#### Production (asci-production)
```
Environment: Production only
SUPABASE_URL = ${SUPABASE_URL_PROD}
NEXT_PUBLIC_SUPABASE_URL = ${SUPABASE_URL_PROD}
SUPABASE_ANON_KEY = ${SUPABASE_ANON_KEY_PROD}
NEXT_PUBLIC_SUPABASE_ANON_KEY = ${SUPABASE_ANON_KEY_PROD}
SUPABASE_SERVICE_ROLE_KEY = ${SUPABASE_SERVICE_ROLE_PROD}
POSTGRES_URL = ${POSTGRES_URL_PROD}

# Shared
RESEND_API_KEY = [from GitHub]
BLOB_READ_WRITE_TOKEN = [from GitHub]
```

#### Staging (asci-staging)
```
Environment: Preview only
SUPABASE_URL = ${SUPABASE_URL_STAGING}
NEXT_PUBLIC_SUPABASE_URL = ${SUPABASE_URL_STAGING}
SUPABASE_ANON_KEY = ${SUPABASE_ANON_KEY_STAGING}
... (igual pattern para STAGING)
```

#### Development (asci-dev)
```
Environment: Preview only
SUPABASE_URL = ${SUPABASE_URL_DEV}
NEXT_PUBLIC_SUPABASE_URL = ${SUPABASE_URL_DEV}
SUPABASE_ANON_KEY = ${SUPABASE_ANON_KEY_DEV}
... (igual pattern para DEV)
```

### Paso 3: Verificar Deployments

```bash
# El flujo automático será:

1. Push a develop
   ↓ GitHub detecta
   ↓ Tests corren (CI)
   ↓ Merge a develop aprobado
   ↓ GitHub Actions dispara deploy-dev
   ↓ Vercel (asci-dev) redeploy
   ↓ Accesible en dev.asci.bigua.lat

2. Push a release/*
   ↓ Tests corren
   ↓ Merge aprobado
   ↓ Vercel (asci-staging) redeploy
   ↓ Accesible en staging.asci.bigua.lat

3. Push a main (solo post-release)
   ↓ Tests corren
   ↓ GitHub Actions dispara deploy-prod
   ↓ Vercel (asci-production) redeploy
   ↓ Accesible en asci.bigua.lat
```

---

## Variables de Entorno

### `.env.local` (Local Development)

```bash
# Copiar de Supabase Dev Project
SUPABASE_URL=https://[dev-project].supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://[dev-project].supabase.co
SUPABASE_ANON_KEY=[dev-anon-key]
NEXT_PUBLIC_SUPABASE_ANON_KEY=[dev-anon-key]
SUPABASE_SERVICE_ROLE_KEY=[dev-service-role-key]
POSTGRES_URL=[dev-postgres-url]

# Otros
RESEND_API_KEY=[key]
BLOB_READ_WRITE_TOKEN=[token]
GOOGLE_GENERATIVE_AI_API_KEY=[key]
PERPLEXITY_API_KEY=[key]
TAVILY_API_KEY=[key]
SERPAPI_API_KEY=[key]
```

### Matriz de Confusión

```
┌──────────────────┬─────────────┬──────────────┬────────────┐
│ Variable         │ .env.local  │ GitHub Env   │ Vercel Env │
├──────────────────┼─────────────┼──────────────┼────────────┤
│ SUPABASE_URL     │ Dev         │ Env-specific │ Env-spec.  │
│ RESEND_API_KEY   │ Shared      │ Shared       │ Shared     │
│ BLOB_TOKEN       │ Shared      │ Shared       │ Shared     │
│ DATABASE_URL     │ Dev         │ Env-specific │ Env-spec.  │
└──────────────────┴─────────────┴──────────────┴────────────┘
```

---

## Workflows CI/CD

### `.github/workflows/ci.yml` - Test en todas las ramas

```yaml
name: CI - Tests and Lint

on:
  push:
    branches: [main, develop, release/*, feature/*, bugfix/*, hotfix/*]
  pull_request:
    branches: [main, develop, release/*]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      
      - name: Install dependencies
        run: npm ci
      
      - name: Lint
        run: npm run lint
      
      - name: Build
        run: npm run build
      
      - name: Type check
        run: npx tsc --noEmit
```

### `.github/workflows/deploy-dev.yml` - Deploy a DEV

```yaml
name: Deploy to Development

on:
  push:
    branches: [develop]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: development
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to Vercel (asci-dev)
        run: |
          npm install -g vercel
          vercel deploy --prod \
            --token=${{ secrets.VERCEL_API_TOKEN }} \
            --scope=bigua \
            --project=asci-dev \
            --env SUPABASE_URL=${{ secrets.SUPABASE_URL_DEV }} \
            --env SUPABASE_ANON_KEY=${{ secrets.SUPABASE_ANON_KEY_DEV }}
      
      - name: Notify Slack
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "✅ DEV deployed to dev.asci.bigua.lat"
            }
```

### `.github/workflows/deploy-staging.yml` - Deploy a STAGING

```yaml
name: Deploy to Staging

on:
  push:
    branches: [release/*, release-*]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: staging
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to Vercel (asci-staging)
        run: |
          npm install -g vercel
          vercel deploy --prod \
            --token=${{ secrets.VERCEL_API_TOKEN }} \
            --scope=bigua \
            --project=asci-staging \
            --env SUPABASE_URL=${{ secrets.SUPABASE_URL_STAGING }} \
            --env SUPABASE_ANON_KEY=${{ secrets.SUPABASE_ANON_KEY_STAGING }}
```

### `.github/workflows/deploy-prod.yml` - Deploy a PRODUCTION

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to Vercel (asci-production)
        run: |
          npm install -g vercel
          vercel deploy --prod \
            --token=${{ secrets.VERCEL_API_TOKEN }} \
            --scope=bigua \
            --project=asci-production \
            --env SUPABASE_URL=${{ secrets.SUPABASE_URL_PROD }} \
            --env SUPABASE_ANON_KEY=${{ secrets.SUPABASE_ANON_KEY_PROD }}
      
      - name: Slack Notification
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "🚀 PRODUCTION deployed to asci.bigua.lat"
            }
```

---

## Plan de Implementación

### Fase 1: Setup Supabase (1-2 horas)

- [ ] Crear proyecto `asci-staging`
- [ ] Crear proyecto `asci-dev`
- [ ] Exportar schema del proyecto actual
- [ ] Importar schema en staging y dev
- [ ] Crear seed data para dev/staging
- [ ] Verificar conexiones

**Checklist:**
```bash
# Verificar que cada proyecto es independiente
curl -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  ${SUPABASE_URL}/rest/v1/profiles?limit=0

# Debe retornar información del proyecto correcto
```

### Fase 2: Configurar GitHub (1 hora)

- [ ] Crear 3 environments en GitHub Actions
- [ ] Agregar secrets por environment
- [ ] Proteger ramas (main, release/*, develop)
- [ ] Verificar permisos

### Fase 3: Configurar Vercel (1 hora)

- [ ] Crear 3 projects en Vercel
- [ ] Conectar cada uno a su rama
- [ ] Configurar environment variables
- [ ] Configurar dominios (dev.*, staging.*, producción)

### Fase 4: CI/CD Workflows (2-3 horas)

- [ ] Crear `ci.yml`
- [ ] Crear `deploy-dev.yml`
- [ ] Crear `deploy-staging.yml`
- [ ] Crear `deploy-prod.yml`
- [ ] Testear flujo completo en cada rama

### Fase 5: Testing e Iteración (2-3 horas)

- [ ] Feature branch → develop → Deploy a dev
- [ ] Verificar en dev.asci.bigua.lat
- [ ] Merge a release → Deploy a staging
- [ ] Verificar en staging.asci.bigua.lat
- [ ] Release a main → Deploy a prod
- [ ] Verificar en asci.bigua.lat
- [ ] Documentar procesos

**Tiempo total: 7-10 horas**

---

## Troubleshooting

### Problema: Variables no se reemplazan en Vercel

**Solución:**
```bash
# En Vercel Deploy command, usar --env explícitamente:
vercel deploy --prod \
  --token=${{ secrets.VERCEL_API_TOKEN }} \
  --env SUPABASE_URL=https://... \
  --env SUPABASE_ANON_KEY=...
```

### Problema: Schema desincronizado entre ambientes

**Solución:**
```bash
# Usar Supabase CLI para sincronizar:
supabase link --project-id staging-project-id
supabase db push # Aplica todas las migraciones
```

### Problema: Datos de producción en dev

**Prevención:**
- Nunca fazer backup de producción a dev
- Usar seed data sintéticos
- Agregar constraint en RLS para evitar acceso cruzado

---

## Diagrama de Flujo Completo

```
┌─────────────────────────────────────────────────────────────────┐
│ Developer crea branch feature desde develop                    │
│ cd desarrollo local + .env.local (DEV database)               │
│ Pushea cambios                                                │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │ GitHub Actions: CI (tests)    │
        │ ✅ Lint, Build, Type check    │
        └───────────────┬───────────────┘
                        │
        ┌───────────────▼────────────────┐
        │ PR review & approval          │
        └───────────────┬───────────────┘
                        │
        ┌───────────────▼────────────────────────────┐
        │ Merge PR a develop                        │
        │ GitHub Actions: deploy-dev.yml            │
        │ ├─ Deploy a asci-dev (Vercel)             │
        │ ├─ Usar SUPABASE_URL_DEV                  │
        │ └─ Accesible en dev.asci.bigua.lat        │
        └───────────────┬────────────────────────────┘
                        │
        ┌───────────────▼─────────────────────────────┐
        │ Testing en dev.asci.bigua.lat             │
        │ (Verifica en DEV database)                 │
        └───────────────┬─────────────────────────────┘
                        │
        ┌───────────────▼──────────────────────────┐
        │ Crear PR desde develop → release/v1.x   │
        │ (Preparación para producción)           │
        └───────────────┬──────────────────────────┘
                        │
        ┌───────────────▼────────────────────────────────┐
        │ PR review & approval                         │
        │ GitHub Actions: deploy-staging.yml           │
        │ ├─ Deploy a asci-staging (Vercel)            │
        │ ├─ Usar SUPABASE_URL_STAGING                 │
        │ └─ Accesible en staging.asci.bigua.lat       │
        └───────────────┬────────────────────────────────┘
                        │
        ┌───────────────▼──────────────────────────┐
        │ Staging QA & final testing              │
        │ (Verifica en STAGING database)          │
        └───────────────┬──────────────────────────┘
                        │
        ┌───────────────▼──────────────────────────┐
        │ Merge release/v1.x a main               │
        │ Github Actions: deploy-prod.yml         │
        │ ├─ Deploy a asci-prod (Vercel)          │
        │ ├─ Usar SUPABASE_URL_PROD               │
        │ └─ Accesible en asci.bigua.lat          │
        └───────────────┬──────────────────────────┘
                        │
        ┌───────────────▼──────────────────────────┐
        │ ✅ PRODUCTION LIVE                       │
        │ (Usuarios reales en PROD database)      │
        │ Tag release: v1.0.0                     │
        └──────────────────────────────────────────┘
```

---

## Checklist de Implementación

- [ ] **Supabase**: 3 proyectos creados y testeados
- [ ] **GitHub**: 3 environments + secrets + protected branches
- [ ] **Vercel**: 3 projects + variables de entorno
- [ ] **Workflows**: 4 YAML files en `.github/workflows/`
- [ ] **Testing**: Flujo completo probado (feature → dev → staging → prod)
- [ ] **Documentación**: Actualizar README con instrucciones
- [ ] **Team**: Capacitar al equipo en nuevo flujo
- [ ] **Monitoreo**: Configurar alertas en cada ambiente

---

## Recursos

- [Supabase Branching](https://supabase.com/docs/guides/local-development)
- [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments)
- [Vercel Deployments](https://vercel.com/docs/deployments/overview)
- [Next.js Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)
