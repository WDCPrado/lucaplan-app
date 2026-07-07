## 1. Tipografía

- [ ] 1.1 En `app/layout.tsx`, reemplazar Roboto/Geist_Mono por `IBM_Plex_Sans` (→ `--font-sans`) e `IBM_Plex_Mono` (→ `--font-mono`), con weights explícitos (sans 400/500/600, mono 400/500)
- [ ] 1.2 Limpiar imports de fuentes sin uso (el `Geist` importado y no usado, Roboto, Geist_Mono) y ajustar `className` del `<html>`
- [ ] 1.3 Verificar que `--font-heading` sigue apuntando a `--font-sans` en `@theme inline`

## 2. Paleta y forma (globals.css)

- [ ] 2.1 Rediseñar de cero los tokens de color/superficie/semánticos en `:root` (light): `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `success`, `warning`, `destructive`, `border`, `input`, `ring`, `sidebar-*`
- [ ] 2.2 Redibujar `chart-1…5` (light) diferenciables entre sí
- [ ] 2.3 Espejar toda la paleta en `.dark` con tonos desaturados/luminosos (no invertidos)
- [ ] 2.4 Bajar `--radius` a `0.25rem` y revisar la escala derivada `radius-sm…4xl` en `@theme inline`
- [ ] 2.5 Recalibrar tokens glass (`--glass-tint-1/2`, `--glass-border`, `--glass-shadow`, `--glass-blur`, `--glass-control`/`-active`) a la nueva paleta, en light y dark
- [ ] 2.6 Recalibrar los blobs ambientales del `body` (light y `.dark body`) para que el glass siga visible con la nueva paleta

## 3. Reglas de números y migración de literales

- [ ] 3.1 Definir/documentar la convención de montos: `font-mono` + `tabular-nums` (+ `slashed-zero` donde aplique)
- [ ] 3.2 Auditar `.tsx` en busca de literales de color/radio hardcodeados y migrarlos a tokens
- [ ] 3.3 Aplicar `font-mono tabular-nums` donde ya se rendericen montos/cifras

## 4. Verificación

- [ ] 4.1 `pnpm typecheck` y `pnpm build` sin errores
- [ ] 4.2 Revisar login/register en 375px y desktop, light y dark: sin scroll horizontal, radius nítido, glass visible
- [ ] 4.3 Verificar contraste AA (≥4.5:1) en pares texto/fondo clave en ambos modos
- [ ] 4.4 Verificar `prefers-reduced-transparency: reduce` (glass cae a `--card` sólido)

## 5. Documentación

- [ ] 5.1 Actualizar `docs/design/design-system.md`: nueva paleta, `--radius: 0.25rem`, tipografía IBM Plex, regla de cifras tabulares y notas de glass recalibrado
