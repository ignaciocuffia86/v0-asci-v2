# Feature: FAQ Helper / Asistente de Ayuda Flotante

## Resumen

Sistema de ayuda contextual con botón flotante que permite a los usuarios de ASCI resolver dudas frecuentes sobre el uso de la plataforma, con búsqueda integrada y fallback a soporte humano.

---

## Diseño Visual

### Componente Flotante
- **Posición**: Esquina inferior derecha, fixed
- **Icono**: `HelpCircle` o `MessageCircle` de Lucide
- **Tamaño**: 56px circular
- **Color**: Primary (slate-900) con hover effect
- **Badge**: Opcional, indicador de "Nuevo" si hay actualizaciones

### Panel Expandido
- **Ancho**: 380px (desktop), 100% (mobile)
- **Alto máximo**: 70vh
- **Header**: Título "Centro de Ayuda" + botón cerrar
- **Buscador**: Input con icono de búsqueda
- **Contenido**: Lista de categorías expandibles (accordion)
- **Footer**: Link a soporte por email

---

## Categorías y Casos de Uso

### 1. Primeros Pasos
| Pregunta | Respuesta |
|----------|-----------|
| **¿Cómo completo mi perfil?** | Ve a tu perfil haciendo clic en tu avatar en la esquina superior derecha. Completa tu nombre, empresa, rol y propuesta de valor. Esta información se usa para personalizar los icebreakers que generes. |
| **¿Qué es una señal?** | Una señal es una mención detectada de una tecnología o proceso en el perfil de LinkedIn de un contacto. ASCI analiza los perfiles y detecta automáticamente qué tecnologías o procesos mencionan las personas. |
| **¿Cuál es la diferencia entre empleado actual y alumni?** | Un empleado actual trabaja actualmente en la empresa y sus señales son más relevantes. Un alumni trabajó anteriormente ahí; sus señales indican que la empresa usó esa tecnología en el pasado. |

### 2. Búsqueda de Señales
| Pregunta | Respuesta |
|----------|-----------|
| **¿Cómo busco por tecnología?** | En la página de búsqueda, selecciona la pestaña "Tecnología". Elige un vendor y producto del menú desplegable, selecciona al menos un país, y opcionalmente filtra por industria. Los resultados mostrarán empresas con señales de esa tecnología. |
| **¿Cómo busco por proceso?** | Selecciona la pestaña "Proceso" en búsqueda. Elige el proceso que te interesa (ej: Transformación Digital, Migración Cloud). A diferencia de tecnología, solo muestra empleados actuales ya que los procesos son más temporales. |
| **¿Cómo busco una empresa específica?** | Usa la pestaña "Empresa" y comienza a escribir el nombre. Aparecerán sugerencias mientras escribes. Selecciona la empresa para ver todas sus señales de tecnología y proceso. |
| **¿Qué significan los números en los resultados?** | El número junto a cada empresa indica la cantidad total de señales detectadas. Puedes ver el desglose entre empleados actuales y alumni haciendo clic en la empresa. |
| **¿Por qué algunas búsquedas no muestran alumni?** | Las búsquedas por proceso solo muestran empleados actuales porque los procesos (como migraciones o transformaciones) son proyectos temporales. Las búsquedas por tecnología sí incluyen alumni. |

### 3. Gestión de Cuentas (Bookmarks)
| Pregunta | Respuesta |
|----------|-----------|
| **¿Cómo guardo una empresa para seguimiento?** | Desde los resultados de búsqueda, haz clic en el icono de bookmark (marcador) junto a la empresa. La empresa se agregará a tu lista de cuentas guardadas. |
| **¿Dónde veo mis cuentas guardadas?** | Accede a "Mis Cuentas" desde el menú lateral. Verás todas las empresas que has guardado con sus señales y notas. |
| **¿Qué es la vista Kanban?** | Es una forma visual de organizar tus cuentas por estado de prospección. Puedes arrastrar las tarjetas entre columnas: Nuevo, Investigando, Contactado, Respondió, Reunión o Descartado. |
| **¿Cómo cambio el estado de una cuenta?** | En la vista Kanban, arrastra la tarjeta de la cuenta a la columna del nuevo estado. En la vista lista, haz clic en el selector de estado junto a la cuenta. |
| **¿Qué son los Tiers o prioridades?** | Los tiers te permiten clasificar cuentas por importancia: **Alta** (cuentas estratégicas), **Transaccional** (oportunidades de venta rápida), **Baja** (seguimiento a largo plazo). Usa los filtros para enfocarte en un tier específico. |
| **¿Cómo agrego notas a una cuenta?** | Abre el detalle de la cuenta y ve a la pestaña de notas o estrategia. Puedes escribir información relevante sobre la cuenta que te ayude en tu proceso de ventas. |

### 4. Detalle de Cuenta
| Pregunta | Respuesta |
|----------|-----------|
| **¿Qué información veo en el detalle de una cuenta?** | El detalle incluye: información general de la empresa, contactos con señales detectadas, noticias recientes, implementaciones tecnológicas detectadas, y herramientas de generación de contenido. |
| **¿Qué son las "Implementaciones"?** | Son tecnologías que hemos detectado que la empresa utiliza, basándonos en las señales de sus empleados actuales y pasados. Te ayuda a entender su stack tecnológico. |
| **¿Cómo veo los contactos de una empresa?** | En el detalle de la cuenta, la pestaña principal muestra los contactos con señales. Puedes filtrar por tipo de señal y ver el snippet donde se menciona la tecnología o proceso. |
| **¿Por qué algunos contactos no tienen email?** | Los alumni (ex-empleados) no muestran datos de contacto como email o teléfono por privacidad. Solo se muestra un enlace a su perfil de LinkedIn. |

### 5. Generación con IA
| Pregunta | Respuesta |
|----------|-----------|
| **¿Qué es el Brief Ejecutivo?** | Es un resumen generado por IA que combina toda la información de la cuenta: señales, noticias, implementaciones y tu estrategia comercial. Te da una visión completa para preparar una reunión o contacto. |
| **¿Cómo genero un icebreaker?** | En el detalle de una cuenta, ve a la sección de contactos. Junto a cada contacto verás la opción de generar un icebreaker. La IA creará un mensaje personalizado basado en las señales del contacto y tu propuesta de valor. |
| **¿Cómo mejoro los icebreakers generados?** | Asegúrate de completar tu propuesta de valor en tu perfil y en la estrategia de la cuenta. Cuanto más contexto tenga la IA, mejores serán los mensajes generados. |
| **¿Se guardan los icebreakers generados?** | Sí, los icebreakers se guardan en el historial de la cuenta para que puedas consultarlos después y hacer seguimiento de qué mensajes enviaste. |

### 6. Decision Makers
| Pregunta | Respuesta |
|----------|-----------|
| **¿Qué son los Decision Makers?** | Son los tomadores de decisión en una empresa para un proceso o tecnología específica. ASCI puede buscar y enriquecer perfiles de personas relevantes para tu venta. |
| **¿Cómo busco Decision Makers?** | En el detalle de una cuenta guardada, usa la función de búsqueda de Decision Makers. Puedes especificar el tipo de rol que buscas (CTO, IT Manager, etc.) y ASCI buscará perfiles relevantes. |
| **¿Qué datos obtengo de los Decision Makers?** | Dependiendo de la disponibilidad, puedes obtener: nombre, cargo, email corporativo, teléfono y enlace a LinkedIn. |

### 7. Señales Públicas y Noticias
| Pregunta | Respuesta |
|----------|-----------|
| **¿Qué son las señales públicas?** | Son noticias y menciones públicas de la empresa que ASCI detecta automáticamente. Incluyen anuncios de la empresa, noticias del sector, y eventos relevantes. |
| **¿Cómo me suscribo a noticias de una empresa?** | Al guardar una empresa en tus cuentas, automáticamente recibirás actualizaciones sobre noticias relevantes de esa empresa en tu digest semanal. |
| **¿Qué es el Digest Semanal?** | Es un email que recibes semanalmente con un resumen de noticias y novedades de las empresas que tienes guardadas en tus cuentas. |

### 8. Filtros y Organización
| Pregunta | Respuesta |
|----------|-----------|
| **¿Cómo filtro mis cuentas?** | En la página de cuentas, usa los filtros en la parte superior. Puedes filtrar por: estado (Nuevo, Contactado, etc.), prioridad/tier (Alta, Transaccional, Baja), y usar el buscador para encontrar por nombre. |
| **¿Puedo exportar mis cuentas?** | Actualmente la exportación está disponible para administradores. Si necesitas exportar datos, contacta a soporte. |
| **¿Cómo ordeno los resultados de búsqueda?** | Los resultados se ordenan por relevancia (cantidad de señales) por defecto. En algunas vistas puedes cambiar el orden haciendo clic en los encabezados de columna. |

### 9. Mi Perfil y Configuración
| Pregunta | Respuesta |
|----------|-----------|
| **¿Cómo edito mi perfil?** | Haz clic en tu avatar en la esquina superior derecha y selecciona "Perfil". Ahí puedes editar tu información personal, empresa y propuesta de valor. |
| **¿Por qué es importante mi propuesta de valor?** | Tu propuesta de valor se usa para generar icebreakers personalizados. Cuanto mejor describas qué ofreces, mejores serán los mensajes que genere la IA. |
| **¿Cómo cambio mi contraseña?** | Ve a tu perfil y busca la opción de cambiar contraseña. Necesitarás ingresar tu contraseña actual y la nueva. |

---

## Arquitectura Técnica Propuesta

### Componentes
```
components/
  help/
    help-button.tsx         # Botón flotante
    help-panel.tsx          # Panel expandido
    help-search.tsx         # Buscador de FAQ
    help-category.tsx       # Categoría accordion
    help-article.tsx        # Artículo individual
    help-footer.tsx         # Footer con link a soporte
```

### Estructura de Datos
```typescript
interface FAQCategory {
  id: string
  title: string
  icon: LucideIcon
  articles: FAQArticle[]
}

interface FAQArticle {
  id: string
  question: string
  answer: string
  keywords: string[]  // Para búsqueda
  relatedArticles?: string[]  // IDs de artículos relacionados
}
```

### Almacenamiento
- **Opción 1 (Recomendada)**: Archivo JSON estático en `/lib/faq-data.ts`
  - Pros: Sin latencia, funciona offline, fácil de mantener
  - Cons: Requiere deploy para actualizar

- **Opción 2**: Tabla en Supabase
  - Pros: Actualizable sin deploy, analytics de uso
  - Cons: Latencia adicional, más complejidad

### Búsqueda
- Implementar búsqueda local con fuzzy matching (fuse.js o similar)
- Buscar en: pregunta, respuesta, keywords
- Mostrar resultados rankeados por relevancia

---

## Flujo de Usuario

```
1. Usuario ve botón flotante "?" en esquina inferior derecha
   │
2. Clic en botón → Se abre panel de ayuda
   │
3. Usuario puede:
   ├── Navegar por categorías (accordion)
   ├── Buscar por texto libre
   │   └── Resultados filtrados en tiempo real
   └── Ver artículo específico
       └── Artículo expandido con respuesta completa
   │
4. Si no encuentra respuesta:
   └── Footer muestra: "¿No encontraste lo que buscabas?"
       └── Botón/link: "Envía tu consulta a ignacio@bigua.lat"
           └── Abre cliente de email con asunto pre-llenado
```

---

## Diseño UI/UX

### Estados del Botón
- **Default**: Icono `HelpCircle`, fondo slate-900
- **Hover**: Escala 1.1, sombra elevada
- **Panel abierto**: Icono cambia a `X` para cerrar

### Panel
```
┌─────────────────────────────────┐
│ Centro de Ayuda            [X] │
├─────────────────────────────────┤
│ 🔍 Buscar en la ayuda...       │
├─────────────────────────────────┤
│ ▼ Primeros Pasos               │
│ ▼ Búsqueda de Señales          │
│ ▼ Gestión de Cuentas           │
│ ▼ Detalle de Cuenta            │
│ ▼ Generación con IA            │
│ ▼ Decision Makers              │
│ ▼ Señales Públicas             │
│ ▼ Filtros y Organización       │
│ ▼ Mi Perfil                    │
├─────────────────────────────────┤
│ ¿No encontraste lo que         │
│ buscabas? Escríbenos a         │
│ ignacio@bigua.lat              │
└─────────────────────────────────┘
```

### Animaciones
- Panel: Slide-in desde la derecha (300ms)
- Categorías: Accordion smooth (200ms)
- Búsqueda: Debounce 300ms, highlight de matches

---

## Métricas a Trackear (Futuro)

1. **Artículos más vistos**: Para identificar dudas comunes
2. **Búsquedas sin resultados**: Para agregar contenido faltante
3. **Clics en "contactar soporte"**: Para medir efectividad del FAQ
4. **Tiempo en panel abierto**: Para evaluar si encuentran respuestas

---

## Plan de Implementación

### Fase 1: MVP (1-2 días)
- [ ] Crear estructura de datos FAQ en `/lib/faq-data.ts`
- [ ] Componente botón flotante
- [ ] Panel con categorías accordion
- [ ] Footer con link a email de soporte

### Fase 2: Búsqueda (0.5 días)
- [ ] Implementar búsqueda con fuse.js
- [ ] Highlight de matches en resultados
- [ ] Estado "sin resultados"

### Fase 3: Polish (0.5 días)
- [ ] Animaciones y transiciones
- [ ] Responsive mobile
- [ ] Accesibilidad (keyboard navigation, ARIA)
- [ ] Persistir estado abierto/cerrado en localStorage

### Fase 4: Mejoras Futuras
- [ ] Analytics de uso
- [ ] Artículos relacionados
- [ ] Valoración de artículos (útil/no útil)
- [ ] Chatbot con IA para preguntas no cubiertas

---

## Consideraciones

1. **Ubicación**: El botón no debe interferir con otros elementos flotantes (ej: toasts, modals)
2. **Mobile**: En mobile, el panel debe ser fullscreen o casi fullscreen
3. **Contexto**: Considerar mostrar artículos relevantes según la página actual (futuro)
4. **Mantenimiento**: Establecer proceso para actualizar FAQ cuando se agreguen features

---

## Contacto de Soporte

**Email de fallback**: ignacio@bigua.lat

**Asunto sugerido para email**: "Consulta ASCI - [Tema]"

**Template de email**:
```
Hola,

Tengo una consulta sobre ASCI que no encontré en el centro de ayuda:

[Espacio para la consulta del usuario]

Saludos,
[Nombre del usuario - auto-completado si es posible]
```
