import Link from "next/link"

export function PluginFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <Link
          href="/dashboard"
          className="flex min-h-11 items-center gap-2.5 text-lg font-semibold"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-primary-foreground text-sm font-bold text-primary">
            L
          </span>
          Luca Plan
        </Link>
        <div>
          <h1 className="max-w-sm font-heading text-5xl font-semibold tracking-tight">
            Este mes sí tiene un plan.
          </h1>
          <p className="mt-5 max-w-sm text-lg leading-8">
            Presupuestos que reinician contigo, pagos visibles y tus movimientos
            en un solo lugar.
          </p>
        </div>
        <p className="max-w-sm text-sm leading-6">
          Tú decides qué asistentes pueden usar tus datos y puedes revocar su
          acceso cuando quieras.
        </p>
      </aside>
      <section className="flex items-center justify-center px-4 py-10 lg:px-12">
        <div className="w-full max-w-md">
          <Link
            href="/dashboard"
            className="mb-8 flex min-h-11 items-center gap-2.5 font-heading text-lg font-semibold lg:hidden"
          >
            <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
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
