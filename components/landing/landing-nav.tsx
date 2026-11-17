import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { cta } from "./landing-data"

export function LogoMark() {
  return (
    <span
      aria-hidden
      className="grid size-8 place-items-center rounded-md bg-primary text-callout font-semibold text-primary-foreground"
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

// Barra superior con fondo propio (`float`, el mismo de las barras de la app): queda fija arriba y
// el contenido pasa por debajo. Los enlaces de sección solo en escritorio; en móvil, logo y CTA.
export function LandingNav({ signupOpen }: { signupOpen: boolean }) {
  return (
    <nav
      aria-label="Principal"
      className="float sticky top-0 z-40 pt-[env(safe-area-inset-top)]"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="press -ml-1 flex min-h-11 items-center gap-2.5 rounded-md px-1 text-title font-semibold"
        >
          <LogoMark />
          <span className="max-[400px]:sr-only">Luca Plan</span>
        </Link>
        <div className="hidden items-center gap-1 lg:flex">
          {links.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="flex min-h-9 items-center rounded-md px-3 text-callout text-ink-2 transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {signupOpen && (
            <Link href={cta.enter.href} className={buttonVariants({ variant: "ghost" })}>
              {cta.enter.label}
            </Link>
          )}
          <Link
            href={signupOpen ? cta.create.href : cta.enter.href}
            className={buttonVariants()}
          >
            {signupOpen ? cta.create.label : cta.enter.label}
          </Link>
        </div>
      </div>
    </nav>
  )
}
