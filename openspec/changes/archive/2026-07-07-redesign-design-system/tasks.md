## 1. Tipografía

- [x] 1.1 En `app/layout.tsx`, reemplazar Roboto/Geist_Mono por `IBM_Plex_Sans` (→ `--font-sans`) e `IBM_Plex_Mono` (→ `--font-mono`), con weights explícitos (sans 400/500/600, mono 400/500)
- [x] 1.2 Limpiar imports de fuentes sin uso (Inter/Space_Grotesk/Geist_Mono del estado previo) y ajustar `className` del `<html>`
- [x] 1.3 Verificar que `--font-heading` apunta a `--font-sans` en `@theme inline`

## 2. Paleta y forma (globals.css)

- [x] 2.1 Rediseñar de cero los tokens de color/superficie/semánticos en `:root` (light): slate + primario azul; `success`/`warning`/`destructive` + sidebar-*
- [x] 2.2 Redibujar `chart-1…5` (light) diferenciables entre sí (azul/teal/verde/violeta/ámbar)
- [x] 2.3 Espejar toda la paleta en `.dark` con tonos desaturados/luminosos (no invertidos)
- [x] 2.4 Bajar `--radius` a `0.25rem`; escala derivada `radius-sm…4xl` intacta en fórmula
- [x] 2.5 Recalibrar tokens glass (tint/border/shadow/blur/control) a la nueva paleta, en light y dark
- [x] 2.6 Recalibrar los blobs ambientales del `body` (light y `.dark body`) a azul/teal/slate

## 3. Reglas de números y migración de literales

- [x] 3.1 Definir la convención de montos: utilidad `.tabular` (`font-mono` + `tabular-nums slashed-zero`)
- [x] 3.2 Auditar `.tsx` por literales de color/radio: UI de producción (login) limpia; hex hardcodeados solo en el prototipo `app/design/dashboard` (colores de categoría = datos demo, fuera de alcance)
- [x] 3.3 Montos ya usan `tabular-nums` en el prototipo; sin montos en la UI de producción

## 4. Verificación

- [x] 4.1 `pnpm typecheck` y `pnpm build` sin errores
- [ ] 4.2 Revisar login/register en 375px y desktop, light y dark: sin scroll horizontal, radius nítido, glass visible (requiere revisión visual del usuario)
- [x] 4.3 Contraste AA (≥4.5:1) verificado por cálculo OKLCH→WCAG en pares clave, ambos modos (ajustado `success` light a 0.55L → 4.55)
- [x] 4.4 `prefers-reduced-transparency: reduce` cae a `--card` sólido (garantía por CSS)

## 5. Documentación

- [x] 5.1 Actualizar `docs/design/design-system.md`: paleta azul/slate, `--radius: 0.25rem`, IBM Plex, regla `.tabular`, glass recalibrado
