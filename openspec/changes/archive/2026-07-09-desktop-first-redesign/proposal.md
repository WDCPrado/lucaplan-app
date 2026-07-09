## Why

LucaPlan hoy es **mobile-first**: el dashboard vive en un contenedor angosto (`max-w-md`)
centrado, con bottom-nav fija, carruseles de scroll horizontal y sheets. En escritorio eso
desperdicia el ancho y se ve como una app móvil estirada. El mercado de apps de finanzas
móviles (con tienda de por medio) ya está saturado; el diferenciador de LucaPlan es ser una
**webapp de acceso directo** — se abre en el navegador sin instalar ni pasar por una tienda.
Para que ese acceso valga la pena, la experiencia primaria debe estar diseñada para escritorio,
sin sacrificar el uso en móvil.

## What Changes

- **Nuevo app-shell desktop-first con sidebar** de navegación fija a la izquierda + área de
  contenido ancha. El contenedor deja de ser `max-w-md`; el contenido usa el ancho disponible
  con un `max-w` amplio y layout multi-columna en escritorio.
- **La bottom-nav fija se reemplaza por la sidebar** en escritorio; en móvil el shell colapsa
  (drawer/off-canvas o bottom-nav) para preservar la navegación táctil.
- **El contenido del dashboard se reorganiza para escritorio**: cuentas en grid (no carrusel
  horizontal), y Movimientos / Presupuestos conviven en columnas en vez de apilarse. En móvil
  vuelven a apilarse y los carruseles/scroll horizontal se conservan donde aporten.
- **Superficies contextuales adaptativas**: las acciones que hoy abren un `Sheet` (agregar
  movimiento, editar categoría, detalle) usan `Dialog`/panel centrado en escritorio y `Sheet`
  en móvil, según el tamaño de viewport.
- **Responsividad conservada como invariante** (ya no "mobile-first" sino "desktop-first,
  aún responsive"): sin scroll horizontal accidental, `min-h-dvh`, targets táctiles y texto
  legible en móvil, verificado en un ancho angosto (~375px) y en escritorio, en dark y light.
- Actualizar la doc del repo (`CLAUDE.md`, guía de verificación de UI) que hoy fija
  "mobile-first" y viewport de verificación ~420px, para reflejar la nueva prioridad
  desktop-first sin perder la exigencia de responsividad.

Fuera de alcance: no hay landing pública nueva, no cambia el backend (domain / application /
infrastructure / API), y la paleta / tokens / tipografía / glass del design system se conservan.

## Capabilities

### New Capabilities

- `app-shell`: Estructura de navegación y layout responsive de la app autenticada —
  sidebar desktop-first que colapsa en móvil, contenedor y grid de contenido, superficies
  contextuales (dialog vs sheet según viewport) y las invariantes de responsividad que todas
  las vistas deben cumplir.

### Modified Capabilities

<!-- Ninguna. `design-system` cubre tokens/paleta/tipografía/glass/a11y de contraste, no
     layout ni navegación; sus requisitos no cambian. `budget-planning` y `finance-model`
     son de dominio; no se tocan. -->

## Impact

- **Presentación (UI), sin tocar negocio:**
  - `components/finance/dashboard.tsx` — reescritura del layout (sidebar + grid multi-columna,
    fin de `max-w-md`/`pb-28`/bottom-nav fija).
  - Nuevo componente de app-shell / sidebar (navegación + responsive collapse). Candidato a
    `pnpm dlx shadcn@latest add sidebar` en lugar de escribirlo a mano.
  - `components/finance/add-transaction-sheet.tsx`, `category-modal.tsx`,
    `category-detail-sheet.tsx`, `account-modal.tsx` — comportamiento adaptativo dialog/sheet.
  - `app/login/*` — revisar que el login se vea bien en escritorio (no solo columna angosta).
- **Sin cambios:** `arch/v1/**` (domain/application/infrastructure), `app/api/**`,
  `app/globals.css` (tokens del design system).
- **Documentación:** `CLAUDE.md` (secciones de responsividad y flujo de verificación de UI),
  para pasar de mobile-first a desktop-first manteniendo la responsividad como requisito.
- **Riesgo principal:** regresión en móvil (scroll horizontal, targets pequeños). Se mitiga
  con la invariante de responsividad y verificación en ambos anchos + ambos temas.
