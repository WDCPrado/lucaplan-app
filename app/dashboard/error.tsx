"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function DashboardError({ retry }: { retry: () => void }) {
  return (
    <main data-product className="mx-auto max-w-xl px-5 py-12">
      <div
        role="alert"
        className="space-y-4 rounded-xl border border-border bg-card p-6"
      >
        <h1 className="font-heading text-xl font-semibold">
          No pudimos cargar tu plan
        </h1>
        <p className="text-sm text-muted-foreground">
          Intenta cargarlo otra vez. Si el problema continúa, vuelve a entrar a
          tu cuenta.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => retry()} className="min-h-11">
            Volver a intentar
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/login">Ir al inicio de sesión</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
