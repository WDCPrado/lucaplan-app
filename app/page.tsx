import Image from "next/image"
import Link from "next/link"

const recurringPayments = [
  ["Arriendo", "28 jul", "$520.000"],
  ["Internet", "02 ago", "$19.990"],
  ["Netflix", "08 ago", "$9.490"],
]

export default function Home() {
  return (
    <main
      data-landing
      className="overflow-hidden bg-background text-foreground"
    >
      <section className="relative min-h-[100dvh] overflow-hidden border-b border-border">
        <div className="absolute inset-x-0 top-0 h-[38rem] bg-[radial-gradient(circle_at_72%_18%,oklch(0.42_0.2_255_/_0.46),transparent_32%),radial-gradient(circle_at_20%_20%,oklch(0.3_0.11_265_/_0.55),transparent_38%)]" />
        <nav
          className="landing-reveal relative z-10 mx-auto flex h-20 max-w-[88rem] items-center justify-between px-6 lg:px-10"
          aria-label="Principal"
        >
          <Link
            href="/"
            className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.05em]"
          >
            <span className="grid size-8 place-items-center rounded-[0.55rem] bg-[oklch(0.92_0.18_110)] text-sm font-bold text-[oklch(0.18_0.04_255)]">
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
            className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-foreground hover:bg-foreground hover:text-background"
          >
            Entrar
          </Link>
        </nav>

        <div className="relative z-10 mx-auto grid max-w-[88rem] gap-10 px-6 pt-10 pb-12 lg:grid-cols-[0.92fr_1.08fr] lg:px-10 lg:pt-14">
          <div className="flex max-w-2xl flex-col justify-center py-8 lg:pt-14 lg:pb-20">
            <p className="landing-reveal landing-delay-1 text-sm font-medium text-[oklch(0.92_0.18_110)]">
              Finanzas personales, por mes
            </p>
            <h1 className="landing-reveal landing-delay-2 mt-6 max-w-[9ch] text-6xl leading-[0.88] font-semibold tracking-[-0.075em] text-balance lg:text-8xl">
              Este mes sí tiene un plan.
            </h1>
            <p className="landing-reveal landing-delay-3 mt-7 max-w-md text-lg leading-8 text-muted-foreground">
              Presupuestos que reinician contigo, pagos recurrentes visibles y
              tus movimientos en un solo lugar.
            </p>
            <div className="landing-reveal landing-delay-4 mt-9 flex flex-wrap items-center gap-4">
              <Link
                href="/login"
                className="rounded-full bg-[oklch(0.92_0.18_110)] px-6 py-3.5 text-sm font-semibold text-[oklch(0.18_0.04_255)] transition-transform duration-150 ease-out active:scale-[0.97]"
              >
                Crear mi plan
              </Link>
              <a
                href="#mes"
                className="group inline-flex items-center gap-2 text-sm font-medium text-foreground"
              >
                Ver el sistema{" "}
                <span
                  className="transition-transform duration-150 ease-out group-hover:translate-x-1"
                  aria-hidden="true"
                >
                  →
                </span>
              </a>
            </div>
          </div>

          <div className="landing-reveal landing-delay-3 relative mx-auto w-full max-w-[46rem] lg:mr-0">
            <div className="absolute -inset-8 -z-10 rounded-full bg-[radial-gradient(circle,oklch(0.47_0.2_255_/_0.3),transparent_68%)] blur-2xl" />
            <div className="landing-float relative aspect-[1.18/1] overflow-hidden rounded-[2rem] border border-white/15 bg-[oklch(0.19_0.05_260)] shadow-[0_36px_100px_oklch(0.03_0.02_260_/_0.58)]">
              <Image
                src="/monthly-system.webp"
                alt="Sistema visual de planificación mensual de LucaPlan"
                fill
                unoptimized
                priority
                sizes="(min-width: 1024px) 54vw, 100vw"
                className="object-cover object-[62%_52%]"
              />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,oklch(0.17_0.05_260_/_0.45),transparent_52%)]" />
              <div className="absolute right-5 bottom-5 left-5 flex items-end justify-between rounded-2xl border border-white/15 bg-[oklch(0.19_0.05_260_/_0.82)] p-4 backdrop-blur-md">
                <div>
                  <p className="text-xs text-[oklch(0.76_0.02_250)]">
                    Presupuesto de julio
                  </p>
                  <p className="mt-1 text-2xl font-semibold tracking-[-0.05em]">
                    $429.500 disponibles
                  </p>
                </div>
                <span className="hidden rounded-full bg-[oklch(0.92_0.18_110)] px-3 py-1.5 text-xs font-semibold text-[oklch(0.18_0.04_255)] sm:block">
                  Vas bien
                </span>
              </div>
            </div>
            <div className="landing-float-slow absolute -bottom-5 -left-5 hidden rounded-2xl border border-white/15 bg-[oklch(0.23_0.06_260)] px-5 py-4 shadow-xl lg:block">
              <p className="text-xs text-muted-foreground">Próximo pago</p>
              <p className="mt-1 font-medium">Spotify, mañana</p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="mes"
        className="mx-auto grid max-w-[88rem] gap-12 px-6 py-28 lg:grid-cols-[0.72fr_1.28fr] lg:px-10"
      >
        <div className="lg:pt-8">
          <p className="text-sm font-medium text-[oklch(0.92_0.18_110)]">
            Presupuesto mensual
          </p>
          <h2 className="mt-5 max-w-sm text-5xl leading-[0.95] font-semibold tracking-[-0.065em]">
            No lleves una cuenta eterna.
          </h2>
        </div>
        <div className="border-l border-border pl-0 lg:pl-12">
          <p className="max-w-2xl text-2xl leading-tight tracking-[-0.035em] text-[oklch(0.87_0.015_250)]">
            Cada mes parte limpio. LucaPlan convierte tus gastos reales en
            decisiones para ahora, no en una cifra acumulada que ya no dice
            nada.
          </p>
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-[1.2fr_0.8fr]">
            {[
              ["Lo que entra", "$1.480.000", "Tus ingresos del mes"],
              [
                "Lo que reservaste",
                "$850.000",
                "Categorías con un límite real",
              ],
              ["Lo que queda", "$429.500", "Espacio para decidir hoy"],
            ].map(([label, value, detail], index) => (
              <div
                key={label}
                className={`bg-card p-6 ${index === 0 ? "sm:col-span-2" : ""}`}
              >
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-9 text-3xl font-semibold tracking-[-0.055em]">
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
        className="border-y border-border bg-[oklch(0.955_0.015_255)]"
      >
        <div className="mx-auto grid max-w-[88rem] gap-14 px-6 py-28 lg:grid-cols-[0.9fr_1.1fr] lg:px-10">
          <div>
            <p className="text-sm font-medium text-[oklch(0.92_0.18_110)]">
              Recurrentes
            </p>
            <h2 className="mt-5 max-w-md text-5xl leading-[0.95] font-semibold tracking-[-0.065em]">
              Lo que vuelve, se ve antes.
            </h2>
            <p className="mt-7 max-w-lg text-lg leading-8 text-muted-foreground">
              Arriendo, suscripciones o cuotas. Cada cobro frecuente queda en su
              lugar antes de que repartas el resto de tu plata.
            </p>
          </div>
          <div className="self-end rounded-[1.5rem] border border-border bg-card p-3 shadow-[0_28px_80px_oklch(0.3_0.04_260_/_0.12)]">
            <div className="flex items-center justify-between px-4 pt-3 pb-5">
              <p className="font-medium">Próximos pagos</p>
              <p className="text-sm text-muted-foreground">Julio y agosto</p>
            </div>
            <div className="space-y-1">
              {recurringPayments.map(([name, date, value]) => (
                <div
                  key={name}
                  className="group flex items-center gap-4 rounded-xl px-4 py-4 transition-colors duration-200 hover:bg-accent"
                >
                  <span className="grid size-10 place-items-center rounded-full bg-[oklch(0.29_0.07_260)] text-sm font-medium text-[oklch(0.92_0.18_110)]">
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
          </div>
        </div>
      </section>

      <section
        id="conecta"
        className="mx-auto grid max-w-[88rem] gap-14 px-6 py-28 lg:grid-cols-[1.05fr_0.95fr] lg:px-10"
      >
        <div>
          <p className="text-sm font-medium text-[oklch(0.92_0.18_110)]">
            Conecta tu banco
          </p>
          <h2 className="mt-5 max-w-lg text-5xl leading-[0.95] font-semibold tracking-[-0.065em]">
            El plan mejora cuando ve lo que pasó.
          </h2>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground">
            LucaPlan se conectará con tus bancos a través de Fintoc para llevar
            los movimientos al presupuesto que corresponde.
          </p>
        </div>
        <div className="grid content-center gap-7 border-l border-border pl-0 lg:pl-12">
          <div>
            <p className="text-xl font-medium">Solo lectura</p>
            <p className="mt-2 leading-7 text-muted-foreground">
              Tus datos aportan contexto. LucaPlan no mueve dinero ni pide que
              cambies tu forma de pagar.
            </p>
          </div>
          <div>
            <p className="text-xl font-medium">Movimientos para decidir</p>
            <p className="mt-2 leading-7 text-muted-foreground">
              Cada transacción aterriza donde te ayuda a saber cuánto puedes
              gastar este mes.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[88rem] px-6 pb-10 lg:px-10">
        <div className="relative overflow-hidden rounded-[2rem] bg-[oklch(0.92_0.18_110)] px-7 py-16 text-[oklch(0.18_0.04_255)] sm:px-12">
          <div className="absolute -top-28 -right-20 size-80 rounded-full border-[32px] border-[oklch(0.76_0.18_255_/_0.3)]" />
          <p className="relative text-sm font-semibold">LucaPlan</p>
          <h2 className="relative mt-5 max-w-2xl text-5xl leading-[0.94] font-semibold tracking-[-0.065em]">
            Un plan más claro para el mes que viene.
          </h2>
          <Link
            href="/login"
            className="relative mt-9 inline-flex rounded-full bg-[oklch(0.18_0.04_255)] px-6 py-3.5 text-sm font-semibold text-[oklch(0.97_0.01_250)] transition-transform duration-150 ease-out active:scale-[0.97]"
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
