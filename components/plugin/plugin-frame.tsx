import Link from "next/link"

export function PluginFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <Link
          href="/dashboard"
          className="flex min-h-11 items-center gap-3 text-title font-semibold"
        >
          <span className="grid size-8 place-items-center rounded-md bg-primary-foreground font-semibold text-primary">
            L
          </span>
          Luca Plan
        </Link>
        <div>
          <h1 className="max-w-sm text-display font-semibold">
            Este mes sí tiene un plan.
          </h1>
          <p className="mt-4 max-w-sm text-body opacity-90">
            Presupuestos que reinician contigo, pagos visibles y tus movimientos
            en un solo lugar.
          </p>
        </div>
        <p className="max-w-sm text-callout opacity-90">
          Tú decides qué asistentes pueden usar tus datos y puedes revocar su
          acceso cuando quieras.
        </p>
      </aside>
      <section className="flex items-center justify-center px-4 py-10 lg:px-12">
        <div className="w-full max-w-md">
          <Link
            href="/dashboard"
            className="mb-8 flex min-h-11 items-center gap-3 text-title font-semibold lg:hidden"
          >
            <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
              L
            </span>
            Luca Plan
          </Link>
          {children}
        </div>
      </section>
    </main>
  )
}
