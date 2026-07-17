"use client"

import { useCallback, useRef } from "react"

// Arrastrar-para-scrollear horizontal con el mouse (en touch el scroll ya es nativo, así que
// solo interceptamos punteros de tipo mouse). Convive con CSS scroll-snap mandatory: durante
// el drag se desactiva el snap (si no, cada asignación de scrollLeft re-snapea y el arrastre
// se traba) y al soltar se anima suave hasta el hijo snap más cercano. Si hubo arrastre real,
// se suprime el click fantasma para no abrir la tarjeta bajo el cursor.
export function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 })

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = ref.current
    if (!el || e.pointerType !== "mouse" || e.button !== 0) return
    drag.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startLeft: el.scrollLeft,
    }
    el.style.scrollSnapType = "none"
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const el = ref.current
    if (!el || !drag.current.active) return
    const delta = e.clientX - drag.current.startX
    if (Math.abs(delta) > 5) drag.current.moved = true
    el.scrollLeft = drag.current.startLeft - delta
  }, [])

  const stop = useCallback(() => {
    const el = ref.current
    if (!el || !drag.current.active) return
    drag.current.active = false

    if (drag.current.moved) {
      // Click fantasma: el pointerup tras arrastrar genera un click sobre la tarjeta.
      el.addEventListener("click", (ev) => ev.stopPropagation(), {
        capture: true,
        once: true,
      })
    }

    // Snap manual al hijo más cercano (smooth); el snap CSS vuelve cuando termina el scroll.
    // Si los ítems están marcados con [data-card] se usan solo esos (evita overlays colados).
    const style = getComputedStyle(el)
    const pad = parseFloat(style.scrollPaddingLeft) || 0
    const marked = el.querySelectorAll(":scope > [data-card]")
    const items = marked.length ? Array.from(marked) : Array.from(el.children)
    let target = el.scrollLeft
    let best = Infinity
    for (const child of items) {
      const left = (child as HTMLElement).offsetLeft - el.offsetLeft - pad
      const dist = Math.abs(left - el.scrollLeft)
      if (dist < best) {
        best = dist
        target = left
      }
    }
    const restore = () => {
      el.style.scrollSnapType = ""
      el.removeEventListener("scrollend", restore)
    }
    el.addEventListener("scrollend", restore)
    setTimeout(restore, 600) // ponytail: fallback para navegadores sin scrollend (Safari)
    el.scrollTo({
      left: Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth)),
      behavior: "smooth",
    })
  }, [])

  return {
    ref,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: stop,
      onPointerLeave: stop,
    },
  }
}
