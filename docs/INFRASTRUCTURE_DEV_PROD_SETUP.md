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
- ✅ **Control de versiones**: Schema migrations versionadas
- ✅ **Aislamiento**: Credenciales y datos completamente separados
- ✅ **Mantenimiento simplificado**: Solo 2 ambientes

### Ambientes

```
┌─────────────────────────────────────────────────────────────┐
│                     PRODUCTION                              │
│  (main branch, usuarios reales, datos vivos)               │
│  ├─ URL: https://asci.bigua.lat                            │
│  ├─ DB: Supabase Prod Project                              │
│  └─ Deploy: Manual após aprovação + merge a main           │
├─────────────────────────────────────────────────────────────┤
│                     DEVELOPMENT                             │
│  (develop branch, desenvolvimento ativo)                   │
│  ├─ URL: https://dev.asci.bigua.lat                        │
│  ├─ DB: Supabase Dev Project                               │
│  └─ Deploy: Automático após merge a develop                │
├─────────────────────────────────────────────────────────────┤
│                     LOCAL                                   │
│  (branches personais, máquina local)                       │
│  ├─ DB: Local ou rama própria Supabase                     │
│  └─ Variables: .env.local                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Arquitectura

### Estructura de Ramas

```
main (Production)
├── tags: v1.0.0, v1.1.0 (releases)
├── Protected: require PR + CI passing
│
develop (Development)
├── Merge from: feature/*, bugfix/*, hotfix/*
├── Merge to: main (releases)
│
feature/*, bugfix/*, hotfix/*, chore/* (Local)
├── Creadas desde: develop
├── Merge a: develop (PR)
```

### Supabase Projects

Crear **2 proyectos Supabase independientes**:

| Ambiente | Nombre | Región | Purpose |
|----------|--------|--------|---------|
| **Production** | `asci-prod` | us-east-1 | Datos vivos |
| **Development** | `asci-dev` | us-east-1 | Desenvolvimento activo |

**Cada proyecto tiene:**
- Base de datos PostgreSQL independiente
- Credenciales y API keys propias
- Configuración de auth separada
- RLS policies idénticas

---

## Setup de Supabase

### Paso 1: Crear 2 Proyectos

**En Supabase Dashboard:**

```bash
# Para cada ambiente ejecutar:
1. Crear nuevo proyecto
   - Nombre: asci-{prod|dev}
   - Region: us-east-1
   - Password: [generar fuerte]
   - Plan: [mismo que atual]

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
# 1. Exportar schema del proyecto atual
supabase db pull --project-id={prod-project-id}

# Archivo generado: ./supabase/migrations/{timestamp}_remote_schema.sql

# 2. Aplicar ao novo proyecto dev
supabase db push --project-id={dev-project-id}
```

**Opción B: Manual desde Supabase SQL Editor**

```bash
# En el novo proyecto Supabase SQL Editor:
1. Copiar toda la estructura del proyecto atual
2. Paste en novo proyecto
3. Ejecutar
```

### Paso 3: Seed Data para Dev

```sql
-- scripts/seed-dev.sql (solo para dev)

-- Insertar usuários de test
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES 
  (gen_random_uuid(), 'dev@test.com', 'hashed_pw', NOW());

-- Insertar datos de prueba (empresas, contactos, etc.)
-- ... (dados sintéticos para testing)
```

---

## Configuración de GitHub

### Paso 1: Proteger Ramas

**Settings → Branches → Branch Protection Rules**

```yaml
# main
  - Require PR reviews: 1
  - Require status checks: All passing
  - Require up-to-date: true
  - Allow auto-merge: false

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
   if branch === 'main' → usar SUPABASE_URL_PROD
```

---

## Configuración de Vercel

### Paso 1: Crear 2 Projects en Vercel

```bash
# En https://vercel.com/new

1. asci-production
   - Connected to: main branch
   - Domain: asci.bigua.lat
   - Environment: production

2. asci-dev
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

#### Development (asci-dev)
```
Environment: Preview only
SUPABASE_URL = ${SUPABASE_URL_DEV}
NEXT_PUBLIC_SUPABASE_URL = ${SUPABASE_URL_DEV}
SUPABASE_ANON_KEY = ${SUPABASE_ANON_KEY_DEV}
NEXT_PUBLIC_SUPABASE_ANON_KEY = ${SUPABASE_ANON_KEY_DEV}
SUPABASE_SERVICE_ROLE_KEY = ${SUPABASE_SERVICE_ROLE_DEV}
POSTGRES_URL = ${POSTGRES_URL_DEV}

# Shared
RESEND_API_KEY = [from GitHub]
BLOB_READ_WRITE_TOKEN = [from GitHub]
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

2. Push a main (após release)
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
    branches: [main, develop, feature/*, bugfix/*, hotfix/*]
  pull_request:
    branches: [main, develop]

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
      
      - name: Notify Success
        run: echo "✅ DEV deployed to dev.asci.bigua.lat"
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
      
      - name: Notify Success
        run: echo "🚀 PRODUCTION deployed to asci.bigua.lat"
```

---

## Plan de Implementación

### Fase 1: Setup Supabase (1 hora)

- [ ] Crear proyecto `asci-dev`
- [ ] Exportar schema del proyecto actual
- [ ] Importar schema en dev
- [ ] Crear seed data para dev
- [ ] Verificar conexiones

**Checklist:**
```bash
# Verificar que cada proyecto es independiente
curl -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  ${SUPABASE_URL}/rest/v1/profiles?limit=0

# Debe retornar información del proyecto correcto
```

### Fase 2: Configurar GitHub (30 min)

- [ ] Crear 2 environments en GitHub Actions
- [ ] Agregar secrets por environment
- [ ] Proteger ramas (main, develop)
- [ ] Verificar permisos

### Fase 3: Configurar Vercel (30 min)

- [ ] Crear 2 projects en Vercel
- [ ] Conectar cada uno a su rama
- [ ] Configurar environment variables
- [ ] Configurar dominios (dev.*, producción)

### Fase 4: CI/CD Workflows (1-2 horas)

- [ ] Crear `ci.yml`
- [ ] Crear `deploy-dev.yml`
- [ ] Crear `deploy-prod.yml`
- [ ] Testear flujo completo en cada rama

### Fase 5: Testing e Iteración (1-2 horas)

- [ ] Feature branch → develop → Deploy a dev
- [ ] Verificar en dev.asci.bigua.lat
- [ ] Merge a main → Deploy a prod
- [ ] Verificar en asci.bigua.lat
- [ ] Documentar procesos

**Tiempo total: 5-6 horas**

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
supabase link --project-id dev-project-id
supabase db push # Aplica todas las migraciones
```

---

## Diagrama de Flujo Completo

```
┌─────────────────────────────────────────────────────────────────┐
│ Developer crea branch feature desde develop                    │
│ cd desenvolvimento local + .env.local (DEV database)           │
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
        ┌───────────────▼──────────────────────────┐
        │ Testing en dev.asci.bigua.lat            │
        │ (Verifica en DEV database)               │
        └───────────────┬──────────────────────────┘
                        │
        ┌───────────────▼──────────────────────────────────┐
        │ Cuando pronto para release: Merge develop → main │
        │ GitHub Actions: deploy-prod.yml                 │
        │ ├─ Deploy a asci-prod (Vercel)                  │
        │ ├─ Usar SUPABASE_URL_PROD                       │
        │ └─ Accesible en asci.bigua.lat                  │
        └───────────────┬──────────────────────────────────┘
                        │
        ┌───────────────▼──────────────────────────┐
        │ ✅ PRODUCTION LIVE                       │
        │ (Usuários reales en PROD database)      │
        │ Tag release: v1.0.0                     │
        └──────────────────────────────────────────┘
```

---

## Checklist de Implementación

- [ ] **Supabase**: 2 proyectos creados e testados
- [ ] **GitHub**: 2 environments + secrets + protected branches
- [ ] **Vercel**: 2 projects + variables de entorno
- [ ] **Workflows**: 3 YAML files en `.github/workflows/`
- [ ] **Testing**: Flujo completo probado (feature → dev → prod)
- [ ] **Documentación**: Actualizar README com instrucciones
- [ ] **Team**: Capacitar al equipo en novo flujo

---

## Recursos

- [Supabase Branching](https://supabase.com/docs/guides/local-development)
- [GitHub Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments)
- [Vercel Deployments](https://vercel.com/docs/deployments/overview)
- [Next.js Environment Variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)
