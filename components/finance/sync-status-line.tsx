"use client"

import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"

// Cadencia nominal de actualización de un banco conectado (el banco refresca por su lado y avisa por
// webhook; esto es la referencia visual de "próxima ~actualización").
const INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 h

function ago(ms: number): string {
  const m = Math.floor(ms / 60000)
  if (m < 1) return "recién"
  if (m < 60) return `hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

function until(ms: number): string {
  if (ms <= 0) return "pronto"
  const m = Math.floor(ms / 60000)
  if (m < 60) return `en ${m} min`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `en ${h} h ${rem} min` : `en ${h} h`
}

// Línea "Actualizado hace X · próxima en Y" para tarjetas de cuentas conectadas. Refresca el reloj
// cada 30s. Renderiza null hasta montar (evita mismatch de hidratación por usar la hora del cliente).
export function SyncStatusLine({ lastSyncedAt }: { lastSyncedAt: string }) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(Date.now())) // set inicial (tras montar)
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(id)
    }
  }, [])

  if (now === null) return null
  const last = new Date(lastSyncedAt).getTime()

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-white/70">
      <RefreshCw className="size-3 shrink-0" />
      <span className="truncate">
        Actualizado {ago(now - last)} <span className="text-white/40">·</span>{" "}
        próxima {until(last + INTERVAL_MS - now)}
      </span>
    </div>
  )
}
