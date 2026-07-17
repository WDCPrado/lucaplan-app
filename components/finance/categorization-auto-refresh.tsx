"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

// Mientras la categorización de fondo avanza (tras conectar/sincronizar), el dashboard no se entera
// solo. Este componente sondea `/api/fintoc/status` y, cada vez que baja el nº de movimientos sin
// categoría, hace `router.refresh()` para re-traer los datos del servidor. Se detiene cuando el
// conteo se estabiliza (categorización terminada) o al tope de tiempo. Solo se monta si el usuario
// tiene cuentas conectadas (ver dashboard). No renderiza nada.
export function CategorizationAutoRefresh() {
  const router = useRouter()
  const last = useRef<number | null>(null)
  const stable = useRef(0)

  useEffect(() => {
    let active = true
    let tries = 0
    const MAX_TRIES = 75 // 75 × 4s = 5 min de tope

    const id = setInterval(async () => {
      if (!active) return
      tries++
      let uncategorized: number | null = null
      try {
        const res = await fetch("/api/fintoc/status", { cache: "no-store" })
        if (res.ok) {
          const s = await res.json()
          if (typeof s?.uncategorized === "number")
            uncategorized = s.uncategorized
        }
      } catch {
        return // error puntual de red → reintenta en el próximo tick
      }
      if (uncategorized === null) return

      if (last.current === null) {
        last.current = uncategorized
      } else if (uncategorized < last.current) {
        last.current = uncategorized
        stable.current = 0
        router.refresh() // avanzó la categorización → refrescar datos
      } else if (++stable.current >= 3 || tries >= MAX_TRIES) {
        active = false
        clearInterval(id) // estable (terminó) o tope → dejar de sondear
      }
    }, 4000)

    return () => {
      active = false
      clearInterval(id)
    }
  }, [router])

  return null
}
