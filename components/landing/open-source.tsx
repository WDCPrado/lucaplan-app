import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { GitHubIcon } from "./brand-icons"
import { CopyButton } from "./copy-button"
import { GITHUB_URL } from "./landing-data"

const COMMANDS = [
  "git clone https://github.com/WDCPrado/lucaplan-app.git",
  "cd lucaplan-app",
  "pnpm install",
  "cp .env.example .env",
  "pnpm setup:db",
  "pnpm dev",
]

// Open source: el repo y cómo correrlo en local, en un bloque que se copia entero. Los pasos son
// los del README (Puesta en marcha); `setup:db` siembra la cuenta demo del entorno local.
export function OpenSource() {
  return (
    <section
      id="open-source"
      className="scroll-mt-20 bg-secondary"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:items-center lg:gap-16 lg:px-8 lg:py-28">
        <div data-reveal className="max-w-lg">
          <h2 className="landing-title font-semibold text-balance">
            Código abierto. Revisa cada línea.
          </h2>
          <p className="mt-5 text-title font-normal text-pretty text-ink-2">
            Licencia MIT. Lee cómo se procesan tus correos o instálalo en tu
            propio servidor.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants(), "h-12 px-6")}
            >
              <GitHubIcon />
              Ver en GitHub
            </a>
            <a
              href={`${GITHUB_URL}/blob/master/docs/self-hosting.md`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline" }), "h-12 px-6")}
            >
              Guía de self-hosting
            </a>
          </div>
        </div>

        <div data-reveal style={{ "--reveal-delay": "120ms" } as React.CSSProperties} className="min-w-0">
          <div className="rounded-xl bg-card p-(--pad-card)">
            <div className="-mr-2 mb-3 flex items-center justify-between gap-3">
              <h3 className="text-title font-semibold text-ink-2">Correrlo en local</h3>
              <CopyButton text={COMMANDS.join("\n")} />
            </div>
            <pre className="overflow-x-auto rounded-lg bg-secondary p-4 font-mono text-caption leading-6">
              <code>
                {COMMANDS.map((c) => (
                  <span key={c} className="block">
                    <span aria-hidden className="text-ink-3 select-none">$ </span>
                    {c}
                  </span>
                ))}
              </code>
            </pre>
          </div>
          <p className="mt-3 text-callout text-pretty text-ink-2">
            Necesitas Node 20.9+, pnpm y Docker. <code className="font-mono">setup:db</code>{" "}
            levanta PostgreSQL y borra esa base local. Abre localhost:3005 y entra
            con <span className="font-mono">demo@lucaplan.cl</span> y el código{" "}
            <span className="font-mono">000000</span>.
          </p>
        </div>
      </div>
    </section>
  )
}
