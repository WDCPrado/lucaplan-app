## Context

LucaPlan es una webapp Next.js 16 de finanzas. Hoy la única vista real es el dashboard
(`components/finance/dashboard.tsx`), construido mobile-first: contenedor `max-w-md`
centrado, `pb-28` para dejar sitio a una **bottom-nav fija** (`fixed inset-x-0 bottom-4`),
saldo + cuentas en un **carrusel horizontal con snap**, presupuestos en otro carrusel, y las
acciones (agregar movimiento, categoría, detalle, cuenta) abren `Sheet` de shadcn. La UI usa
shadcn/ui + Base UI (estilo `radix-maia`), Tailwind v4 y tokens de `app/globals.css`.

El backend (clean architecture en `arch/v1/**` + Route Handlers en `app/api/**`) queda intacto:
este cambio es 100% presentación. La motivación y el alcance están en `proposal.md`; los
requisitos verificables, en `specs/app-shell/spec.md`.

## Goals / Non-Goals

**Goals:**

- App-shell desktop-first: sidebar fija a la izquierda en `lg`+, contenido ancho a la derecha.
- Layout multi-columna en escritorio; apilado en móvil, sin regresiones táctiles.
- Reemplazar la bottom-nav fija por la sidebar en escritorio; conservar navegación táctil en móvil.
- Superficies (add/editar/detalle) que se sienten nativas en cada tamaño.
- Cero cambios de negocio, API, tokens, tipografía o glass.

**Non-Goals:**

- No landing pública ni marketing.
- No nuevas vistas/rutas de producto (Reportes, Búsqueda, etc.): los íconos de nav sin pantalla
  propia hoy son placeholders; no se implementan aquí.
- No cambiar la paleta ni el design system (`app/globals.css` no se toca).
- No migrar a Figma (solo si el usuario lo pide, tras aprobar en código).

## Decisions

### 1. Shell mínimo a mano, no el bloque `sidebar` de shadcn

Construir el shell con un `<aside>` fijo visible en `lg`+ (`hidden lg:flex`) y, en móvil, un
botón que abre el `Sheet` **ya instalado** (`components/ui/sheet.tsx`) con los mismos enlaces.

- **Por qué:** el proyecto usa Base UI (estilo `radix-maia`); el bloque `sidebar` de shadcn
  está pensado para Radix y arrastra funcionalidad que aquí es YAGNI (modo icono colapsable,
  rail, tooltips, persistencia en cookie). El shell que necesitamos —sidebar fija + drawer
  móvil— sale de un `<aside>` + el `Sheet` que ya existe. Menos superficie, menos deps.
- **Alternativa considerada:** `pnpm dlx shadcn@latest add sidebar`. Descartada por over-kill y
  riesgo de fricción con Base UI. Reevaluar solo si más adelante se quiere colapso icon-mode o
  persistencia de estado de la sidebar.

### 2. Una superficie responsive compartida (`ResponsiveModal`)

Envolver el contenido de cada superficie en un único wrapper que renderiza **`Dialog` en
escritorio y `Sheet` en móvil**, decidido por un hook `useIsDesktop` basado en `matchMedia`.
Los 4 usos (add-transaction, category-modal, category-detail, account-modal) comparten el
wrapper; el contenido del formulario no se duplica.

- **Por qué:** cumple "superficies contextuales adaptativas" sin duplicar formularios. El hook
  `matchMedia` es un efecto genuino (sincronización con un sistema externo: el media query),
  no lógica de otra capa — cumple la regla anti-`useEffect` del proyecto. Para evitar mismatch
  de hidratación SSR, el hook parte de un default y se corrige en `mount` (el contenido es el
  mismo; solo cambia el envoltorio).
- **Alternativa considerada:** quedarse solo con `Sheet` en ambos tamaños (0 JS nuevo). Es aún
  más lazy, pero en escritorio un formulario a pantalla lateral completa se siente pobre.
  **Fallback aceptable** si el wrapper resulta molesto: `Sheet` lateral (`side="right"`) en
  todos los tamaños. Decidir al implementar viendo el resultado real.

### 3. Layout con CSS grid + breakpoints Tailwind, sin JS

El contenido usa clases Tailwind responsive: contenedor `max-w-md` → `max-w-6xl` (o `7xl`);
cuentas pasan de carrusel (`overflow-x-auto snap`) a `grid grid-cols-1 sm:grid-cols-2
lg:grid-cols-3`; Movimientos y Presupuestos pasan de apilado a `lg:grid-cols-[...]` en columnas.
Los carruseles horizontales se conservan solo donde aún aporten en móvil.

- **Por qué:** el breakpoint lo resuelve CSS; no hace falta JS para el layout. Mobile-first de
  Tailwind sigue siendo la base de clases (default = móvil, `lg:` = escritorio), lo que
  garantiza que el móvil no regrese.

### 4. Iterar sobre un mock en `app/design/` antes de tocar la vista real

Prototipar el shell desktop-first en `app/design/desktop-shell/page.tsx` (mock funcional con
datos en memoria, siguiendo el flujo de UI del proyecto), verificar con Playwright en escritorio
y ~375px, guardar `preview.png`, y **recién con el visto bueno** portar el layout a
`components/finance/dashboard.tsx`.

- **Por qué:** reduce el riesgo de romper la app real mientras se explora la forma; respeta el
  flujo de creación de UI de `CLAUDE.md`. El mock es descartable; la vista real es la entrega.

## Risks / Trade-offs

- **Regresión en móvil** (scroll horizontal, targets pequeños, carrusel roto) → mitigación:
  base de clases mobile-first + invariantes de responsividad del spec, verificadas con Playwright
  a ~375px y escritorio, en dark y light, antes de cerrar cada iteración.
- **Mismatch de hidratación por `useIsDesktop`** → mitigación: hook con default estable y
  corrección en mount; el contenido es idéntico entre superficies, solo cambia el envoltorio,
  así que un flash de envoltorio no afecta datos ni foco.
- **`ResponsiveModal` puede ser complejidad innecesaria** → mitigación: si molesta, caer al
  fallback `Sheet` lateral en todos los tamaños (decisión 2). No bloquea el resto.
- **Base UI ≠ shadcn sidebar** → ya mitigado eligiendo el shell a mano (decisión 1).

## Migration Plan

1. Prototipar en `app/design/desktop-shell/`, verificar y aprobar visualmente.
2. Portar el shell + layout a `components/finance/dashboard.tsx`; introducir `ResponsiveModal` y
   aplicarlo a las 4 superficies.
3. Revisar `app/login/*` para que se vea bien en escritorio.
4. Actualizar `CLAUDE.md` (responsividad → desktop-first aún responsive; verificación de UI en
   escritorio + móvil).
5. Sin migración de datos ni de API. Rollback = revertir los commits de UI; el backend nunca cambió.

## Open Questions

- ¿La sidebar lista destinos futuros (Cuentas, Reportes) como placeholders inertes, o solo los
  que ya tienen pantalla? Asunción: placeholders inertes mínimos, sin rutas nuevas.
- ¿El login pasa a un layout split (marca / formulario) en escritorio, o basta con centrarlo
  con un `max-w`? Asunción: centrado con `max-w`, salvo que se pida el split.
