import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

// Galería de mocks de diseño. Agrega aquí cada vista nueva (carpeta en app/design/<slug>).
const mocks = [
  {
    slug: "desktop-shell",
    title: "Shell desktop-first",
    desc: "Sidebar + drawer móvil, layout multi-columna responsive",
  },
  {
    slug: "dashboard",
    title: "Dashboard · Inicio",
    desc: "Balance, scroll de cuentas y movimientos",
  },
  {
    slug: "email-snapshot",
    title: "Outlook · Revisión y snapshot",
    desc: "Tarjetas editables de candidatos con saldos total/disponible",
  },
  {
    slug: "ux-audit",
    title: "Auditoría UX · propuesta",
    desc: "Inicio, movimientos, recurrentes, cuotas y ajustes rediseñados",
  },
]

export default function DesignIndex() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto max-w-md px-5 py-10">
        <p className="text-sm text-muted-foreground">Mocks de diseño</p>
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          Luca Plan · Design
        </h1>

        <ul className="mt-8 space-y-3">
          {mocks.map((m) => (
            <li key={m.slug}>
              <Link
                href={`/design/${m.slug}`}
                className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
              >
                <div>
                  <p className="font-medium">{m.title}</p>
                  <p className="text-sm text-muted-foreground">{m.desc}</p>
                </div>
                <ArrowUpRight className="size-5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
