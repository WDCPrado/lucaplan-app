"use client"

import { useState } from "react"
import { useTheme } from "next-themes"
import { Check, Copy, Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { ScrollArea } from "@/components/ui/scroll-area"
import { LEGAL, type LegalKey } from "@/components/landing/legal-content"
import { EmailCodeForm } from "./email-code-form"

const LANDING_ONLY = process.env.NEXT_PUBLIC_LANDING_ONLY === "true"
const GITHUB_URL = "https://github.com/WDCPrado/lucaplan-app"

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Cambiar tema"
      className="absolute top-4 right-4 z-10 size-11 text-ink-2"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-5 dark:hidden" />
      <Moon className="hidden size-5 dark:block" />
    </Button>
  )
}

// Marca GitHub inline (mismo patrón que GoogleIcon; lucide deprecó los iconos de marca).
function GitHubIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-4.5"
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

// Vitrina: Luca Plan es open source y también se instala local.
function OpenSourceNotice() {
  const [copied, setCopied] = useState(false)
  const cloneCmd = `git clone ${GITHUB_URL}.git`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cloneCmd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Sin permiso de clipboard: el comando queda visible para copiarlo a mano.
    }
  }

  return (
    <section
      aria-labelledby="open-source-title"
      className="mt-4 flex flex-col gap-3 rounded-xl bg-card p-(--pad-card)"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-secondary">
          <GitHubIcon />
        </span>
        <div className="min-w-0">
          <h2 id="open-source-title" className="font-semibold">
            ¿Quieres tu propio Luca Plan?
          </h2>
          <p className="text-callout text-ink-2">
            Es open source: clónalo y córrelo en tu máquina, con tus datos.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label="Copiar comando"
        title="Copiar comando"
        className="press group/copy flex min-h-(--ctl) w-full items-center gap-2.5 rounded-md bg-secondary px-3 text-left hover:bg-surface-3"
      >
        <code className="flex-1 scrollbar-none overflow-x-auto font-mono text-caption whitespace-nowrap text-ink-2">
          {cloneCmd}
        </code>
        {copied ? (
          <Check className="size-4 shrink-0 text-success" />
        ) : (
          <Copy className="size-4 shrink-0 text-ink-3 transition-colors group-hover/copy:text-foreground" />
        )}
      </button>
      <Button asChild variant="outline" size="lg" className="w-full">
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          <GitHubIcon />
          Ver en GitHub
        </a>
      </Button>
    </section>
  )
}

export function LoginForm({
  signupOpen,
  codeInConsole,
}: {
  signupOpen: boolean
  codeInConsole: boolean
}) {
  const [legal, setLegal] = useState<LegalKey | null>(null)
  return (
    <main className="relative flex min-h-dvh flex-col items-center bg-background px-4 pt-16 pb-10 md:justify-center md:py-16">
      <ThemeToggle />

      {/* Una columna sobre papel: marca, título, el paso del formulario en su tarjeta y los legales. */}
      <div className="flex w-full max-w-100 animate-in flex-col duration-300 fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-md bg-primary font-semibold text-primary-foreground"
          >
            L
          </span>
          <span className="font-semibold">Luca Plan</span>
        </div>

        <h1 className="mt-8 text-screen-title font-semibold text-balance">
          {signupOpen ? "Entra o crea tu cuenta" : "Entra a tu plan"}
        </h1>

        <div className="mt-4 rounded-xl bg-card p-(--pad-card)">
          <EmailCodeForm signupOpen={signupOpen} codeInConsole={codeInConsole} />
        </div>
        {LANDING_ONLY && <OpenSourceNotice />}

        <p className="mt-6 text-center text-caption text-ink-3">
          Al continuar aceptas los{" "}
          <button
            type="button"
            onClick={() => setLegal("terminos")}
            className="underline underline-offset-2 transition-colors hover:text-foreground"
          >
            Términos y Condiciones
          </button>{" "}
          y la{" "}
          <button
            type="button"
            onClick={() => setLegal("privacidad")}
            className="underline underline-offset-2 transition-colors hover:text-foreground"
          >
            Política de Privacidad
          </button>
          .
        </p>
      </div>

      {/* Legales: mismo contenido que la landing; aquí respetan el tema del usuario */}
      {legal && (
        <ResponsiveModal
          open
          onOpenChange={(o) => !o && setLegal(null)}
          title={LEGAL[legal].title}
        >
          <ScrollArea className="max-h-[62dvh]">
            <div>{LEGAL[legal].body}</div>
          </ScrollArea>
        </ResponsiveModal>
      )}
    </main>
  )
}
