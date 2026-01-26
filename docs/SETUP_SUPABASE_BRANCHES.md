# Supabase Branches - Setup Simplificado

> Guía para configurar ambientes development y production usando Supabase Branches en el mismo repositorio GitHub

---

## Arquitectura

```
Tu repositorio: asci (GitHub)
│
├── main branch
│   ├─ Supabase: Production
│   ├─ Vercel: asci-production
│   └─ URL: asci.bigua.lat
│
└── develop branch
    ├─ Supabase: Preview (rama develop)
    ├─ Vercel: asci-dev
    └─ URL: dev.asci.bigua.lat
```

---

## Paso 1: Configurar Supabase Branches

### 1.1 En Supabase Dashboard

```
1. Ir a: https://supabase.com/dashboard
2. Seleccionar tu proyecto ASCI (production)
3. Ir a: Settings > Integrations > GitHub
4. Conectar/autorizar el repositorio asci
5. Configurar:
   - Production branch: main
   - Preview branches: develop
```

### 1.2 Verificar en GitHub

Supabase creará automáticamente:
- Una acción de deployment para cada push
- Credenciales automáticas en environment variables
- Preview URL para rama develop

---

## Paso 2: Configurar GitHub Environments

### 2.1 Crear Environments

En tu repo GitHub: **Settings > Environments**

**Crear: `production`**
```
Protection rules: Require deployments to succeed before merging (opcional)
```

**Crear: `development`**
```
(Sin protecciones requeridas)
```

### 2.2 Agregar Secrets

**Environment: production**
```
VERCEL_TOKEN = [token de Vercel]
VERCEL_ORG_ID = [tu org ID]
VERCEL_PROJECT_ID_PROD = [ID del proyecto asci-production]
```

**Environment: development**
```
VERCEL_TOKEN = [token de Vercel]
VERCEL_ORG_ID = [tu org ID]
VERCEL_PROJECT_ID_DEV = [ID del proyecto asci-dev]
```

---

## Paso 3: Configurar Vercel

### 3.1 Crear proyecto DEV

En Vercel:

```
1. New Project
2. Nombre: asci-dev
3. Conectar: repositorio asci
4. Rama: develop
5. Environment: Preview
6. Domain: dev.asci.bigua.lat (opcional, Vercel proporciona default)
```

### 3.2 Variables de Entorno (en Vercel)

**Para asci-production:**
```
SUPABASE_URL = [prod-url]
NEXT_PUBLIC_SUPABASE_URL = [prod-url]
SUPABASE_ANON_KEY = [prod-anon-key]
NEXT_PUBLIC_SUPABASE_ANON_KEY = [prod-anon-key]
```

**Para asci-dev:**
```
SUPABASE_URL = [same-prod-url]
NEXT_PUBLIC_SUPABASE_URL = [same-prod-url]
SUPABASE_ANON_KEY = [same-prod-anon-key]
NEXT_PUBLIC_SUPABASE_ANON_KEY = [same-prod-anon-key]
```

> Las credenciales de Supabase son las MISMAS porque usamos branches dentro del mismo proyecto

---

## Paso 4: Configurar .env.local (Local Dev)

```bash
# Copy from Supabase Production Project (estos se usan también en preview)
SUPABASE_URL=https://[proyecto].supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://[proyecto].supabase.co
SUPABASE_ANON_KEY=[anon-key]
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon-key]
SUPABASE_SERVICE_ROLE_KEY=[service-role-key]
POSTGRES_URL=[postgres-url]

# Otros
RESEND_API_KEY=[key]
BLOB_READ_WRITE_TOKEN=[token]
```

---

## Flujo de Trabajo

### Developer: Feature Development

```bash
1. git checkout -b feature/new-thing
2. cd desarrollo local con .env.local
3. npm run dev
4. git push origin feature/new-thing
5. GitHub Actions: CI tests (lint, build, type check)
6. Create PR a develop
7. Review & merge
```

### Deploy a DEV (Automático)

```
1. PR merged a develop
2. GitHub detecta push a develop
3. GitHub Actions: deploy-dev.yml dispara
4. Vercel redeploy asci-dev
5. Supabase crea preview branch automáticamente
6. Accesible en dev.asci.bigua.lat
```

### Deploy a PROD (Manual + Automático)

```
1. Cuando listo para release: git checkout main
2. git merge develop
3. git push origin main
4. GitHub Actions: deploy-prod.yml dispara
5. Vercel redeploy asci-production
6. Accesible en asci.bigua.lat
```

---

## Variables de Entorno - Matriz Final

```
┌──────────────────────┬─────────────┬──────────────┐
│ Variable             │ .env.local  │ Vercel       │
├──────────────────────┼─────────────┼──────────────┤
│ SUPABASE_URL         │ Prod*       │ Prod         │
│ SUPABASE_ANON_KEY    │ Prod*       │ Prod         │
│ RESEND_API_KEY       │ Shared      │ Shared       │
│ BLOB_READ_WRITE_TOKEN│ Shared      │ Shared       │
└──────────────────────┴─────────────┴──────────────┘

* Mismo proyecto, diferentes ramas de BD
```

---

## Workflows GitHub Actions

### ✅ Incluidos en el repo

```
.github/workflows/
├── ci.yml (tests en todas las ramas)
├── deploy-dev.yml (deploy a develop)
└── deploy-prod.yml (deploy a main)
```

### Flujo CI/CD

```
Push a cualquier rama
├─ GitHub Actions: ci.yml
├─ Tests: Lint, Build, Type check
├─ PR review
│
└─ Si es develop/main:
   ├─ Deploy automático (deploy-dev.yml o deploy-prod.yml)
   ├─ Vercel redeploy
   └─ Supabase preview branch (si develop)
```

---

## Checklist de Setup

- [ ] **Supabase**: 
  - [ ] Conectar GitHub en Settings > Integrations
  - [ ] Configurar main → production, develop → preview
  - [ ] Verificar que preview branch se crea al push a develop

- [ ] **GitHub**:
  - [ ] Crear 2 environments: production, development
  - [ ] Agregar secrets en cada environment
  - [ ] Proteger rama main (opcional)
  - [ ] Verificar que workflows existen en .github/workflows/

- [ ] **Vercel**:
  - [ ] Crear 2 proyectos: asci-production, asci-dev
  - [ ] Conectar ramas: main → prod, develop → dev
  - [ ] Configurar variables de entorno en cada proyecto
  - [ ] Configurar dominios si es necesario

- [ ] **Testing**:
  - [ ] Push a feature branch → CI tests pasan
  - [ ] Merge a develop → Deploy a asci-dev
  - [ ] Verificar en dev.asci.bigua.lat
  - [ ] Merge a main → Deploy a asci-prod
  - [ ] Verificar en asci.bigua.lat

---

## Troubleshooting

### Problema: Supabase preview branch no se crea

**Solución:**
```
1. Ir a Supabase Settings > GitHub Integrations
2. Re-conectar el repositorio
3. Asegurar que develop está configurado como preview branch
```

### Problema: Variables de entorno no se cargan en Vercel

**Solución:**
```
1. En Vercel: Settings > Environment Variables
2. Asegurar que estén configuradas para "Preview"
3. Re-deploy manualmente
```

### Problema: Deploy falla con "Project not found"

**Solución:**
```
1. Verificar VERCEL_PROJECT_ID_DEV está correcto
2. Token de Vercel tiene permisos necesarios
3. Org ID es correcto
```

---

## Próximos Pasos

1. Implementar seed data para develop
2. Agregar migrations automáticas en Supabase
3. Configurar alertas en ambientes
4. Documentar procesos en README

---

## Recursos

- [Supabase GitHub Integration](https://supabase.com/docs/guides/integrations/github)
- [Supabase Branching](https://supabase.com/docs/guides/local-development/branching)
- [Vercel Deployments](https://vercel.com/docs/deployments/overview)
- [GitHub Actions](https://docs.github.com/en/actions)
