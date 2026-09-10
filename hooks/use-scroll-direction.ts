import * as React from "react"

// Dirección del último scroll de la página, como external store (mismo patrón que useIsMobile:
// sin setState dentro de un effect). Con la página arriba del todo siempre es "up", para que nada
// quede escondido al volver al inicio.
let direction: "up" | "down" = "up"
let lastY = 0
const listeners = new Set<() => void>()

function onScroll() {
  const y = window.scrollY
  const next =
    y <= 0 ? "up" : y > lastY + 4 ? "down" : y < lastY - 4 ? "up" : direction
  lastY = y
  if (next !== direction) {
    direction = next
    listeners.forEach((l) => l())
  }
}

function subscribe(l: () => void) {
  listeners.add(l)
  if (listeners.size === 1)
    window.addEventListener("scroll", onScroll, { passive: true })
  return () => {
    listeners.delete(l)
    if (listeners.size === 0) window.removeEventListener("scroll", onScroll)
  }
}

export function useScrollDirection() {
  return React.useSyncExternalStore(
    subscribe,
    () => direction,
    () => "up" as const
  )
}
