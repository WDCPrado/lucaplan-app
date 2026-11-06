"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { GitHubIcon } from "./brand-icons"
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
  const [copied, setCopied] = useState<"ok" | "error" | null>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMANDS.join("\n"))
      setCopied("ok")
    } catch {
      setCopied("error")
    }
    setTimeout(() => setCopied(null), 2000)
  }
  return (
    <section
      id="open-source"
      className="scroll-mt-24 border-y border-border bg-secondary/50"
    >
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:items-center lg:gap-16 lg:px-8 lg:py-28">
        <div data-reveal className="max-w-lg">
          <h2 className="text-[clamp(2rem,4.5vw,3rem)] leading-[1.05] font-bold tracking-[-0.03em] text-balance">
            Código abierto. Revisa cada línea.
          </h2>
          <p className="mt-5 text-title-3 font-normal text-pretty text-muted-foreground">
            Licencia MIT. Lee cómo se procesan tus correos o instálalo en tu
            propio servidor.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="press flex min-h-12 items-center gap-2 rounded-full bg-foreground px-6 text-body font-semibold text-background hover:bg-foreground/85"
            >
              <GitHubIcon />
              Ver en GitHub
            </a>
            <a
              href={`${GITHUB_URL}/blob/master/docs/self-hosting.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="press flex min-h-12 items-center rounded-full bg-(--glass-control) px-6 text-body font-medium hover:bg-foreground/10"
            >
              Guía de self-hosting
            </a>
          </div>
        </div>

        <div data-reveal style={{ "--reveal-delay": "120ms" } as React.CSSProperties} className="min-w-0">
          <div className="overflow-hidden rounded-xl bg-card">
            <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border pr-1.5 pl-4">
              <p className="text-subheadline font-semibold">Correrlo en local</p>
              <button
                type="button"
                onClick={copy}
                className="press flex min-h-11 items-center gap-1.5 rounded-full px-3 text-subheadline text-primary hover:bg-foreground/5"
              >
                {copied === "ok" ? (
                  <Check aria-hidden className="size-4" />
                ) : (
                  <Copy aria-hidden className="size-4" />
                )}
                {copied === "ok" ? "Copiado" : copied === "error" ? "No se pudo copiar" : "Copiar"}
              </button>
            </div>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-footnote leading-6">
              <code>
                {COMMANDS.map((c) => (
                  <span key={c} className="block">
                    <span aria-hidden className="text-muted-foreground select-none">$ </span>
                    {c}
                  </span>
                ))}
              </code>
            </pre>
          </div>
          <p className="mt-3 px-4 text-footnote text-pretty text-muted-foreground">
            Necesitas Node 20.9+, pnpm y Docker. <code className="font-mono">setup:db</code>{" "}
            levanta PostgreSQL y borra esa base local. Abre localhost:3005 y entra
            con <span className="font-mono">demo@lucaplan.cl</span> y el código{" "}
            <span className="font-mono">000000</span>.
          </p>
          <span aria-live="polite" className="sr-only">
            {copied === "ok" ? "Comandos copiados" : copied === "error" ? "No se pudo copiar" : ""}
          </span>
        </div>
      </div>
    </section>
  )
}
