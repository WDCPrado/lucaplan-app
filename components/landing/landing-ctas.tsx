import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { cta } from "./landing-data"

// Los dos caminos de la landing. Con el registro cerrado la instancia pública es de su dueño: solo
// queda «Entrar» (crear una cuenta sería un callejón sin salida en /login).
const big = "h-12 px-6"

export function LandingCtas({ signupOpen }: { signupOpen: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {signupOpen && (
        <Link href={cta.create.href} className={cn(buttonVariants(), big)}>
          {cta.create.label}
        </Link>
      )}
      <Link
        href={cta.enter.href}
        className={cn(buttonVariants({ variant: signupOpen ? "secondary" : "default" }), big)}
      >
        {cta.enter.label}
      </Link>
    </div>
  )
}
