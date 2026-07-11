"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowLeftRight, ArrowRight, LockKeyhole, NotebookPen, Repeat2, Sparkles } from "lucide-react"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { ScrollArea } from "@/components/ui/scroll-area"
import { LEGAL, type LegalKey } from "@/components/landing/legal-content"
import { AccountCard } from "@/components/finance/account-card"
import { MovementRow } from "@/components/finance/movement-row"
import { ProgressRing } from "@/components/finance/progress-ring"
import { CategoryIcon } from "@/components/finance/category-icons"
import type {
  AccountDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

// Modo landing-only (deploy público sin app): los CTAs apuntan al repo en vez de /login.
// El bloqueo real de /login y demás rutas lo hace proxy.ts con la misma env.
const LANDING_ONLY = process.env.NEXT_PUBLIC_LANDING_ONLY === "true"
const GITHUB_URL = "https://github.com/WDCPrado/lucaplan-app"
const LINKEDIN_URL = "https://www.linkedin.com/in/welliton-da-costa-prado-5050b4251"

// Iconos de marca inline (lucide los deprecó); mismo patrón que GoogleIcon en el login.
function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4.5" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4.5" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
    </svg>
  )
}
const cta = LANDING_ONLY
  ? { href: GITHUB_URL, enter: "GitHub", create: "Ver en GitHub", target: "_blank", rel: "noopener noreferrer" }
  : { href: "/login", enter: "Entrar", create: "Crear mi plan", target: undefined, rel: undefined }

const monthStats = [
  ["Lo que entra", "$1.480.000", "Tus ingresos del mes"],
  ["Lo que reservaste", "$850.000", "Categorías con un límite real"],
  ["Lo que queda", "$429.500", "Espacio para decidir hoy"],
] as const

// Demo con los componentes REALES de la app (mismos que usa el dashboard).
const demoAccount: AccountDTO = {
  id: "demo",
  bankId: "demo",
  bankName: "Banco de Chile",
  name: "Cuenta corriente",
  accountType: "checking",
  currency: "CLP",
  balance: 1248500,
  color: null,
  cardLast4: "4821",
  provider: "fintoc",
  lastSyncedAt: null,
}

const demoMovements: TransactionDTO[] = [
  {
    id: "m1", accountId: "demo", currency: "CLP", editable: false,
    description: "Jumbo Costanera", amount: 68450, direction: "debit",
    date: "", status: "confirmed", categoryId: "c1", categoryName: "Supermercado",
    categoryIcon: "ShoppingCart", categoryColor: "#4f6ef7", remaining: 239250, categoryLimit: 650000,
  },
  {
    id: "m2", accountId: "demo", currency: "CLP", editable: false,
    description: "Sueldo julio", amount: 1480000, direction: "credit",
    date: "", status: "confirmed", categoryId: "c2", categoryName: "Sueldo",
    categoryIcon: "TrendingUp", categoryColor: "#22a06b", remaining: null, categoryLimit: null,
  },
  {
    id: "m3", accountId: "demo", currency: "CLP", editable: false,
    description: "Carga Bip!", amount: 15200, direction: "debit",
    date: "", status: "confirmed", categoryId: "c3", categoryName: "Transporte",
    categoryIcon: "Bus", categoryColor: "#0e9488", remaining: 64800, categoryLimit: 100000,
  },
]

const demoBudgets = [
  { name: "Supermercado", icon: "ShoppingCart", color: "#4f6ef7", pct: 63, status: "bueno", available: "$239.250" },
  { name: "Transporte", icon: "Bus", color: "#0e9488", pct: 34, status: "bueno", available: "$64.800" },
  { name: "Ocio", icon: "Film", color: "#e8618c", pct: 86, status: "moderado", available: "$16.800" },
] as const

// Movimientos "crudos" del banco ya categorizados por la IA (descripciones bancarias reales).
const demoCategorized: TransactionDTO[] = [
  {
    id: "ai1", accountId: "demo", currency: "CLP", editable: false,
    description: "Pago:payu *uber eats", amount: 12990, direction: "debit",
    date: "", status: "confirmed", categoryId: "c4", categoryName: "Comida",
    categoryIcon: "Utensils", categoryColor: "#e8618c", remaining: null, categoryLimit: null,
  },
  {
    id: "ai2", accountId: "demo", currency: "CLP", editable: false,
    description: "Pago:red Movilidad San", amount: 815, direction: "debit",
    date: "", status: "confirmed", categoryId: "c3", categoryName: "Transporte",
    categoryIcon: "Bus", categoryColor: "#0e9488", remaining: null, categoryLimit: null,
  },
  {
    id: "ai3", accountId: "demo", currency: "CLP", editable: false,
    description: "Pago:unimarc Vitacura", amount: 6040, direction: "debit",
    date: "", status: "confirmed", categoryId: "c1", categoryName: "Supermercado",
    categoryIcon: "ShoppingCart", categoryColor: "#4f6ef7", remaining: null, categoryLimit: null,
  },
]

const aiSources = [
  {
    Icon: Sparkles,
    title: "Entiende el lenguaje bancario",
    body: "«Pago:payu *uber eats» es comida, no un misterio. La IA lee la descripción cruda del banco y la clasifica sola.",
  },
  {
    Icon: NotebookPen,
    title: "Tus categorías explican qué son",
    body: "Cada categoría lleva una descripción tuya, y la IA la usa como contexto. Tú defines qué significa «Cuentas» en tu vida.",
  },
  {
    Icon: Repeat2,
    title: "Aprende de tus correcciones",
    body: "Cuando recategorizas un movimiento, tu elección queda guardada y afina las siguientes pasadas. Funciona en cualquier país y banco: aprende de tus datos, no de listas fijas.",
  },
] as const

const delay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties

export default function Home() {
  const [legal, setLegal] = useState<LegalKey | null>(null)

  // ponytail: useEffect legítimo — sincroniza con IntersectionObserver y el scroll del DOM
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

    // Navbar: gana fondo/borde/sombra al scrollear.
    const nav = document.getElementById("landing-nav")
    const onScroll = () => {
      if (window.scrollY > 24) nav?.setAttribute("data-stuck", "")
      else nav?.removeAttribute("data-stuck")
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      io.disconnect()
      window.removeEventListener("scroll", onScroll)
    }
  }, [])

  return (
    // overflow-x-clip (no hidden): recorta los decorativos sin romper el sticky del navbar.
    // isolate: permite pintar el mesh (-z-10) sobre el fondo del main pero bajo el contenido.
    <main data-landing className="relative isolate overflow-x-clip bg-background text-foreground">
      {/* Mesh degradado continuo detrás del navbar y el hero (sin cortes) */}
      <div
        aria-hidden="true"
        className="landing-glow pointer-events-none absolute inset-x-0 top-0 -z-10 h-[52rem]"
      />
      {/* Navbar: píldora flotante arriba; al scrollear se expande a barra full-width con fondo */}
      <nav
        id="landing-nav"
        aria-label="Principal"
        className="group sticky top-0 z-50 px-4 transition-[padding] duration-300 data-stuck:px-0 lg:px-6"
      >
        <div className="mx-auto mt-4 flex h-16 max-w-5xl items-center justify-between rounded-full border border-border/70 bg-background/85 px-6 shadow-lg shadow-black/5 backdrop-blur-xl transition-all duration-300 group-data-stuck:mt-0 group-data-stuck:h-18 group-data-stuck:max-w-[120rem] group-data-stuck:rounded-none group-data-stuck:border-x-0 group-data-stuck:border-t-0 group-data-stuck:shadow-sm">
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
            <a href="#app" className="transition-colors hover:text-foreground">
              La app
            </a>
            <a
              href="#conecta"
              className="transition-colors hover:text-foreground"
            >
              Conecta tu banco
            </a>
          </div>
          <Link
            href={cta.href}
            target={cta.target}
            rel={cta.rel}
            className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors duration-200 hover:border-foreground hover:bg-foreground hover:text-background"
          >
            {cta.enter}
          </Link>
        </div>
      </nav>

      <section className="relative border-b border-border">
        <div className="relative z-10 mx-auto grid max-w-[88rem] gap-12 px-6 pt-10 pb-16 lg:grid-cols-[0.92fr_1.08fr] lg:px-10 lg:pt-16 lg:pb-24">
          <div className="flex max-w-2xl flex-col justify-center py-6 lg:py-12">
            <p data-reveal className="text-sm font-semibold text-primary">
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
              Presupuestos que reinician contigo, pagos visibles y tus
              movimientos en un solo lugar.
            </p>
            <div
              data-reveal
              style={delay(240)}
              className="mt-9 flex flex-wrap items-center gap-5"
            >
              <Link
                href={cta.href}
                target={cta.target}
                rel={cta.rel}
                className="rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/30 active:translate-y-0 active:scale-[0.98]"
              >
                {cta.create}
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
            <div className="landing-float-a absolute -top-5 -left-6 hidden rounded-2xl border border-border bg-card px-5 py-4 shadow-lg lg:block">
              <p className="text-xs text-muted-foreground">Próximo pago</p>
              <p className="mt-1 font-medium">Spotify, mañana</p>
            </div>
          </div>
        </div>
      </section>

      <section
        id="mes"
        className="mx-auto grid max-w-[88rem] scroll-mt-24 gap-12 px-6 py-24 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16 lg:px-10 lg:py-32"
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
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-sm sm:grid-cols-[1.2fr_0.8fr]">
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

      <section id="app" className="scroll-mt-24 border-y border-border bg-secondary/60">
        <div className="mx-auto grid max-w-[88rem] gap-16 px-6 py-24 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:px-10 lg:py-36">
          <div data-reveal>
            <p className="text-sm font-semibold text-primary">La app</p>
            <h2 className="mt-5 max-w-md text-4xl leading-[0.98] font-semibold tracking-[-0.05em] lg:text-5xl">
              Tal cual la vas a usar.
            </h2>
            <p className="mt-7 max-w-lg text-lg leading-8 text-muted-foreground">
              Cada gasto aterriza en su categoría y descuenta su presupuesto al
              instante. Tus cuentas, movimientos y límites del mes, en una sola
              pantalla.
            </p>
          </div>

          {/* Collage con los componentes reales del dashboard */}
          <div className="relative mx-auto w-full max-w-xl lg:min-h-[33rem]">
            <div
              data-reveal
              className="rounded-3xl border border-border bg-card p-4 shadow-xl lg:absolute lg:inset-x-0 lg:top-10"
            >
              <div className="flex items-center justify-between px-3 pt-2 pb-4">
                <p className="font-heading font-bold">Movimientos</p>
                <p className="text-sm text-muted-foreground">Julio</p>
              </div>
              <div className="flex flex-col gap-0.5 pb-2">
                {demoMovements.map((tx) => (
                  <MovementRow key={tx.id} tx={tx} />
                ))}
              </div>
            </div>

            <div
              data-reveal
              style={delay(150)}
              className="z-10 mt-6 lg:absolute lg:-top-16 lg:-right-6 lg:mt-0 lg:rotate-2"
            >
              <div className="landing-float-a rounded-3xl border border-border bg-card p-5 shadow-2xl">
                <p className="font-heading pb-4 text-sm font-bold">
                  Presupuestos
                </p>
                <div className="flex gap-5">
                  {demoBudgets.map((b) => (
                    <div key={b.name} className="flex flex-col items-center gap-1.5">
                      <ProgressRing percent={b.pct} status={b.status} size={64} stroke={6}>
                        <CategoryIcon icon={b.icon} size={20} color={b.color} />
                      </ProgressRing>
                      <div className="text-center">
                        <div className="text-xs font-medium">{b.name}</div>
                        <div className="tabular text-xs text-muted-foreground">
                          {b.available}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div
              data-reveal
              style={delay(300)}
              className="z-10 mt-6 w-72 max-w-full lg:absolute lg:top-82 lg:-left-14 lg:mt-0 lg:-rotate-3"
            >
              <div className="landing-float-b drop-shadow-2xl">
                <AccountCard account={demoAccount} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="categorias"
        className="mx-auto grid max-w-[88rem] scroll-mt-24 gap-16 px-6 py-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-10 lg:py-32"
      >
        {/* Demo visual: movimientos crudos ya categorizados + el diálogo de recategorización */}
        <div className="relative order-2 mx-auto w-full max-w-xl lg:order-1 lg:min-h-120">
          <div
            data-reveal
            className="rounded-3xl border border-border bg-card p-4 shadow-xl lg:absolute lg:inset-x-0 lg:top-0"
          >
            <div className="flex items-center justify-between px-3 pt-2 pb-3">
              <p className="font-heading font-bold">Recién importados</p>
              <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Sparkles className="size-3.5" aria-hidden="true" />
                Categorizado con IA
              </span>
            </div>
            <div className="flex flex-col gap-0.5 pb-2">
              {demoCategorized.map((tx) => (
                <MovementRow key={tx.id} tx={tx} />
              ))}
            </div>
          </div>

          <div
            data-reveal
            style={delay(200)}
            className="z-10 mt-6 lg:absolute lg:right-0 lg:-bottom-4 lg:mt-0 lg:max-w-sm lg:rotate-2"
          >
            <div className="landing-float-b rounded-2xl border border-border bg-card p-5 shadow-2xl">
              <p className="text-sm leading-6 font-medium">
                ¿Aplicar «Comida» a los otros 8 movimientos con este mismo
                texto?
              </p>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                LucaPlan guardará tu elección y la usará para categorizar
                mejor la próxima vez.
              </p>
              <div className="mt-4 flex gap-2" aria-hidden="true">
                <span className="grid flex-1 place-items-center rounded-full border border-border py-2 text-sm font-medium text-muted-foreground">
                  Solo esta
                </span>
                <span className="grid flex-1 place-items-center rounded-full bg-primary py-2 text-sm font-semibold text-primary-foreground">
                  Aplicar a todos
                </span>
              </div>
            </div>
          </div>
        </div>

        <div data-reveal className="order-1 lg:order-2">
          <p className="text-sm font-semibold text-primary">
            Categorización con IA
          </p>
          <h2 className="mt-5 max-w-md text-4xl leading-[0.98] font-semibold tracking-[-0.05em] lg:text-5xl">
            Se ordena solo. Y aprende de ti.
          </h2>
          <div className="mt-8 grid gap-7">
            {aiSources.map(({ Icon, title, body }, i) => (
              <div key={title} data-reveal style={delay(100 + i * 100)} className="flex gap-5">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xl font-medium">{title}</p>
                  <p className="mt-2 leading-7 text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="conecta"
        className="mx-auto grid max-w-[88rem] scroll-mt-24 gap-14 border-t border-border px-6 py-24 lg:grid-cols-[1.05fr_0.95fr] lg:px-10 lg:py-32"
      >
        <div data-reveal>
          <p className="text-sm font-semibold text-primary">Conecta tu banco</p>
          <h2 className="mt-5 max-w-lg text-4xl leading-[0.98] font-semibold tracking-[-0.05em] lg:text-5xl">
            El plan mejora cuando ve lo que pasó.
          </h2>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground">
            LucaPlan se conecta con tu banco mediante un conector open source
            que corre en tu propio equipo, y lleva los movimientos al
            presupuesto que corresponde.
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
          className="relative overflow-hidden rounded-3xl bg-primary px-7 py-16 text-primary-foreground shadow-2xl shadow-primary/25 sm:px-12 lg:py-20"
        >
          <div className="absolute -top-32 -right-24 size-96 rounded-full border-[36px] border-primary-foreground/10" />
          <div className="absolute -bottom-44 -left-20 size-80 rounded-full bg-primary-foreground/5" />
          <p className="relative text-sm font-semibold">LucaPlan</p>
          <h2 className="relative mt-5 max-w-2xl text-4xl leading-[0.98] font-semibold tracking-[-0.05em] lg:text-5xl">
            Un plan más claro para el mes que viene.
          </h2>
          <Link
            href={cta.href}
            target={cta.target}
            rel={cta.rel}
            className="relative mt-9 inline-flex rounded-full bg-primary-foreground px-6 py-3.5 text-sm font-semibold text-primary transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:scale-[0.98]"
          >
            {cta.create}
          </Link>
        </div>
      </section>

      <footer className="border-t border-border bg-secondary/40">
        <div className="mx-auto max-w-[88rem] px-6 py-14 lg:px-10">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="max-w-xs">
              <div className="flex items-center gap-2.5 font-semibold tracking-[-0.04em]">
                <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                  L
                </span>
                LucaPlan
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                Finanzas personales, un mes a la vez. Hecho en Chile.
              </p>
            </div>

            <nav aria-label="Producto" className="text-sm">
              <p className="font-semibold">Producto</p>
              <ul className="mt-4 space-y-3 text-muted-foreground">
                <li><a href="#mes" className="transition-colors hover:text-foreground">El mes</a></li>
                <li><a href="#app" className="transition-colors hover:text-foreground">La app</a></li>
                <li><a href="#categorias" className="transition-colors hover:text-foreground">Categorización con IA</a></li>
                <li><a href="#conecta" className="transition-colors hover:text-foreground">Conecta tu banco</a></li>
                <li><Link href={cta.href} target={cta.target} rel={cta.rel} className="transition-colors hover:text-foreground">{cta.enter}</Link></li>
              </ul>
            </nav>

            <nav aria-label="Legal" className="text-sm">
              <p className="font-semibold">Legal</p>
              <ul className="mt-4 space-y-3 text-muted-foreground">
                <li>
                  <button onClick={() => setLegal("terminos")} className="transition-colors hover:text-foreground">
                    Términos y Condiciones
                  </button>
                </li>
                <li>
                  <button onClick={() => setLegal("privacidad")} className="transition-colors hover:text-foreground">
                    Política de Privacidad
                  </button>
                </li>
              </ul>
            </nav>

            <div className="text-sm">
              <p className="font-semibold">Seguridad</p>
              <p className="mt-4 max-w-xs leading-6 text-muted-foreground">
                Conexión bancaria de solo lectura con un conector open source
                que corre en tu propio equipo: tus credenciales nunca salen de
                tu dispositivo y LucaPlan no puede mover tu dinero.
              </p>
            </div>
          </div>

          <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              © 2026 LucaPlan · Open source, hecho por{" "}
              <a
                href={LINKEDIN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 transition-colors hover:text-foreground"
              >
                Welliton da Costa Prado
              </a>
              .
            </p>
            <div className="flex items-center gap-5">
              <p>Tratamiento de datos conforme a la Ley 21.719 (Chile).</p>
              <div className="flex items-center gap-1">
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub"
                  className="grid size-9 place-items-center rounded-md transition-colors hover:text-foreground"
                >
                  <GitHubIcon />
                </a>
                <a
                  href={LINKEDIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="LinkedIn"
                  className="grid size-9 place-items-center rounded-md transition-colors hover:text-foreground"
                >
                  <LinkedInIcon />
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {legal && (
        <ResponsiveModal
          open
          onOpenChange={(o) => !o && setLegal(null)}
          title={LEGAL[legal].title}
          // force-light: el portal se monta fuera de [data-landing]; sin esto, con tema
          // dark el modal saldría oscuro sobre una landing siempre clara.
          className="force-light sm:max-w-2xl"
        >
          <ScrollArea className="max-h-[62dvh] px-6">
            <div className="pb-8">{LEGAL[legal].body}</div>
          </ScrollArea>
        </ResponsiveModal>
      )}
    </main>
  )
}
