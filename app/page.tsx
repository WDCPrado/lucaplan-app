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
// entra o se crea la cuenta con el código por correo.
export default function Home() {
  return (
    <main className="relative overflow-x-clip bg-background text-foreground">
      <RevealObserver />
      <LandingNav />
      <Hero />
      <Steps />
      <PlanSection />
      <AccountsSection />
      <AiSection />
      <ConnectSection />
      <OpenSource />
      <Faq />
      <LandingFooter />
    </main>
  )
}
