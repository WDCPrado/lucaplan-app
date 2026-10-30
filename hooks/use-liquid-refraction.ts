import * as React from "react"

// Refracción real del Liquid Glass (mejora progresiva). Solo Chromium dibuja un filtro SVG en
// backdrop-filter; Safari y Firefox aceptan `url()` en CSS.supports pero no lo pintan, así que no hay
// detección por capacidad fiable: se exige además `navigator.userAgentData` (Client Hints), que solo
// existe en Blink (Chrome, Edge, Opera, Samsung, Android) y no en WebKit —tampoco en Chrome de iOS—
// ni en Gecko. Fuera de eso, o en gama baja o con ahorro de datos, no se descarga nada y el vidrio
// CSS queda igual.
type Nav = Navigator & {
  userAgentData?: unknown
  deviceMemory?: number
  connection?: { saveData?: boolean }
}

function canRefract() {
  const nav = navigator as Nav
  return (
    !!nav.userAgentData &&
    CSS.supports("backdrop-filter", "url(#a)") &&
    !nav.connection?.saveData &&
    (nav.hardwareConcurrency ?? 0) > 4 &&
    (nav.deviceMemory ?? 8) > 4
  )
}

/** Suma la refracción al `liquid-glass` del elemento cuando el navegador la dibuja. */
export function useLiquidRefraction<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  React.useEffect(() => {
    const el = ref.current
    if (!el || !canRefract()) return
    let detach: (() => void) | undefined
    let started = false
    let cancelled = false
    // Solo se descarga y se monta cuando el elemento es vidrio visible en este ancho: la barra
    // inferior y la cápsula móvil del mes no cuentan en escritorio (ocultas, o sin vidrio). Si el
    // ancho cruza el corte de md, se vuelve a mirar.
    const wide = window.matchMedia("(min-width: 48rem)")
    function start() {
      if (started || !el!.offsetWidth || getComputedStyle(el!).backdropFilter === "none") return
      started = true
      wide.removeEventListener("change", start)
      import("@/lib/liquid-refraction-dom").then(({ attachRefraction }) => {
        if (!cancelled) detach = attachRefraction(el!)
      })
    }
    start()
    if (!started) wide.addEventListener("change", start)
    return () => {
      cancelled = true
      wide.removeEventListener("change", start)
      detach?.()
    }
  }, [ref])
}
