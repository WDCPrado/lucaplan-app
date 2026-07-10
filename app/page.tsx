"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect } from "react"
import { ArrowLeftRight, ArrowRight, LockKeyhole } from "lucide-react"

const recurringPayments = [
  ["Arriendo", "28 jul", "$520.000"],
  ["Internet", "02 ago", "$19.990"],
  ["Netflix", "08 ago", "$9.490"],
] as const

const monthStats = [
  ["Lo que entra", "$1.480.000", "Tus ingresos del mes"],
  ["Lo que reservaste", "$850.000", "Categorías con un límite real"],
  ["Lo que queda", "$429.500", "Espacio para decidir hoy"],
] as const

const delay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties

export default function Home() {
  // ponytail: useEffect legítimo — sincroniza con IntersectionObserver (sistema externo al render)
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible")
            io.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    )
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <main data-landing className="overflow-hidden bg-background text-foreground">
      <section className="landing-glow relative overflow-hidden border-b border-border">
        <nav
          className="relative z-10 mx-auto flex h-20 max-w-[88rem] items-center justify-between px-6 lg:px-10"
          aria-label="Principal"
        >
          <Link
            href="/"
            className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.04em]"
          >
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              L
            </span>
            LucaPlan
          </Link>
          <div className="hidden items-center gap-8 text-sm text-muted-foreground lg:flex">
            <a href="#mes" className="transition-colors hover:text-foreground">
              El mes
            </a>
            <a
              href="#recurrentes"
              className="transition-colors hover:text-foreground"
            >
              Recurrentes
            </a>
            <a
              href="#conecta"
              className="transition-colors hover:text-foreground"
            >
              Conecta tu banco
            </a>
          </div>
          <Link
            href="/login"
            className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors duration-200 hover:border-foreground hover:bg-foreground hover:text-background"
          >
            Entrar
          </Link>
        </nav>

        <div className="relative z-10 mx-auto grid max-w-[88rem] gap-12 px-6 pt-10 pb-16 lg:grid-cols-[0.92fr_1.08fr] lg:px-10 lg:pt-16 lg:pb-24">
          <div className="flex max-w-2xl flex-col justify-center py-6 lg:py-12">
            <p
              data-reveal
              className="text-sm font-semibold text-primary"
            >
              Finanzas personales, por mes
            </p>
            <h1
              data-reveal
              style={delay(80)}
              className="mt-6 max-w-[10ch] text-6xl leading-[0.92] font-semibold tracking-[-0.055em] text-balance lg:text-8xl"
            >
              Este mes <span className="text-primary">sí</span> tiene un plan.
            </h1>
            <p
              data-reveal
              style={delay(160)}
              className="mt-7 max-w-md text-lg leading-8 text-muted-foreground"
            >
              Presupuestos que reinician contigo, pagos recurrentes visibles y
              tus movimientos en un solo lugar.
            </p>
            <div
              data-reveal
              style={delay(240)}
              className="mt-9 flex flex-wrap items-center gap-5"
            >
              <Link
                href="/login"
                className="rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/30 active:translate-y-0 active:scale-[0.98]"
              >
                Crear mi plan
              </Link>
              <a
                href="#mes"
                className="group inline-flex items-center gap-1.5 text-sm font-medium text-foreground"
              >
                Ver el sistema
                <ArrowRight
                  className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </a>
            </div>
          </div>

          <div
            data-reveal
            style={delay(160)}
            className="relative mx-auto w-full max-w-[46rem] lg:mr-0"
          >
            <div className="relative aspect-[1.15/1] overflow-hidden rounded-3xl border border-border shadow-2xl">
              <Image
                src="/monthly-system.webp"
                alt="Sistema visual de planificación mensual de LucaPlan"
                fill
                unoptimized
                priority
                sizes="(min-width: 1024px) 54vw, 100vw"
                className="object-cover object-[62%_52%]"
              />
              <div className="absolute inset-x-5 bottom-5 rounded-2xl border border-white/50 bg-white/80 p-5 backdrop-blur-xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      Presupuesto de julio
                    </p>
                    <p className="mt-1 text-2xl font-semibold tracking-[-0.04em]">
                      $429.500{" "}
                      <span className="text-base font-normal text-muted-foreground">
                        disponibles
                      </span>
                    </p>
                  </div>
                  <span className="hidden rounded-full bg-success/10 px-3 py-1.5 text-xs font-semibold text-success sm:block">
                    Vas bien
                  </span>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-border">
                  <div
                    className="landing-bar h-full rounded-full bg-primary"
                    style={{ "--bar": "57%" } as React.CSSProperties}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  $850.000 reservados de $1.480.000
                </p>
              </div>
            </div>
            <div className="absolute -top-5 -left-6 hidden rounded-2xl border border-border bg-card px-5 py-4 shadow-lg lg:block">
              <p className="text-xs text-muted-foreground">Próximo pago</p>
              <p className="mt-1 font-medium">Spotify, mañana</p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="mes"
        className="mx-auto grid max-w-[88rem] gap-12 px-6 py-24 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16 lg:px-10 lg:py-32"
      >
        <div data-reveal className="lg:pt-2">
          <p className="text-sm font-semibold text-primary">
            Presupuesto mensual
          </p>
          <h2 className="mt-5 max-w-sm text-4xl leading-[0.98] font-semibold tracking-[-0.05em] lg:text-5xl">
            No lleves una cuenta eterna.
          </h2>
        </div>
        <div className="lg:border-l lg:border-border lg:pl-16">
          <p
            data-reveal
            style={delay(100)}
            className="max-w-2xl text-2xl leading-snug tracking-[-0.02em] text-foreground/80 lg:text-3xl"
          >
            Cada mes parte limpio. LucaPlan convierte tus gastos reales en
            decisiones para ahora, no en una cifra acumulada que ya no dice
            nada.
          </p>
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-[1.2fr_0.8fr]">
            {monthStats.map(([label, value, detail], index) => (
              <div
                key={label}
                data-reveal
                style={delay(index * 100)}
                className={`bg-card p-6 ${index === 0 ? "sm:col-span-2" : ""}`}
              >
                <p className="text-sm text-muted-foreground">{label}</p>
                <p
                  className={`tabular mt-9 text-3xl font-semibold tracking-[-0.04em] ${index === 2 ? "text-success" : ""}`}
                >
                  {value}
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="recurrentes"
        className="border-y border-border bg-secondary/60"
      >
        <div className="mx-auto grid max-w-[88rem] gap-14 px-6 py-24 lg:grid-cols-[0.9fr_1.1fr] lg:px-10 lg:py-32">
          <div data-reveal>
            <p className="text-sm font-semibold text-primary">Recurrentes</p>
            <h2 className="mt-5 max-w-md text-4xl leading-[0.98] font-semibold tracking-[-0.05em] lg:text-5xl">
              Lo que vuelve, se ve antes.
            </h2>
            <p className="mt-7 max-w-lg text-lg leading-8 text-muted-foreground">
              Arriendo, suscripciones o cuotas. Cada cobro frecuente queda en su
              lugar antes de que repartas el resto de tu plata.
            </p>
          </div>
          <div
            data-reveal
            style={delay(150)}
            className="self-end rounded-3xl border border-border bg-card p-3 shadow-xl shadow-primary/5"
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-5">
              <p className="font-medium">Próximos pagos</p>
              <p className="text-sm text-muted-foreground">Julio y agosto</p>
            </div>
            <div className="space-y-1">
              {recurringPayments.map(([name, date, value]) => (
                <div
                  key={name}
                  className="flex items-center gap-4 rounded-xl px-4 py-4 transition-colors duration-200 hover:bg-accent/60"
                >
                  <span className="grid size-10 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                    {name[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{name}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {date}
                    </p>
                  </div>
                  <p className="tabular text-sm font-medium">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-border px-4 py-4 text-sm">
              <p className="text-muted-foreground">Total del mes</p>
              <p className="tabular font-semibold">$549.480</p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="conecta"
        className="mx-auto grid max-w-[88rem] gap-14 px-6 py-24 lg:grid-cols-[1.05fr_0.95fr] lg:px-10 lg:py-32"
      >
        <div data-reveal>
          <p className="text-sm font-semibold text-primary">Conecta tu banco</p>
          <h2 className="mt-5 max-w-lg text-4xl leading-[0.98] font-semibold tracking-[-0.05em] lg:text-5xl">
            El plan mejora cuando ve lo que pasó.
          </h2>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground">
            LucaPlan se conecta con tus bancos a través de Fintoc para llevar
            los movimientos al presupuesto que corresponde.
          </p>
        </div>
        <div className="grid content-center gap-8 lg:border-l lg:border-border lg:pl-16">
          <div data-reveal style={delay(100)} className="flex gap-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
              <LockKeyhole className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xl font-medium">Solo lectura</p>
              <p className="mt-2 leading-7 text-muted-foreground">
                Tus datos aportan contexto. LucaPlan no mueve dinero ni pide
                que cambies tu forma de pagar.
              </p>
            </div>
          </div>
          <div data-reveal style={delay(200)} className="flex gap-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
              <ArrowLeftRight className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xl font-medium">Movimientos para decidir</p>
              <p className="mt-2 leading-7 text-muted-foreground">
                Cada transacción aterriza donde te ayuda a saber cuánto puedes
                gastar este mes.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[88rem] px-6 pb-12 lg:px-10">
        <div
          data-reveal
          className="relative overflow-hidden rounded-3xl bg-primary px-7 py-16 text-primary-foreground sm:px-12 lg:py-20"
        >
          <div className="absolute -top-32 -right-24 size-96 rounded-full border-[36px] border-primary-foreground/10" />
          <div className="absolute -bottom-44 -left-20 size-80 rounded-full bg-primary-foreground/5" />
          <p className="relative text-sm font-semibold">LucaPlan</p>
          <h2 className="relative mt-5 max-w-2xl text-4xl leading-[0.98] font-semibold tracking-[-0.05em] lg:text-5xl">
            Un plan más claro para el mes que viene.
          </h2>
          <Link
            href="/login"
            className="relative mt-9 inline-flex rounded-full bg-primary-foreground px-6 py-3.5 text-sm font-semibold text-primary transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:scale-[0.98]"
          >
            Crear mi plan
          </Link>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[88rem] flex-col gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-10">
        <p className="font-medium text-foreground">LucaPlan</p>
        <p>Finanzas personales, un mes a la vez.</p>
      </footer>
    </main>
  )
}
