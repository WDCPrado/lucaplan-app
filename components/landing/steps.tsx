"use client"

import { Lock } from "lucide-react"
import { CategoryIcon } from "@/components/finance/category-icons"
import { MovementRow } from "@/components/finance/movement-row"
import { OutlookIcon } from "@/app/login/mail-app-icons"
import { SCAN_LOOKBACK_MONTHS } from "@/lib/onboarding-schemas"
import { importedMovements, onboardingCategories } from "./landing-data"

const delay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties

const STEP_GAP = 220 // ms entre un paso y el siguiente: se leen en orden, como el onboarding

// «Así empiezas»: los pasos reales del onboarding. Al entrar en pantalla la línea se llena y cada
// paso aparece tras el anterior; con movimiento reducido todo queda visible y quieto.
export function Steps() {
  const steps = [
    {
      title: "Crea tu cuenta",
      body: "Escribe tu correo y entra con el código de 6 dígitos que te llega. Sin contraseñas.",
      visual: (
        <div aria-hidden className="flex gap-1.5">
          {"482107".split("").map((d, i) => (
            <span
              key={i}
              className="tabular grid h-11 w-9 place-items-center rounded-lg bg-card text-title-3 font-semibold"
            >
              {d}
            </span>
          ))}
        </div>
      ),
    },
    {
      title: "Cuéntale tu día a día",
      body: "Dónde compras, cómo te mueves, qué pagas cada mes. La IA arma tus categorías y tú las ajustas.",
      visual: (
        <div aria-hidden className="flex flex-col gap-2">
          <p className="rounded-lg bg-card px-3 py-2 text-subheadline text-pretty text-muted-foreground">
            «Compro en el Jumbo, ando en metro, voy al gimnasio y tengo un perro.»
          </p>
          <div className="flex flex-wrap gap-1.5">
            {onboardingCategories.map((c) => (
              <span
                key={c.name}
                className="flex items-center gap-1.5 rounded-lg bg-card py-1 pr-2.5 pl-1 text-footnote font-medium"
              >
                <span
                  className="grid size-6 place-items-center rounded-md text-white"
                  style={{ background: c.color }}
                >
                  <CategoryIcon icon={c.icon} size={14} />
                </span>
                {c.name}
              </span>
            ))}
          </div>
        </div>
      ),
    },
    {
      title: "Conecta tu Outlook",
      body: "Con permiso de solo lectura, revocable cuando quieras. Luca Plan lee solo los avisos de tu banco.",
      visual: (
        <div
          aria-hidden
          className="flex items-center gap-3 rounded-lg bg-card px-3 py-2.5"
        >
          <OutlookIcon className="size-7 shrink-0" />
          <div className="min-w-0">
            <p className="text-subheadline font-medium">Outlook</p>
            <p className="flex items-center gap-1 text-footnote text-muted-foreground">
              <Lock className="size-3" />
              Solo lectura de correo
            </p>
          </div>
        </div>
      ),
    },
    {
      title: "Tus últimos meses, ya ordenados",
      body: `Se importan los avisos de los últimos ${SCAN_LOOKBACK_MONTHS} meses, categorizados, y tu plan parte con datos reales.`,
      visual: (
        <div
          aria-hidden
          className="inset-list overflow-hidden rounded-lg bg-card [--inset:4rem]"
        >
          {importedMovements.map((tx) => (
            <MovementRow
              key={tx.id}
              tx={tx}
              className="min-h-11 rounded-none px-3"
            />
          ))}
        </div>
      ),
    },
  ]

  return (
    <section
      id="empieza"
      className="scroll-mt-24 border-y border-border bg-secondary/50"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 lg:px-8 lg:py-28">
        <h2
          data-reveal
          className="max-w-xl text-[clamp(2rem,4.5vw,3rem)] leading-[1.05] font-bold tracking-[-0.03em] text-balance"
        >
          Así empiezas. Cuatro pasos y tu mes ya tiene datos.
        </h2>

        <ol data-reveal className="group relative mt-14 grid gap-10 lg:grid-cols-4 lg:gap-6">
          {/* La línea que une los pasos: vertical en móvil, horizontal en escritorio. */}
          <span
            aria-hidden
            className="absolute top-2 bottom-2 left-[1.0625rem] w-0.5 origin-top scale-y-0 rounded-full bg-primary transition-transform duration-[1400ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-[.is-visible]:scale-y-100 motion-reduce:scale-y-100 motion-reduce:transition-none lg:top-[1.0625rem] lg:right-[calc(25%-2.25rem)] lg:bottom-auto lg:left-[1.125rem] lg:h-0.5 lg:w-auto lg:origin-left lg:scale-x-0 lg:scale-y-100 lg:group-[.is-visible]:scale-x-100 lg:motion-reduce:scale-x-100"
          />
          {steps.map((s, i) => (
            <li
              key={s.title}
              data-reveal
              style={delay(200 + i * STEP_GAP)}
              className="relative grid grid-cols-[2.25rem_1fr] gap-x-4 lg:grid-cols-1 lg:gap-y-5"
            >
              <span
                aria-hidden
                className="tabular relative z-10 grid size-9 place-items-center rounded-full bg-primary text-subheadline font-bold text-primary-foreground"
              >
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-4">
                <div>
                  <h3 className="text-headline font-semibold">
                    <span className="sr-only">Paso {i + 1}: </span>
                    {s.title}
                  </h3>
                  <p className="mt-1.5 text-subheadline text-pretty text-muted-foreground">
                    {s.body}
                  </p>
                </div>
                {s.visual}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
