"use client"

import { AccountCard } from "@/components/finance/account-card"
import { useCardCarousel } from "@/hooks/use-card-carousel"
import { accounts } from "./landing-data"

const delay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties

// Cuentas y tarjetas: el mismo carrusel del Inicio (snap, zoom wallet en móvil, drag con mouse).
export function AccountsSection() {
  const { ref, handlers, onScroll } = useCardCarousel()
  return (
    <section
      id="tarjetas"
      className="scroll-mt-24 border-y border-border bg-secondary/50"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8 lg:py-28">
        <div data-reveal className="max-w-2xl">
          <h2 className="text-[clamp(2rem,4.5vw,3rem)] leading-[1.05] font-bold tracking-[-0.03em] text-balance">
            Cada cupo en su moneda.
          </h2>
          <p className="mt-5 text-title-3 font-normal text-pretty text-muted-foreground">
            El cupo nacional en pesos y el internacional en dólares, cada uno
            con su usado y disponible. Nunca se suman.
          </p>
        </div>

        <div
          ref={ref}
          {...handlers}
          onScroll={onScroll}
          data-reveal
          style={delay(100)}
          aria-label="Tarjetas de ejemplo"
          role="group"
          className="-mx-5 mt-10 flex cursor-grab snap-x snap-mandatory scrollbar-none gap-4 overflow-x-auto mask-[linear-gradient(90deg,transparent,black_var(--fade-l,0rem),black_calc(100%-var(--fade-r,2.5rem)),transparent)] px-5 pt-1 pb-4 active:cursor-grabbing lg:mx-0 lg:grid lg:cursor-auto lg:grid-cols-3 lg:overflow-visible lg:px-0 lg:mask-none"
        >
          {accounts.map((a) => (
            <div
              key={a.id}
              data-card
              className="flex w-72 shrink-0 snap-center snap-always lg:w-auto"
            >
              <AccountCard account={a} showConnected />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
