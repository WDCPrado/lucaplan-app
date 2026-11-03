"use client"

import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/finance/app-shell"

// La cartola no se pudo leer (base caída, red): el marco queda y la lista cede su lugar a un aviso
// con Reintentar, que vuelve a pedir la página sin recargar la app.
export default function MovementsError({ retry }: { retry: () => void }) {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-4 pt-1 pb-6 md:pt-6 lg:px-8">
        <div
          role="alert"
          className="glass flex flex-col items-center gap-1 rounded-xl px-6 py-12 text-center"
        >
          <p className="text-headline font-semibold">
            No se pudieron cargar los movimientos
          </p>
          <p className="text-subheadline text-balance text-muted-foreground">
            Revisa tu conexión e inténtalo otra vez.
          </p>
          <Button type="button" onClick={retry} className="mt-4">
            Reintentar
          </Button>
        </div>
      </div>
    </AppShell>
  )
}
