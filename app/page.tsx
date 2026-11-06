import { redirect } from "next/navigation"
import { connection } from "next/server"
import { isSignupOpen } from "@/arch/v1/infrastructure/auth/login-code"
import { isInstallationEmpty } from "@/arch/v1/infrastructure/database/prisma/setup-deps"
import { AccountsSection } from "@/components/landing/accounts-section"
import { AiSection } from "@/components/landing/ai-section"
import { ConnectSection } from "@/components/landing/connect-section"
import { Faq } from "@/components/landing/faq"
import { Hero } from "@/components/landing/hero"
import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingNav } from "@/components/landing/landing-nav"
import { OpenSource } from "@/components/landing/open-source"
import { PlanSection } from "@/components/landing/plan-section"
import { RevealObserver } from "@/components/landing/reveal-observer"
import { Steps } from "@/components/landing/steps"

// La landing usa el lenguaje de la app (iOS 26): fondo agrupado, celdas sólidas y vidrio solo en
// la barra que flota. Sigue el tema de la persona, claro u oscuro. Todo CTA apunta a /login: ahí se
// entra o, con el registro abierto, se crea la cuenta con el código por correo.
export default async function Home() {
  // SIGNUP_OPEN se lee en cada pedido, no queda congelado en el build.
  await connection()
  // Sin ninguna cuenta, lo primero es la instalación inicial. Si la base no responde, se trata como
  // «no vacía»: la landing no cae por esta consulta.
  if (await isInstallationEmpty().catch(() => false)) redirect("/setup")
  const signupOpen = isSignupOpen()
  return (
    <main className="relative overflow-x-clip bg-background text-foreground">
      <RevealObserver />
      <LandingNav signupOpen={signupOpen} />
      <Hero signupOpen={signupOpen} />
      <Steps signupOpen={signupOpen} />
      <PlanSection />
      <AccountsSection />
      <AiSection />
      <ConnectSection />
      <OpenSource />
      <Faq signupOpen={signupOpen} />
      <LandingFooter />
    </main>
  )
}
