import * as React from "react"

import { cn } from "@/lib/utils"

// Campo del sistema de controles (WDC-188): relleno de tono (surface-2), sin borde, radio 8, alto
// --ctl y texto body (16 en móvil: Safari no hace zoom). Foco y error como anillo interior.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      // Dentro de una hoja (vaul), arrastrar sobre el campo selecciona texto en vez de mover la hoja.
      data-vaul-no-drag
      className={cn(
        "h-(--ctl) w-full min-w-0 rounded-md border-0 bg-secondary px-3 py-1 text-body transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-callout file:font-semibold file:text-foreground placeholder:text-ink-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:outline-2 aria-invalid:-outline-offset-2 aria-invalid:outline-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
