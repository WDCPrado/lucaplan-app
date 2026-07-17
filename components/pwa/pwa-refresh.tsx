"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

// Isla que aporta dos gestos de "traer datos frescos" que el modo standalone (PWA instalada)
// no da solo: (1) refrescar al volver a primer plano —el SO reanuda la app, no la relanza— y
// (2) pull-to-refresh —el navegador solo lo ofrece en pestaña normal—. Ambos usan
// router.refresh(): re-consulta los server components sin re-descargar el bundle ni perder
// estado del cliente. Solo se activa instalada; en web el navegador ya cubre ambos gestos.
// ponytail: umbral fijo + spinner por timeout (no hay callback de fin de refresh); sube el
// umbral o mide la navegación si el refresco tarda y el spinner queda corto.
const THRESHOLD = 70 // px de arrastre para disparar
const MAX_PULL = 120 // tope visual del arrastre

export function PwaRefresh() {
  const router = useRouter()
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)

  useEffect(() => {
    if (!window.matchMedia("(display-mode: standalone)").matches) return

    const refresh = () => {
      setRefreshing(true)
      router.refresh()
      // router.refresh() no avisa cuándo termina; ocultamos el spinner tras un momento.
      window.setTimeout(() => setRefreshing(false), 900)
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh()
    }

    const onTouchStart = (e: TouchEvent) => {
      // Solo desde el tope y con un dedo; ignora si hay un drawer (vaul) tomando el gesto.
      if (
        window.scrollY > 0 ||
        e.touches.length !== 1 ||
        document.querySelector("[data-vaul-drawer]")
      ) {
        startY.current = null
        return
      }
      startY.current = e.touches[0].clientY
    }

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null) return
      const delta = e.touches[0].clientY - startY.current
      if (delta <= 0) {
        setPull(0)
        return
      }
      e.preventDefault() // frena el bounce nativo mientras se tira
      setPull(Math.min(delta, MAX_PULL))
    }

    const onTouchEnd = () => {
      if (startY.current !== null && pull >= THRESHOLD) refresh()
      startY.current = null
      setPull(0)
    }

    document.addEventListener("visibilitychange", onVisibility)
    document.addEventListener("touchstart", onTouchStart, { passive: true })
    document.addEventListener("touchmove", onTouchMove, { passive: false })
    document.addEventListener("touchend", onTouchEnd, { passive: true })
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      document.removeEventListener("touchstart", onTouchStart)
      document.removeEventListener("touchmove", onTouchMove)
      document.removeEventListener("touchend", onTouchEnd)
    }
  }, [router, pull])

  const active = refreshing || pull > 0
  if (!active) return null

  const offset = refreshing ? THRESHOLD : pull
  return (
    <div
      aria-hidden
      className="pwa-safe-top pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
      style={{ transform: `translateY(${offset - MAX_PULL}px)` }}
    >
      <div className="bg-background/90 mt-2 rounded-full border p-2 shadow-md backdrop-blur">
        <Loader2
          className={
            refreshing || pull >= THRESHOLD ? "size-5 animate-spin" : "size-5"
          }
          style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
        />
      </div>
    </div>
  )
}
