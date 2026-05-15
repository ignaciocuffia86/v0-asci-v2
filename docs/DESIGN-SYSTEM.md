# ASCI v3 Design System

> Documento de referencia para el diseno de bot.bigua.lat
> Inspirado en: Linear, Vercel Dashboard, Clay.com

---

## 1. Filosofia de Diseno

### Principios Core

1. **Density over whitespace**: Usuarios B2B necesitan ver mas informacion de un vistazo para tomar decisiones rapidas.
2. **Content over chrome**: La interfaz debe desaparecer, el contenido es protagonista.
3. **Keyboard-first**: Atajos de teclado para todas las acciones frecuentes.
4. **Speed is a feature**: Interacciones de <100ms, sin loaders innecesarios.
5. **Guide, don't overwhelm**: El dashboard es un aliado que guia al usuario a traves de los datos.

### Estetica

- Dark mode por defecto (warm charcoal, no negro puro)
- Paleta casi monocromatica con acentos minimos
- Bordes de 1px en lugar de sombras
- Animaciones cortas y sutiles (150-200ms)
- Tipografia clara con jerarquia definida

---

## 2. Paleta de Colores

### Tokens Semanticos (globals.css)

```css
@theme inline {
  /* ═══════════════════════════════════════════════════════════
     BACKGROUND LAYERS
     Warm charcoal base, no pure black
     ═══════════════════════════════════════════════════════════ */
  --background: oklch(0.14 0.005 285);           /* Base layer - warm dark */
  --background-subtle: oklch(0.17 0.005 285);    /* Cards, panels */
  --background-muted: oklch(0.20 0.005 285);     /* Hover states, wells */
  --background-emphasis: oklch(0.23 0.005 285);  /* Active states */

  /* ═══════════════════════════════════════════════════════════
     FOREGROUND / TEXT
     High contrast hierarchy
     ═══════════════════════════════════════════════════════════ */
  --foreground: oklch(0.95 0.005 285);           /* Primary text */
  --foreground-muted: oklch(0.65 0.005 285);     /* Secondary text */
  --foreground-subtle: oklch(0.45 0.005 285);    /* Tertiary, disabled */

  /* ═══════════════════════════════════════════════════════════
     BORDERS
     Subtle separation, no heavy lines
     ═══════════════════════════════════════════════════════════ */
  --border: oklch(0.25 0.005 285);               /* Default borders */
  --border-muted: oklch(0.20 0.005 285);         /* Subtle dividers */
  --border-emphasis: oklch(0.35 0.005 285);      /* Focus rings, active */

  /* ═══════════════════════════════════════════════════════════
     PRIMARY ACCENT
     Teal/Cyan - Feels modern, technical, trustworthy
     Used sparingly for CTAs and key actions
     ═══════════════════════════════════════════════════════════ */
  --primary: oklch(0.75 0.15 180);               /* Primary buttons, links */
  --primary-foreground: oklch(0.15 0.02 180);    /* Text on primary */
  --primary-muted: oklch(0.35 0.08 180);         /* Subtle primary bg */

  /* ═══════════════════════════════════════════════════════════
     STATUS COLORS
     Minimal, purposeful
     ═══════════════════════════════════════════════════════════ */
  --success: oklch(0.70 0.15 145);               /* Green - positive signals */
  --success-muted: oklch(0.30 0.05 145);
  
  --warning: oklch(0.75 0.15 85);                /* Amber - attention needed */
  --warning-muted: oklch(0.30 0.05 85);
  
  --destructive: oklch(0.65 0.20 25);            /* Red - errors, destructive */
  --destructive-muted: oklch(0.25 0.08 25);

  /* ═══════════════════════════════════════════════════════════
     SIGNAL COLORS
     Para badges de tipos de senal en el digest
     ═══════════════════════════════════════════════════════════ */
  --signal-technology: oklch(0.70 0.12 280);     /* Purple - tech signals */
  --signal-hiring: oklch(0.70 0.12 145);         /* Green - job postings */
  --signal-news: oklch(0.70 0.12 220);           /* Blue - news */
  --signal-funding: oklch(0.75 0.15 85);         /* Amber - funding */

  /* ═══════════════════════════════════════════════════════════
     COMPONENT SPECIFIC
     ═══════════════════════════════════════════════════════════ */
  --card: var(--background-subtle);
  --card-foreground: var(--foreground);
  
  --popover: var(--background-subtle);
  --popover-foreground: var(--foreground);
  
  --muted: var(--background-muted);
  --muted-foreground: var(--foreground-muted);
  
  --accent: var(--background-emphasis);
  --accent-foreground: var(--foreground);
  
  --input: var(--background-muted);
  --ring: var(--primary);

  /* ═══════════════════════════════════════════════════════════
     RADIUS
     Subtle rounding, not too rounded
     ═══════════════════════════════════════════════════════════ */
  --radius: 0.5rem;
  --radius-sm: 0.375rem;
  --radius-lg: 0.75rem;
}
```

### Uso de Colores

| Elemento | Token | Notas |
|----------|-------|-------|
| Fondo de app | `--background` | Warm charcoal base |
| Cards/Panels | `--card` | Ligeramente mas claro |
| Texto principal | `--foreground` | Alto contraste |
| Texto secundario | `--muted-foreground` | Metadata, timestamps |
| Bordes | `--border` | 1px solido, no sombras |
| CTA principal | `--primary` | Teal, usar con moderacion |
| Badges de senal | `--signal-*` | Cada tipo de senal tiene su color |

---

## 3. Tipografia

### Font Stack

```css
@theme inline {
  --font-sans: 'Inter', 'Inter Fallback', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}
```

### Escala Tipografica

| Uso | Clase | Size | Weight | Line Height |
|-----|-------|------|--------|-------------|
| Page title | `text-2xl font-semibold` | 24px | 600 | 1.2 |
| Section title | `text-lg font-medium` | 18px | 500 | 1.3 |
| Card title | `text-base font-medium` | 16px | 500 | 1.4 |
| Body | `text-sm` | 14px | 400 | 1.5 |
| Caption/Meta | `text-xs text-muted-foreground` | 12px | 400 | 1.4 |
| Mono/Code | `font-mono text-xs` | 12px | 400 | 1.4 |

### Reglas

- Nunca usar mas de 2 font-weights en el mismo componente
- Usar `text-balance` en titulos para evitar orphans
- Usar `truncate` para texto que puede desbordar
- Line-height entre 1.4-1.6 para texto de lectura

---

## 4. Layout Principal

### Estructura de 3 Columnas

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Header: Logo + Campaign Selector + Search (Cmd+K) + User Menu           │
├────────────┬────────────────────────────────────────┬───────────────────┤
│            │                                        │                   │
│  SIDEBAR   │           MAIN CONTENT                 │    COPILOT        │
│  240px     │           flex-1                       │    320px          │
│  fixed     │           scrollable                   │    collapsible    │
│            │                                        │                   │
│  Campaign  │  ┌─────────────────────────────────┐  │  ┌─────────────┐  │
│  Accounts  │  │ Account Header                  │  │  │ Chat Input  │  │
│  List      │  │ Company + Quick Actions         │  │  │             │  │
│            │  └─────────────────────────────────┘  │  │ Messages    │  │
│  - Acme    │  ┌─────────────────────────────────┐  │  │             │  │
│  - Bigua   │  │ Signals Feed                    │  │  │ Suggestions │  │
│  - Corp    │  │ Timeline of news/tech radar     │  │  │             │  │
│            │  │                                 │  │  └─────────────┘  │
│            │  └─────────────────────────────────┘  │                   │
│            │  ┌─────────────────────────────────┐  │                   │
│            │  │ Decision Makers                 │  │                   │
│            │  │ Contacts grid                   │  │                   │
│            │  └─────────────────────────────────┘  │                   │
│            │                                        │                   │
├────────────┴────────────────────────────────────────┴───────────────────┤
│ Footer: Status + Keyboard shortcuts hint                                │
└─────────────────────────────────────────────────────────────────────────┘
```

### Breakpoints y Responsividad

```css
/* Mobile: Stack everything */
@media (max-width: 768px) {
  /* Sidebar becomes bottom sheet */
  /* Copilot becomes floating button + sheet */
  /* Main content takes full width */
}

/* Tablet: 2 columns */
@media (min-width: 769px) and (max-width: 1024px) {
  /* Sidebar visible */
  /* Copilot collapsed by default */
}

/* Desktop: 3 columns */
@media (min-width: 1025px) {
  /* Full layout */
}
```

### Espaciado

| Contexto | Gap | Padding |
|----------|-----|---------|
| Entre secciones | `gap-6` | - |
| Dentro de cards | - | `p-4` |
| Entre items en lista | `gap-2` | - |
| Grid de cards | `gap-4` | - |
| Header/Footer | - | `px-4 py-3` |

---

## 5. Componentes Core

### 5.1 Sidebar de Cuentas

```tsx
// Estructura
<aside className="w-60 border-r border-border bg-background flex flex-col">
  {/* Campaign selector */}
  <div className="p-3 border-b border-border">
    <Select>
      <SelectTrigger>
        <SelectValue placeholder="Select campaign" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="monitoring">Base Instalada</SelectItem>
        <SelectItem value="prospecting">Q1 Targets</SelectItem>
      </SelectContent>
    </Select>
  </div>
  
  {/* Account list */}
  <ScrollArea className="flex-1">
    <div className="p-2 flex flex-col gap-1">
      {accounts.map(account => (
        <AccountListItem 
          key={account.id}
          account={account}
          isActive={activeId === account.id}
          hasNewSignals={account.newSignals > 0}
        />
      ))}
    </div>
  </ScrollArea>
  
  {/* Add account button */}
  <div className="p-3 border-t border-border">
    <Button variant="outline" className="w-full">
      <PlusIcon data-icon="inline-start" />
      Add Account
    </Button>
  </div>
</aside>
```

### 5.2 Account List Item

```tsx
<button 
  className={cn(
    "w-full flex items-center gap-3 px-3 py-2 rounded-md text-left",
    "hover:bg-muted transition-colors",
    isActive && "bg-muted"
  )}
>
  <Avatar className="size-8">
    <AvatarImage src={account.logoUrl} />
    <AvatarFallback>{account.name[0]}</AvatarFallback>
  </Avatar>
  
  <div className="flex-1 min-w-0">
    <p className="text-sm font-medium truncate">{account.name}</p>
    <p className="text-xs text-muted-foreground truncate">{account.industry}</p>
  </div>
  
  {hasNewSignals && (
    <Badge variant="secondary" className="shrink-0">
      {account.newSignals}
    </Badge>
  )}
</button>
```

### 5.3 Signal Card

```tsx
<Card className="group">
  <CardHeader className="pb-2">
    <div className="flex items-center justify-between">
      <Badge 
        variant="outline" 
        className="text-[var(--signal-technology)]"
      >
        Technology
      </Badge>
      <span className="text-xs text-muted-foreground">2h ago</span>
    </div>
  </CardHeader>
  
  <CardContent className="pb-3">
    <p className="text-sm leading-relaxed">
      {signal.summary}
    </p>
  </CardContent>
  
  <CardFooter className="pt-0">
    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <Button variant="ghost" size="sm">
        <BookmarkIcon data-icon="inline-start" />
        Save
      </Button>
      <Button variant="ghost" size="sm">
        <SparklesIcon data-icon="inline-start" />
        Generate Icebreaker
      </Button>
    </div>
  </CardFooter>
</Card>
```

### 5.4 Contact Card (Decision Maker)

```tsx
<Card className="hover:border-border-emphasis transition-colors">
  <CardContent className="p-4">
    <div className="flex items-start gap-3">
      <Avatar className="size-10">
        <AvatarImage src={contact.photoUrl} />
        <AvatarFallback>{contact.initials}</AvatarFallback>
      </Avatar>
      
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{contact.name}</p>
        <p className="text-sm text-muted-foreground truncate">
          {contact.title}
        </p>
        
        <div className="flex items-center gap-2 mt-2">
          {contact.email && (
            <Button variant="ghost" size="sm">
              <MailIcon data-icon="inline-start" />
              Email
            </Button>
          )}
          {contact.linkedin && (
            <Button variant="ghost" size="sm">
              <LinkedinIcon data-icon="inline-start" />
              LinkedIn
            </Button>
          )}
        </div>
      </div>
      
      <Badge variant="outline">{contact.seniority}</Badge>
    </div>
  </CardContent>
</Card>
```

### 5.5 Copilot Panel

```tsx
<aside className="w-80 border-l border-border bg-background flex flex-col">
  {/* Header */}
  <div className="p-3 border-b border-border flex items-center justify-between">
    <h3 className="font-medium">Copilot</h3>
    <Button variant="ghost" size="icon">
      <XIcon />
    </Button>
  </div>
  
  {/* Messages */}
  <ScrollArea className="flex-1 p-3">
    <div className="flex flex-col gap-4">
      {messages.map(msg => (
        <CopilotMessage key={msg.id} message={msg} />
      ))}
    </div>
  </ScrollArea>
  
  {/* Suggestions */}
  <div className="p-3 border-t border-border">
    <p className="text-xs text-muted-foreground mb-2">Suggestions</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm">Generate icebreaker</Button>
      <Button variant="outline" size="sm">Find more DMs</Button>
      <Button variant="outline" size="sm">Campaign stats</Button>
    </div>
  </div>
  
  {/* Input */}
  <div className="p-3 border-t border-border">
    <div className="relative">
      <Textarea 
        placeholder="Ask anything..."
        className="min-h-[80px] pr-10 resize-none"
      />
      <Button 
        size="icon" 
        className="absolute bottom-2 right-2"
      >
        <SendIcon />
      </Button>
    </div>
  </div>
</aside>
```

---

## 6. Patrones de Interaccion

### 6.1 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Command palette |
| `Cmd+/` | Toggle copilot |
| `Cmd+N` | New campaign |
| `Cmd+I` | Import CSV |
| `J/K` | Navigate accounts |
| `Enter` | Open selected account |
| `Esc` | Close modals/panels |
| `?` | Show all shortcuts |

### 6.2 Command Palette (Cmd+K)

```tsx
<CommandDialog>
  <CommandInput placeholder="Search accounts, actions..." />
  <CommandList>
    <CommandEmpty>No results found.</CommandEmpty>
    
    <CommandGroup heading="Accounts">
      {accounts.map(a => (
        <CommandItem key={a.id}>
          <Avatar className="size-5 mr-2">...</Avatar>
          {a.name}
        </CommandItem>
      ))}
    </CommandGroup>
    
    <CommandGroup heading="Actions">
      <CommandItem>
        <PlusIcon data-icon="inline-start" />
        Create Campaign
      </CommandItem>
      <CommandItem>
        <UploadIcon data-icon="inline-start" />
        Import CSV
      </CommandItem>
      <CommandItem>
        <SearchIcon data-icon="inline-start" />
        Search Apollo
      </CommandItem>
    </CommandGroup>
  </CommandList>
</CommandDialog>
```

### 6.3 Loading States

```tsx
// Skeleton para account list
<div className="flex items-center gap-3 px-3 py-2">
  <Skeleton className="size-8 rounded-full" />
  <div className="flex-1">
    <Skeleton className="h-4 w-24 mb-1" />
    <Skeleton className="h-3 w-16" />
  </div>
</div>

// Skeleton para signal card
<Card>
  <CardHeader className="pb-2">
    <Skeleton className="h-5 w-20" />
  </CardHeader>
  <CardContent>
    <Skeleton className="h-4 w-full mb-2" />
    <Skeleton className="h-4 w-3/4" />
  </CardContent>
</Card>
```

### 6.4 Empty States

```tsx
<Empty>
  <EmptyIcon>
    <InboxIcon />
  </EmptyIcon>
  <EmptyTitle>No signals yet</EmptyTitle>
  <EmptyDescription>
    We're monitoring this account. New signals will appear here.
  </EmptyDescription>
</Empty>
```

---

## 7. Componentes de shadcn a Usar

### Core (instalar primero)

```bash
npx shadcn@latest add button card badge avatar
npx shadcn@latest add input textarea select
npx shadcn@latest add dialog sheet drawer
npx shadcn@latest add command scroll-area separator
npx shadcn@latest add skeleton spinner
npx shadcn@latest add tooltip popover
npx shadcn@latest add tabs
```

### Forms

```bash
npx shadcn@latest add field fieldset input-group toggle-group
npx shadcn@latest add checkbox radio-group switch
```

### Data Display

```bash
npx shadcn@latest add table
npx shadcn@latest add alert
npx shadcn@latest add progress
```

### Navigation

```bash
npx shadcn@latest add sidebar
npx shadcn@latest add breadcrumb
npx shadcn@latest add dropdown-menu
```

---

## 8. Animaciones

### Transiciones Estandar

```css
/* Default transition for hover states */
.transition-colors {
  transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease;
}

/* For expanding/collapsing */
.transition-all {
  transition: all 200ms ease;
}

/* For opacity changes */
.transition-opacity {
  transition: opacity 150ms ease;
}
```

### Reglas

- No usar animaciones en acciones criticas (submit, delete)
- Fade in para elementos que aparecen (opacity 0 -> 1, 150ms)
- Slide para paneles laterales (transform, 200ms)
- No animar mas de 2 propiedades simultaneamente

---

## 9. Iconografia

### Libreria: Lucide React

```tsx
import { 
  Building2,      // Company
  Users,          // Contacts
  Mail,           // Email
  Phone,          // Phone
  Linkedin,       // LinkedIn
  Globe,          // Website
  TrendingUp,     // Signals
  Newspaper,      // News
  Briefcase,      // Job postings
  Cpu,            // Technology
  DollarSign,     // Funding
  Search,         // Search
  Plus,           // Add
  Upload,         // Import
  Download,       // Export
  Settings,       // Settings
  Sparkles,       // AI/Copilot
  Send,           // Send message
  ChevronRight,   // Expand
  X,              // Close
  Check,          // Success
  AlertCircle,    // Warning
} from 'lucide-react';
```

### Tamanos

| Contexto | Tamano |
|----------|--------|
| Dentro de Button | Auto (no poner clase) |
| Standalone en UI | `size-4` o `size-5` |
| Empty state | `size-10` |
| Avatar fallback | `size-5` |

---

## 10. Responsive Considerations

### Mobile-first approach

```tsx
// Sidebar en mobile -> Bottom sheet
<Sheet>
  <SheetTrigger asChild>
    <Button variant="outline" size="icon" className="md:hidden">
      <MenuIcon />
    </Button>
  </SheetTrigger>
  <SheetContent side="left">
    <AccountList />
  </SheetContent>
</Sheet>

// Sidebar en desktop -> Fixed
<aside className="hidden md:flex md:w-60 ...">
  <AccountList />
</aside>
```

### Copilot en mobile

```tsx
// Floating button + Drawer
<Drawer>
  <DrawerTrigger asChild>
    <Button 
      size="icon" 
      className="fixed bottom-4 right-4 md:hidden size-12 rounded-full shadow-lg"
    >
      <SparklesIcon />
    </Button>
  </DrawerTrigger>
  <DrawerContent>
    <DrawerTitle className="sr-only">Copilot</DrawerTitle>
    <CopilotPanel />
  </DrawerContent>
</Drawer>

// Panel en desktop
<aside className="hidden md:flex md:w-80 ...">
  <CopilotPanel />
</aside>
```

---

## 11. Checklist de Implementacion

### Fase 1: Setup

- [ ] Configurar globals.css con tokens
- [ ] Instalar Inter y JetBrains Mono
- [ ] Instalar componentes core de shadcn
- [ ] Crear layout base con 3 columnas

### Fase 2: Shell

- [ ] Header con logo + campaign selector + command palette
- [ ] Sidebar de cuentas
- [ ] Main content area
- [ ] Copilot panel (colapsable)

### Fase 3: Componentes

- [ ] AccountListItem
- [ ] SignalCard
- [ ] ContactCard
- [ ] CopilotMessage
- [ ] Empty states

### Fase 4: Interacciones

- [ ] Command palette (Cmd+K)
- [ ] Keyboard navigation
- [ ] Loading skeletons
- [ ] Toast notifications

---

*Documento creado: 2025-05-14*
*Version: 1.0*
