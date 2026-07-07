## Context

El look actual (glassmorphism esmeralda, `--radius: 0.85rem`, Roboto + Geist Mono) prioriza
suavidad sobre densidad de datos. Para una app de planificación financiera, los números son el
contenido principal y hoy no tienen tipografía tabular pensada para análisis. Fuente de verdad
del sistema: [app/globals.css](../../../../app/globals.css) (tokens + `@theme inline` + glass) y
[app/layout.tsx](../../../../app/layout.tsx) (fuentes). Doc: `docs/design/design-system.md`.

Restricciones fijas (decididas con el usuario): mantener liquid glass como técnica; radius casi
recto; IBM Plex Sans/Mono; rediseñar la paleta de cero. Tailwind v4, shadcn/ui + Base UI,
`next-themes`. No introducir otra librería de componentes ni deps npm nuevas.

## Goals / Non-Goals

**Goals:**
- Paleta rediseñada de cero, sobria y financiera, conservando los nombres de token.
- `--radius: 0.25rem` y escala derivada recalibrada.
- IBM Plex Sans (texto) + IBM Plex Mono (cifras) con `tabular-nums` para montos.
- Glass recalibrado a la nueva paleta, coherente con el look sobrio.
- Doc del design system actualizada.

**Non-Goals:**
- Rediseñar layouts o componentes concretos (solo el sistema/tokens; la UI hereda vía tokens).
- Construir el dominio financiero (presupuestos/gastos/metas).
- Cambiar la librería de componentes o agregar dependencias npm.

## Decisions

- **Conservar nombres de token, cambiar solo valores.** La UI ya tira de `bg-card`,
  `text-success`, etc. Redibujar valores en `:root`/`.dark` propaga el rediseño sin tocar
  componentes. Alternativa (renombrar tokens): rota toda la UI sin beneficio → descartada.

- **`--radius: 0.25rem` como base, escala derivada intacta en fórmula.** `globals.css` ya deriva
  `radius-sm…4xl` de `--radius` con multiplicadores; basta cambiar la base. Revisar que los
  multiplicadores grandes (`4xl` = 2.6×) sigan teniendo sentido con base pequeña; si `4xl` queda
  irrelevante, se acepta (casi no se usa con esquinas rectas).

- **IBM Plex vía `next/font/google`.** Igual patrón que hoy (Roboto/Geist_Mono). `IBM_Plex_Sans`
  y `IBM_Plex_Mono` requieren `weight` explícito (no son variable fonts en next/font). Mapear a
  `--font-sans` y `--font-mono`; `--font-heading` sigue apuntando a `--font-sans`. Limpiar el
  import de `Geist` que ya estaba sin uso. Alternativa (Inter): buen tabular pero el usuario
  eligió Plex por su look de "ingeniería financiera" → Plex.

- **Números = `font-mono` + `tabular-nums`.** Regla de uso documentada; no es un token sino una
  convención de clase. Donde ya se listen montos, aplicar `font-mono tabular-nums`.

- **Paleta: elegir primario + neutros + semánticos de cero en OKLCH.** Mantener OKLCH (ya en uso,
  buen control perceptual de contraste). Verificar AA en ambos modos antes de cerrar valores.
  `success`/`warning`/`destructive` y `chart-1…5` diferenciables entre sí.

- **Glass recalibrado, no removido.** Ajustar `--glass-tint/border/shadow/blur` y los blobs del
  `body` a la nueva paleta para que el efecto no desentone con el look sobrio (blobs más tenues
  si la paleta es más fría/neutra).

## Risks / Trade-offs

- **Contraste roto por la paleta nueva** → verificar AA (≥4.5:1) en cada par texto/fondo en light
  y dark antes de dar por cerrada la paleta; el spec lo exige por escenario.
- **Glass invisible si la paleta pierde vivacidad de fondo** → el efecto necesita blobs vívidos;
  recalibrar blobs junto con la paleta, no después.
- **IBM Plex Mono ancho puede desbordar en móvil** → usar mono solo en cifras, no en texto largo;
  probar montos largos en 375px.
- **Componentes con valores hardcodeados** no heredan el rediseño → auditar rápido `.tsx` en
  busca de literales de color/radio y migrarlos a tokens.
- **`next/font` Plex requiere weights explícitos** → declarar los weights usados (p.ej. 400/500/600
  sans; 400/500 mono) para no inflar el bundle.

## Migration Plan

1. Editar `app/globals.css`: paleta `:root` + `.dark`, `--radius`, tokens glass, blobs del `body`.
2. Editar `app/layout.tsx`: cambiar fuentes a IBM Plex Sans/Mono, limpiar imports huérfanos.
3. Auditar `.tsx` por literales de color/radio; migrar a tokens.
4. Verificar en 375px y desktop, light y dark: contraste AA, glass visible, montos tabulares.
5. Actualizar `docs/design/design-system.md`.
Rollback: revertir el commit; no hay migración de datos ni cambios de API.

## Open Questions

- ¿Primario nuevo? (¿se conserva la familia verde-dinero o se va a azul/teal más neutro?) — a
  decidir al elegir valores de paleta; no bloquea el resto del plan.
- ¿Weights exactos de Plex Sans/Mono a cargar? — fijar según lo que use la UI actual.
