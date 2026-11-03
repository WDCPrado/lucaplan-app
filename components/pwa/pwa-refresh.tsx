"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Glass } from "glisse"
import { Loader2 } from "lucide-react"

// Isla que refresca al volver a primer plano: el modo standalone (PWA instalada) reanuda la app
// en vez de relanzarla, así que router.refresh() re-consulta los server components sin re-descargar
// el bundle ni perder estado del cliente. Solo se activa instalada; en web el navegador ya lo cubre.
// ponytail: spinner por timeout (router.refresh() no avisa cuándo termina); sube el timeout si el
// refresco tarda y el spinner queda corto.
export function PwaRefresh() {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!window.matchMedia("(display-mode: standalone)").matches) return

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return
      setRefreshing(true)
      router.refresh()
      // router.refresh() no avisa cuándo termina; ocultamos el spinner tras un momento.
      window.setTimeout(() => setRefreshing(false), 900)
    }

    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [router])

  if (!refreshing) return null

  return (
    <div
      aria-hidden
      className="pwa-safe-top pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
    >
      <Glass className="mt-2 rounded-lg p-2">
        <Loader2 className="size-5 animate-spin" />
      </Glass>
    </div>
  )
}
