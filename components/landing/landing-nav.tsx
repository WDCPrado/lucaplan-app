import Link from "next/link"
import { cta } from "./landing-data"

export function LogoMark() {
  return (
    <span
      aria-hidden
      className="grid size-8 place-items-center rounded-lg bg-primary text-subheadline font-bold text-primary-foreground"
    >
      L
    </span>
  )
}

const links = [
  ["#empieza", "Cómo empiezas"],
  ["#plan", "El plan"],
  ["#conecta", "Conexión"],
  ["#open-source", "Open source"],
  ["#preguntas", "Preguntas"],
] as const

// Barra flotante de vidrio, como la topbar de la app: el vidrio es la capa que flota sobre el
// contenido. La cápsula no es sticky ella misma (liquid-glass fija position: relative).
export function LandingNav() {
  return (
    <nav
      aria-label="Principal"
      className="sticky top-0 z-40 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:px-4"
    >
      <div className="liquid-glass mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 rounded-full pr-2 pl-4">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2.5 text-headline font-semibold"
        >
          <LogoMark />
          <span className="max-[400px]:sr-only">Luca Plan</span>
        </Link>
        <div className="hidden items-center gap-6 text-subheadline text-muted-foreground lg:flex">
          {links.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="transition-colors duration-150 hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={cta.enter.href}
            className="press flex min-h-10 items-center rounded-full px-4 text-subheadline font-medium hover:bg-foreground/5"
          >
            {cta.enter.label}
          </Link>
          <Link
            href={cta.create.href}
            className="press flex min-h-10 items-center rounded-full bg-primary px-4 text-subheadline font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {cta.create.label}
          </Link>
        </div>
      </div>
    </nav>
  )
}
