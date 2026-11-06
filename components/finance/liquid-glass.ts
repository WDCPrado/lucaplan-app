"use client"

import * as React from "react"
import type { GlassConfig, LiquidGlass } from "@ybouane/liquidglass"
import { GLASS_DEFAULT, GLASS_MAX, getGlass, subscribeGlass } from "@/lib/glass-level"

// Refracción de Liquid Glass en la barra inferior móvil (WDC-179) con @ybouane/liquidglass: un shader
// WebGL sobre una foto (html-to-image) del contenido de la página. El vidrio CSS (`liquid-glass`) es
// el respaldo y queda tal cual hasta que la librería arranca; recién entonces `data-lg-active` en la
// barra le quita el desenfoque CSS (globals.css) y deja encima solo el relleno de su nivel.
// Requisito de la librería: la barra es hija directa del root (el wrapper del sidebar) y el resto de
// los hijos del root es lo que se ve detrás; por eso <main> pinta su bg-background y vuelve a
// `select-text` (la librería pone user-select: none en el root).
//
// ponytail: techo conocido. (1) La foto es la página entera a devicePixelRatio: en una lista larga
// pasa el tope de área de canvas de iOS (~16,7 MP); al cruzarlo se apaga y vuelve el vidrio CSS.
// (2) Cada cambio del contenido recaptura la página entera (html-to-image, en el hilo principal):
// se agrupa en un debounce, pero en el iPhone puede costar cientos de ms y batería. (3) La librería
// no sigue el scroll: se le avisa en cada frame de scroll. La mejora es capturar solo la franja
// detrás de la barra (PR #6 de ybouane/liquidglass); cuando entre, se sube la versión y se quita (1).

// Se apaga si cualquiera calza. Van separadas por coma (OR) a propósito: un motor que no conoce
// prefers-reduced-transparency la evalúa falsa sola, sin anular las demás.
const OFF_QUERY =
  "(min-width: 768px), (prefers-reduced-transparency: reduce), (prefers-contrast: more), (prefers-reduced-motion: reduce)"
const INIT_TIMEOUT_MS = 3000 // init puede no resolver nunca en Chrome reciente (issue #3 upstream)
const RECAPTURE_DEBOUNCE_MS = 600
const MAX_CANVAS_AREA = 16_000_000

// Nivel 0–3 de Apariencia → shader. El tinte no va aquí: lo pone el --glass-fill CSS del nivel.
// La sombra tampoco: queda la de --glass-shadow.
const BASE: Partial<GlassConfig> = {
  brightness: 0,
  tintStrength: 0,
  shadowOpacity: 0,
  cornerRadius: 32, // h-16 rounded-full
  zRadius: 24,
}
const LEVELS: Partial<GlassConfig>[] = [
  { blurAmount: 0.05, refraction: 0.69, saturation: 0.3 },
  { blurAmount: 0.12, refraction: 0.6, saturation: 0.4 },
  { blurAmount: 0.2, refraction: 0.5, saturation: 0.5 },
  { blurAmount: 0.3, refraction: 0.3, saturation: 0.6 },
]

function subscribeOff(onChange: () => void) {
  const mql = window.matchMedia(OFF_QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

// Devuelve el `data-config` para la barra (o undefined si está apagada). Cambiar de nivel solo
// cambia ese atributo, que la librería observa: no reinicia nada.
export function useLiquidGlassBar(navRef: React.RefObject<HTMLElement | null>) {
  const off = React.useSyncExternalStore(
    subscribeOff,
    () => window.matchMedia(OFF_QUERY).matches,
    () => true
  )
  const level = React.useSyncExternalStore(
    subscribeGlass,
    getGlass,
    () => GLASS_DEFAULT
  )
  const enabled = !off && level < GLASS_MAX

  React.useEffect(() => {
    const nav = navRef.current
    const root = nav?.parentElement
    const main = root?.querySelector<HTMLElement>(":scope > main")
    if (!enabled || !nav || !root || !main) return

    let alive = true
    let failed = false // timeout, sin WebGL o error: el resto de esta sesión queda el vidrio CSS
    let starting = false
    let inst: LiquidGlass | null = null
    let frame = 0
    let recapture = 0

    const fits = () => {
      const dpr = window.devicePixelRatio || 1
      return main.offsetWidth * main.offsetHeight * dpr * dpr < MAX_CANVAS_AREA
    }
    const stop = () => {
      inst?.destroy()
      inst = null
      delete nav.dataset.lgActive
    }
    const start = () => {
      if (inst || starting || failed || !fits()) return
      starting = true
      let timedOut = false
      const timer = window.setTimeout(() => {
        timedOut = failed = true
        starting = false
      }, INIT_TIMEOUT_MS)
      import("@ybouane/liquidglass")
        .then(({ LiquidGlass }) =>
          LiquidGlass.init({ root, glassElements: [nav], defaults: BASE })
        )
        .then(
          (instance) => {
            window.clearTimeout(timer)
            starting = false
            // Llegó tarde, se desmontó o la página creció mientras arrancaba.
            if (timedOut || !alive || !fits()) return instance.destroy()
            inst = instance
            nav.dataset.lgActive = ""
          },
          () => {
            window.clearTimeout(timer)
            starting = false
            failed = true
          }
        )
    }

    // La librería no escucha el scroll: con la barra fija, cada frame de scroll mueve lo de atrás.
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        inst?.markChanged()
      })
    }
    // Contenido o tema distintos con el mismo tamaño: la librería no recaptura sola. `force`
    // conserva la foto anterior hasta que llega la nueva (sin parpadeo en blanco).
    const onContentChange = () => {
      window.clearTimeout(recapture)
      recapture = window.setTimeout(() => {
        void inst?.capture.captureElement(main, true)
      }, RECAPTURE_DEBOUNCE_MS)
    }
    const contentObserver = new MutationObserver(onContentChange)
    contentObserver.observe(main, { childList: true, subtree: true, characterData: true })
    const themeObserver = new MutationObserver(onContentChange)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    const sizeObserver = new ResizeObserver(() => {
      if (!fits()) stop()
      else start()
    })
    sizeObserver.observe(main)

    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll, { passive: true })
    start()

    return () => {
      alive = false
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      cancelAnimationFrame(frame)
      window.clearTimeout(recapture)
      contentObserver.disconnect()
      themeObserver.disconnect()
      sizeObserver.disconnect()
      stop()
    }
  }, [enabled, navRef])

  return enabled ? JSON.stringify(LEVELS[level] ?? LEVELS[GLASS_DEFAULT]) : undefined
}
