import Link from "next/link"
import { cta } from "./landing-data"

// Los dos caminos de la landing. Con el registro cerrado la instancia pública es de su dueño: solo
// queda «Entrar» (crear una cuenta sería un callejón sin salida en /login).
export function LandingCtas({ signupOpen }: { signupOpen: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {signupOpen && (
        <Link
          href={cta.create.href}
          className="press flex min-h-12 items-center rounded-full bg-primary px-6 text-body font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {cta.create.label}
        </Link>
      )}
      <Link
        href={cta.enter.href}
        className={
          signupOpen
            ? "press flex min-h-12 items-center rounded-full bg-(--glass-control) px-6 text-body font-medium hover:bg-foreground/10"
            : "press flex min-h-12 items-center rounded-full bg-primary px-6 text-body font-semibold text-primary-foreground hover:bg-primary/90"
        }
      >
        {cta.enter.label}
      </Link>
    </div>
  )
}
