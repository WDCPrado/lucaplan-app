import * as React from "react"

import { cn } from "@/lib/utils"

// Como Input: relleno de tono, radio 8, texto body y foco interior.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      // Dentro de una hoja (vaul), arrastrar sobre el campo selecciona texto en vez de mover la hoja.
      data-vaul-no-drag
      className={cn(
        "flex field-sizing-content min-h-22 w-full resize-none rounded-md border-0 bg-secondary px-3 py-3 text-body transition-colors outline-none placeholder:text-ink-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:outline-2 aria-invalid:-outline-offset-2 aria-invalid:outline-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
