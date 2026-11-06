"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

// Botón Copiar de la landing: copia `text`, confirma dos segundos y lo anuncia al lector de pantalla.
export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [state, setState] = useState<"ok" | "error" | null>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState("ok")
    } catch {
      setState("error")
    }
    setTimeout(() => setState(null), 2000)
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="press flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-subheadline text-primary hover:bg-foreground/5"
    >
      {state === "ok" ? (
        <Check aria-hidden className="size-4" />
      ) : (
        <Copy aria-hidden className="size-4" />
      )}
      <span aria-live="polite">
        {state === "ok" ? "Copiado" : state === "error" ? "No se pudo copiar" : label}
      </span>
    </button>
  )
}
