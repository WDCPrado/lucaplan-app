## 1. Prototipo del shell en app/design

- [x] 1.1 Crear `app/design/desktop-shell/page.tsx`: mock funcional (datos en memoria) del shell desktop-first — sidebar fija a la izquierda en `lg`+ con `<aside>` (`hidden lg:flex`), contenido ancho a la derecha
- [x] 1.2 Agregar el drawer móvil: botón que abre el `Sheet` ya instalado (`components/ui/sheet.tsx`) con los mismos enlaces de navegación; sin espacio permanente en `< lg`
- [x] 1.3 Registrar el mock en el índice `app/design/page.tsx`
- [x] 1.4 Verificar con Playwright a ~375px y en escritorio, dark + light; guardar `app/design/desktop-shell/preview.png` y mostrarlo. Iterar hasta el visto bueno del usuario

## 2. Portar el shell al dashboard real

Se extrajo el shell a un componente reutilizable `components/finance/app-shell.tsx` (shadcn
`sidebar` colapsable + drawer móvil + dropdown de usuario con toggle de tema + FAB "agregar").

- [x] 2.1 En `components/finance/dashboard.tsx`: reemplazado el contenedor `max-w-md` + `pb-28` por `AppShell` + área de contenido `max-w-6xl`
- [x] 2.2 Eliminada la bottom-nav fija; la navegación vive en la sidebar (desktop) y en el drawer (móvil, vía shadcn `Sheet`)
- [x] 2.3 La sidebar lista solo destinos existentes (Inicio · Movimientos · Presupuestos); Movimientos/Presupuestos hacen scroll a su sección, sin rutas nuevas

## 3. Layout de contenido multi-columna

- [x] 3.1 Cuentas: carrusel → `grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3` (`AccountCard` pasó a `w-full`)
- [x] 3.2 Movimientos (`lg:col-span-2`) y Presupuestos (`lg:col-span-1`) en columnas paralelas en `lg`; apilados en móvil
- [x] 3.3 Sin scroll horizontal de página en ningún ancho (chips de cuenta/banco pasaron a `flex-wrap`)

## 4. Superficies contextuales adaptativas

- [x] 4.1 Reutilizado `useIsMobile` (`hooks/use-mobile.ts`, instalado con el sidebar de shadcn) en vez de crear `useIsDesktop`; reescrito con `useSyncExternalStore` (SSR → desktop, sin setState-en-effect)
- [x] 4.2 Creado `ResponsiveModal` (`components/ui/responsive-modal.tsx`): `Dialog` en escritorio, `Sheet` inferior en móvil, contenido compartido, blindado contra desbordes horizontales
- [x] 4.3 Aplicado `ResponsiveModal` a `add-transaction-sheet.tsx`, `category-modal.tsx`, `category-detail-sheet.tsx`, `account-modal.tsx` sin duplicar formularios

## 5. Login responsive en escritorio

- [x] 5.1 `app/login/*` verificado: glass card centrado con `max-w-md` + toggle de tema; se ve bien en escritorio y móvil. Sin cambios necesarios (ya era responsive)

## 6. Documentación

- [x] 6.1 `CLAUDE.md` actualizado: responsividad de "mobile-first" → "desktop-first, aún responsive"; verificación de UI en escritorio + móvil; nota del bug de caché de Turbopack al crear rutas en caliente

## 7. Verificación final

- [x] 7.1 Layout verificado con Playwright (escritorio ~1440px + móvil ~390px, dark + light) sobre el mock `app/design/desktop-shell` — idéntico al dashboard real (mismo `AppShell` + superficies). El dashboard autenticado (`/`) no fue capturable: el registro devuelve 403 (signup deshabilitado) y no hay credenciales; el usuario puede verlo con su sesión
- [x] 7.2 `pnpm lint` (0 errores; 2 warnings ajenos preexistentes) y `pnpm typecheck` sin errores
- [x] 7.3 Screenshot de referencia guardado en `app/design/desktop-shell/preview.png` y mostrado al usuario
