"use client"

import { Camera, Check } from "lucide-react"
import { AccountCard } from "@/components/finance/account-card"
import { useCardCarousel } from "@/hooks/use-card-carousel"
import { formatMoney } from "@/lib/finance-format"
import { accounts } from "./landing-data"

const [nat, intl] = accounts[0].buckets ?? []

const delay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties

// Cuentas y tarjetas: el mismo carrusel del Inicio (snap, zoom wallet en móvil, drag con mouse) y,
// al lado, cómo se actualiza un saldo que el correo no avisa: con una captura que tú confirmas.
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

        <div
          data-reveal
          style={delay(160)}
          className="mt-10 grid gap-6 rounded-xl bg-card p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] md:items-center lg:p-6"
        >
          <div>
            <h3 className="flex items-center gap-2 text-title-3 font-bold">
              <Camera aria-hidden className="size-5 text-primary" />
              Actualiza un saldo con una captura
            </h3>
            <p className="mt-2 max-w-xl text-body text-pretty text-muted-foreground">
              Sube hasta 5 capturas de la app de tu banco y la IA lee los
              montos. Tú los revisas antes de guardar, y la imagen se procesa y
              se descarta.
            </p>
          </div>
          {/* Lo que vuelve de la lectura: montos editables que se confirman. */}
          <div aria-hidden className="inset-list overflow-hidden rounded-xl bg-secondary">
            {[
              ["Cupo nacional disponible", formatMoney(nat.available, "CLP")],
              ["Cupo internacional disponible", formatMoney(intl.available, "USD")],
            ].map(([label, value]) => (
              <div key={label} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                <span className="text-subheadline text-muted-foreground">{label}</span>
                <span className="tabular text-subheadline font-semibold">{value}</span>
              </div>
            ))}
            <div className="flex min-h-11 items-center justify-center gap-1.5 px-4 text-body font-semibold text-primary">
              <Check className="size-4" />
              Confirmar saldos
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
