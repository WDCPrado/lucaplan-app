"use client"

import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/finance/app-shell"

// La cartola no se pudo leer (base caída, red): el marco queda y la lista cede su lugar a un aviso
// con Reintentar, que vuelve a pedir la página sin recargar la app.
export default function MovementsError({ retry }: { retry: () => void }) {
  return (
    <AppShell>
      <div className="page-container">
        <div
          role="alert"
          className="flex flex-col items-start gap-1 rounded-xl bg-card p-(--pad-card)"
        >
          <p className="text-title font-semibold">
            No se pudieron cargar los movimientos
          </p>
          <p className="text-callout text-ink-2">
            Revisa tu conexión e inténtalo otra vez.
          </p>
          <Button type="button" onClick={retry} className="mt-3">
            Reintentar
          </Button>
        </div>
      </div>
    </AppShell>
  )
}
