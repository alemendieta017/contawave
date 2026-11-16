# ContaWave — Manual de Identidad de Marca y Sistema de Diseño UI

> **Propósito de este documento:** Guía maestra de identidad visual, tokens de diseño y estándares de interfaz (UI/UX) de **ContaWave**. Está redactada para servir como **fuente de verdad y contexto base al diseñar o desarrollar nuevas pantallas con IA**, garantizando coherencia absoluta con la aplicación existente (`Next.js 16 + React 19 + Tailwind CSS`) y con el posicionamiento estratégico del producto.

---

## 1. Esencia de Marca y Posicionamiento

- **Qué es ContaWave:** Plataforma de gestión patrimonial y flujo de caja continuo para profesionales independientes (programadores remotos, médicos, consultores, arquitectos), freelancers y micropymes.
- **Qué NO es:** No es un ERP fiscal/tributario rígido (tipo SAP o Zoho Books) ni una app infantil de finanzas personales.
- **Reacción objetivo en el usuario:** _"Al fin una app seria que no parece un juego de dibujitos para niños."_
- **Atributos de personalidad:**
  1. **Autoridad Serena:** Precisión financiera y partida doble real funcionando bajo el capó sin abrumar al usuario.
  2. **Fluidez Moderna:** Movimiento continuo (la ola), claridad visual y fricción mínima (hábito de 2 minutos al día).
  3. **Pragmatismo Ejecutivo:** Todo converge en responder dos preguntas: _¿cuál es mi patrimonio neto real?_ y _¿tengo espalda para los próximos 6 meses? (Rolling Forecast)_.

---

## 2. Logotipo y Reglas de Contraste

### 2.1 Variantes Oficiales

Ubicación en el proyecto: `frontend/public/brand/` (y respaldos en `C:\Users\amend\OneDrive\Documentos\Contawave\logos`).

| Variante               | Archivo                                               | Uso recomendado                                                         |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| **Isotipo (`Wave C`)** | `contawave_logo_only.png`                             | Favicon, app icon, avatar, portadas y contenedores compactos.           |
| **Versión Horizontal** | `contawave_logo_horizontal_transparency.png` / `.svg` | Navbar principal, headers web, emails transaccionales y documentos.     |
| **Versión Cuadrada**   | `contawave_logo_square_transparency.png` / `.svg`     | Splash screens, pantallas de login/registro y tarjetas de presentación. |

### 2.2 Reglas Críticas de Legibilidad

- **Problema conocido en fondos oscuros:** El lado izquierdo del isotipo _Wave C_ posee un degradado violeta muy oscuro (`#231238`). Si se coloca directamente sobre fondos oscuros (`#231238` o `#120820`), su silueta izquierda se pierde.
- **Solución obligatoria:**
  - En **presentaciones o tarjetas oscuras**, encerrar el isotipo dentro de un contenedor circular o redondeado en **Brand Card (`#F4EEFB`)** con borde sutil `#B56CE2` o sobre fondo blanco `#FFFFFF`.
  - En **componentes UI de la app en Dark Mode** (como el wordmark horizontal o cuadrado), aplicar el tratamiento CSS oficial definido en `BrandLogo.tsx`:
    ```tsx
    className =
      'object-contain w-auto h-full dark:brightness-175 dark:contrast-105 transition-[filter]';
    ```
- **Área de respeto:** Dejar al menos `1×` la altura de la letra `"c"` libre alrededor del imagotipo.
- **Tamaño mínimo digital:** `24 × 24 px` para el isotipo; `120 px` de ancho para el lockup horizontal.
- **Prohibido:** Deformar proporciones, rotar, reemplazar el gradiente por colores planos ajenos o colocar sobre violetas medios (`#7C3AED`) sin contenedor.

---

## 3. Sistema Cromático y Tokens (`globals.css`)

**Regla estricta de desarrollo:** **PROHIBIDO** hardcodear colores HEX inline en componentes (`bg-[#7c3aed]`, `text-[#231238]`). Usar siempre los **tokens semánticos** de Tailwind conectados a `globals.css`.

### 3.1 Paleta Oficial de Marca

| Token            | HEX       | HSL (`globals.css`) | Peso / Rol Visual                                                                                            |
| ---------------- | --------- | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Brand Deep**   | `#231238` | `267 51% 15%`       | **Color dominante (60%).** Texto principal en Light Mode, superficies primarias y autoridad financiera.      |
| **Brand Vivid**  | `#7C3AED` | `262 83% 58%`       | **Acento primario.** Botones de acción principal, foco (`ring`), estados activos e indicadores clave.        |
| **Brand Wave**   | `#B56CE2` | `277 68% 65%`       | **Acento secundario.** Extremo luminoso de gradientes, detalles de olas y gráficos.                          |
| **Brand Card**   | `#F4EEFB` | `268 59% 96%`       | **Superficie suave.** Fondos de tarjetas secundarias, badges neutros y contenedores de contraste.            |
| **Canvas Light** | `#FBF9FE` | —                   | **Fondo de página (Light Mode).** Blanco con tinte lavanda imperceptible para lectura prolongada sin fatiga. |
| **Pure White**   | `#FFFFFF` | `0 0% 100%`         | **Superficie de tarjeta (`--card`).** Elevación limpia sobre `#FBF9FE`.                                      |
| **Brand Teal**   | `#10B981` | `160 84% 39%`       | **Éxito y Liquidez.** Flujo de caja positivo, metas cumplidas y balances saludables.                         |

### 3.2 Tokens Semánticos (Light Mode vs. Dark Mode)

| Token CSS / Tailwind      | Light Mode (`:root`)       | Dark Mode (`.dark`)           | Uso en Interfaz                                                 |
| ------------------------- | -------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `bg-background`           | `#FFFFFF` / Body `#FBF9FE` | `267 55% 7%` / Body `#120820` | Fondo base de página.                                           |
| `text-foreground`         | `267 51% 15%` (`#231238`)  | `268 50% 97%` (`#FBF9FE`)     | Títulos y texto principal.                                      |
| `bg-card`                 | `0 0% 100%` (`#FFFFFF`)    | `267 45% 12%`                 | Tarjetas, modales, tablas y paneles.                            |
| `--card-tint`             | `268 59% 96%` (`#F4EEFB`)  | `267 45% 15%`                 | Filas alternadas, headers de sección y sub-cards.               |
| `bg-primary`              | `267 51% 15%` (`#231238`)  | `262 83% 65%`                 | Botón primario y elementos de máximo énfasis.                   |
| `bg-secondary`            | `268 59% 96%` (`#F4EEFB`)  | `267 40% 18%`                 | Botones secundarios y pills.                                    |
| `bg-muted`                | `268 30% 95%`              | `267 35% 18%`                 | Estados deshabilitados, skeletons y divisores suaves.           |
| `text-muted-foreground`   | `267 15% 45%`              | `268 20% 65%`                 | Etiquetas secundarias, subtítulos, placeholders.                |
| `border-border` / `input` | `268 25% 91%`              | `267 35% 22%`                 | Bordes de inputs, tablas y tarjetas (`1px`).                    |
| `ring-ring`               | `262 83% 58%` (`#7C3AED`)  | `262 83% 65%`                 | Anillo de foco accesible (`focus-visible:ring-2`).              |
| `destructive`             | `0 84.2% 60.2%`            | `0 62.8% 30.6%`               | Errores de validación, déficit crítico y acciones destructivas. |

### 3.3 Gradientes y Sombras Insignia

Disponibles como utilidades CSS en `globals.css`:

- **`bg-brand-gradient`:** Gradiente diagonal `135deg` (`hsl(--brand-gradient-start)` → `hsl(--brand-gradient-mid)` → `hsl(--brand-gradient-end)`). Ideal para banners hero, cards destacadas de patrimonio neto o botones CTA premium.
- **`text-brand-gradient`:** Texto con clip de gradiente para cifras heroicas puntuales.
- **`shadow-brand-glow`:** `0 10px 25px -4px rgba(124, 58, 237, 0.35)` — Elevación para botones CTA principales o cards activas.
- **`shadow-brand-glow-sm`:** `0 4px 14px -2px rgba(124, 58, 237, 0.25)` — Elevación sutil para hover o popovers.

### 3.4 Regla de Semántica Neutral Contable

- **PROHIBIDO** usar verde o rojo para distinguir **Debe (Débito)** y **Haber (Crédito)**. En partida doble, un débito o crédito depende de la naturaleza de la cuenta y no es intrínsecamente "bueno" o "malo".
- Usar **etiquetas y badges neutros** (`bg-secondary text-secondary-foreground` o `bg-muted`) para columnas o tags de Debe/Haber.
- Reservar **Brand Teal (`#10B981`)** y **Destructive** únicamente para indicadores reales de resultado: liquidez positiva vs. déficit proyectado, cumplimiento de presupuesto o alertas de error.

---

## 4. Tipografía y Ergonomía Financiera

### 4.1 Familia Tipográfica

- **Fuente oficial:** `Plus Jakarta Sans` (cargada vía `next/font/google` como `--font-plus-jakarta-sans`).
- **Carácter:** Sans-serif geométrica, moderna, con excelente apertura en números y alta legibilidad en densidades altas de datos.

### 4.2 Escala Jerárquica en UI

| Nivel                           | Clases Tailwind sugeridas             | Peso                          | Uso                                               |
| ------------------------------- | ------------------------------------- | ----------------------------- | ------------------------------------------------- |
| **Hero / KPI Global**           | `text-3xl sm:text-4xl tracking-tight` | `font-bold`                   | Patrimonio neto, saldo disponible total.          |
| **Título de Página (H1)**       | `text-2xl sm:text-3xl tracking-tight` | `font-bold`                   | Título principal de cada módulo.                  |
| **Encabezado de Sección (H2)**  | `text-lg sm:text-xl`                  | `font-semibold`               | Títulos de cards, modales y subsecciones.         |
| **Cuerpo / Celdas**             | `text-sm` (`14px`)                    | `font-normal` / `font-medium` | Filas de libro diario, presupuestos, formularios. |
| **Labels / Badges / Metadatos** | `text-xs` (`12px`)                    | `font-medium`                 | Encabezados de tabla, fechas, estados, hints.     |

### 4.3 Reglas Obligatorias de Datos Monetarios

1. **Alineación Tabular (`tabular-nums`):** Obligatorio en **todo** importe, porcentaje, saldo o cifra monetaria (`className="tabular-nums"`). Evita saltos horizontales al actualizar montos y alinea decimales verticalmente.
2. **Alineación Financiera en Tablas y Listas:**
   - Conceptos, descripciones y nombres de cuenta: **izquierda** (`text-left`).
   - Débitos, Créditos, Saldos e Importes: **derecha** (`text-right`).
3. **Inputs Monetarios:**
   - Configurar siempre `inputMode="decimal"` (o `"numeric"` según `decimalPlaces` de la moneda, ej. Guaraníes sin decimales vs. USD con 2).
   - Formatear siempre mediante el helper centralizado `formatCurrency(...)`.

---

## 5. Layout, Espaciado y Estándares Tailwind CSS

### 5.1 Prohibición de Valores Arbitrarios (No Magic Numbers)

- **PROHIBIDO** usar brackets arbitrarios de Tailwind: `w-[500px]`, `h-[300px]`, `text-[13px]`, `p-[18px]`, `bg-[#1a2b]`.
- Utilizar exclusivamente la **escala estándar de múltiplos de 4px** (`p-2`, `p-4`, `p-6`, `gap-3`, `gap-4`, `max-w-md`, `max-w-2xl`, `w-full`).
- Dimensiones estructurales fijas repetitivas (como el ancho del sidebar) se definen como variables CSS en `globals.css`.

### 5.2 Geometría y Radios

- **Radio base (`--radius`):** `0.75rem` (`rounded-xl`, `12px`) para cards, modales y contenedores principales.
- **Radio interno:** `rounded-lg` (`8px`) para inputs, botones e ítems de menú dentro de cards; `rounded-full` para pills, badges de estado y avatares.
- **Composición de clases:** Toda clase condicional o extensible debe componerse con `cn(...)` desde `lib/utils.ts`.

### 5.3 Responsividad Mobile-First y Cero Clipping

- Diseñar primero para pantallas de **`320px+`** y escalar progresivamente con `sm:`, `md:`, `lg:`.
- **Prohibido** el scroll horizontal a nivel de página y prohibido ocultar layouts rotos con `overflow-x-hidden`.
- **Adaptación de formularios y grillas:**
  - En **móvil**: usar _Bottom Sheets_ (`AccountPickerSheet`, modales de captura rápida) y tarjetas apiladas con área táctil cómoda.
  - En **escritorio**: usar tablas financieras densas, grillas matriciales (`BudgetMatrix`, `ForecastMatrixGrid`) y paneles divididos.

---

## 6. Patrones de Componentes, Estados y Accesibilidad (a11y)

### 6.1 Jerarquía de Botones y Acciones

- **Acción Principal (CTA):** Fondo `bg-primary` (o `bg-brand-gradient` + `shadow-brand-glow-sm` en acciones clave de flujo), texto `text-primary-foreground`, altura mínima táctil en móvil `h-11` (`44px`) o `h-10` en escritorio.
- **Acción Secundaria:** `bg-secondary text-secondary-foreground hover:bg-secondary/80`.
- **Acción Terciaria / Ghost:** `hover:bg-accent hover:text-accent-foreground`.
- **Acción Destructiva:** `bg-destructive text-destructive-foreground` (siempre acompañada de confirmación modal para operaciones irreversibles).

### 6.2 Estados de Carga, Vacío y Error

- **Loading States:** Usar **Skeletons** (`bg-muted animate-pulse rounded-lg`) que respeten exactamente las dimensiones del contenido final para garantizar **cero CLS (Cumulative Layout Shift)**.
- **Empty States:** Icono sutil en contenedor `bg-secondary`, título claro, breve explicación orientada al hábito del usuario y un **CTA directo** para crear el primer registro.
- **Feedback de Foco y Teclado:**
  - Todo elemento interactivo debe incluir `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`.
  - Soportar navegación fluida con `Tab` / `Shift+Tab` en formularios y grillas de asientos.
  - Soportar el atajo **`Ctrl+Enter`** para asentar transacciones sin soltar el teclado.

---

## 7. Checklist Rápido para Desarrollar Nuevas Pantallas con IA

Antes de dar por terminada cualquier nueva pantalla o componente en ContaWave, verificar:

1. **Arquitectura:** ¿Es Server Component por defecto, dejando `'use client'` solo en las hojas interactivas?
2. **Tokens de color:** ¿Usa `bg-background`, `bg-card`, `text-foreground`, `border-border` y soporta Light + Dark Mode sin ningún HEX hardcodeado?
3. **Sin Magic Numbers:** ¿Están todos los espaciados, anchos y fuentes en la escala estándar de Tailwind (cero `[...]`)?
4. **Ergonomía contable:** ¿Tienen `tabular-nums` y `text-right` todos los importes y saldos? ¿Se respeta la semántica neutral en Debe/Haber?
5. **Mobile-First & Touch:** ¿Funciona fluido desde `320px` sin scroll horizontal y con botones `>= 44px` (`h-11`) en móvil?
6. **Estados completos:** ¿Incluye Skeleton de carga, Empty State con CTA, manejo de errores y `focus-visible:ring-2`?
